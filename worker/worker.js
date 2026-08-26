// worker.js — OmniRoute proxy worker
const RATE_LIMIT_MAX = 20;
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
  'moviebox': (t) => `https://movie-box.co/?s=${encodeURIComponent(t)}`,
  '1flex': (t) => `https://1flex.org/?s=${encodeURIComponent(t)}`,
  '1tube': (t) => `https://1tube.org/?s=${encodeURIComponent(t)}`,
  'cineby': (t) => `https://cineby.at/search?q=${encodeURIComponent(t)}`,
  'fmovies': (t) => `https://fmovies-hd.to/?s=${encodeURIComponent(t)}`,
  'myasiantv': (t) => `https://myasiantv.com.lv/?s=${encodeURIComponent(t)}`,
  'dramacool': (t) => `https://dramacool.com.tw/search?type=movies&keyword=${encodeURIComponent(t)}`,
  'kisskh': (t) => `https://kisskh.co/search?q=${encodeURIComponent(t)}`,
  'asiancrush': (t) => `https://www.asiancrush.com/?s=${encodeURIComponent(t)}`,
  'viki': (t) => `https://www.viki.com/search?q=${encodeURIComponent(t)}`,
  'viu': (t) => `https://www.viu.com/ott/global/en/search?q=${encodeURIComponent(t)}`,
  'kocowa': (t) => `https://www.kocowa.com/search?query=${encodeURIComponent(t)}`,
  'ondemandkorea': (t) => `https://www.ondemandkorea.com/search?query=${encodeURIComponent(t)}`,
  'wetv': (t) => `https://wetv.vip/en/search?q=${encodeURIComponent(t)}`,
  'amasian tv': (t) => `https://amasiantv.com/?s=${encodeURIComponent(t)}`,
  'reanime': (t) => `https://reanime.to/?s=${encodeURIComponent(t)}`,
  'animepahe': (t) => `https://animepahe.pw/?s=${encodeURIComponent(t)}`,
  'miruro': (t) => `https://miruro.to/search?keyword=${encodeURIComponent(t)}`,
  'anikoto': (t) => `https://anikototv.to/?s=${encodeURIComponent(t)}`,
  'enma': (t) => `https://enma.lol/?s=${encodeURIComponent(t)}`,
};

// Hits the site's real search endpoint and returns the raw HTML along with
// the search URL itself (used as a fallback link if Layer 5 parsing below
// can't extract anything better).
async function liveFetchSearch(site, title) {
  const key = site.toLowerCase();
  const template = SITE_SEARCH_URLS[key];
  if (!template || !title) return null;
  const searchUrl = template(title);
  try {
    const res = await fetch(searchUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const html = await res.text();
    return { searchUrl, html };
  } catch (err) {
    return null;
  }
}

// ===== Layer 5: AI-based generic HTML parser =====
// Groq's role here is NOT to guess a URL from memory — it's given the
// actual raw HTML from the live-fetch above and asked to pick out the
// title+link pairs that are really on the page. Returns the best-matching
// direct link, or null if nothing usable/confident enough.
const HTML_PARSE_MAX_CHARS = 15000;

async function aiParseSearchResults(env, title, normTitle, html) {
  if (!env.OMNIROUTE_URL || !html) return null;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .slice(0, HTML_PARSE_MAX_CHARS);

  const prompt = `Ito ang raw HTML ng search results page para sa titulong "${title}". Hanapin mo ang title+link pairs na aktwal na nasa HTML na ito (huwag mang-imbento). Piliin ang pinakamalapit na match sa "${title}". Sumagot ka lang ng JSON, walang ibang teksto: {"title": "<eksaktong titulo na nakita sa HTML>", "link": "<buong URL ng detail page>"}. Kung walang malapit na match, isagot: {"title": null, "link": null}.

HTML:
${stripped}`;

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
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed?.link || !parsed?.title) return null;
    const score = similarity(normTitle, normalizeTitle(String(parsed.title)));
    if (score < FUZZY_MATCH_THRESHOLD) return null;
    return String(parsed.link);
  } catch (err) {
    console.warn('AI HTML parse failed:', String(err));
    return null;
  }
}

// Live-fetch (Layer 4) -> AI parse (Layer 5) -> verify -> fallback to the
// search URL itself if parsing didn't yield a confident direct link.
async function resolveLiveSite(env, site, title, normTitle) {
  const fetched = await liveFetchSearch(site, title);
  if (!fetched) return null;
  const parsedLink = await aiParseSearchResults(env, title, normTitle, fetched.html);
  if (parsedLink) {
    try {
      const check = await fetch(parsedLink, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (check.ok) return { url: parsedLink, isDirect: true };
    } catch (err) {
      // HEAD can fail on sites that block it; fall through to search URL.
    }
  }
  return { url: fetched.searchUrl, isDirect: false };
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
    // resolveLiveSite() hits the real search endpoint (Layer 4), asks Groq
    // to pick the matching title+link out of the actual returned HTML
    // (Layer 5), and falls back to the search URL itself if parsing comes
    // up empty. Any site resolved here is skipped below the same way D1
    // hits are.
    let liveFetchLinks = {};
    let linkTypes = {}; // site -> 'direct' | 'search', for honest labeling in index.html
    if (normTitle && remainingSites.length) {
      const liveResults = await Promise.all(
        remainingSites.map((site) => resolveLiveSite(env, site, title, normTitle))
      );
      const stillMissingAfterLiveFetch = [];
      remainingSites.forEach((site, i) => {
        const result = liveResults[i];
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
      const entries = Object.entries(parsedLinks).filter(([, url]) => typeof url === 'string' && url.trim());
      const VERIFY_TIMEOUT_MS = 5000;
      const verified = await Promise.allSettled(
        entries.map(async ([site, url]) => {
          try {
            const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
            return [site, res.ok ? url : ''];
          } catch (err) {
            try {
              const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
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
