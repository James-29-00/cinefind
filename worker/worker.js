// worker.js — OmniRoute proxy worker
const RATE_LIMIT_MAX = 20;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const CACHE_TTL_SECONDS = 60 * 60 * 24;       // 24hr — used when at least one real link was verified
const CACHE_TTL_EMPTY_SECONDS = 60 * 60;      // 1hr — used when nothing verified (likely a new/unlisted title, refresh sooner)

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function hashPrompt(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function isRateLimited(env, ip) {
  const windowId = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `rl:${ip}:${windowId}`;
  try {
    const current = await env.RATE_LIMIT_KV.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= RATE_LIMIT_MAX) return true;
    await env.RATE_LIMIT_KV.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5,
    });
    return false;
  } catch (err) {
    return false;
  }
}

async function cacheGet(env, key) {
  if (!env.SEARCH_CACHE) return null;
  try {
    return await env.SEARCH_CACHE.get(key, { type: 'json' });
  } catch (err) {
    return null;
  }
}

async function cacheSet(env, key, payload, ttlSeconds = CACHE_TTL_SECONDS) {
  if (!env.SEARCH_CACHE) return;
  try {
    await env.SEARCH_CACHE.put(key, JSON.stringify(payload), {
      expirationTtl: ttlSeconds,
    });
  } catch (err) {
  }
}

// Decide TTL based on whether the payload actually contains a usable link.
// - verifiedLinks with at least one non-empty URL -> long TTL (result is real, stable)
// - all links empty / nothing verified -> short TTL (title may just be newly released
//   and not indexed on the sites yet; refresh sooner instead of hiding it for 24h)
function ttlForPayload(payload) {
  try {
    const parsed = JSON.parse(payload.text);
    const links = parsed?.links;
    if (links && typeof links === 'object') {
      const hasRealLink = Object.values(links).some((url) => typeof url === 'string' && url.trim());
      return hasRealLink ? CACHE_TTL_SECONDS : CACHE_TTL_EMPTY_SECONDS;
    }
  } catch (err) {
    // Not the {links: {...}} shape (e.g. raw fallback text) — treat as the
    // long-TTL case since it's not the "found nothing" scenario this handles.
  }
  return CACHE_TTL_SECONDS;
}

// ===== Layer 8: Similarity scoring utilities =====
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Full-string similarity() breaks down when comparing a short search title
// against a long, noisy string like a page's <title> tag — e.g. "dr
// romantic season 2" vs "watch dr romantic season 2 online free
// myasiantv". The extra site-name/"watch online free" text inflates the
// edit distance against the FULL length, tanking the score even for a
// genuinely correct match. This slides a window the length of the short
// title across the long string and keeps the best local match instead —
// only used for page-title verification (verifyLinkContent), not for
// anchor-text matching where both sides are already comparable lengths.
function partialSimilarity(shortNorm, longNorm) {
  if (!shortNorm || !longNorm) return 0;
  if (longNorm.length <= shortNorm.length) return similarity(shortNorm, longNorm);
  const capped = longNorm.slice(0, 300); // page titles are rarely useful past this; keeps worst-case cost bounded
  const winLen = shortNorm.length;
  let best = 0;
  for (let start = 0; start <= capped.length - winLen; start++) {
    const score = similarity(shortNorm, capped.slice(start, start + winLen));
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

const FUZZY_MATCH_THRESHOLD = 0.6;

// ===== Layer 3: D1 fuzzy lookup =====
// Scans stored titles for this row's site and returns the best fuzzy match
// above threshold, or null. D1 has no built-in fuzzy search, so this pulls
// candidate rows (LIKE on first word, a cheap pre-filter) then scores them
// in JS with Levenshtein similarity.
async function d1FuzzyLookup(env, normTitle, site) {
  if (!env.LINKS_DB) return null;
  try {
    const firstWord = normTitle.split(' ')[0] || normTitle;
    const { results } = await env.LINKS_DB.prepare(
      `SELECT normalized_title, url FROM links WHERE site = ? AND normalized_title LIKE ? LIMIT 50`
    ).bind(site, `%${firstWord}%`).all();

    let best = null;
    let bestScore = 0;
    for (const row of results || []) {
      const score = similarity(normTitle, row.normalized_title);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    if (best && bestScore >= FUZZY_MATCH_THRESHOLD) {
      return best.url;
    }
    return null;
  } catch (err) {
    console.warn('D1 lookup failed:', String(err));
    return null;
  }
}

// ===== Layer 7: Auto-upsert to D1 =====
// Only stores links that were actually verified (non-empty), so the table
// only ever grows with confirmed-good data.
async function d1Upsert(env, normTitle, originalTitle, site, url) {
  if (!env.LINKS_DB || !url) return;
  try {
    await env.LINKS_DB.prepare(
      `INSERT INTO links (normalized_title, original_title, site, url, verified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(normalized_title, site) DO UPDATE SET
         url = excluded.url,
         original_title = excluded.original_title,
         verified_at = excluded.verified_at`
    ).bind(normTitle, originalTitle, site, url, Date.now()).run();
  } catch (err) {
    console.warn('D1 upsert failed:', String(err));
  }
}

// ===== Layer 4: Live-fetch per site =====
// Mirrors the search-URL templates index.html builds client-side
// (MOVIE_SITES/SERIES_SITES/DRAMA_SITES/ANIME_SITES) so the worker can
// hit each site's real search endpoint directly instead of asking Groq
// to guess a URL from memory. Keyed lowercase to match site.toLowerCase()
// usage elsewhere in this file.
const SITE_SEARCH_URLS = {
  '1shows': (t) => `https://1shows.org/?s=${encodeURIComponent(t)}`,
  'flickystream': (t) => `https://flickystream.dad/?s=${encodeURIComponent(t)}`,
  'moviebox': (t) => `https://movie-box.co/web/searchResult?keyword=${encodeURIComponent(t)}`, // confirmed live (Aug 26, 2026)
  '1flex': (t) => `https://1flex.org/?s=${encodeURIComponent(t)}`,
  '1tube': (t) => `https://1tube.org/?s=${encodeURIComponent(t)}`,
  // 'cineby' intentionally omitted — domain moved to cineby.im and its
  // search is client-side rendered (the URL never changes after
  // searching, confirmed by live testing), so there's no URL Layer 4 can
  // fetch to get real results. Routes straight to Layer 6 instead, same
  // reasoning as the kisskh omission above.
  'myasiantv': (t) => `https://myasiantv.com.lv/?type=movies&s=${encodeURIComponent(t)}`, // confirmed live (Aug 26, 2026)
  'fmovies': (t) => `https://fmovies-hd.to/?s=${encodeURIComponent(t)}`,
  'dramacool': (t) => `https://dramacool.baby/search?q=${encodeURIComponent(t)}`, // confirmed live on dramacool.baby (Aug 26, 2026)
  // 'kisskh' intentionally omitted — kisskh.co has no working /search?q= page
  // (confirmed 404). Leaving it out of this map makes liveFetchSearch's
  // `template` lookup miss and return null immediately (no fetch, no wasted
  // Scrape.do credit), which routes kisskh straight to Layer 6 instead
  // (Groq guesses the direct URL from its known pattern, then
  // verifyLinkContent confirms it) — the right fit since kisskh doesn't
  // have a static search page to scrape in the first place.
  'asiancrush': (t) => `https://www.asiancrush.com/?s=${encodeURIComponent(t)}`,
  'viki': (t) => `https://www.viki.com/search?q=${encodeURIComponent(t)}`,
  'viu': (t) => `https://www.viu.com/ott/global/en/search?q=${encodeURIComponent(t)}`,
  'kocowa': (t) => `https://www.kocowa.com/search?query=${encodeURIComponent(t)}`,
  'ondemandkorea': (t) => `https://www.ondemandkorea.com/search?query=${encodeURIComponent(t)}`,
  'wetv': (t) => `https://wetv.vip/en/search?q=${encodeURIComponent(t)}`,
  'amasian tv': (t) => `https://amasiantv.com/?s=${encodeURIComponent(t)}`,
  'reanime': (t) => `https://reanime.to/search?q=${encodeURIComponent(t)}&limit=36&offset=0`, // confirmed live (Aug 26, 2026)
  'animepahe': (t) => `https://animepahe.pw/?s=${encodeURIComponent(t)}`,
  'miruro': (t) => `https://www.miruro.to/search?query=${encodeURIComponent(t)}&type=ANIME&sort=POPULARITY_DESC`, // confirmed live (Aug 26, 2026)
  'anikoto': (t) => `https://anikototv.to/?s=${encodeURIComponent(t)}`,
  'enma': (t) => `https://enma.lol/?s=${encodeURIComponent(t)}`,
};

// Fetches a URL, routing through the Scrape.do proxy (real browser rendering +
// residential proxies + Cloudflare/anti-bot handling) when SCRAPEDO_API_KEY is
// configured. Falls back to a plain direct fetch otherwise (or if Scrape.do
// itself errors), so this is safe to call even without the key set.
// Only these sites are known (confirmed via live testing) to need the
// Scrape.do proxy — everything else uses a plain direct fetch to conserve
// the free 1,000-requests/month quota. Add a site's key here (matching
// SITE_SEARCH_URLS) only after observing a blank/blocked result from it
// in an actual search — don't add speculatively.
const PROTECTED_SITES = new Set(['kisskh', 'dramacool']);

// Fetches a URL, routing through the Scrape.do proxy (real browser rendering +
// residential proxies + Cloudflare/anti-bot handling) when SCRAPEDO_API_KEY is
// configured AND the given site is in PROTECTED_SITES. Falls back to a plain
// direct fetch otherwise (unprotected sites, missing key, or Scrape.do error),
// so this is safe to call even without the key set.
async function smartFetch(env, url, opts = {}) {
  const timeout = opts.timeoutMs || 8000;
  const useProxy = opts.site && PROTECTED_SITES.has(opts.site.toLowerCase());
  if (useProxy && env.SCRAPEDO_API_KEY) {
    try {
      const proxied = `https://api.scrape.do/?token=${env.SCRAPEDO_API_KEY}&url=${encodeURIComponent(url)}&render=true`;
      const res = await fetch(proxied, { signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
      console.error(`[smartFetch] scrape.do non-ok for site=${opts.site} status=${res.status} url=${url}`, (await res.text()).slice(0, 300));
    } catch (err) {
      console.error(`[smartFetch] scrape.do threw for site=${opts.site} url=${url}`, String(err));
      // fall through to direct fetch below
    }
  }
  return fetch(url, {
    method: opts.method || 'GET',
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(timeout),
  });
}

// Hits the site's real search endpoint and returns the raw HTML along with
// the search URL itself (used as a fallback link if Layer 5 parsing below
// can't extract anything better).
async function liveFetchSearch(env, site, title) {
  const key = site.toLowerCase();
  const template = SITE_SEARCH_URLS[key];
  if (!template || !title) return null;
  const searchUrl = template(title);
  try {
    const res = await smartFetch(env, searchUrl, { timeoutMs: 8000, site });
    if (!res.ok) return null;
    const html = await res.text();
    return { searchUrl, html };
  } catch (err) {
    return null;
  }
}

// ===== Layer 5: AI-based generic HTML parser =====
// Instead of dumping raw HTML (mostly noise: scripts, nav, ads) at Groq,
// extract every <a href>...</a> pair first — this works on ANY site's HTML
// since it doesn't depend on that site's specific CSS/div structure, just
// the universal fact that links are <a href> tags. Groq then only has to
// pick the right entry out of a short, clean list instead of parsing raw
// markup soup.
const MAX_ANCHOR_CANDIDATES = 60;

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const altRe = /<img\s[^>]*alt=["']([^"']*)["'][^>]*>/i;
  let match;
  let base;
  try { base = new URL(baseUrl); } catch (err) { base = null; }
  while ((match = re.exec(html)) && anchors.length < 500) {
    const rawHref = match[1];
    const inner = match[2];
    let text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      const altMatch = inner.match(altRe);
      text = (altMatch?.[1] || '').trim();
    }
    if (!text) continue;
    let href = rawHref;
    if (base) {
      try { href = new URL(rawHref, base).href; } catch (err) { continue; }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    anchors.push({ text, href });
  }
  return anchors;
}

// Narrow the full anchor list down to the ones most likely relevant, using
// the same similarity() scoring Layer 3 uses — so Groq gets a short list
// instead of hundreds of nav/footer/ad links.
function rankAnchorCandidates(anchors, normTitle) {
  return anchors
    .map((a) => ({ ...a, score: similarity(normTitle, normalizeTitle(a.text)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ANCHOR_CANDIDATES);
}

// Batches ALL sites' candidate lists into ONE Groq call (instead of one
// call per site) — same picking logic, just asked once for every site at
// the same time. siteCandidates: { site: [{text, href}, ...] }.
// Returns { site: pickedHref | null }.
async function aiParseSearchResultsBatch(env, title, normTitle, siteCandidates) {
  const siteNames = Object.keys(siteCandidates).filter((s) => siteCandidates[s].length);
  if (!env.OMNIROUTE_URL || !siteNames.length) return {};

  const sections = siteNames.map((site) => {
    const list = siteCandidates[site].map((a, i) => `  ${i}. "${a.text}" -> ${a.href}`).join('\n');
    return `Site: ${site}\n${list}`;
  }).join('\n\n');

  const prompt = `Para sa bawat site sa ibaba, may listahan ng title+link pairs na aktwal na nakuha mula sa search results page ng site na iyon para sa "${title}" (hindi ito imbento, mula mismo sa HTML). Piliin per site ang numero ng entry na pinakamalapit na tumutugma sa "${title}". Sumagot ka lang ng JSON, walang ibang teksto: {"<site name>": <numero o null>, ...} — isang entry per site na nakalista.

${sections}`;

  try {
    const res = await fetch(`${env.OMNIROUTE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.OMNIROUTE_API_KEY ? { Authorization: `Bearer ${env.OMNIROUTE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: env.OMNIROUTE_MODEL || 'auto',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const picks = {};
    for (const site of siteNames) {
      const idx = parsed?.[site];
      if (idx === null || idx === undefined) continue;
      const picked = siteCandidates[site][Number(idx)];
      if (!picked) continue;
      // Belt-and-suspenders: re-check similarity ourselves, don't just
      // trust that Groq picked correctly.
      if (similarity(normTitle, normalizeTitle(picked.text)) < FUZZY_MATCH_THRESHOLD) continue;
      picks[site] = picked.href;
    }
    return picks;
  } catch (err) {
    console.warn('AI HTML parse batch failed:', String(err));
    return {};
  }
}

// Live-fetch (Layer 4) for every remaining site in parallel, build each
// site's candidate list, then a single batched AI parse (Layer 5) call
// resolves all of them at once. Falls back to the search URL itself for
// any site the batch didn't confidently resolve.
async function resolveLiveSites(env, sites, title, normTitle) {
  const fetched = await Promise.all(sites.map((site) => liveFetchSearch(env, site, title)));
  const siteCandidates = {};
  const searchUrls = {};
  sites.forEach((site, i) => {
    const f = fetched[i];
    if (!f) return;
    searchUrls[site] = f.searchUrl;
    const anchors = extractAnchors(f.html, f.searchUrl);
    siteCandidates[site] = rankAnchorCandidates(anchors, normTitle);
  });

  const picks = await aiParseSearchResultsBatch(env, title, normTitle, siteCandidates);

  const verified = await Promise.all(
    Object.entries(picks).map(async ([site, link]) => [site, await verifyLinkContent(env, link, normTitle, site)])
  );
  const confirmedDirect = new Set(verified.filter(([, ok]) => ok).map(([site]) => site));

  const results = {};
  sites.forEach((site) => {
    if (!(site in searchUrls)) { results[site] = null; return; }
    if (picks[site] && confirmedDirect.has(site)) {
      results[site] = { url: picks[site], isDirect: true };
    } else {
      results[site] = { url: searchUrls[site], isDirect: false };
    }
  });
  return results;
}

// Reachability (HTTP 200) isn't proof a page is actually about the title —
// many sites soft-404 (always return 200, e.g. serving their SPA shell for
// any path). Fetch the page and check its <title>/og:title actually
// resembles the requested title before calling it a confirmed direct link.
const LISTING_URL_PATTERN = /[?&](s|q|keyword|search)=|\/search(\/|$|\?)/i;

async function verifyLinkContent(env, url, normTitle, site) {
  if (LISTING_URL_PATTERN.test(url)) return false;
  try {
    const res = await smartFetch(env, url, { timeoutMs: 6000, site });
    if (!res.ok) return false;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const pageTitle = (ogMatch?.[1] || titleMatch?.[1] || '').trim();
    if (!pageTitle) return false;
    return partialSimilarity(normTitle, normalizeTitle(pageTitle)) >= FUZZY_MATCH_THRESHOLD;
  } catch (err) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const limited = await isRateLimited(env, clientIp);
      if (limited) {
        return json({ error: 'Too many requests. Please slow down and try again shortly.' }, 429);
      }
    } else {
      console.warn('RATE_LIMIT_KV not bound — rate limiting is disabled.');
    }

    let prompt, title, sites;
    try {
      ({ prompt, title, sites } = await request.json());
    } catch (err) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    if (!prompt || typeof prompt !== 'string') {
      return json({ error: 'Missing or invalid prompt' }, 400);
    }

    // ===== Layer 3: D1 fuzzy lookup (runs before cache/Groq if we have a title) =====
    // If index.html sent a title + sites list, try to resolve as many as
    // possible straight from D1 first. Any site found here is skipped in
    // the Groq prompt below — no point asking the AI to re-guess something
    // we already have verified.
    let d1Links = {};
    let remainingSites = Array.isArray(sites) ? sites : [];
    const normTitle = title && typeof title === 'string' ? normalizeTitle(title) : null;
    if (normTitle && env.LINKS_DB && remainingSites.length) {
      const lookups = await Promise.all(
        remainingSites.map((site) => d1FuzzyLookup(env, normTitle, site.toLowerCase()))
      );
      const stillMissing = [];
      remainingSites.forEach((site, i) => {
        if (lookups[i]) {
          d1Links[site.toLowerCase()] = lookups[i];
        } else {
          stillMissing.push(site);
        }
      });
      remainingSites = stillMissing;
      // Everything resolved from D1 — return immediately, no need to touch cache or Groq.
      if (remainingSites.length === 0) {
        return json({ text: JSON.stringify({ links: d1Links }), fromD1: true, linkTypes: Object.fromEntries(Object.keys(d1Links).map((s) => [s, 'direct'])) });
      }
    }

    // ===== Layer 4+5: Live-fetch + AI HTML parse (sites D1 didn't resolve) =====
    // resolveLiveSites() hits every remaining site's real search endpoint
    // (Layer 4) in parallel, then resolves ALL of them with a SINGLE
    // batched Groq call (Layer 5) instead of one call per site — falls
    // back to the search URL itself for any site parsing comes up empty
    // on. Any site resolved here is skipped below the same way D1 hits are.
    let liveFetchLinks = {};
    let linkTypes = {}; // site -> 'direct' | 'search', for honest labeling in index.html
    if (normTitle && remainingSites.length) {
      const liveResults = await resolveLiveSites(env, remainingSites, title, normTitle);
      const stillMissingAfterLiveFetch = [];
      remainingSites.forEach((site) => {
        const result = liveResults[site];
        if (result) {
          liveFetchLinks[site.toLowerCase()] = result.url;
          linkTypes[site.toLowerCase()] = result.isDirect ? 'direct' : 'search';
        } else {
          stillMissingAfterLiveFetch.push(site);
        }
      });
      remainingSites = stillMissingAfterLiveFetch;
      // D1 + live-fetch covered everything — skip Groq (Layer 6) entirely.
      if (remainingSites.length === 0) {
        const combinedLinks = { ...d1Links, ...liveFetchLinks };
        if (env.LINKS_DB) {
          await Promise.all(
            Object.entries(liveFetchLinks).map(([site, url]) => d1Upsert(env, normTitle, title, site, url))
          );
        }
        return json({ text: JSON.stringify({ links: combinedLinks }), fromD1: Object.keys(d1Links).length > 0, fromLiveFetch: true, linkTypes });
      }
    }

    const cacheKey = `omniroute:${hashPrompt(prompt.trim())}`;
    if (env.SEARCH_CACHE) {
      const cached = await cacheGet(env, cacheKey);
      if (cached) {
        return json({ ...cached, cached: true });
      }
    }

    if (!env.OMNIROUTE_URL) {
      return json({ error: 'OmniRoute not configured yet' }, 500);
    }

    let omniRes;
    try {
      omniRes = await fetch(`${env.OMNIROUTE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.OMNIROUTE_API_KEY ? { Authorization: `Bearer ${env.OMNIROUTE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: env.OMNIROUTE_MODEL || 'auto',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(55000),
      });
    } catch (err) {
      return json({ error: 'OmniRoute request failed', detail: String(err) }, 502);
    }

    if (!omniRes.ok) {
      const details = await omniRes.text();
      return json({ error: 'OmniRoute request failed', details }, 502);
    }

    const data = await omniRes.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const trimmed = text.trim();

    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('```'))) {
      return json({ error: 'OmniRoute returned no usable JSON', raw: trimmed.slice(0, 200) }, 502);
    }

    let parsedLinks = null;
    try {
      const cleaned = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      parsedLinks = parsed?.links || null;
    } catch (err) {
    }

    if (parsedLinks && typeof parsedLinks === 'object') {
      const entries = Object.entries(parsedLinks).filter(
        ([site, url]) => typeof url === 'string' && url.trim() && !(site in d1Links) && !(site in liveFetchLinks)
      );
      const VERIFY_TIMEOUT_MS = 5000;
      const verified = await Promise.allSettled(
        entries.map(async ([site, url]) => {
          try {
            const res = await smartFetch(env, url, { method: 'HEAD', timeoutMs: VERIFY_TIMEOUT_MS, site });
            return [site, res.ok ? url : ''];
          } catch (err) {
            try {
              const res = await smartFetch(env, url, { timeoutMs: VERIFY_TIMEOUT_MS, site });
              return [site, res.ok ? url : ''];
            } catch (err2) {
              return [site, ''];
            }
          }
        })
      );

      const verifiedLinks = { ...parsedLinks, ...d1Links, ...liveFetchLinks };
      verified.forEach((result, i) => {
        const [site] = entries[i];
        verifiedLinks[site] = result.status === 'fulfilled' ? result.value[1] : '';
      });
      // D1-known links were already verified in a past request — restore them
      // after the loop so they aren't overwritten by this round's re-check.
      Object.assign(verifiedLinks, d1Links, liveFetchLinks);

      // ===== Layer 7: Auto-upsert to D1 =====
      if (normTitle && env.LINKS_DB) {
        await Promise.all(
          Object.entries(verifiedLinks)
            .filter(([, url]) => typeof url === 'string' && url.trim())
            .map(([site, url]) => d1Upsert(env, normTitle, title, site, url))
        );
      }

      // Groq-guessed and D1-known links point at the actual title's page,
      // not a search page — mark them 'direct'. Live-fetch entries keep
      // whatever resolveLiveSite() already determined (direct vs search).
      const finalLinkTypes = { ...linkTypes };
      Object.keys(verifiedLinks).forEach((site) => {
        if (!finalLinkTypes[site] && verifiedLinks[site]) finalLinkTypes[site] = 'direct';
      });

      const payload = { text: JSON.stringify({ links: verifiedLinks }), linkTypes: finalLinkTypes };
      await cacheSet(env, cacheKey, payload, ttlForPayload(payload));
      return json(payload);
    }

    const payload = { text: trimmed };
    await cacheSet(env, cacheKey, payload, ttlForPayload(payload));
    return json(payload);
  },

  async scheduled(event, env) {
    if (!env.OMNIROUTE_URL) return;
    try {
      await fetch(`${env.OMNIROUTE_URL}/`, { signal: AbortSignal.timeout(10000) });
    } catch (err) {
    }
  },
};
