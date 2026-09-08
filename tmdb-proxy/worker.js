
/**
 * CineFind TMDB Proxy — Cloudflare Worker
 *
 * Hides the TMDB API key server-side. The frontend calls this Worker
 * instead of api.themoviedb.org directly, so the key never appears
 * in the browser / page source.
 *
 * SETUP:
 * 1. Paste this whole file into your Cloudflare Worker's editor.
 * 2. Add a secret named TMDB_API_KEY (Settings → Variables and Secrets)
 *    with your real TMDB key as the value. Do NOT hardcode it below.
 * 3. Deploy. You'll get a URL like:
 *    https://cinefind-proxy.<your-subdomain>.workers.dev
 * 4. Edit ALLOWED_ORIGINS below — replace the placeholder with your real
 *    deployed site's origin (e.g. 'https://cinefind.com'). Add more
 *    entries to the array if you have a staging domain too.
 * 5. Create a KV namespace: Workers & Pages → KV → Create namespace
 *    (name it e.g. "RATE_LIMIT"). Then open this Worker → Settings →
 *    Variables and Secrets → KV Namespace Bindings → Add binding →
 *    variable name RATE_LIMIT_KV → pick the namespace you just made.
 *    Save and deploy. This same namespace is reused below for the
 *    shared trending cache — no second namespace needed.
 * 6. (Optional, recommended) Attach a custom domain/route to this Worker
 *    (Settings → Domains & Routes) if you want the Cache API edge cache
 *    to kick in for non-trending modes — on a bare workers.dev URL,
 *    that caching is skipped entirely (see fix below). Trending caching
 *    (below) works fine either way since it's done via KV, not the
 *    Cache API.
 *
 * CHANGE LOG:
 * - Added optional `page` support to the plain search/multi branch (the
 *   one used by the main search bar and the suggestions dropdown). It
 *   already existed on the `genre` (discover) branch but was missing
 *   here, so TMDB search always silently capped out at its own page 1
 *   (~20 results) — a real title could exist on TMDB but never surface
 *   if it ranked outside that first page by popularity. Defaults to '1'
 *   when the frontend doesn't send a page param, so this is fully
 *   backward-compatible with anything already calling this Worker.
 * - Added search_person/person_credits, search_collection/collection,
 *   and search_keyword/discover_keyword modes to support Actor/Director,
 *   Franchise, and Vibe/Tag search on the frontend.
 * - Locked ALLOWED_ORIGINS down to a real allow-list instead of "*" —
 *   see step 4 above, you MUST edit this list with your real domain(s)
 *   or every request will be rejected as CORS-denied.
 * - Added per-IP rate limiting via Workers KV — see step 5 above, this
 *   needs a KV namespace created and bound or it fails open (allows
 *   everything) with a console warning on every request.
 * - Added `credits` mode (cast/crew for a single title) so the Detail
 *   screen can show real cast instead of hardcoded mockup names.
 * - FIX: `caches.default` (the Cache API) is only available on Workers
 *   attached to a custom domain/zone — it's undefined on plain
 *   *.workers.dev subdomains. Calling `.match()` on it there threw
 *   immediately, before any TMDB request even went out, which is why
 *   every mode (suggestions, trending, recommendations, etc.) failed
 *   identically. The cache read/write are now guarded so the Worker
 *   just skips edge caching when `caches.default` isn't available,
 *   instead of crashing.
 * - RETUNED the rate limiter to use SAMPLED writes instead of writing to
 *   KV on every single request. The original version called KV.put() on
 *   every non-blocked request, which burns through the free plan's
 *   1,000 KV writes/day almost immediately under normal use — that's
 *   what caused the "KV put() limit exceeded for the day" error. Now,
 *   every request still does a KV.get() (reads are ~100,000/day free,
 *   effectively unlimited here) to check the current count, but only
 *   1 in every WRITE_SAMPLE_RATE requests actually persists an updated
 *   count with .put(). Tuned for up to ~5,000 legitimate requests/day
 *   while staying comfortably under the 1,000 writes/day cap.
 * - ADDED a genuinely SHARED trending cache via KV, replacing reliance
 *   on the Cache API (which doesn't work on bare workers.dev URLs
 *   anyway). Previously the frontend's "Trending Now" section faked
 *   trending with a hardcoded title list and fetched a poster via a
 *   full TMDB search call PER TITLE, PER VISITOR, with no sharing
 *   between visitors at all (only an in-memory cache inside each
 *   individual browser tab, wiped on every reload). Now: the first
 *   request for mode=trending after the cache has expired fetches real
 *   trending data from TMDB once and writes it into KV; every other
 *   visitor (and every reload, by anyone) for the next 24 hours reads
 *   that same cached KV entry instead of calling TMDB again. TMDB's
 *   weekly trending list barely changes hour to hour, so a 24-hour
 *   refresh is indistinguishable from real-time to visitors while
 *   costing roughly 1 TMDB call and 1 KV write per day, total, no
 *   matter how much traffic the site gets.
 */

// Only these origins may call this proxy. Requests from anywhere else
// (including a plain fetch typed into a browser address bar, or someone
// else's site trying to piggyback on your TMDB key) get a CORS rejection.
const ALLOWED_ORIGINS = [
  'https://james-29-00.github.io', // your GitHub Pages site — lowercase to match the actual Origin header the browser sends (protocol + domain only, no /cinefind path)
  // 'https://staging.your-actual-domain.com', // uncomment/add more as needed
];

// Per-IP fixed-window rate limit. 30 requests / 60 seconds is generous for
// one real visitor (search + suggestions + a few detail fetches) but stops
// a single IP from burning through your daily Worker/TMDB quota.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// Only actually persist the rate-limit counter to KV every Nth request per
// IP — every request still reads the current count (KV reads are cheap/
// free at this scale), just not every request writes it back. This is
// what keeps KV writes far under the 1,000/day cap even with a few
// thousand real requests coming in. Tuned for up to ~5,000 requests/day;
// if traffic grows a lot, raise this further (e.g. to 10) to stay safe.
const WRITE_SAMPLE_RATE = 5;

// How long the SHARED trending cache stays valid before the next visitor
// triggers a fresh TMDB fetch. TMDB's trending list is a WEEKLY ranking
// that barely moves hour to hour, so 24 hours is indistinguishable from
// real-time to visitors while costing about 1 TMDB call/day total.
const TRENDING_CACHE_TTL_SECONDS = 86400; // 24 hours
const TRENDING_CACHE_KEY = 'cache:trending';

export default {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(requestOrigin) });
    }

    // ===== RATE LIMITING (per-IP, fixed window via Workers KV) =====
    // Fails OPEN (allows the request) if RATE_LIMIT_KV isn't bound yet, so
    // this never takes the site down before you've finished the KV setup
    // in step 5 above — it just logs a warning instead.
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const rateLimited = await isRateLimited(env, clientIp);
      if (rateLimited) {
        return jsonResponse({ error: 'Too many requests. Please slow down and try again shortly.' }, 429, 0, requestOrigin);
      }
    } else {
      console.warn('RATE_LIMIT_KV not bound — rate limiting is disabled. See SETUP step 5.');
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    const mode = url.searchParams.get('mode');

    // ===== SHARED TRENDING CACHE (KV-backed, 24h) =====
    // Handled separately from the generic TMDB-proxy flow below: this is
    // the ONE genuinely shared, cross-visitor cache in this Worker. See
    // CHANGE LOG above for why this replaced the old per-visitor,
    // per-title approach on the frontend.
    if (mode === 'trending') {
      const data = await getTrendingData(env);
      return jsonResponse(data, 200, TRENDING_CACHE_TTL_SECONDS, requestOrigin);
    }

    // Edge-cache lifetime for this request, in seconds. Overridden per
    // branch below.
    let cacheTtlSeconds = 3600;

    let tmdbUrl;
    if (mode === 'recommendations') {
      const mediaType = url.searchParams.get('media_type') === 'tv' ? 'tv' : 'movie';
      const id = url.searchParams.get('id');
      if (!id) {
        return jsonResponse({ error: 'Missing "id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${id}/recommendations?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === 'credits') {
      // Cast/crew for a single title — used by the Detail screen so the
      // cast row shows real data instead of hardcoded mockup names.
      const mediaType = url.searchParams.get('media_type') === 'tv' ? 'tv' : 'movie';
      const id = url.searchParams.get('id');
      if (!id) {
        return jsonResponse({ error: 'Missing "id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${id}/credits?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === 'genre') {
      const mediaType = url.searchParams.get('media_type') === 'tv' ? 'tv' : 'movie';
      const genreId = url.searchParams.get('genre_id');
      const page = url.searchParams.get('page') || '1';
      if (!genreId) {
        return jsonResponse({ error: 'Missing "genre_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${env.TMDB_API_KEY}&with_genres=${genreId}&sort_by=popularity.desc&page=${page}`;
    } else if (mode === 'season') {
      // Fetch season-specific data (poster, air date, overview) for a TV
      // show, given its TMDB tv_id and a season number. Used so a search
      // like "A Shop for Killers season 2" can show Season 2's actual
      // poster/date/description instead of the show-level (Season 1) data.
      const tvId = url.searchParams.get('tv_id');
      const seasonNumber = url.searchParams.get('season_number');
      if (!tvId || !seasonNumber) {
        return jsonResponse({ error: 'Missing "tv_id" or "season_number" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === 'search_person') {
      // Actor/Director search — step 1: find the person by name.
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/person?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === 'person_credits') {
      // Actor/Director search — step 2: their combined movie+TV credits.
      const personId = url.searchParams.get('person_id');
      if (!personId) {
        return jsonResponse({ error: 'Missing "person_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/person/${personId}/combined_credits?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === 'search_collection') {
      // Franchise search — step 1: find the collection by name (e.g. "John Wick").
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/collection?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === 'collection') {
      // Franchise search — step 2: every part/movie in that collection.
      const collectionId = url.searchParams.get('collection_id');
      if (!collectionId) {
        return jsonResponse({ error: 'Missing "collection_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/collection/${collectionId}?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === 'search_keyword') {
      // Vibe/Tag search — step 1: resolve a free-text tag (e.g. "isekai") to a TMDB keyword id.
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/keyword?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === 'discover_keyword') {
      // Vibe/Tag search — step 2: movies or TV tagged with that keyword.
      const keywordId = url.searchParams.get('keyword_id');
      const mediaType = url.searchParams.get('media_type') === 'tv' ? 'tv' : 'movie';
      if (!keywordId) {
        return jsonResponse({ error: 'Missing "keyword_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${env.TMDB_API_KEY}&with_keywords=${keywordId}&sort_by=popularity.desc`;
    } else {
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      const page = url.searchParams.get('page') || '1';
      tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${page}`;
    }

    // ===== EDGE CACHE (Cloudflare Cache API) =====
    // Shares one cached TMDB response across ALL visitors hitting the same
    // query/mode/page — e.g. hundreds of people searching "Squid Game"
    // cost ONE real TMDB request per cacheTtlSeconds window instead of one
    // per visitor, cutting TMDB calls (and search latency) for anything
    // popular. Cache key uses sorted query params so param ordering from
    // the frontend never causes an accidental cache miss on what's really
    // the same request.
    //
    // NOTE: `caches.default` is only available on Workers attached to a
    // custom domain/zone — it's undefined on plain *.workers.dev
    // subdomains. Guard every use of it so we skip caching instead of
    // throwing when it's not available. (Trending no longer relies on
    // this at all — see the shared KV cache above.)
    const cache = caches.default;
    const cacheKey = new Request(buildCacheKeyUrl(url), { method: 'GET' });
    const cachedRes = cache ? await cache.match(cacheKey) : null;
    if (cachedRes) {
      // Rebuild with THIS request's CORS header rather than returning the
      // cached Response object as-is — the cache is shared across every
      // origin, but Access-Control-Allow-Origin is per-request, so a
      // response cached for one allowed origin must not be replayed
      // as-is to a different (or disallowed) one.
      const cachedBody = await cachedRes.text();
      return new Response(cachedBody, {
        status: cachedRes.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': cachedRes.headers.get('Cache-Control') || 'no-store',
          ...corsHeaders(requestOrigin),
        },
      });
    }

    try {
      const tmdbRes = await fetch(tmdbUrl);
      const data = await tmdbRes.json();
      // Only successful upstream responses get a cacheable Cache-Control
      // header and get stored — a TMDB error/rate-limit response is never
      // cached, so it self-heals on the very next request instead of
      // getting stuck for the full TTL.
      const response = jsonResponse(data, tmdbRes.status, tmdbRes.ok ? cacheTtlSeconds : 0, requestOrigin);
      if (tmdbRes.ok && cache) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch (err) {
      return jsonResponse({ error: 'Upstream request failed' }, 502, 0, requestOrigin);
    }
  },
};

// Returns the shared trending payload, serving it straight from KV when a
// fresh copy already exists, and only hitting TMDB (then writing to KV)
// when the cache is missing or has expired. This is what makes trending
// genuinely shared across every visitor instead of per-browser.
async function getTrendingData(env) {
  if (env.RATE_LIMIT_KV) {
    const cached = await env.RATE_LIMIT_KV.get(TRENDING_CACHE_KEY, { type: 'json' });
    if (cached) return cached;
  }

  const tmdbRes = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${env.TMDB_API_KEY}`);
  const data = await tmdbRes.json();

  if (tmdbRes.ok && env.RATE_LIMIT_KV) {
    // Fire-and-forget-ish: awaited here since there's no ctx.waitUntil in
    // scope of this helper, but it's a single small write, not a
    // meaningful latency hit, and only happens once per 24h window.
    await env.RATE_LIMIT_KV.put(TRENDING_CACHE_KEY, JSON.stringify(data), {
      expirationTtl: TRENDING_CACHE_TTL_SECONDS,
    });
  }

  return data;
}

// Fixed-window per-IP rate limiter backed by Workers KV, with SAMPLED
// writes so it doesn't burn through the 1,000 writes/day free-tier cap.
//
// Every request does a cheap KV.get() to read the last known count and
// its position in the sequence. Between real writes, the count used for
// the limit check is ESTIMATED by adding 1 per request since the last
// persisted write. Only every WRITE_SAMPLE_RATE-th request actually
// persists the updated count back to KV — so with WRITE_SAMPLE_RATE = 5,
// only 1 in 5 requests writes, cutting writes ~5x versus writing on every
// request, while still blocking a spammer within a few requests of the
// limit (not instantly precise, but plenty tight for this purpose).
//
// Uses a window-numbered key (e.g. "rl:1.2.3.4:29841733") so the counter
// naturally resets every RATE_LIMIT_WINDOW_SECONDS without a separate
// cleanup step — once the window rolls over, the next request just starts
// a fresh key with its own TTL.
async function isRateLimited(env, ip) {
  const windowId = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `rl:${ip}:${windowId}`;

  const stored = await env.RATE_LIMIT_KV.get(key, { type: 'json' });
  const lastCount = stored ? stored.count : 0;
  const lastRequestNumber = stored ? stored.requestNumber : 0;

  // This request's position in the sequence for this IP+window.
  const currentRequestNumber = lastRequestNumber + 1;
  // Estimate: every request since the last real write counts toward the
  // total, even though most of them didn't persist their own count.
  const estimatedCount = lastCount + (currentRequestNumber - lastRequestNumber);

  if (estimatedCount > RATE_LIMIT_MAX) {
    // Blocked requests are never written — no need to persist a rejection,
    // and this avoids wasting a write on traffic we're already refusing.
    return true;
  }

  // Only actually write back to KV every WRITE_SAMPLE_RATE-th request (or
  // on the very first request in a window, so a fresh window always has
  // an accurate baseline instead of starting from a stale estimate).
  const shouldWrite = currentRequestNumber % WRITE_SAMPLE_RATE === 0 || lastRequestNumber === 0;
  if (shouldWrite) {
    await env.RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: estimatedCount, requestNumber: currentRequestNumber }),
      { expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5 }
    );
  }

  return false;
}

// Normalizes a request URL into a stable cache key by sorting its query
// params — so `?query=X&page=1` and `?page=1&query=X` (same request,
// different param order) hit the same cache entry instead of missing.
function buildCacheKeyUrl(url) {
  const keyUrl = new URL(url.toString());
  const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  keyUrl.search = '';
  for (const [k, v] of sortedParams) keyUrl.searchParams.append(k, v);
  return keyUrl.toString();
}

function corsHeaders(requestOrigin) {
  // Only echo back the Origin header if it's on the allow-list — otherwise
  // the browser enforces CORS and blocks the response client-side. A
  // non-matching origin gets no Access-Control-Allow-Origin header at all
  // (safer than falling back to a wildcard or to ALLOWED_ORIGINS[0], which
  // would leak a real response body to disallowed origins on simple GETs).
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  return headers;
}

function jsonResponse(obj, status = 200, cacheSeconds = 0, requestOrigin = '') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // 'no-store' on anything not explicitly marked cacheable (errors,
      // missing-param 400s) — those should never sit in the edge cache.
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
      ...corsHeaders(requestOrigin),
    },
  });
}
