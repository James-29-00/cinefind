// scripts/check-sites.js
// Reads sites.json, checks each URL, writes result to status.json
// Run automatically by .github/workflows/check-sites.yml (daily)
//
// v2: adds browser-like headers, retries for likely bot-blocks, and a
// 3-state status (up / blocked / down) so the admin panel can tell the
// difference between "confirmed dead" and "probably fine, just flagged
// as a bot by the site's protection" (Cloudflare/DDoS-Guard etc. commonly
// block GitHub Actions' datacenter IPs even when the site works fine for
// real visitors).

const fs = require('fs');
const path = require('path');

const SITES_PATH = path.join(__dirname, '..', 'sites.json');
const CUSTOM_SITES_PATH = path.join(__dirname, '..', 'custom-sites.json');
const OVERRIDES_PATH = path.join(__dirname, '..', 'overrides.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'status.json');
const TIMEOUT_MS = 10000;

// HTTP codes commonly returned by bot-protection layers (Cloudflare,
// DDoS-Guard, etc.) rather than the site actually being down.
const BLOCK_LIKE_STATUS_CODES = new Set([403, 429, 503]);

// Browser-like headers so a plain GET looks less like an obvious script.
// This won't defeat real JS-challenge pages, but it clears the simpler
// User-Agent-only checks some sites use.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.google.com/'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// A single fetch attempt. Never throws — always resolves to a result shape
// so the retry loop can decide what to do with it.
async function attemptFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: BROWSER_HEADERS
    });
    clearTimeout(timeout);
    return { ok: true, httpStatus: res.status, responseMs: Date.now() - startedAt };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : err.message
    };
  }
}

// Retries only for outcomes that look like a transient bot-block or
// network blip (403/429/503 or timeout). A hard failure like DNS
// not resolving won't get "fixed" by retrying, so we don't waste time
// retrying those — one shot is enough to call it confirmed down.
const RETRYABLE_NETWORK_ERRORS = ['timeout', 'fetch failed', 'ECONNRESET', 'ETIMEDOUT'];

async function checkSite(site, maxAttempts = 3) {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await attemptFetch(site.url);
    lastResult = result;

    if (result.ok && !BLOCK_LIKE_STATUS_CODES.has(result.httpStatus)) {
      // Clean success — no need to retry further.
      break;
    }

    const isRetryableHttp = result.ok && BLOCK_LIKE_STATUS_CODES.has(result.httpStatus);
    const isRetryableNetwork = !result.ok &&
      RETRYABLE_NETWORK_ERRORS.some(e => (result.error || '').includes(e));

    if (!isRetryableHttp && !isRetryableNetwork) {
      // Hard failure (e.g. DNS not found) — retrying won't help.
      break;
    }

    if (attempt < maxAttempts) {
      await sleep(3000 * attempt); // 3s, then 6s backoff
    }
  }

  return classifyResult(site, lastResult);
}

function classifyResult(site, result) {
  const base = { name: site.name, url: site.url, checkedAt: new Date().toISOString() };

  if (result.ok) {
    if (BLOCK_LIKE_STATUS_CODES.has(result.httpStatus)) {
      return { ...base, status: 'blocked', httpStatus: result.httpStatus };
    }
    if (result.httpStatus >= 200 && result.httpStatus < 400) {
      // Response time is only meaningful for a confirmed-up site — a
      // blocked/down result's timing doesn't tell you how fast the site
      // actually loads, so it's omitted for those branches above.
      return { ...base, status: 'up', httpStatus: result.httpStatus, avgResponseMs: Math.round(result.responseMs) };
    }
    // Other 4xx/5xx not in the block-like set (e.g. 404) — treat as down.
    return { ...base, status: 'down', httpStatus: result.httpStatus };
  }

  // Network-level failure. Timeouts after retries are ambiguous (could be
  // a slow/blocking site or a genuinely dead one) — label 'blocked' so a
  // human double-checks rather than assuming it's confirmed dead. DNS/
  // connection-refused errors are as close to "confirmed down" as this
  // script can get.
  if (result.error === 'timeout') {
    return { ...base, status: 'blocked', httpStatus: null, error: 'timeout after retries' };
  }
  return { ...base, status: 'down', httpStatus: null, error: result.error };
}

async function main() {
  const sites = JSON.parse(fs.readFileSync(SITES_PATH, 'utf-8'));

  // Same site name → key rule used by the front-end (index.html), so
  // "1Shows" / "1-Shows" / "1 Shows" all match the same override/status entry.
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // custom-sites.json — sites added later via the admin panel's "Add New
  // Website" form. Optional file; if it doesn't exist yet, just means no
  // one has added anything through the admin panel yet.
  let customSites = [];
  if (fs.existsSync(CUSTOM_SITES_PATH)) {
    try {
      customSites = JSON.parse(fs.readFileSync(CUSTOM_SITES_PATH, 'utf-8'));
    } catch (err) {
      console.warn('Could not parse custom-sites.json, skipping:', err.message);
    }
  }

  // overrides.json — live URL replacements made via the admin panel's
  // "Update Live Link" button. If a site has an override, we should check
  // THAT url (what visitors actually get sent to), not the old one in
  // sites.json — otherwise a fixed link would keep showing as "down" forever.
  let overrides = {};
  if (fs.existsSync(OVERRIDES_PATH)) {
    try {
      overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'));
    } catch (err) {
      console.warn('Could not parse overrides.json, skipping:', err.message);
    }
  }

  // Merge sites.json + custom-sites.json, de-duping by normalized name
  // (sites.json wins if somehow both define the same site), then apply any
  // live URL override on top.
  const merged = new Map();
  for (const s of [...sites, ...customSites]) {
    if (!s.name || !s.url) continue;
    const key = normalize(s.name);
    if (merged.has(key)) continue;
    const liveUrl = overrides[key] || s.url;
    merged.set(key, { name: s.name, url: liveUrl });
  }
  const allSites = Array.from(merged.values());

  console.log(`Checking ${allSites.length} sites (${sites.length} from sites.json, ${customSites.length} from custom-sites.json, ${Object.keys(overrides).length} with live overrides)...`);

  const results = [];
  // Check sequentially with small delay to avoid rate-limiting / looking like a bot flood
  for (const site of allSites) {
    const result = await checkSite(site);
    const icon = result.status === 'up' ? '✅' : result.status === 'blocked' ? '🟡' : '❌';
    console.log(`${icon} ${result.name} (${result.httpStatus || result.error})`);
    results.push(result);
    await sleep(500); // small courtesy delay between different sites
  }

  const output = {
    lastRun: new Date().toISOString(),
    totalSites: results.length,
    upCount: results.filter(r => r.status === 'up').length,
    blockedCount: results.filter(r => r.status === 'blocked').length,
    downCount: results.filter(r => r.status === 'down').length,
    results
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. ${output.upCount} up, ${output.blockedCount} blocked (needs manual check), ${output.downCount} confirmed down. Written to status.json`);
}

main().catch(err => {
  console.error('Checker failed:', err);
  process.exit(1);
});
