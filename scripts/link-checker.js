// ===== CineFind external link/site checker =====
// Runs on a GitHub Actions schedule (see .github/workflows/link-checker.yml).
// Job: read every stored link out of the D1 database, spot-check whether
// each URL still works, tell the Worker about anything dead, and confirm
// "I'm alive" via /heartbeat so the Worker's own backup sweep stays parked
// (see HEARTBEAT_STALE_MS / isCheckerAlive in worker.js — it only takes
// over reverify duty if this script stops running for 2+ days).
//
// Required environment variables (set as GitHub Actions secrets):
//   CF_API_TOKEN        - Cloudflare API token with D1:Read permission
//   CF_ACCOUNT_ID        - Cloudflare account ID
//   CF_D1_DATABASE_ID    - the "cinefind-catalog" D1 database ID
//   WORKER_URL            - e.g. https://fancy-wildflower-1260.<subdomain>.workers.dev
//   CHECKER_SECRET        - same value as the Worker's CHECKER_SECRET secret
//
// Node 20+ (GitHub's ubuntu-latest runner ships this) — uses global fetch,
// no npm dependencies.

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID;
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const CHECKER_SECRET = process.env.CHECKER_SECRET;

const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONCURRENCY = 8;
// If this share (or more) of a site's sampled links come back dead/blocked
// in the same run, treat it as a SITE problem, not individual link rot —
// flag the site instead of nuking every one of its rows. Protects against
// e.g. the site being globally down or Cloudflare-challenging every request
// getting misread as "all these links rotted".
const SITE_DOWN_THRESHOLD = 0.7;
// Minimum sample size before the threshold above is trusted — a site with
// only 2 links and 2 failures is not statistically "70% down", it's just
// unlucky. Below this, fall back to per-link handling even if 100% failed.
const MIN_SAMPLE_FOR_SITE_VERDICT = 5;
// Server-side /links-invalidate rejects any call asking to delete more than
// 20% of total D1 rows at once (see worker.js). Chunk under that with a
// safety margin so we don't get rejected on a technicality.
const CLIENT_INVALIDATE_CAP_RATIO = 0.18;

const BOT_BLOCK_SIGNS = [
  'checking your browser',
  'attention required',
  'cf-browser-verification',
  'captcha',
  'access denied',
  'just a moment',
];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function fetchAllLinks() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT site, url, normalized_title FROM links' }),
  });
  if (!res.ok) {
    throw new Error(`D1 query failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const results = data?.result?.[0]?.results;
  if (!Array.isArray(results)) {
    throw new Error('D1 query returned an unexpected shape — check CF_D1_DATABASE_ID / permissions.');
  }
  return results; // [{ site, url, normalized_title }, ...]
}

// Checks one URL. Returns 'ok' | 'dead' | 'bot_flagged' | 'transient'.
// 'transient' (timeout, 5xx, network error) is deliberately NOT treated as
// dead — could just be a slow response — so it never triggers a delete.
async function checkOne(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'GET', // HEAD is unreliable on a lot of these sites; GET + no-body-read is safer
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 404 || res.status === 410) return 'dead';
    if (res.status >= 500) return 'transient';
    if (res.status === 403 || res.status === 429) return 'bot_flagged';

    if (res.ok) {
      // Cheap peek at the body for bot-challenge pages that still return 200.
      const text = (await res.text().catch(() => '')).slice(0, 2000).toLowerCase();
      if (BOT_BLOCK_SIGNS.some((sign) => text.includes(sign))) return 'bot_flagged';
      return 'ok';
    }
    return 'transient';
  } catch (err) {
    clearTimeout(timeout);
    return 'transient'; // timeout / DNS / network error — don't punish the link for our own flakiness
  }
}

async function checkInBatches(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function runNext() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, runNext);
  await Promise.all(workers);
  return out;
}

async function postToWorker(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHECKER_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  if (!res.ok) {
    log(`  ! ${path} failed: ${res.status}`, parsed);
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function main() {
  const missing = ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_D1_DATABASE_ID', 'WORKER_URL', 'CHECKER_SECRET']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  log('Fetching all links from D1...');
  const rows = await fetchAllLinks();
  log(`Fetched ${rows.length} rows.`);
  if (!rows.length) {
    log('No links to check. Sending heartbeat and exiting.');
    await postToWorker('/heartbeat');
    return;
  }

  log(`Checking ${rows.length} URLs (concurrency ${MAX_CONCURRENCY})...`);
  const outcomes = await checkInBatches(rows, async (row) => {
    const outcome = await checkOne(row.url);
    return { ...row, outcome };
  });

  // Group by site
  const bySite = new Map();
  for (const o of outcomes) {
    const key = o.site.toLowerCase();
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(o);
  }

  const deadToInvalidate = [];
  const siteStatusCalls = [];

  for (const [site, siteRows] of bySite) {
    const total = siteRows.length;
    const deadCount = siteRows.filter((r) => r.outcome === 'dead').length;
    const botCount = siteRows.filter((r) => r.outcome === 'bot_flagged').length;
    const badCount = deadCount + botCount;

    const hasEnoughSample = total >= MIN_SAMPLE_FOR_SITE_VERDICT;
    const badRatio = total ? badCount / total : 0;

    if (hasEnoughSample && botCount / total >= SITE_DOWN_THRESHOLD) {
      log(`Site "${site}": ${botCount}/${total} bot-flagged → marking bot_flagged (not deleting individual links).`);
      siteStatusCalls.push({ site, status: 'bot_flagged' });
    } else if (hasEnoughSample && badRatio >= SITE_DOWN_THRESHOLD) {
      log(`Site "${site}": ${badCount}/${total} dead/blocked → marking down (not deleting individual links).`);
      siteStatusCalls.push({ site, status: 'down' });
    } else {
      // Site looks healthy overall — clear any stale flag, and invalidate
      // just the specific dead links (bot_flagged individual links are left
      // alone; a 403/429 on one link with the rest fine is more likely a
      // fluke than proof that specific link is gone).
      siteStatusCalls.push({ site, status: 'ok' });
      for (const r of siteRows) {
        if (r.outcome === 'dead') deadToInvalidate.push({ site, url: r.url });
      }
    }
    log(`  ${site}: ${total} checked, ${deadCount} dead, ${botCount} bot-flagged, ${total - badCount} ok`);
  }

  log(`Sending ${siteStatusCalls.length} /site-status update(s)...`);
  for (const call of siteStatusCalls) {
    await postToWorker('/site-status', call);
  }

  if (deadToInvalidate.length) {
    const cap = Math.max(1, Math.floor(rows.length * CLIENT_INVALIDATE_CAP_RATIO));
    log(`Invalidating ${deadToInvalidate.length} dead link(s) in batches of ${cap}...`);
    for (let i = 0; i < deadToInvalidate.length; i += cap) {
      const chunk = deadToInvalidate.slice(i, i + cap);
      const result = await postToWorker('/links-invalidate', { urls: chunk });
      log(`  batch ${i / cap + 1}: ${result.ok ? 'ok' : 'FAILED'}`, result.body);
    }
  } else {
    log('No individual dead links to invalidate.');
  }

  log('Sending heartbeat...');
  const hb = await postToWorker('/heartbeat');
  if (!hb.ok) {
    throw new Error('Heartbeat failed — run will be reported as failed so the Worker does not think the checker is alive.');
  }

  log('Run complete.');
}

main().catch((err) => {
  console.error('Checker run FAILED:', err);
  process.exit(1); // non-zero exit -> GitHub Actions marks the run failed, no heartbeat was sent
});
