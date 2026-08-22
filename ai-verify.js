// ============================================================
// ai-verify.js — CineFind AI-Verified Sites feature
// Extracted from index.html so it lives in its own file.
//
// HOW TO USE THIS FILE:
// 1. Upload this file to your GitHub repo (same folder as index.html).
// 2. In index.html, add this line right before </body>:
//      <script src="ai-verify.js"></script>
//    (must load AFTER all your other inline <script> code, since this
//    file calls functions like escapeAttr, applyStatusDots, getSiteStatus,
//    isHotSite, normalizeSiteName, defaultLogoHtml, openReportModal,
//    copySiteLink, and reads SITES_DIRECTORY / customSites — all of which
//    are still defined in index.html itself. Nothing needs to change in
//    those other functions.)
// 3. In index.html, DELETE the block that starts with:
//      // ========== AI-VERIFIED SITES (automatic, background, real-time Gemini check) ==========
//    and ends right before:
//      // ========== SIMILAR / RELATED ==========
//    (i.e. delete checkAIVerifiedSites, renderDebugBox,
//     renderStaticFallbackSites, and renderAIVerifiedSites from
//     index.html — they now live here instead.)
// 4. Keep these two lines in index.html (do NOT delete them — this file
//    depends on them being defined globally before it runs):
//      const AI_VERIFY_WORKER_URL = 'https://fancy-wildflower-1260.manio-james-g-5588.workers.dev';
//      const DEBUG_MODE = new URLSearchParams(window.location.search).get('debug') === '1';
// ============================================================

// ========== AI-VERIFIED SITES (automatic, background, real-time Gemini check) ==========
// Uses the same Worker + prompt structure/rules as the older Gemini-powered
// version of CineFind, adapted to verify sites for a title we already know
// (from TMDB) instead of asking Gemini to identify the title itself.
// Runs automatically per search with a 5s budget. If Gemini doesn't answer
// in time (or errors), the small "Checking..." indicator just quietly
// disappears — the static list was already visible the whole time, so
// nothing on screen breaks or needs explaining.
// ============================================================
// THE AI PROMPT — this is the full "brain" of the direct-link
// verification feature. This exact text is what gets sent to Gemini
// every time someone searches a title. Everything the AI is allowed
// to do, and everything it's told NOT to do, lives here.
//
// IMPORTANT (found 2026-08-22): Google Search grounding does not cost
// "1 search" per API call — Gemini internally fires a SEPARATE search
// query for each site it tries to verify. Listing all 5 sites and
// trusting the model to "only check the relevant ones" still let it
// fan out and search all 5, burning 5x the grounding quota per single
// title lookup. The fix: decide the relevant site(s) HERE in JS,
// BEFORE building the prompt text, so sites that don't apply are
// never even mentioned to the model — nothing for it to search.
//
// Whole intent, in plain terms:
//   1. Tell Gemini exactly which title/year/type (movie, series,
//      anime, K-Drama) the user is looking for.
//   2. Only mention the 1-2 sites that are actually relevant to this
//      title's category — never all 5, to keep grounding search
//      fan-out (and quota use) to a minimum per lookup.
//   3. Force Gemini to actually use Google Search to check in real
//      time whether the title is really watchable there — never
//      just guess from memory.
//   4. Force a strict JSON reply (name, url, note, linkType) so the
//      front-end code can render it directly as clickable cards —
//      no free-text answers allowed.
//   5. Only allow "linkType": "direct" (a real clickable link straight
//      to the title) when Gemini is 100% sure the exact URL is right.
//      Otherwise it must fall back to "search_required" (a link to
//      the site's search page instead) rather than invent a URL that
//      might be wrong or dead.
//   6. If nothing can be confidently verified, return an empty list
//      instead of forcing a bad guess — the front-end then falls back
//      to the static site list.
//
// If you want to change WHICH sites the AI checks, edit
// CATEGORY_SITES below — this is the only place you need to edit.
// ============================================================
// NOTE: named AI_VERIFY_SITE_MAP (not CATEGORY_SITES) — index.html
// already has its own global CATEGORY_SITES for the static site
// directory. Since this file loads as a plain <script src>, it shares
// the same global scope as index.html's inline script, so reusing
// that name would collide and break the whole page's JS.
//
// Keys match what index.html's own detectCategory(r, type) already
// returns — 'anime', 'drama', 'movie', 'series' — so this plugs
// straight into the category the app already computes, no guessing.
const AI_VERIFY_SITE_MAP = {
  anime: [
    { name: 'Animepahe', domain: 'animepahe.pw' },
  ],
  drama: [
    { name: 'DramaCool', domain: 'dramacool.com.tw' },
    { name: 'KissKH', domain: 'kisskh.co' },
  ],
  movie: [
    { name: 'Cineby', domain: 'cineby.at' },
  ],
  series: [
    { name: 'Cineby', domain: 'cineby.at' },
  ],
};

function buildVerifyPrompt(movie) {
  const categoryHint = movie.category === 'anime' ? ' — this is anime'
    : movie.category === 'drama' ? ' — this is a K-Drama/J-Drama'
    : '';

  // Only the sites relevant to THIS title's category get mentioned in
  // the prompt text below — everything else in AI_VERIFY_SITE_MAP is
  // never sent, so Gemini has nothing else to search for.
  const relevantSites = AI_VERIFY_SITE_MAP[movie.category] || AI_VERIFY_SITE_MAP.movie;
  const siteChecklist = relevantSites
    .map((s, i) => `  ${i + 1}. ${s.name} (${s.domain})`)
    .join('\n');

  return `Verify current, real, working FREE streaming sites where someone can watch "${movie.title}"${movie.year ? ' (' + movie.year + ')' : ''} right now. This is a ${movie.type === 'series' ? 'TV series' : 'movie'}${categoryHint}.

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "sites": [
    {
      "name": "Site name",
      "url": "https://full-direct-url-to-the-title-on-that-site",
      "note": "Short note e.g. English sub, Free with ads",
      "linkType": "direct"
    }
  ],
  "tip": "One helpful tip for watching this right now"
}

Rules:
- Use Google Search to verify real-time whether this title is actually available on the site(s) below before including it. Do not rely on memory alone.
- Only include REAL, working, free streaming sites (no paid/subscription required)
- Check ONLY these site(s) — do not check or suggest any other site:
${siteChecklist}
- IMPORTANT: Only recommend a site if you are CONFIDENT this specific title is actually available and watchable there right now
- URL rule (follow in this priority order):
  1. ONLY set "linkType": "direct" if you have 100% verified through actual search that this exact URL leads directly to this specific title and it is currently watchable. If there is ANY doubt, do NOT use "direct".
  2. If you're confident the title exists on the site but are not 100% sure of the exact URL, use that site's search results page URL instead and set "linkType": "search_required"
  3. Never invent or guess a direct URL — a wrong guessed link is worse than a search-page link.
- Rank the site(s) above from MOST reliable to least reliable if more than one applies
- If none can be confidently verified, respond with {"sites": [], "tip": ""}
- Keep it family-friendly`;
}

// ============================================================
// checkAIVerifiedSites — runs the above prompt through the Worker
// and renders whatever Gemini confidently verifies.
// ============================================================
async function checkAIVerifiedSites(movie, staticFallback) {
  const indicator = document.getElementById('ai-verify-indicator');
  const container = document.getElementById('ai-verify-section');
  if (!movie || !indicator || !container) return;

  const prompt = buildVerifyPrompt(movie);

  const controller = new AbortController();
  // 18s budget (was 12s): the Worker now runs a real reachability check on
  // every "direct" link (see isUrlReachable() in the Worker) AFTER Gemini
  // responds, before returning — up to ~4.5s more on top of Gemini's own
  // response time. That pushed borderline cases (Gemini itself taking
  // 8-10s) past the old 12s cap, timing out and falling back to the
  // static list even though a real answer was seconds away. Bumped to
  // give that extra step headroom; testing whether this alone is enough
  // before also trimming the Worker's per-URL check timeout.
  const timeoutId = setTimeout(() => controller.abort(), 18000);
  const startTime = performance.now();

  // Debug trail collected on every run (cheap — just array pushes + console.log,
  // no user-visible effect). Only rendered on-page when ?debug=1 is in the URL
  // (see renderDebugBox), so normal users never see this; useful for diagnosing
  // on mobile where devtools aren't easily available.
  const debugLines = [];
  const since = () => `+${((performance.now() - startTime) / 1000).toFixed(1)}s`;
  const log = (msg) => { debugLines.push(`[${since()}] ${msg}`); console.log('[AI-verify]', msg); };

  log(`Worker URL: ${AI_VERIFY_WORKER_URL}`);
  log(`Prompt length: ${prompt.length} chars`);

  try {
    log('Sending POST request...');
    const res = await fetch(AI_VERIFY_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // title/category sent alongside the prompt so the Worker can run its
      // own direct KissKH API lookup (real ID, not a Gemini guess) without
      // needing to parse the movie title back out of the free-text prompt.
      body: JSON.stringify({ prompt, title: movie.title, category: movie.category }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    log(`HTTP response received: ${res.status} ${res.statusText}`);

    // Read as raw text first so a non-JSON response (HTML error page, plain
    // text, etc.) doesn't just throw an opaque "Unexpected token" error —
    // we can show exactly what the Worker actually sent back.
    const rawBody = await res.text();
    log(`Raw response body (${rawBody.length} chars): ${rawBody.slice(0, 500)}${rawBody.length > 500 ? '…' : ''}`);

    let resData;
    try {
      resData = JSON.parse(rawBody);
    } catch (parseErr) {
      throw new Error(`Worker did not return valid JSON (HTTP ${res.status} ${res.statusText}).`);
    }

    if (!res.ok || resData.error) {
      const apiMsg = resData.details
        || (typeof resData.error === 'string' ? resData.error : resData.error?.message)
        || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(apiMsg);
    }

    const text = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      throw new Error(`Empty response from Gemini. Full JSON: ${JSON.stringify(resData).slice(0, 400)}`);
    }

    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse AI response as JSON.');
    }

    log(`✅ Success — Gemini returned ${(parsed.sites || []).length} site(s)`);

    // Only apply if the user is still looking at the same movie
    // (they may have navigated away during the 18s window).
    if (window.currentMovie === movie) renderAIVerifiedSites(parsed, staticFallback);
  } catch (err) {
    clearTimeout(timeoutId);
    if (window.currentMovie !== movie) return;

    const isTimeout = err.name === 'AbortError';
    // "Failed to fetch" from the fetch() call itself (before any HTTP
    // response is even received) almost always means CORS or a network/
    // DNS problem, not something wrong with Gemini or the JSON — flag
    // that distinctly since the fix is completely different. A genuine CORS
    // block normally fails FAST (well under 18s) since the browser blocks
    // it client-side before waiting for a real response — so isTimeout and
    // isNetworkFail are treated as mutually exclusive, distinguishable
    // failure modes.
    const isNetworkFail = !isTimeout && /failed to fetch|networkerror|load failed/i.test(err.message || '');
    const isQuota = /quota|429|rate limit|resource_exhausted/i.test(err.message || '');
    const elapsed = since();
    const failureType = isTimeout ? 'TIMEOUT (18s cap hit)'
      : isNetworkFail ? 'CORS/network error (blocked before any HTTP response)'
      : isQuota ? 'QUOTA/RATE LIMIT — Gemini API quota likely exhausted'
      : 'error';
    log(`❌ Failed at ${elapsed} — ${failureType}: ${err.message || err.toString()}`);

    const el = document.getElementById('ai-verify-indicator');
    if (el) el.remove();

    renderStaticFallbackSites(staticFallback, { err, elapsed: elapsed.replace('+', '').replace('s', ''), isTimeout, isNetworkFail, isQuota });
  } finally {
    renderDebugBox(debugLines);
  }
}

// Always-on debug trail, written directly into the page (collapsible) so the
// exact request/response/error is visible without needing devtools —
// especially useful when debugging on mobile. Only rendered when the page
// is loaded with ?debug=1 in the URL; regular users never see this panel.
function renderDebugBox(lines) {
  const box = document.getElementById('ai-debug-box');
  if (!box || lines.length === 0) return;
  if (!DEBUG_MODE) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <details open style="margin-top:10px; font-size:.72rem; color:var(--muted); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
      <summary style="cursor:pointer; font-weight:600; color:var(--text);">🐛 AI check debug log</summary>
      <pre style="white-space:pre-wrap; word-break:break-word; margin-top:8px; font-family:monospace; font-size:.68rem; line-height:1.5;">${escapeAttr(lines.join('\n'))}</pre>
    </details>
  `;
}

// Renders the plain static site list into the AI-verify slot — used when
// Gemini times out (18s), errors, or comes back with no confidently
// verified sites. `failure`, if present, is shown as a short on-screen note
// (timed out / CORS-or-network / other) so failures are diagnosable without
// opening devtools — especially useful on mobile.
function renderStaticFallbackSites(staticFallback, failure) {
  const container = document.getElementById('ai-verify-section');
  if (!container || !staticFallback) return;

  // User-facing note is intentionally generic — no raw error text, timing,
  // or technical details. Full failure detail (timeout vs network vs quota,
  // exact error message, elapsed time) goes to the debug log instead
  // (see the `log(...)` calls in the caller), visible only with ?debug=1.
  const errNote = failure
    ? `<p style="font-size:.7rem; color:var(--muted); margin-bottom:10px;">⚠️ AI check unavailable — showing the regular list instead.</p>`
    : '';

  container.innerHTML = `
    <div class="section-label">🌐 Free streaming sites</div>
    ${errNote}
    <div class="sites-grid">${staticFallback.siteCards}</div>
    ${staticFallback.tip ? `<div class="tips-box">💡 <strong>Tip:</strong> ${staticFallback.tip}</div>` : ''}
  `;
  applyStatusDots();
}

function renderAIVerifiedSites(parsed, staticFallback) {
  const container = document.getElementById('ai-verify-section');
  if (!container) return;
  const rawSites = parsed.sites || [];

  if (rawSites.length === 0) {
    // Gemini answered but didn't confidently verify anything — fall back
    // to the static list rather than leaving this section empty.
    renderStaticFallbackSites(staticFallback);
    return;
  }

  // Dedup: Gemini sometimes returns the same site twice under a slightly
  // different name or URL variant (e.g. "Tubi" / "tubi.tv", or a trailing-
  // slash variant of the same domain). We key on both a normalized name and
  // a normalized hostname, and keep only the FIRST occurrence of each —
  // Gemini's own ranking already puts the most reliable match first, so
  // this preserves that AI-first order rather than re-sorting anything.
  const seenNames = new Set();
  const seenDomains = new Set();
  const sites = rawSites.filter(s => {
    const nameKey = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let domainKey = '';
    try { domainKey = new URL(s.url).hostname.replace(/^www\./, '').replace(/^m\./, ''); }
    catch (e) { domainKey = (s.url || '').toLowerCase(); }
    if (seenNames.has(nameKey) || (domainKey && seenDomains.has(domainKey))) return false;
    seenNames.add(nameKey);
    if (domainKey) seenDomains.add(domainKey);
    return true;
  });

  // Resolve each Gemini-returned site against SITES_DIRECTORY + customSites
  // FIRST (built-in + admin-added, same combined list renderSitesDirectory
  // uses), so hot/status lookups below use the same canonical name the admin
  // panel's "Hot" tag and status.json entries are keyed on — not whatever
  // exact phrasing Gemini happened to use for the site name.
  const allKnownSites = [...SITES_DIRECTORY, ...customSites];
  const resolved = sites.map(s => {
    const dirMatch = allKnownSites.find(d =>
      normalizeSiteName(s.name).includes(normalizeSiteName(d.name)) || normalizeSiteName(d.name).includes(normalizeSiteName(s.name))
    );
    return { s, dirMatch, canonicalName: dirMatch ? dirMatch.name : s.name };
  });

  // Priority order: 🔥 Hot first, then by status — green (up) → yellow
  // (blocked/may-issue) → unknown (no status data) → red (down) last.
  // Gemini's own relative ranking is preserved within each tier (stable sort).
  const statusRank = (name) => {
    const status = getSiteStatus(name);
    if (status === 'up') return 0;
    if (status === 'blocked') return 1;
    if (status === 'down') return 3;
    return 2; // unknown / not yet checked
  };
  resolved.sort((a, b) => {
    const hotDiff = (isHotSite(b.canonicalName) ? 1 : 0) - (isHotSite(a.canonicalName) ? 1 : 0);
    if (hotDiff !== 0) return hotDiff;
    return statusRank(a.canonicalName) - statusRank(b.canonicalName);
  });

  const cards = resolved.map(({ s, dirMatch, canonicalName }, i) => {
    const logoInner = dirMatch ? (dirMatch.logoHtml || defaultLogoHtml(dirMatch)) : `<span style="font-size:1.3rem;">🎥</span>`;
    return `
    <a href="${s.url}" target="_blank" rel="noopener" class="site-card" data-site-name="${escapeAttr(canonicalName)}" style="animation-delay:${i * 0.07}s">
      <div class="site-logo-box">${logoInner}</div>
      <div class="site-info">
        <div class="site-name"><span class="status-dot-mini" data-status-dot style="display:none; width:13px; height:13px; margin-right:6px; vertical-align:middle;"></span>${escapeAttr(s.name)}</div>
        <div class="site-note">${escapeAttr(s.note || 'AI-verified')}</div>
        ${s.linkType === 'direct' ? '<div style="font-size:.7rem;color:#06d6a0;margin-top:3px;">✅ Direct link (AI-verified)</div>' : '<div style="font-size:.7rem;color:#ffd166;margin-top:3px;">⚠️ Search inside site</div>'}
      </div>
      <button class="copy-link-btn" onclick="event.preventDefault(); event.stopPropagation(); openReportModal('${escapeAttr(s.name)}', '${escapeAttr(s.url)}')" title="Report broken" aria-label="Report ${escapeAttr(s.name)} as broken" style="font-size:.85rem;">🚩</button>
      <button class="copy-link-btn" onclick="copySiteLink(event, '${escapeAttr(s.url)}', this)" title="Copy link" aria-label="Copy link to ${escapeAttr(s.name)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
      <span class="arrow">→</span>
    </a>`;
  }).join('');

  container.innerHTML = `
    <div class="section-label" style="margin-top:4px; display:flex; align-items:center; gap:6px;">🔮 AI-Verified <span style="font-weight:400; text-transform:none; letter-spacing:0; color:var(--green); font-size:.7rem;">(checked just now)</span></div>
    <div class="sites-grid">${cards}</div>
    ${parsed.tip ? `<div class="tips-box" style="margin-top:10px;">💡 <strong>Tip:</strong> ${escapeAttr(parsed.tip)}</div>` : ''}
  `;
  applyStatusDots();
}

// ===== Standalone KissKH direct-link check =====
// Independent of ENABLE_AI_VERIFY and the Gemini flow above — hits the
// Worker's dedicated mode=kisskh branch, which only calls kisskh.co's own
// search API, no Gemini/API keys involved. Call this unconditionally for
// drama titles regardless of whether AI-verify is on; it patches the
// already-visible static KissKH card in place once a confirmed match comes
// back, and silently does nothing on any failure — the generic KissKH
// search link already showing is a perfectly fine fallback either way.
//
// Debug trail: every branch below logs a line and renders it into
// #kisskh-debug-box, but ONLY when ?debug=1 is in the URL (DEBUG_MODE,
// defined in index.html) — regular users never see this, same pattern as
// the AI-verify debug log above. Use this to see exactly why a KissKH card
// didn't upgrade (wrong category, network error, no confident match, etc.)
// instead of it just silently staying generic with no visible reason.
function renderKissKHDebug(lines) {
  const box = document.getElementById('kisskh-debug-box');
  if (!box || !DEBUG_MODE || lines.length === 0) return;
  box.innerHTML = `
    <details open style="margin-top:10px; font-size:.72rem; color:var(--muted); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
      <summary style="cursor:pointer; font-weight:600; color:var(--text);">🐛 KissKH check debug log</summary>
      <pre style="white-space:pre-wrap; word-break:break-word; margin-top:8px; font-family:monospace; font-size:.68rem; line-height:1.5;">${escapeAttr(lines.join('\n'))}</pre>
    </details>
  `;
}

async function checkKissKHDirectLink(movie) {
  const debugLines = [];
  const log = (msg) => { debugLines.push(msg); if (DEBUG_MODE) console.log('[KissKH]', msg); };

  if (!movie || movie.category !== 'drama' || !movie.title) {
    log(`Skipped — category is "${movie && movie.category}", not "drama" (or no title).`);
    renderKissKHDebug(debugLines);
    return;
  }
  log(`Checking KissKH direct link for "${movie.title}"...`);
  try {
    const res = await fetch(AI_VERIFY_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'kisskh', title: movie.title }),
      signal: AbortSignal.timeout(8000),
    });
    log(`Worker responded: HTTP ${res.status} ${res.statusText}`);
    if (!res.ok) {
      log('Stopping — non-OK HTTP status. Generic KissKH card left as-is.');
      renderKissKHDebug(debugLines);
      return;
    }
    const data = await res.json();
    log(`Response body: ${JSON.stringify(data).slice(0, 300)}`);
    const result = data && data.result;
    if (!result || !result.url) {
      log('No confident match returned by the Worker (result is null/empty). Generic KissKH card left as-is.');
      renderKissKHDebug(debugLines);
      return;
    }
    // Movie may have changed while this request was in flight.
    if (window.currentMovie !== movie) {
      log('Movie changed while request was in flight — discarding result.');
      renderKissKHDebug(debugLines);
      return;
    }

    const card = document.querySelector('.site-card[data-site-name="KissKH"]');
    if (!card) {
      log('No KissKH card found in the DOM to update — was it renamed or removed from the sites list?');
      renderKissKHDebug(debugLines);
      return;
    }
    card.href = result.url;

    const noteDiv = card.querySelector('.site-info > div.site-note');
    if (noteDiv) noteDiv.textContent = result.note || 'English sub, Free streaming';

    const badgeSpan = card.querySelector('.site-info > span.site-note, .site-info > span.site-free');
    if (badgeSpan) {
      badgeSpan.outerHTML = '<span class="site-free" style="margin-top:2px; display:inline-block;">✅ Direct link</span>';
    }

    // Report/Copy buttons had the old generic URL baked into their onclick
    // strings when the card was first built — refresh those too so they
    // stay consistent with the new href instead of silently pointing at
    // the stale search-page link.
    const reportBtn = card.querySelector('.copy-link-btn.report-icon');
    if (reportBtn) {
      reportBtn.setAttribute('onclick', `event.preventDefault(); event.stopPropagation(); openReportModal('KissKH', '${escapeAttr(result.url)}')`);
    }
    const copyBtn = card.querySelector('.copy-link-btn:not(.report-icon)');
    if (copyBtn) {
      copyBtn.setAttribute('onclick', `copySiteLink(event, '${escapeAttr(result.url)}', this)`);
    }
    log(`✅ Success — KissKH card upgraded to confirmed direct link: ${result.url}`);
    renderKissKHDebug(debugLines);
  } catch (e) {
    log(`❌ Failed — ${e.name}: ${e.message}. Generic KissKH card left as-is.`);
    renderKissKHDebug(debugLines);
  }
}
