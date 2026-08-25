// worker.js — OmniRoute proxy worker
// Layer 1 (Rate Limiting) and Layer 2 (Cache) added below.
// Reuses the SAME KV bindings already declared in wrangler.toml for the
// dramacool-search worker (RATE_LIMIT_KV, SEARCH_CACHE) — no new
// namespaces needed, just make sure this worker's own wrangler.toml
// also declares these two [[kv_namespaces]] blocks with matching ids.

const RATE_LIMIT_MAX = 20;              // same numbers as dramacool-search-worker.js
const RATE_LIMIT_WINDOW_SECONDS = 60;   // 20 requests per 60s window per IP
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24hr, same as dramacool-search-worker.js

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

// Simple, fast string hash (djb2) — used only to turn an arbitrary-length
// prompt into a short, safe KV key. Not cryptographic, just needs to be
// consistent and low-collision for cache-key purposes.
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
    // KV hiccup shouldn't block real requests — fail open, same
    // "best effort" principle used in dramacool-search-worker.js.
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

async function cacheSet(env, key, payload) {
  if (!env.SEARCH_CACHE) return;
  try {
    await env.SEARCH_CACHE.put(key, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    // Non-fatal — cache write failing shouldn't break the response.
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

    // ===== Layer 1: Rate limiting =====
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const limited = await isRateLimited(env, clientIp);
      if (limited) {
        return json({ error: 'Too many requests. Please slow down and try again shortly.' }, 429);
      }
    } else {
      console.warn('RATE_LIMIT_KV not bound — rate limiting is disabled.');
    }

    let prompt;
    try {
      ({ prompt } = await request.json());
    } catch (err) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    if (!prompt || typeof prompt !== 'string') {
      return json({ error: 'Missing or invalid prompt' }, 400);
    }

    // ===== Layer 2: Cache check (before touching OmniRoute at all) =====
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

    // OmniRoute exposes an OpenAI-compatible /v1/chat/completions endpoint.
    // It handles picking which underlying free AI provider to use and the
    // auto-fallback between them internally — this worker doesn't need to
    // know or care which one actually answered.
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
        signal: AbortSignal.timeout(15000),
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

    // ===== Server-side link verification =====
    // The prompt (built in index.html's buildOmniRoutePrompt) only asks
    // the model for its best-guess URL pattern per site — it deliberately
    // does NOT ask it to verify the page exists, since that phrasing was
    // what got the prompt refused by Groq outright. That means every URL
    // coming back here is unconfirmed and could easily be wrong (site
    // changed its URL scheme, title doesn't actually exist there, model
    // just guessed badly).
    //
    // Verification happens here instead: a plain HEAD request per guessed
    // URL, worker-to-website. This is NOT subject to the CORS restriction
    // that blocked doing this check from the browser — CORS only applies
    // to requests initiated by page JavaScript in a browser, not
    // server-to-server fetches like this one. Any URL that doesn't
    // resolve (non-2xx/3xx, timeout, network error) gets dropped and
    // replaced with an empty string, exactly like "OmniRoute found
    // nothing" — index.html's existing fallback-link behavior handles
    // that case already, no front-end change needed there beyond the
    // badge wording.
    let parsedLinks = null;
    try {
      const cleaned = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      parsedLinks = parsed?.links || null;
    } catch (err) {
      // Not valid JSON after cleanup — fall through and return the raw
      // text as before; index.html already handles a response that
      // isn't the expected shape.
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
            // Some sites don't support HEAD (405/501) even though the page
            // itself is real — retry once with GET before giving up on it,
            // since a false-negative here throws away a working link.
            try {
              const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
              return [site, res.ok ? url : ''];
            } catch (err2) {
              return [site, '']; // couldn't verify — treat as not found rather than trusting an unverified guess
            }
          }
        })
      );

      const verifiedLinks = { ...parsedLinks };
      verified.forEach((result, i) => {
        const [site] = entries[i];
        verifiedLinks[site] = result.status === 'fulfilled' ? result.value[1] : '';
      });

      const payload = { text: JSON.stringify({ links: verifiedLinks }) };
      await cacheSet(env, cacheKey, payload);
      return json(payload);
    }

    const payload = { text: trimmed };
    await cacheSet(env, cacheKey, payload);
    return json(payload);
  },
};
