var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ALLOWED_ORIGINS = [
  "https://james-29-00.github.io",
  // your GitHub Pages site
  "https://mycinefind.vercel.app"
  // your live Vercel site — lowercase to match the actual Origin header the browser sends (protocol + domain only, no path)
  // 'https://staging.your-actual-domain.com', // uncomment/add more as needed
];
var RATE_LIMIT_MAX = 30;
var RATE_LIMIT_WINDOW_SECONDS = 60;
var WRITE_SAMPLE_RATE = 5;
var TRENDING_CACHE_TTL_SECONDS = 86400;
var TRENDING_CACHE_KEY = "cache:trending";
var worker_default = {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(requestOrigin) });
    }
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.RATE_LIMIT_KV) {
      const rateLimited = await isRateLimited(env, clientIp);
      if (rateLimited) {
        return jsonResponse({ error: "Too many requests. Please slow down and try again shortly." }, 429, 0, requestOrigin);
      }
    } else {
      console.warn("RATE_LIMIT_KV not bound \u2014 rate limiting is disabled. See SETUP step 5.");
    }
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    const mode = url.searchParams.get("mode");
    if (mode === "trending") {
      const data = await getTrendingData(env);
      return jsonResponse(data, 200, TRENDING_CACHE_TTL_SECONDS, requestOrigin);
    }
    let cacheTtlSeconds = 3600;
    let tmdbUrl;
    if (mode === "recommendations") {
      const mediaType = url.searchParams.get("media_type") === "tv" ? "tv" : "movie";
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ error: 'Missing "id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${id}/recommendations?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === "credits") {
      const mediaType = url.searchParams.get("media_type") === "tv" ? "tv" : "movie";
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ error: 'Missing "id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${id}/credits?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === "genre") {
      const mediaType = url.searchParams.get("media_type") === "tv" ? "tv" : "movie";
      const genreId = url.searchParams.get("genre_id");
      const page = url.searchParams.get("page") || "1";
      if (!genreId) {
        return jsonResponse({ error: 'Missing "genre_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${env.TMDB_API_KEY}&with_genres=${genreId}&sort_by=popularity.desc&page=${page}`;
    } else if (mode === "season") {
      const tvId = url.searchParams.get("tv_id");
      const seasonNumber = url.searchParams.get("season_number");
      if (!tvId || !seasonNumber) {
        return jsonResponse({ error: 'Missing "tv_id" or "season_number" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === "search_person") {
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/person?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === "person_credits") {
      const personId = url.searchParams.get("person_id");
      if (!personId) {
        return jsonResponse({ error: 'Missing "person_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/person/${personId}/combined_credits?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === "search_collection") {
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/collection?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === "collection") {
      const collectionId = url.searchParams.get("collection_id");
      if (!collectionId) {
        return jsonResponse({ error: 'Missing "collection_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/collection/${collectionId}?api_key=${env.TMDB_API_KEY}`;
    } else if (mode === "search_keyword") {
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/search/keyword?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    } else if (mode === "discover_keyword") {
      const keywordId = url.searchParams.get("keyword_id");
      const mediaType = url.searchParams.get("media_type") === "tv" ? "tv" : "movie";
      if (!keywordId) {
        return jsonResponse({ error: 'Missing "keyword_id" parameter' }, 400, 0, requestOrigin);
      }
      tmdbUrl = `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${env.TMDB_API_KEY}&with_keywords=${keywordId}&sort_by=popularity.desc`;
    } else {
      if (!query || !query.trim()) {
        return jsonResponse({ error: 'Missing "query" parameter' }, 400, 0, requestOrigin);
      }
      const page = url.searchParams.get("page") || "1";
      tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${page}`;
    }
    const cache = caches.default;
    const cacheKey = new Request(buildCacheKeyUrl(url), { method: "GET" });
    const cachedRes = cache ? await cache.match(cacheKey) : null;
    if (cachedRes) {
      const cachedBody = await cachedRes.text();
      return new Response(cachedBody, {
        status: cachedRes.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": cachedRes.headers.get("Cache-Control") || "no-store",
          ...corsHeaders(requestOrigin)
        }
      });
    }
    try {
      const tmdbRes = await fetch(tmdbUrl);
      const data = await tmdbRes.json();
      const response = jsonResponse(data, tmdbRes.status, tmdbRes.ok ? cacheTtlSeconds : 0, requestOrigin);
      if (tmdbRes.ok && cache) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch (err) {
      return jsonResponse({ error: "Upstream request failed" }, 502, 0, requestOrigin);
    }
  }
};
async function getTrendingData(env) {
  if (env.RATE_LIMIT_KV) {
    const cached = await env.RATE_LIMIT_KV.get(TRENDING_CACHE_KEY, { type: "json" });
    if (cached) return cached;
  }
  const tmdbRes = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${env.TMDB_API_KEY}`);
  const data = await tmdbRes.json();
  if (tmdbRes.ok && env.RATE_LIMIT_KV) {
    await env.RATE_LIMIT_KV.put(TRENDING_CACHE_KEY, JSON.stringify(data), {
      expirationTtl: TRENDING_CACHE_TTL_SECONDS
    });
  }
  return data;
}
__name(getTrendingData, "getTrendingData");
async function isRateLimited(env, ip) {
  const windowId = Math.floor(Date.now() / 1e3 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `rl:${ip}:${windowId}`;
  const stored = await env.RATE_LIMIT_KV.get(key, { type: "json" });
  const lastCount = stored ? stored.count : 0;
  const lastRequestNumber = stored ? stored.requestNumber : 0;
  const currentRequestNumber = lastRequestNumber + 1;
  const estimatedCount = lastCount + (currentRequestNumber - lastRequestNumber);
  if (estimatedCount > RATE_LIMIT_MAX) {
    return true;
  }
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
__name(isRateLimited, "isRateLimited");
function buildCacheKeyUrl(url) {
  const keyUrl = new URL(url.toString());
  const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  keyUrl.search = "";
  for (const [k, v] of sortedParams) keyUrl.searchParams.append(k, v);
  return keyUrl.toString();
}
__name(buildCacheKeyUrl, "buildCacheKeyUrl");
function corsHeaders(requestOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }
  return headers;
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(obj, status = 200, cacheSeconds = 0, requestOrigin = "") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // 'no-store' on anything not explicitly marked cacheable (errors,
      // missing-param 400s) — those should never sit in the edge cache.
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
      ...corsHeaders(requestOrigin)
    }
  });
}
__name(jsonResponse, "jsonResponse");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
