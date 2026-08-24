// ========== CINEFIND — DRAMACOOL CATALOG CRAWLER (Phase 2) ==========
const COUNTRIES = ['South Korea', 'China', 'Japan', 'Thailand', 'Philippines'];
const GENRES = ['Romance', 'Action', 'Mystery', 'Comedy', 'Drama', 'Thriller', 'Fantasy', 'Historical'];

// Fixed order matters — the rotation pointer stored in KV (see runCrawl) is
// just an index into this array, so it has to stay stable across runs.
const TARGETS = [
  ...COUNTRIES.map(c => ({ kind: 'country', value: c })),
  ...GENRES.map(g => ({ kind: 'genre', value: g })),
];

const MAX_PAGES_PER_TARGET = 10;
const FETCH_TIMEOUT_MS = 4000;
const DELAY_BETWEEN_REQUESTS_MS = 1500;

// Phase 0.6 — Subrequest-limit fix:
// The crawl used to attempt all 13 targets (COUNTRIES+GENRES) in a single
// invocation — with domain fallback and up to MAX_PAGES_PER_TARGET pages
// each, that's up to 13 × domains × 10 = 100s of fetch() calls, way past
// Cloudflare's ~50 subrequests-per-invocation ceiling (Free plan). Once
// the limit hit, every fetch() after it failed instantly for the rest of
// that run — which looked like sudden cascading failures across unrelated
// domains, but was really just "ran out of budget."
//
// Fix has two parts:
// 1. Only process TARGETS_PER_RUN targets per invocation, tracked via a KV
//    pointer (nextTargetIndex) that rotates through all 13 over successive
//    Cron ticks — so the full catalog still gets refreshed regularly, just
//    spread across many small runs instead of one huge one.
// 2. A hard SUBREQUEST_BUDGET as a safety net for the batch itself — even
//    2 targets can occasionally blow past 50 if a domain needs multiple
//    fallback attempts times many pages. If the budget is hit mid-batch,
//    the run stops cleanly (not mid-fetch-failure) and saves its place so
//    the NEXT run picks up exactly where this one stopped, rather than
//    skipping ahead and silently missing that target.
const TARGETS_PER_RUN = 2;
// Reserve a few fetches of headroom below the real ~50 ceiling for the
// registry load (1 fetch) and the health-status GitHub write (up to 2
// fetches) that happen outside this budget check.
const SUBREQUEST_BUDGET = 44;

// Phase 0.5 — Resilience & Safety additions:
// An entry not re-confirmed by any crawl in this many days is stale enough
// to remove — either the title got taken down, or the site restructured
// in a way that stopped this entry from being re-found. 30 days gives
// several crawl cycles of grace before cleanup, so a single bad/blocked
// crawl run doesn't wipe out otherwise-good entries. (With the batching
// above, a full rotation now takes ~7 runs to cover all 13 targets once —
// 30 days still comfortably covers many full rotations even on an
// infrequent Cron schedule.)
const STALE_ENTRY_DAYS = 30;
// If more than this fraction of targets ATTEMPTED THIS RUN fail, that's a
// strong signal something broke (site redesign, new bot-protection) rather
// than normal one-off flakiness — worth a proactive health flag instead of
// only a passive log line buried in scraper_log. Judged per-run (out of
// TARGETS_PER_RUN), not against the full 13, since each run only ever
// attempts a small batch now.
const BREAKAGE_ALERT_THRESHOLD = 0.5;

// Thrown by fetchExplorePage() to unwind out of the target/domain/page
// loops in one motion once SUBREQUEST_BUDGET is hit, instead of threading
// a "stop everything" signal through several nested return-value checks.
class SubrequestBudgetExceeded extends Error {}

export default {
  async fetch(request, env, ctx) {
    const result = await runCrawl(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCrawl(env));
  },
};

async function runCrawl(env) {
  const summary = {
    targetsAttempted: 0, targetsOk: 0, targetsFailed: 0,
    entriesUpserted: 0, errors: [], budgetStopped: false,
  };
  // Shared fetch counter for this run only — passed into fetchExplorePage()
  // so it can throw once SUBREQUEST_BUDGET is reached. Deliberately a local
  // object (not module-level) since Workers can reuse the same isolate for
  // multiple invocations; module-level mutable state would leak between
  // unrelated runs.
  const fetchState = { fetchCount: 0 };

  let registry;
  try {
    registry = await loadDomainRegistry(env);
    fetchState.fetchCount++; // loadDomainRegistry itself costs 1 fetch
  } catch (err) {
    await log(env, 'error', 'registry_load_failed', String(err));
    // Include the real error (e.g. "HTTP 404" or "HTTP 401") directly in
    // the returned summary — previously this was a fixed generic message,
    // so the actual reason was only visible in D1's scraper_log table,
    // not in the response body someone sees when hitting the Worker URL
    // directly to debug (as opposed to a scheduled cron run).
    summary.errors.push(`Could not load dramacool-domains.json — aborting crawl entirely. Reason: ${String(err)}`);
    return summary;
  }

  const domainsToTry = [registry.primary, ...(registry.fallbacks || []).map(f => f.domain)];

  // ---- Phase 0.6: figure out which small batch of targets to run this time ----
  let startIndex = 0;
  try {
    const saved = await env.CRAWL_STATE.get('nextTargetIndex');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (Number.isInteger(parsed) && parsed >= 0) startIndex = parsed % TARGETS.length;
    }
  } catch (err) {
    // Missing/misbehaving KV binding shouldn't kill the crawl — worst case
    // every run just restarts from target 0 instead of rotating properly.
    await log(env, 'warning', 'kv_read_failed', String(err));
  }

  const batch = [];
  for (let i = 0; i < TARGETS_PER_RUN; i++) {
    batch.push(TARGETS[(startIndex + i) % TARGETS.length]);
  }

  let stoppedEarly = false;
  let targetsCompletedThisRun = 0;
  summary.targetsSkippedByBudget = 0;

  for (const target of batch) {
    summary.targetsAttempted++;
    let succeeded = false;

    try {
      for (const domain of domainsToTry) {
        let page = 1;
        let targetEntryCount = 0;
        let targetFailed = false;

        while (page <= MAX_PAGES_PER_TARGET) {
          const params = target.kind === 'country'
            ? `country=${encodeURIComponent(target.value)}`
            : `genre=${encodeURIComponent(target.value)}`;
          const url = `https://${domain}/explore?${params}&page=${page}`;

          const result = await fetchExplorePage(url, env, fetchState);
          if (result === null) { targetFailed = true; break; }

          const upserted = await upsertEntries(env, result.body, domain, target);
          targetEntryCount += upserted;

          if (!result.hasNext) break;
          page++;
          await sleep(DELAY_BETWEEN_REQUESTS_MS);
        }

        if (!targetFailed) {
          summary.entriesUpserted += targetEntryCount;
          succeeded = true;
          break;
        }
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      }
    } catch (err) {
      if (err instanceof SubrequestBudgetExceeded) {
        stoppedEarly = true;
        // This target got cut off mid-attempt, not actually resolved either
        // way — undo the targetsAttempted++ above and count it separately,
        // so targetsOk + targetsFailed + targetsSkippedByBudget always adds
        // up to targetsAttempted, and updateHealthStatus()'s failureRatio
        // isn't skewed by a target that was never really evaluated.
        summary.targetsAttempted--;
        summary.targetsSkippedByBudget++;
        await log(env, 'warning', 'subrequest_budget_exceeded',
          `Hit ${SUBREQUEST_BUDGET}-fetch budget mid-batch at ${target.kind}=${target.value}; stopping run early, will retry this target first next run.`);
        break; // don't advance targetsCompletedThisRun for this one — retry it next run
      }
      throw err; // unexpected error — don't swallow it
    }

    if (stoppedEarly) break;

    if (succeeded) {
      summary.targetsOk++;
    } else {
      summary.targetsFailed++;
      summary.errors.push(`All domains failed for ${target.kind}=${target.value}`);
    }
    targetsCompletedThisRun++;
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  // Only advance the rotation pointer past targets actually finished this
  // run (ok OR cleanly failed) — a target cut short by the budget guard is
  // NOT counted as completed, so next run retries it from scratch instead
  // of silently skipping it.
  const newIndex = (startIndex + targetsCompletedThisRun) % TARGETS.length;
  try {
    await env.CRAWL_STATE.put('nextTargetIndex', String(newIndex));
  } catch (err) {
    await log(env, 'error', 'kv_write_failed', String(err));
  }

  summary.budgetStopped = stoppedEarly;
  summary.batchStartIndex = startIndex;
  summary.nextTargetIndex = newIndex;
  summary.targetsInRotation = TARGETS.length;
  summary.fetchesUsedThisRun = fetchState.fetchCount;

  await log(env, 'info', 'crawl_complete', JSON.stringify(summary));

  // Phase 0.5 additions — run after the crawl itself so a cleanup or
  // health-check failure never prevents the actual crawl summary above
  // from being logged/returned.
  summary.staleEntriesRemoved = await cleanupStaleEntries(env);
  summary.health = await updateHealthStatus(env, summary);

  return summary;
}

// ===== Phase 0.5 — Data freshness / cleanup =====
// Removes catalog rows no crawl has re-confirmed (via last_seen) in
// STALE_ENTRY_DAYS — otherwise the table only ever grows, including for
// titles that got taken down or moved off the site entirely.
async function cleanupStaleEntries(env) {
  const cutoff = new Date(Date.now() - STALE_ENTRY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const result = await env.DB.prepare(
      `DELETE FROM dramacool_catalog WHERE last_seen < ?`
    ).bind(cutoff).run();
    const removed = result.meta?.changes || 0;
    if (removed > 0) {
      await log(env, 'info', 'stale_entries_removed', `Removed ${removed} entries not seen since before ${cutoff}`);
    }
    return removed;
  } catch (err) {
    await log(env, 'error', 'cleanup_failed', String(err));
    return 0;
  }
}

// ===== Phase 0.5 — Proactive breakage alert =====
// Passive logging (scraper_log) already existed, but it only helps if
// someone thinks to go dig through it. This writes a small always-current
// dramacool-health.json to the same GitHub repo the domain registry
// already lives in — a single healthy/unhealthy flag with a reason, so a
// broken crawl is visible at a glance (e.g. from an admin panel widget)
// instead of requiring a manual log search to notice.
async function updateHealthStatus(env, summary) {
  const failureRatio = summary.targetsAttempted > 0
    ? summary.targetsFailed / summary.targetsAttempted
    : 0;
  const healthy = failureRatio < BREAKAGE_ALERT_THRESHOLD;
  const status = {
    healthy,
    lastRun: new Date().toISOString(),
    targetsAttempted: summary.targetsAttempted,
    targetsOk: summary.targetsOk,
    targetsFailed: summary.targetsFailed,
    failureRatio: Number(failureRatio.toFixed(2)),
    budgetStopped: summary.budgetStopped,
    rotationProgress: `${summary.nextTargetIndex}/${summary.targetsInRotation}`,
    reason: healthy
      ? null
      : `${summary.targetsFailed}/${summary.targetsAttempted} targets failed this run — possible site redesign or new bot-protection. Check scraper_log for ng_state_not_found / unexpected_response_shape events.`,
  };

  try {
    await writeGitHubFile(env, 'dramacool-health.json', JSON.stringify(status, null, 2));
  } catch (err) {
    // A failed health-file write shouldn't be treated as the crawl itself
    // failing — log it, but don't let it affect the returned summary.
    await log(env, 'error', 'health_status_write_failed', String(err));
  }

  return status;
}

// Generic "create or update a file in the repo" helper — GitHub's Contents
// API requires the current file's SHA to update it (not needed for a
// brand-new file), so this fetches that first and treats a 404 as "file
// doesn't exist yet" rather than an error.
async function writeGitHubFile(env, path, content) {
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    'Authorization': `token ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'CineFindCrawler',
  };

  let sha;
  const existing = await fetch(apiUrl, { headers });
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(`Could not check existing ${path} (HTTP ${existing.status})`);
  }

  const body = {
    message: `Update ${path} (automated)`,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Could not write ${path} (HTTP ${res.status})`);
}

async function fetchExplorePage(url, env, state) {
  // Phase 0.6 — subrequest budget guard. Thrown (not returned) so it
  // unwinds straight out of the page/domain/target loops in runCrawl
  // without needing a special-case check after every call site.
  if (state.fetchCount >= SUBREQUEST_BUDGET) {
    throw new SubrequestBudgetExceeded(`Budget of ${SUBREQUEST_BUDGET} fetches reached before requesting ${url}`);
  }
  state.fetchCount++;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
  } catch (err) {
    await log(env, 'error', err.name === 'AbortError' ? 'timeout' : 'network_error', `${url} — ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    await log(env, 'error', 'domain_dead_or_page_missing', url);
    return null;
  }
  if (res.status === 403) {
    await log(env, 'warning', 'possible_bot_challenge', url);
    return null;
  }
  if (!res.ok) {
    await log(env, 'error', 'http_error', `${url} — HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  const match = html.match(/<script id="ng-state" type="application\/json">(.*?)<\/script>/s);
  if (!match) {
    await log(env, 'warning', 'ng_state_not_found', `${url} — page loaded but no ng-state blob (structure may have changed)`);
    return null;
  }

  let ngState;
  try {
    ngState = JSON.parse(match[1]);
  } catch (err) {
    await log(env, 'warning', 'ng_state_parse_failed', `${url} — ${String(err)}`);
    return null;
  }

  const listEntry = Object.values(ngState).find(v => v && v.u && v.u.includes('/drama/list'));
  if (!listEntry || !listEntry.b || !Array.isArray(listEntry.b.body)) {
    await log(env, 'warning', 'unexpected_response_shape', `${url} — no drama/list entry found in ng-state (API contract may have changed)`);
    return null;
  }

  if (listEntry.b.body.length === 0) {
    await log(env, 'info', 'empty_page', url);
  }

  return { body: listEntry.b.body, hasNext: !!listEntry.b.hasNext };
}

// Characters allowed in a DramaCool slug based on normal URL slugs seen in
// practice (lowercase letters, digits, hyphens). Anything else in
// entry.slug is a sign the scraped value isn't a clean slug — either the
// page structure changed in an unexpected way, or (worst case) the source
// site was compromised and is trying to inject something like a
// protocol-relative URL or a path that escapes /drama/. Rejecting instead
// of best-effort-cleaning means a suspicious entry is dropped and logged
// rather than silently saved in some partially-sanitized form.
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/i;

async function upsertEntries(env, entries, domain, target) {
  let count = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of entries) {
    if (!entry.name || !entry.slug) continue;

    // Phase 0.5 — URL/domain validation. Building the URL from a slug
    // that isn't validated first means a malicious/malformed slug value
    // could smuggle in things like "../" path traversal or an embedded
    // "http://other-site.com" that changes what domain the final link
    // actually points to. Requiring the slug to match a plain
    // letters/digits/hyphens pattern guarantees the resulting URL can only
    // ever point at ${domain}/drama/<slug> — never anywhere else.
    if (!SAFE_SLUG_PATTERN.test(entry.slug)) {
      await log(env, 'warning', 'unsafe_slug_rejected', `domain=${domain} slug=${JSON.stringify(entry.slug).slice(0, 100)}`);
      continue;
    }

    // Defense-in-depth: the front-end render path should also escape
    // title text before inserting it into the page (see roadmap Phase
    // 0.5), but sanitizing here too means a raw, unescaped title from a
    // compromised source is never even stored — one less place downstream
    // code has to remember to handle it safely.
    const cleanTitle = sanitizeScrapedText(entry.name);
    if (!cleanTitle) continue; // name was nothing but disallowed content after cleaning

    const normalized = normalizeTitle(cleanTitle);
    const url = `https://${domain}/drama/${entry.slug}`;
    const country = entry.country ? sanitizeScrapedText(entry.country) : (target.kind === 'country' ? target.value : null);
    try {
      await env.DB.prepare(
        `INSERT INTO dramacool_catalog (title, normalized_title, url, source_domain, country, year, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(normalized_title, url) DO UPDATE SET last_seen = excluded.last_seen, year = excluded.year`
      ).bind(cleanTitle, normalized, url, domain, country, entry.releaseYear || null, today).run();
      count++;
    } catch (err) {
      await log(env, 'error', 'd1_write_failed', `${url} — ${String(err)}`);
    }
  }
  return count;
}

// Strips HTML tags and control characters from scraped text fields (title,
// country) before they're stored. This is not a substitute for proper
// output-escaping at render time (HTML tags stripped here could still
// legitimately be part of a title in some edge case, and the front-end
// must escape regardless of what's in D1) — it's a floor: even if a
// render path somewhere forgets to escape, raw "<script>" text can't have
// gotten into the database in the first place via this crawler.
function sanitizeScrapedText(text) {
  return String(text)
    .replace(/<[^>]*>/g, '')           // strip HTML tags
    .replace(/[\u0000-\u001F\u007F]/g, '') // strip control characters
    .trim()
    .slice(0, 500); // guard against absurdly long scraped strings
}

function normalizeTitle(title) {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

async function loadDomainRegistry(env) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/dramacool-domains.json`, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'CineFindCrawler',
    },
  });
  if (!res.ok) throw new Error(`Could not read dramacool-domains.json (HTTP ${res.status})`);
  const data = await res.json();
  const content = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
  if (!content.primary) throw new Error('dramacool-domains.json has no "primary" field');
  return content;
}

async function log(env, severity, event, detail) {
  try {
    await env.DB.prepare(
      `INSERT INTO scraper_log (logged_at, severity, event, detail) VALUES (?, ?, ?, ?)`
    ).bind(new Date().toISOString(), severity, event, detail).run();
  } catch (err) {
    console.error('scraper_log write failed:', err, '| original:', severity, event, detail);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
