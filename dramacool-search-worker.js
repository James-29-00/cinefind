// ========== CINEFIND — DRAMACOOL CATALOG SEARCH (Phase 2, Item 2) ==========
// 1) Fuzzy-matches the query against the D1 catalog the crawler populates.
// 2) If nothing clears the confidence threshold, falls back to a live
//    "just in time" search directly on the site (confirmed working pattern:
//    https://{domain}/search?q={query}), and upserts anything found back
//    into D1 so the catalog grows from real usage, not just scheduled crawls.
//
// SETUP — same env vars as the dramacool-crawler Worker:
//   DB           — D1 binding (cinefind-catalog)
//   GITHUB_TOKEN — for reading dramacool-domains.json (domain registry)
//   GITHUB_REPO  — e.g. "james-29-00/cinefind"
//   SEARCH_CACHE — KV binding (dramacool-search-cache)
//   RATE_LIMIT_KV — KV binding (dramacool-rate-limit)
//   STATS_KV     — KV binding (dramacool-stats) — Phase 5, monitoring

const ALLOWED_ORIGIN = '*'; // tighten to your actual site origin once live
const CONFIDENCE_THRESHOLD = 0.6; // tune this after Phase 2 Item 3's manual 15-title re-test
const MAX_CANDIDATES = 50; // how many LIKE-matched D1 rows to pull before scoring
const MAX_RESULTS = 5; // how many confident matches to return, best-first
const LIVE_FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h — long enough to skip repeat D1+live work on popular queries, short enough that a newly-crawled/upserted title shows up again within a day
const RATE_LIMIT_MAX = 20; // requests
const RATE_LIMIT_WINDOW_SECONDS = 60; // per this many seconds, per IP

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ---------- Phase 5: stats endpoint ----------
    // Reads the KV counter written in the background below (trackOutcome).
    // No rate limit / cache / D1 involvement — just a KV read.
    if (url.searchParams.get('mode') === 'stats') {
      return json(await getStats(env, url.searchParams.get('days')));
    }

    // ---------- Rate limiting (per-IP, fixed window via KV) ----------
    // Fails OPEN (allows the request) if RATE_LIMIT_KV isn't bound yet, so
    // this never takes search down before the KV setup is finished — it
    // just logs a warning instead. Same fixed-window pattern as
    // cinefind-proxy's isRateLimited().
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const limited = await isRateLimited(env, clientIp);
      if (limited) {
        return json({ error: 'Too many requests. Please slow down and try again shortly.' }, 429);
      }
    } else {
      console.warn('RATE_LIMIT_KV not bound — rate limiting is disabled.');
    }

    const query = url.searchParams.get('query');
    if (!query || !query.trim()) {
      return json({ error: 'Missing query parameter' }, 400);
    }

    const normalizedQuery = normalizeTitle(query);
    const cacheKey = `search:${normalizedQuery}`;

    // ---------- Step 0: cache check ----------
    // Best-effort — a KV read failure shouldn't block the actual search,
    // it just means this request behaves as a cache miss.
    if (env.SEARCH_CACHE) {
      try {
        const cached = await env.SEARCH_CACHE.get(cacheKey, { type: 'json' });
        if (cached) {
          // Cache hits still count toward Phase 5 stats — a cached "no
          // match" is still a fallback from the searcher's point of view,
          // and skipping cached requests here would badly undercount
          // total volume on popular queries.
          trackOutcome(env, ctx, cached.matched === true);
          return json({ ...cached, cached: true });
        }
      } catch (err) { /* treat as cache miss */ }
    }

    // ---------- Step 1: D1 fuzzy match ----------
    let candidates;
    try {
      const { results } = await env.DB.prepare(
        `SELECT title, url, source_domain, country, year, normalized_title
         FROM dramacool_catalog
         WHERE normalized_title LIKE ?
         LIMIT ?`
      ).bind(`%${normalizedQuery}%`, MAX_CANDIDATES).all();
      candidates = results || [];
    } catch (err) {
      return json({ error: 'D1 query failed', detail: String(err) }, 500);
    }

    let best = null;
    let scored = [];
    if (candidates.length > 0) {
      scored = candidates
        .map(c => ({
          title: c.title, url: c.url, source_domain: c.source_domain,
          country: c.country, year: c.year,
          score: similarity(normalizedQuery, c.normalized_title),
        }))
        .sort((a, b) => b.score - a.score);
      best = scored[0];
    }

    if (best && best.score >= CONFIDENCE_THRESHOLD) {
      const payload = {
        matched: true,
        source: 'd1',
        confidence: Math.round(best.score * 100) / 100,
        results: scored.filter(s => s.score >= CONFIDENCE_THRESHOLD).slice(0, MAX_RESULTS),
      };
      await cacheSet(env, cacheKey, payload);
      trackOutcome(env, ctx, true);
      return json(payload);
    }

    // ---------- Step 2: no confident D1 match — try a live search ----------
    let liveResults = [];
    let liveError = null;
    let debugInfo = null;
    try {
      const liveOutcome = await fetchLiveSearch(env, query);
      liveResults = liveOutcome.results;
      debugInfo = liveOutcome.debug;
    } catch (err) {
      liveError = String(err);
    }

    if (liveResults.length > 0) {
      // Best-effort — don't fail the response if D1 write hiccups, the
      // person searching still gets their answer either way.
      try { await upsertResults(env, liveResults); } catch (err) { /* logged inside upsertResults */ }

      const payload = {
        matched: true,
        source: 'live',
        confidence: null, // not a fuzzy-match score — this came from the site's own search, taken at face value
        results: liveResults.slice(0, MAX_RESULTS),
      };
      await cacheSet(env, cacheKey, payload);
      trackOutcome(env, ctx, true);
      return json(payload);
    }

    // ---------- Step 3: genuinely nothing found ----------
    // debug is only meaningfully populated when live search actually ran
    // and returned zero usable entries — it's the "why" behind that zero,
    // so Phase 2 Item 2 testing doesn't need Worker log access to see it.
    const payload = {
      matched: false,
      source: null,
      confidence: best ? Math.round(best.score * 100) / 100 : 0,
      results: [],
      topCandidate: best ? { title: best.title, score: Math.round(best.score * 100) / 100 } : null,
      liveSearchError: liveError, // null if live search just found nothing (not an error)
      debug: debugInfo,
    };
    // Cache negative results too — a genuine "nothing found" for a stable
    // query (typo, nonsense, unmatched title) shouldn't re-run D1 + a full
    // parallel live-search fan-out on every repeat search either.
    await cacheSet(env, cacheKey, payload);
    trackOutcome(env, ctx, false);
    return json(payload);
  },
};

// ========== CACHE HELPERS ==========
// Best-effort write — a KV failure here should never break the response
// the person searching is waiting on.
async function cacheSet(env, key, payload) {
  if (!env.SEARCH_CACHE) return;
  try {
    await env.SEARCH_CACHE.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
  } catch (err) { /* non-fatal — just means this result isn't cached this time */ }
}

// ========== RATE LIMITING ==========
// Fixed-window per-IP counter, same shape as cinefind-proxy's isRateLimited.
// Window-numbered key (rl:{ip}:{windowId}) resets itself once the window
// rolls over — no separate cleanup step needed. Fails safe: any KV error
// here is treated as "not limited" rather than blocking the request.
async function isRateLimited(env, ip) {
  const windowId = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `rl:${ip}:${windowId}`;
  try {
    const current = await env.RATE_LIMIT_KV.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= RATE_LIMIT_MAX) return true;
    await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5 });
    return false;
  } catch (err) {
    return false; // KV hiccup — don't block real users over it
  }
}

// ========== PHASE 5: MONITORING (match vs fallback counters) ==========
// One KV key per UTC day (stats:2026-08-23) holding {match, fallback}
// counts. Deliberately NOT awaited at any call site above — every call is
// wrapped in ctx.waitUntil() so this never adds latency to the actual
// search response the person is waiting on. Read-modify-write, not an
// atomic increment (Workers KV has no such primitive) — under concurrent
// requests a rare lost update is possible, which is an acceptable
// trade-off for a rough daily count, not billing-grade accuracy.
function trackOutcome(env, ctx, matched) {
  if (!env.STATS_KV) return; // not bound yet — monitoring is opt-in, never blocks search
  if (!ctx || typeof ctx.waitUntil !== 'function') return; // defensive — should always be present in a real Worker request
  ctx.waitUntil(incrementStat(env, matched));
}

async function incrementStat(env, matched) {
  try {
    const day = new Date().toISOString().slice(0, 10); // UTC date, matches upsertResults' `today`
    const key = `stats:${day}`;
    const raw = await env.STATS_KV.get(key, { type: 'json' });
    const counts = raw || { match: 0, fallback: 0 };
    if (matched) counts.match += 1; else counts.fallback += 1;
    // 32 days: enough for the stats endpoint's default 7-day view plus a
    // full month of history without the KV namespace growing unbounded.
    await env.STATS_KV.put(key, JSON.stringify(counts), { expirationTtl: 60 * 60 * 24 * 32 });
  } catch (err) {
    console.error('trackOutcome failed:', err);
  }
}

// Returns the last N days (default 7, capped 30) of daily counts plus a
// combined total — this is what the admin panel's stats widget reads via
// ?mode=stats. Missing days (KV key never written, e.g. zero traffic that
// day) are filled in as {match:0, fallback:0} rather than omitted, so the
// widget can render a consistent N-day series without gap-filling itself.
async function getStats(env, daysParam) {
  if (!env.STATS_KV) return { error: 'STATS_KV not configured', days: [] };
  const days = Math.min(Math.max(parseInt(daysParam, 10) || 7, 1), 30);
  const results = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    let counts = { match: 0, fallback: 0 };
    try {
      const raw = await env.STATS_KV.get(`stats:${date}`, { type: 'json' });
      if (raw) counts = raw;
    } catch (err) { /* treat as zero for this day */ }
    results.push({ date, match: counts.match, fallback: counts.fallback });
  }
  const totalMatch = results.reduce((sum, r) => sum + r.match, 0);
  const totalFallback = results.reduce((sum, r) => sum + r.fallback, 0);
  const total = totalMatch + totalFallback;
  return {
    days: results.reverse(), // oldest first, chronological for charting
    totalMatch,
    totalFallback,
    fallbackRate: total > 0 ? Math.round((totalFallback / total) * 1000) / 10 : 0, // one decimal place, e.g. 16.7
  };
}

// ========== LIVE SEARCH (JIT fallback) ==========
// Tries the domain registry's primary domain, then each fallback in order,
// same resilience pattern as the crawler's runCrawl(). Confirmed URL
// pattern: https://{domain}/search?q={query}
// Filters out results whose title isn't actually close to what was
// searched. dramacool.rest's own search page, when it finds no real match,
// falls back to a "you might like" / recent-uploads style list instead of
// an empty result set — the ng-state parsing still succeeds and the array
// still has entries, so without this check every one of those unrelated
// titles would be reported back as a confident match. Same Levenshtein
// similarity() already used for the D1 scoring, just applied here too.
const LIVE_MATCH_THRESHOLD = 0.45; // looser than D1's 0.6 — site's own search already did some matching; this only catches the "no real match" fallback-list case, not near-miss title variants
function filterByTitleSimilarity(results, query) {
  const normalizedQuery = normalizeTitle(query);
  return results.filter(r => similarity(normalizedQuery, normalizeTitle(r.title)) >= LIVE_MATCH_THRESHOLD);
}

async function fetchLiveSearch(env, query) {
  const registry = await loadDomainRegistry(env);
  const domainsToTry = [registry.primary, ...(registry.fallbacks || []).map(f => f.domain)];

  // Fetched in parallel rather than one-by-one. Sequential tries meant a
  // dead/slow domain added its full LIVE_FETCH_TIMEOUT_MS on top of every
  // domain after it — with 2 domains that's up to 10s worst case before
  // the person searching sees anything, and it only gets worse as more
  // fallback domains get added to the registry over time. Running every
  // domain's fetch+parse concurrently caps the worst case at roughly one
  // timeout window regardless of how many domains are configured, while
  // Promise.allSettled (not Promise.race) still lets every domain finish
  // and log its own outcome below — nothing about the per-domain debug
  // detail is lost, it just no longer waits in line to happen.
  const attempts = [];
  const settled = await Promise.allSettled(
    domainsToTry.map(domain => fetchAndParseDomain(domain, query))
  );

  // Priority order preserved here, not by fetch speed — the primary
  // domain's result wins if it has usable matches, even if a fallback
  // domain's fetch happened to resolve first.
  for (let i = 0; i < domainsToTry.length; i++) {
    const domain = domainsToTry[i];
    const outcome = settled[i];
    if (outcome.status === 'rejected') {
      attempts.push({ domain, outcome: 'fetch_failed', detail: String(outcome.reason) });
      continue;
    }
    const { httpError, results, debugEntry } = outcome.value;
    if (httpError) {
      attempts.push({ domain, outcome: 'http_error', status: httpError });
      continue;
    }
    attempts.push(debugEntry);
    if (results.length > 0) return { results, debug: { attempts } };
  }
  return { results: [], debug: { attempts } };
}

// One domain's fetch + parse + similarity-filter, isolated so
// fetchLiveSearch can run several of these concurrently via
// Promise.allSettled without one domain's error taking down the others.
async function fetchAndParseDomain(domain, query) {
  const url = `https://${domain}/search?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return { httpError: res.status, results: [], debugEntry: null };
  }

  const html = await res.text();
  const parsed = parseSearchNgState(html);

  // parsed.entries can be: null (a real parse failure — no script tag, bad
  // JSON, wrong ng-state key/shape), or an array (successful parse) that
  // may legitimately be empty (site's own search genuinely found
  // nothing). These are different outcomes and were previously both
  // falling into the same `if (parsed.entries && parsed.entries.length >
  // 0)` check, which meant a real empty-array success got mislabeled as
  // 'parse_failed' with reason: null in the debug output — confusing to
  // read during manual testing even though the actual search behavior
  // (report nothing found) was correct either way.
  if (parsed.entries !== null) {
    const rawResults = parsed.entries
      .map(e => ({
        title: e.name || e.title,
        url: e.slug ? `https://${domain}/drama/${e.slug}` : null,
        source_domain: domain,
        country: e.country || null,
        year: e.releaseYear || e.year || null,
      }))
      // Checks the raw slug, not the built URL — the URL always contains
      // '/drama/' by construction above, so filtering on the URL string
      // let through entries with no slug at all (as '.../drama/undefined').
      .filter(r => r.title && r.url);
    const results = filterByTitleSimilarity(rawResults, query);
    return {
      httpError: null,
      results,
      debugEntry: { domain, outcome: 'parsed', entryCount: parsed.entries.length, usableCount: rawResults.length, afterSimilarityFilter: results.length },
    };
  }
  // Got a real page but couldn't find/parse the search ng-state entry
  // (site structure differs from /explore's) — record exactly why so
  // this doesn't need a follow-up round-trip to diagnose.
  return {
    httpError: null,
    results: [],
    debugEntry: { domain, outcome: 'parse_failed', reason: parsed.reason, ngStateKeys: parsed.ngStateKeys || null },
  };
}

// The crawler's fetchExplorePage() looks for the ng-state entry whose .u
// contains '/drama/list'. The search page is a different Angular route, so
// its resolved-data entry will have a different .u — this looks for any
// entry whose .u contains 'search' as the equivalent heuristic. If
// dramacool ever changes this exact key, this will start returning no
// entries and fall through gracefully rather than throwing — the `reason`
// and `ngStateKeys` fields let a manual test show exactly which stage
// failed (no script tag found / JSON.parse failed / no matching key /
// unexpected shape under that key) without needing Worker log access.
function parseSearchNgState(html) {
  const match = html.match(/<script id="ng-state" type="application\/json">(.*?)<\/script>/s);
  if (!match) return { entries: null, reason: 'no_ng_state_script_tag' };

  let ngState;
  try {
    ngState = JSON.parse(match[1]);
  } catch (err) {
    return { entries: null, reason: 'ng_state_json_parse_failed' };
  }

  const ngStateKeys = Object.keys(ngState);
  const searchEntry = Object.values(ngState).find(v => v && v.u && v.u.toLowerCase().includes('search'));
  if (!searchEntry) return { entries: null, reason: 'no_entry_with_search_in_u', ngStateKeys };
  if (!searchEntry.b || !Array.isArray(searchEntry.b.body)) {
    return { entries: null, reason: 'matched_entry_missing_b.body_array', ngStateKeys };
  }
  return { entries: searchEntry.b.body, reason: null };
}

// Same upsert the crawler uses, so live-search finds enrich the same table
// future D1 lookups benefit from.
async function upsertResults(env, results) {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of results) {
    const normalized = normalizeTitle(r.title);
    try {
      await env.DB.prepare(
        `INSERT INTO dramacool_catalog (title, normalized_title, url, source_domain, country, year, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(normalized_title, url) DO UPDATE SET last_seen = excluded.last_seen, year = excluded.year`
      ).bind(r.title, normalized, r.url, r.source_domain, r.country, r.year, today).run();
    } catch (err) {
      console.error('upsertResults write failed:', err, '| entry:', r.title);
    }
  }
}

async function loadDomainRegistry(env) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/dramacool-domains.json`, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'CineFindSearch',
    },
  });
  if (!res.ok) throw new Error(`Could not read dramacool-domains.json (HTTP ${res.status})`);
  const data = await res.json();
  const content = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
  if (!content.primary) throw new Error('dramacool-domains.json has no "primary" field');
  return content;
}

// ========== SHARED HELPERS ==========
function normalizeTitle(title) {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      currRow[j] = a[i - 1] === b[j - 1]
        ? prevRow[j - 1]
        : 1 + Math.min(prevRow[j], currRow[j - 1], prevRow[j - 1]);
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
