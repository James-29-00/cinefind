// scripts/check-sites.js
// Reads sites.json, checks each URL, writes result to status.json
// Run automatically by .github/workflows/check-sites.yml (daily)

const fs = require('fs');
const path = require('path');

const SITES_PATH = path.join(__dirname, '..', 'sites.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'status.json');
const TIMEOUT_MS = 10000;

async function checkSite(site) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some sites block requests with no browser-like User-Agent
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);
    return {
      name: site.name,
      url: site.url,
      status: res.ok || (res.status >= 200 && res.status < 400) ? 'up' : 'down',
      httpStatus: res.status,
      checkedAt: new Date().toISOString()
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      name: site.name,
      url: site.url,
      status: 'down',
      httpStatus: null,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      checkedAt: new Date().toISOString()
    };
  }
}

async function main() {
  const sites = JSON.parse(fs.readFileSync(SITES_PATH, 'utf-8'));
  console.log(`Checking ${sites.length} sites...`);

  const results = [];
  // Check sequentially with small delay to avoid rate-limiting / looking like a bot flood
  for (const site of sites) {
    const result = await checkSite(site);
    console.log(`${result.status === 'up' ? '✅' : '❌'} ${result.name} (${result.httpStatus || result.error})`);
    results.push(result);
  }

  const output = {
    lastRun: new Date().toISOString(),
    totalSites: results.length,
    upCount: results.filter(r => r.status === 'up').length,
    downCount: results.filter(r => r.status === 'down').length,
    results
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. ${output.upCount} up, ${output.downCount} down. Written to status.json`);
}

main().catch(err => {
  console.error('Checker failed:', err);
  process.exit(1);
});
