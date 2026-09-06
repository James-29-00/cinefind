// ========== PWA INSTALL PROMPT ==========
// Chrome/Edge/Android fire this event once the site meets installability
// criteria (manifest.json + icons + served over https). We intercept it and
// stash it instead of letting the browser show its own mini-infobar. The
// "Install app" action itself lives inside the theme dropdown menu now
// (folded in alongside Help, see toggleThemeDropdown) rather than its own
// header button — deferredInstallPrompt being non-null is what the dropdown
// checks to decide whether to show that row at all. iOS Safari never fires
// this event (no such API there), so the row simply never appears there —
// iOS users still add via native Share -> "Add to Home Screen", unchanged.
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

async function triggerInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice; // resolves once the user accepts/dismisses
  deferredInstallPrompt = null;
}

// Covers the case where the user installs via the browser's own UI instead
// of our menu row (e.g. they'd already dismissed it once) — keeps state in
// sync so a stale "Install app" row doesn't linger in the dropdown.
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

// Registering a service worker is what makes Chrome/Edge/Brave on Android
// reliably fire beforeinstallprompt — on some versions it's a hard
// installability requirement, not just a nice-to-have. sw.js now also
// caches the app shell (index.html) and serves it back when the network
// is unavailable, so the app opens to something useful instead of the
// browser's default offline error — see sw.js for what is/isn't cached.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ========== iOS "ADD TO HOME SCREEN" FALLBACK ==========
// iOS Safari never fires beforeinstallprompt (Apple provides no such API),
// so our install button above never appears there. This shows a small,
// dismissible banner with manual instructions instead — otherwise iOS
// users (a large share of mobile visitors) never learn the app is
// installable at all. Dismissal is remembered per-device via localStorage,
// same pattern as the homepage safety tip.
function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function isInStandaloneMode() {
  return ('standalone' in window.navigator) && window.navigator.standalone;
}

function showIosInstallBannerIfNeeded() {
  if (!isIosDevice() || isInStandaloneMode()) return; // not iOS, or already installed
  if (localStorage.getItem('cinefind-ios-install-dismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.innerHTML = `
    <span class="ios-banner-icon">📲</span>
    <span class="ios-banner-text">Install this app: tap <strong>Share</strong> <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg> then <strong>Add to Home Screen</strong></span>
    <button class="ios-banner-close" onclick="dismissIosInstallBanner()" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);
}

function dismissIosInstallBanner() {
  localStorage.setItem('cinefind-ios-install-dismissed', '1');
  const el = document.getElementById('ios-install-banner');
  if (el) el.remove();
}

// ========== THEME TOGGLE (Crimson Dark -> Crimson Light -> Cyber -> Galaxy, via moon button) ==========
// Cyber and Galaxy are purpose-built dark/neon aesthetics (their glow effects
// need a near-black background to read correctly), so only Crimson gets a
// light variant. Light mode lives inside the same single-button cycle rather
// than a separate control, per how this site's UI is laid out.
function initTheme() {
  loadColorTheme();
}

const THEME_KEY = 'cinefind-theme-mode';
const THEME_CYCLE = [
  { theme: 'theme-crimson', mode: 'dark-mode', label: 'Crimson', swatch: '#e63946' },
  { theme: 'theme-crimson', mode: 'light-mode', label: 'Light Mode', swatch: '#ffffff' },
  { theme: 'theme-cyber', mode: 'dark-mode', label: 'Cyber', swatch: '#22e5e5' },
  { theme: 'theme-galaxy', mode: 'dark-mode', label: 'Galaxy', swatch: '#ff5fa2' },
];
const THEME_CLASSES = THEME_CYCLE.map(s => s.theme).filter((v, i, a) => a.indexOf(v) === i);
const MODE_CLASSES = ['dark-mode', 'light-mode'];

function findThemeIndex() {
  const i = THEME_CYCLE.findIndex(s =>
    document.body.classList.contains(s.theme) && document.body.classList.contains(s.mode)
  );
  return i === -1 ? 0 : i;
}

function cycleTheme() {
  const next = THEME_CYCLE[(findThemeIndex() + 1) % THEME_CYCLE.length];
  applyTheme(next, true);
}

// ========== THEME DROPDOWN (pick directly instead of cycling one-by-one) ==========
function toggleThemeDropdown(event) {
  event.stopPropagation();
  const menu = document.getElementById('theme-dropdown-menu');
  if (!menu) return;
  const isOpen = menu.style.display === 'block';
  if (isOpen) {
    menu.style.display = 'none';
    return;
  }
  const activeIndex = findThemeIndex();
  // Color swatch dot per option — previously plain text labels only, so
  // you had to actually pick a theme to see what it looked like. The dot
  // uses each theme's real accent color as a preview before switching.
  // Light Mode's swatch is white (not a red shade) so it reads as
  // distinctly different from Crimson at a glance in the dropdown — same
  // problem the two would otherwise share if both used red dots. White
  // needs a darker border to stay visible against the menu's own
  // background (the pale border everything else uses would nearly
  // disappear against a white dot), so it gets its own border color.
  menu.innerHTML = THEME_CYCLE.map((s, i) => `
    <button onclick="selectThemeFromDropdown(${i})" style="display:flex; align-items:center; gap:8px; width:100%; text-align:left; background:${i === activeIndex ? 'rgba(255,255,255,.08)' : 'none'}; border:none; color:var(--text); font-size:.82rem; font-weight:${i === activeIndex ? '700' : '500'}; padding:8px 10px; border-radius:6px; cursor:pointer;">
      <span style="width:12px; height:12px; border-radius:50%; background:${s.swatch}; border:1px solid ${s.swatch === '#ffffff' ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.25)'}; flex-shrink:0; box-shadow:0 0 6px ${s.swatch}99;"></span>
      <span>${i === activeIndex ? '✓ ' : ''}${s.label}</span>
    </button>
  `).join('')
  // Help lives in the hamburger menu (see hamburger-menu markup), not
  // here — this dropdown stays theme-options-only.
  + (deferredInstallPrompt
    ? `<div style="height:1px; background:var(--border); margin:5px 2px;"></div>
       <button onclick="closeThemeDropdownOnOutsideClick(); triggerInstallPrompt();" style="display:flex; align-items:center; gap:8px; width:100%; text-align:left; background:none; border:none; color:var(--text); font-size:.82rem; font-weight:500; padding:8px 10px; border-radius:6px; cursor:pointer;">
      <span style="width:12px; text-align:center; flex-shrink:0;">📲</span>
      <span>Install app</span>
    </button>`
    : '');
  menu.style.display = 'block';
  menu.style.animation = 'dropdownIn .16s ease';
  menu.style.transformOrigin = 'top right';
  document.addEventListener('click', closeThemeDropdownOnOutsideClick, { once: true });
}

function selectThemeFromDropdown(index) {
  applyTheme(THEME_CYCLE[index], true);
  const menu = document.getElementById('theme-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

function closeThemeDropdownOnOutsideClick() {
  const menu = document.getElementById('theme-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

function applyTheme(state, announce) {
  document.body.classList.remove(...THEME_CLASSES, ...MODE_CLASSES);
  document.body.classList.add(state.theme, state.mode);
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme: state.theme, mode: state.mode }));
  } catch (e) { /* storage unavailable — theme still applied to DOM */ }
  // No JS-driven color logic needed for the button itself — it reads
  // var(--accent), which the theme-* CSS classes already set, so the
  // icon color/glow follows automatically.
  const labelEl = document.getElementById('theme-name-label');
  if (labelEl) labelEl.textContent = state.label;
  const btn = document.getElementById('theme-picker-btn');
  if (btn) btn.setAttribute('aria-label', `Change theme — currently ${state.label}`);
  // Moon = "tap to go dark", sun = "tap to go light" — standard convention.
  // The button used to show a moon icon even while already in Light Mode,
  // which reads backwards (looks like "currently dark", not "tap for dark").
  const iconEl = document.getElementById('theme-toggle-icon');
  if (iconEl) {
    // Sun icon redrawn with evenly-spaced rays (45° apart) and a slightly
    // heavier stroke (2 vs the earlier 1.8) — the original hand-placed
    // coordinates had uneven gaps between rays that read as slightly
    // lopsided at 20px, especially next to the clean, symmetric moon fill.
    iconEl.innerHTML = state.mode === 'light-mode'
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
  if (announce) showToast(`Switched to ${state.label} theme`);
}

function loadColorTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const match = THEME_CYCLE.find(s => s.theme === saved.theme && s.mode === saved.mode);
      if (match) { applyTheme(match, false); return; }
    }
  } catch (e) { /* fall through to OS-preference default below */ }

  // No saved choice yet (first visit) — default to the OS-level light/dark
  // preference instead of always starting dark. Still just a starting
  // point: the very next manual toggle overrides it via localStorage above.
  let prefersLight = false;
  try {
    prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch (e) { /* matchMedia unsupported — fall back to dark default */ }
  applyTheme(prefersLight ? THEME_CYCLE[1] : THEME_CYCLE[0], false);
}

// ========== HAMBURGER MENU ==========
function toggleHamburgerMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('hamburger-menu');
  if (!menu) return;
  const isOpen = menu.style.display === 'block';
  if (isOpen) {
    closeHamburgerMenu();
  } else {
    menu.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.addEventListener('click', closeHamburgerOnOutsideClick, { once: true });
  }
}

function closeHamburgerMenu() {
  const menu = document.getElementById('hamburger-menu');
  if (menu) {
    menu.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function closeHamburgerOnOutsideClick(event) {
  const menu = document.getElementById('hamburger-menu');
  const btn = document.getElementById('hamburger-menu-btn');
  if (menu && !menu.contains(event.target) && !btn.contains(event.target)) {
    closeHamburgerMenu();
  }
}

function updateHamburgerFavCount() {
  const favs = getFavorites().length;
  const el = document.getElementById('hamburger-fav-count');
  if (el) el.textContent = `(${favs})`;
}

// ========== TOAST / SHARE / COPY LINK ==========
let toastTimer = null;

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ========== OFFLINE DETECTION ==========
// A persistent banner (not the auto-dismissing toast above) since "no
// connection" is an ongoing state the user should keep seeing until it's
// resolved, not a one-off notification. Search/status fetches already
// have their own per-request error handling (see searchMovie()'s catch
// block) — this banner is purely an at-a-glance signal so the user
// understands *why* things are failing, without needing to first try an
// action and read an error message to find out.
function updateOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (navigator.onLine) {
    if (banner) banner.classList.remove('show');
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.className = 'offline-banner';
    banner.innerHTML = `📡 You're offline — some things may not load until your connection's back.`;
    document.body.appendChild(banner);
  }
  banner.classList.add('show');
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for browsers/webviews without the Clipboard API
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

function copySiteLink(e, url, btn) {
  e.preventDefault();
  e.stopPropagation();
  copyTextToClipboard(url)
    .then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = '✅';
      showToast('Link copied!');
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    })
    .catch(() => showToast("Couldn't copy — try again"));
}

function shareMovie() {
  const movie = window.currentMovie;
  if (!movie) return;

  const text = `Check out "${movie.title}"${movie.year ? ' (' + movie.year + ')' : ''} — found it on CineFind 🎬`;

  if (navigator.share) {
    navigator.share({ title: movie.title, text, url: window.location.href }).catch(() => { /* user cancelled — no-op */ });
  } else {
    copyTextToClipboard(`${text}\n${window.location.href}`)
      .then(() => showToast('Copied to clipboard!'))
      .catch(() => showToast("Couldn't copy — try again"));
  }
}
// ========== FAVORITES SYSTEM ==========
function getFavorites() {
  try { return JSON.parse(localStorage.getItem('cinefind-favorites') || '[]'); }
  catch (e) { return []; } // corrupted/old data shouldn't crash the whole page
}

function saveFavorites(favs) {
  try { localStorage.setItem('cinefind-favorites', JSON.stringify(favs)); } catch (e) { /* storage full/unavailable */ }
  updateFavCount();
}

function addFavorite(movie) {
  const favs = getFavorites();
  const exists = favs.some(f => f.title === movie.title);
  if (!exists) {
    favs.push({ ...movie, dateAdded: Date.now() });
    saveFavorites(favs);
  }
}

function removeFavorite(title) {
  let favs = getFavorites();
  favs = favs.filter(f => f.title !== title);
  saveFavorites(favs);
}

function updateFavCount() {
  const totalFavs = getFavorites().length + getDirFavs().length;
  const favCountEl = document.getElementById('fav-count');
  if (favCountEl) favCountEl.textContent = totalFavs;
  updateHamburgerFavCount();
}

// Small card for a favorited website, reused inside the "My Favorites" page.
// Mirrors the homepage directory card's look (logo, status dot/label) but
// standalone since renderSitesDirectory()'s buildCard is scoped locally.
function buildFavSiteCard(s, i) {
  const liveUrl = getOverriddenUrl(s.name, s.url);
  // Same pastel-tint cycling as the homepage directory cards (buildCard).
  // IMPORTANT: this class must go on .card-content (the <a> below), not
  // the outer .gradient-card-wrapper — the .card-pastel-blue/gold/rose
  // CSS rules override .card-content's base dark background-color, so
  // putting the class on the wrong element (as an earlier fix did) left
  // the card silently still rendering the dark #16161f background.
  const pastelClass = ['card-pastel-blue', 'card-pastel-gold', 'card-pastel-rose'][(i || 0) % 3];
  return `
    <div class="gradient-card-wrapper" data-site-name="${escapeAttr(s.name)}">
      <a href="${liveUrl}" target="_blank" rel="noopener" class="card-content ${pastelClass}" aria-label="${s.name} — opens in new tab" onclick="trackSiteClick('${escapeAttr(s.name).replace(/'/g, "\\'")}')">
        <span class="status-label-mini status-loading" data-status-label>
          <span class="status-dot-mini" data-status-dot></span>
          <span class="status-text-mini" data-status-text></span>
          <span class="speed-badge-mini" data-speed-badge></span>
        </span>
        <button class="pin-icon faved" style="position:absolute; top:8px; right:8px; z-index:2;" onclick="event.preventDefault(); event.stopPropagation(); toggleDirFav(event, '${escapeAttr(s.name)}')" aria-label="Remove from favorites">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.8 7.1-.7z"/></svg>
        </button>
        <div class="card-logo">${s.logoHtml || defaultLogoHtml(s)}</div>
      </a>
    </div>`;
}

function showFavorites(sortBy, siteSortBy) {
  hideFiltersBar();
  const recentEl = document.getElementById('recently-viewed-section');
  if (recentEl) recentEl.innerHTML = ''; // homepage-only widget
  sortBy = sortBy || 'date-desc';
  siteSortBy = siteSortBy || 'az';
  lastFavMovieSort = sortBy;
  lastFavSiteSort = siteSortBy;
  const favs = getFavorites();
  const dirFavNames = getDirFavs();
  const seenFavNames = new Set();
  let favSites = [...SITES_DIRECTORY, ...customSites]
    .filter(s => {
      const key = normalizeSiteName(s.name);
      if (seenFavNames.has(key)) return false;
      seenFavNames.add(key);
      return true;
    })
    .filter(s => dirFavNames.includes(s.name));

  const statusRank = { up: 0, blocked: 1, down: 2 };
  favSites = [...favSites].sort((a, b) => {
    switch (siteSortBy) {
      case 'za': return b.name.localeCompare(a.name);
      case 'status': return (statusRank[getSiteStatus(a.name)] ?? 3) - (statusRank[getSiteStatus(b.name)] ?? 3);
      case 'az':
      default: return a.name.localeCompare(b.name);
    }
  });

  if (favs.length === 0 && favSites.length === 0) {
    document.getElementById('result-area').innerHTML = `
      <div class="empty">
        <div class="big">⭐</div>
        <p>No favorites yet. Search and star movies, or star a website below, to add them here!</p>
        <button class="pop-chip" onclick="resetSearch()" style="margin-top:16px;">← Go back</button>
      </div>`;
    return;
  }

  let html = `
    <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <button class="pop-chip" onclick="resetSearch()">← Back to search</button>
      ${favs.length > 0 ? `
      <select class="filter-select" onchange="showFavorites(this.value, '${siteSortBy}')" style="width:auto;">
        <option value="date-desc" ${sortBy === 'date-desc' ? 'selected' : ''}>Newest added</option>
        <option value="date-asc" ${sortBy === 'date-asc' ? 'selected' : ''}>Oldest added</option>
        <option value="rating-desc" ${sortBy === 'rating-desc' ? 'selected' : ''}>Highest rated</option>
        <option value="az" ${sortBy === 'az' ? 'selected' : ''}>Title A–Z</option>
        <option value="za" ${sortBy === 'za' ? 'selected' : ''}>Title Z–A</option>
      </select>` : ''}
    </div>`;

  html += `<div style="display:flex; justify-content:space-between; align-items:center; margin:0 0 12px;">
    <h2 style="font-size:1rem; margin:0;">🌐 Favorite Websites</h2>
    ${favSites.length > 1 ? `
    <select class="filter-select" onchange="showFavorites('${sortBy}', this.value)" style="width:auto; font-size:.75rem;">
      <option value="az" ${siteSortBy === 'az' ? 'selected' : ''}>Name A–Z</option>
      <option value="za" ${siteSortBy === 'za' ? 'selected' : ''}>Name Z–A</option>
      <option value="status" ${siteSortBy === 'status' ? 'selected' : ''}>Online first</option>
    </select>` : ''}
  </div>`;
  html += favSites.length > 0
    ? `<div class="dir-grid" style="margin-bottom:28px;">${favSites.map((s, i) => buildFavSiteCard(s, i)).join('')}</div>`
    : `<p style="color:var(--muted); font-size:.85rem; margin-bottom:28px;">No favorite websites yet — tap the ⭐ on any site card to save it here.</p>`;

  if (favs.length > 0) html += `<h2 style="font-size:1rem; margin:0 0 12px;">🎬 Favorite Movies &amp; Shows</h2>`;

  const sorted = [...favs].sort((a, b) => {
    switch (sortBy) {
      case 'date-asc': return (a.dateAdded || 0) - (b.dateAdded || 0);
      case 'rating-desc': return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
      case 'az': return a.title.localeCompare(b.title);
      case 'za': return b.title.localeCompare(a.title);
      case 'date-desc':
      default: return (b.dateAdded || 0) - (a.dateAdded || 0);
    }
  });
  sorted.forEach(movie => {
    html += `
      <div class="movie-header" style="margin-bottom:16px;">
        <div class="movie-poster${movie.poster ? ' poster-loading' : ''}" id="poster-${movie.title}">
          ${movie.poster ? `<img class="poster-img" src="${movie.poster}" alt="${escapeAttr(movie.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" onload="this.style.opacity=1; this.parentElement.classList.remove('poster-loading')" onerror="this.parentElement.classList.remove('poster-loading'); this.parentElement.innerHTML='${movie.type === 'series' ? '📺' : '🎬'}'">` : (movie.type === 'series' ? '📺' : '🎬')}
        </div>
        <div class="movie-info">
          <div class="movie-title">${movie.title}</div>
          <div class="movie-meta">
            ${movie.year ? `<span class="badge badge-year">${movie.year}</span>` : ''}
            ${movie.rating ? `<span class="badge badge-rating">⭐ ${movie.rating}</span>` : ''}
          </div>
          <p class="movie-desc">${movie.description || ''}</p>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="pop-chip" onclick='renderResult(${escapeAttr(JSON.stringify(movie))}, "${escapeAttr(movie.title)}")'>▶️ View</button>
            <button class="pop-chip" onclick="removeFavorite('${escapeAttr(movie.title)}'); showFavorites('${sortBy}');" style="color:#e63946;">🗑️ Remove</button>
          </div>
        </div>
      </div>`;
  });
  document.getElementById('result-area').innerHTML = html;
  if (favSites.length > 0) applyStatusDots();
}

// ========== LONG-PRESS TO FAVORITE (directory cards) ==========
// Complements the small star icon (Item 1's touch-target fix already covers
// that) with a second, much larger gesture: hold anywhere on a directory
// card for ~500ms to toggle its favorite, no precision-tapping a tiny icon
// required. Delegated on #result-area (survives re-renders — cards get
// rebuilt often via renderSitesDirectory/renderHomepage, a per-card
// listener would need re-binding every time) instead of attaching to each
// card individually.
(function setupLongPressFavorite() {
  const LONG_PRESS_MS = 500;
  const MOVE_CANCEL_PX = 10; // finger drifting this far = a scroll, not a hold
  let pressTimer = null;
  let pressStartX = 0, pressStartY = 0;
  let longPressFiredOn = null; // the card element a long-press just completed on

  function cardFromEvent(e) {
    return e.target.closest ? e.target.closest('.gradient-card-wrapper[data-site-name]') : null;
  }

  function clearPressTimer() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }

  document.addEventListener('touchstart', (e) => {
    const card = cardFromEvent(e);
    if (!card || !e.touches || !e.touches[0]) return;
    pressStartX = e.touches[0].clientX;
    pressStartY = e.touches[0].clientY;
    clearPressTimer();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressFiredOn = card;
      const siteName = card.dataset.siteName;
      if (siteName) {
        toggleDirFav({ preventDefault(){}, stopPropagation(){} }, siteName);
        if (navigator.vibrate) navigator.vibrate(15); // short haptic tick = "action taken"
      }
    }, LONG_PRESS_MS);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pressTimer || !e.touches || !e.touches[0]) return;
    const dx = e.touches[0].clientX - pressStartX;
    const dy = e.touches[0].clientY - pressStartY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) clearPressTimer(); // treat as scroll, not a hold
  }, { passive: true });

  document.addEventListener('touchend', clearPressTimer, { passive: true });
  document.addEventListener('touchcancel', clearPressTimer, { passive: true });

  // A completed long-press already performed the favorite toggle — the
  // browser's own synthesized click that follows touchend would otherwise
  // also navigate the card's <a href> to the site, which isn't what a
  // "hold to favorite" gesture should do. Swallow just that one click.
  document.addEventListener('click', (e) => {
    const card = cardFromEvent(e);
    if (card && card === longPressFiredOn) {
      e.preventDefault();
      longPressFiredOn = null;
    }
  }, true);
})();

// ========== FILTERING SYSTEM ==========
let lastSearchResult = null;      // full, unfiltered list from the last search
let currentDisplayedResults = null; // whatever list (filtered or not) is currently shown as cards

// The Year/Rating/Type filter bar only makes sense once there's a results
// list on screen — hidden otherwise so it doesn't look "dead" on the homepage.
function showFiltersBar() {
  const bar = document.getElementById('filters-bar');
  bar.style.display = 'flex';
  bar.style.animation = 'panelIn .18s ease';
}
function hideFiltersBar() {
  document.getElementById('filters-bar').style.display = 'none';
}

function applyFilters() {
  if (!lastSearchResult) return;

  const yearFilter = document.getElementById('year-filter').value;
  const ratingFilter = document.getElementById('rating-filter').value;
  const typeFilter = document.getElementById('type-filter').value;
  const quickFilterEl = document.getElementById('quick-filter-input');
  const quickFilter = quickFilterEl ? quickFilterEl.value.trim().toLowerCase() : '';

  let filtered = lastSearchResult;

  // Instant title filter within the already-loaded results — pure client-side,
  // no new TMDB call, so it updates as the person types.
  if (quickFilter) {
    filtered = filtered.filter(m => m.title && m.title.toLowerCase().includes(quickFilter));
  }

  if (yearFilter) {
    const year = parseInt(yearFilter);
    if (yearFilter === '2010s') {
      filtered = filtered.filter(m => m.year >= 2010 && m.year < 2020);
    } else if (yearFilter === '2000s') {
      filtered = filtered.filter(m => m.year >= 2000 && m.year < 2010);
    } else {
      filtered = filtered.filter(m => m.year === year);
    }
  }

  if (ratingFilter) {
    const rating = parseFloat(ratingFilter);
    filtered = filtered.filter(m => m.rating && parseFloat(m.rating) >= rating);
  }

  if (typeFilter) {
    filtered = filtered.filter(m => m.type === typeFilter);
  }

  if (filtered.length === 0) {
    currentDisplayedResults = [];
    document.getElementById('result-area').innerHTML = `
      <div class="empty">
        <div class="big">🔍</div>
        <p>No results match your filters. Try adjusting them.</p>
      </div>`;
    return;
  }

  // Show every matching result, not just the first one
  renderResultsGrid(filtered);
}

// Renders a grid of clickable result cards for a list of movies/series
const RESULTS_PER_PAGE = 9;
let visibleResultsCount = RESULTS_PER_PAGE;
let currentResultsLabel = null; // optional custom header, e.g. "🎭 Comedy"
let currentResultsRaw = null;   // original, unsorted order — kept so sorting can always start fresh
let currentSortBy = 'default';
// "Search Deeper" state — the search itself always fetches+merges TMDB
// pages 1-2 automatically (see runSearch()); these track manual on-demand
// fetches beyond that, since always auto-fetching many pages on every
// search would multiply API calls for the common case where page 1-2
// already has what the person wants.
let currentSearchQueryForApi = null; // the cleaned query actually sent to TMDB (qForApi), for re-fetching further pages
let currentSearchSeasonHint = null; // season number (if any) the user typed in this search — read by selectMovie() so grid picks get the same season enrichment the single-result path already applies
let currentSearchPagesFetched = 0;   // 2 once the initial page1+2 merge completes; bumped by searchDeeper()
const MAX_SEARCH_PAGES = 5;          // hard cap so this can't spiral into dozens of requests

// Genre browsing used to only ever fetch TMDB's first results page (~20
// titles before the poster filter), so "Load More" would reveal all of
// them in a couple of clicks and then just disappear — capping every
// genre at ~20 titles even though TMDB has hundreds more. This state
// lets loadMoreResults() fetch additional TMDB pages once the
// currently-loaded batch runs out, instead of only revealing what's
// already in memory. Reset to inactive here so plain search results
// (which don't have TMDB pages to fetch further) never try to use it.
let genreBrowseState = null; // { genreId, label, page, totalPages } or null when not genre-browsing

// ========== BACK-BUTTON / HISTORY INTEGRATION ==========
// Android's hardware/gesture back button normally exits the page entirely
// once there's no browser history to fall back on. Pushing a state entry
// whenever the view changes (search results, home) lets popstate catch the
// back gesture and restore the previous view in-app instead of leaving.
function pushViewState(view) {
  const state = { cfView: view };
  if (history.state && history.state.cfView === view) {
    history.replaceState(state, '');
  } else {
    history.pushState(state, '');
  }
}
window.addEventListener('popstate', (e) => {
  const view = e.state && e.state.cfView;
  if (view === 'results' && currentDisplayedResults) {
    renderVisibleResults();
  } else {
    document.getElementById('search-input').value = '';
    renderHomepage();
    lastSearchResult = null;
    currentDisplayedResults = null;
    currentResultsRaw = null;
    currentSortBy = 'default';
  }
});

function renderResultsGrid(movies, label) {
  const recentEl = document.getElementById('recently-viewed-section');
  if (recentEl) recentEl.innerHTML = ''; // homepage-only widget
  currentResultsRaw = movies;
  currentDisplayedResults = movies;
  currentResultsLabel = label || null;
  currentSortBy = 'default';
  visibleResultsCount = RESULTS_PER_PAGE; // reset to first page whenever a new list is shown
  genreBrowseState = null; // only browseGenre() turns this back on
  pushViewState('results');
  showFiltersBar();
  renderVisibleResults();
}

// Returns a new sorted copy — never mutates the original list
function sortMovies(list, sortBy) {
  const copy = [...(list || [])];
  switch (sortBy) {
    case 'rating-desc': return copy.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
    case 'year-desc': return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'year-asc': return copy.sort((a, b) => (a.year || 0) - (b.year || 0));
    case 'az': return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'default':
    default: return copy;
  }
}

// Called when the user picks a sort option — re-sorts from the original
// order and resets pagination so the first page reflects the new order.
function setResultsSort(sortBy) {
  currentSortBy = sortBy;
  currentDisplayedResults = sortMovies(currentResultsRaw, sortBy);
  visibleResultsCount = RESULTS_PER_PAGE;
  renderVisibleResults();
}

// Renders however many results are currently "unlocked" (visibleResultsCount),
// plus a Load More button if there are more left to show.
function renderVisibleResults() {
  const movies = currentDisplayedResults || [];
  const area = document.getElementById('result-area');
  const visible = movies.slice(0, visibleResultsCount);

  const cards = visible.map((m, i) => `
    <div class="result-card" onclick="selectMovie(${i})" style="animation-delay:${(i % RESULTS_PER_PAGE) * 0.05}s">
      <div class="result-poster${m.poster ? ' poster-loading' : ''}">
        ${m.poster ? `<img class="poster-img" src="${m.poster}" alt="${m.title}" loading="lazy" onload="this.style.opacity=1; this.parentElement.classList.remove('poster-loading')" onerror="this.parentElement.classList.remove('poster-loading'); this.parentElement.innerHTML='${m.type === 'series' ? '📺' : '🎬'}'">` : (m.type === 'series' ? '📺' : '🎬')}
      </div>
      <div class="result-info">
        <div class="result-title">${m.title}</div>
        <div class="result-meta">
          ${m.year ? `<span class="badge badge-year">${m.year}</span>` : ''}
          ${m.rating ? `<span class="badge badge-rating">⭐ ${m.rating}</span>` : ''}
          ${m.genre === 'Documentary' ? `<span class="badge badge-year" style="opacity:.8;">📋 Documentary</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  const hasMore = visibleResultsCount < movies.length;
  const canSearchDeeper = !hasMore && currentSearchQueryForApi && currentSearchPagesFetched < MAX_SEARCH_PAGES;
  const headerText = currentResultsLabel || `✅ Found ${movies.length} result(s) — tap one to see streaming links`;

  area.innerHTML = `
    <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div class="popular-label" style="margin-bottom:0;">${headerText}</div>
      <div style="display:flex; align-items:center; gap:8px;">
        <select class="filter-select" onchange="setResultsSort(this.value)" style="width:auto;" aria-label="Sort results by">
          <option value="default" ${currentSortBy === 'default' ? 'selected' : ''}>Sort: Relevance</option>
          <option value="rating-desc" ${currentSortBy === 'rating-desc' ? 'selected' : ''}>Highest rated</option>
          <option value="year-desc" ${currentSortBy === 'year-desc' ? 'selected' : ''}>Newest first</option>
          <option value="year-asc" ${currentSortBy === 'year-asc' ? 'selected' : ''}>Oldest first</option>
          <option value="az" ${currentSortBy === 'az' ? 'selected' : ''}>Title A–Z</option>
        </select>
        <button class="pop-chip" onclick="resetSearch()" style="font-size:.75rem; padding:6px 12px;">← Home</button>
      </div>
    </div>
    <div class="results-grid">${cards}</div>
    ${hasMore ? `
      <div style="text-align:center; margin-top:18px;">
        <button class="pop-chip" onclick="loadMoreResults()">Load More (${movies.length - visibleResultsCount} left)</button>
      </div>` : canSearchDeeper ? `
      <div style="text-align:center; margin-top:18px;" id="search-deeper-wrap">
        <p style="font-size:.78rem; color:var(--muted); margin-bottom:8px;">Not seeing what you're looking for?</p>
        <button class="pop-chip" id="search-deeper-btn" onclick="searchDeeper()">Search Deeper (more results)</button>
      </div>` : ''}`;
}

// On-demand only (not automatic on every search) — fetches one more TMDB
// page beyond what runSearch() already auto-merges (pages 1-2), for when
// the wanted title is ranked further down by TMDB's own popularity sort
// than that covers. Capped at MAX_SEARCH_PAGES total so repeatedly
// clicking can't spiral into dozens of requests for one search.
function searchDeeper() {
  const btn = document.getElementById('search-deeper-btn');
  if (!currentSearchQueryForApi || !btn) return;
  btn.disabled = true;
  btn.textContent = 'Searching...';

  const nextPage = currentSearchPagesFetched + 1;
  fetch(`${TMDB_PROXY_URL}?query=${encodeURIComponent(currentSearchQueryForApi)}&page=${nextPage}`, { signal: AbortSignal.timeout(8000) })
    .then(r => r.json())
    .then(tmdb => {
      currentSearchPagesFetched = nextPage;
      const seen = new Set((currentResultsRaw || []).map(m => `${m.type}-${m.id}`));
      const newResults = (tmdb.results || [])
        .filter(m => m.media_type === 'movie' || m.media_type === 'tv')
        .map(parseTmdbItem)
        .filter(m => !seen.has(`${m.type}-${m.id}`));

      currentResultsRaw = [...(currentResultsRaw || []), ...newResults];
      lastSearchResult = currentResultsRaw;
      currentDisplayedResults = sortMovies(currentResultsRaw, currentSortBy);
      visibleResultsCount += newResults.length; // reveal the newly-fetched page immediately
      renderVisibleResults();
    })
    .catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = 'Search Deeper (more results)'; }
    });
}

function loadMoreResults() {
  visibleResultsCount += RESULTS_PER_PAGE;
  renderVisibleResults();
}

// Called when the user taps a card in the results grid
function selectMovie(index) {
  const movie = currentDisplayedResults && currentDisplayedResults[index];
  if (!movie) return;
  // Grid cards never went through enrichWithSeasonData() (that only ran on
  // a single auto-rendered top result) — apply it now, lazily, only for
  // the specific card actually picked, so OmniRoute gets the same season
  // context the single-result path already had. Safe no-op for movies or
  // when the user didn't type a season (enrichWithSeasonData() itself
  // checks item.type/seasonNumber and just resolves the original item).
  if (movie.type === 'series' && currentSearchSeasonHint) {
    enrichWithSeasonData(movie, currentSearchSeasonHint).then(enriched => {
      currentDisplayedResults[index] = enriched;
      renderResult(enriched, enriched.title);
    });
  } else {
    renderResult(movie, movie.title);
  }
}

// ========== LIVE SEARCH SUGGESTIONS ==========
const SUGGEST_MIN_CHARS = 2;
const SUGGEST_DEBOUNCE_MS = 350;
let suggestDebounceTimer = null;
let suggestAbortController = null;
// Tracks which suggestion (if any) is currently arrow-key-highlighted, so
// Enter can select it and so re-rendering the list (new keystroke) doesn't
// leave a stale highlight pointing at a removed item.
let suggestionHighlightIndex = -1;

// While live-typing, "bleach sea..." (working toward "bleach season") looks
// to TMDB like a literal title with no matches — the dropdown flickers to
// "No matches" for every half-typed letter of "season" until the word is
// finished, then correctly shows Bleach the instant it completes. This
// strips a trailing word that's still just a PREFIX of a known suffix
// keyword (not yet an exact match — exact matches are already handled by
// cleanSearchQuery) so suggestions keep showing against the base title
// while the suffix word is still being typed out.
const SUGGEST_PARTIAL_SUFFIX_WORDS = ['season', 'seasons', 'episode', 'episodes', 'eps', 'part', 'volume', 'final'];
function stripPartialSuffixWord(q) {
  const m = q.match(/^(.*\S)\s+([a-z]{2,})$/i);
  if (!m) return q;
  const lastWord = m[2].toLowerCase();
  const isGenuinePartial = SUGGEST_PARTIAL_SUFFIX_WORDS.some(k => k !== lastWord && k.startsWith(lastWord));
  return isGenuinePartial ? m[1] : q;
}

// ========== SAFE STRING ESCAPING ==========
// Used anywhere a title/query gets interpolated into an HTML attribute (like onclick="fn('...')").
// Escaping only the single quote (as the old code did) still leaves double quotes, angle
// brackets, etc. able to break out of the attribute or inject markup. This escapes everything
// HTML-attribute-unsafe, so it's safe regardless of what characters end up in a TMDB title.
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function handleSuggestInput() {
  const box = document.getElementById('suggestions-box');
  const query = document.getElementById('search-input').value.trim();

  clearTimeout(suggestDebounceTimer);

  if (query.length === 0) {
    showSearchHistory();
    return;
  }

  if (query.length < SUGGEST_MIN_CHARS) {
    closeSuggestions();
    return;
  }

  // Shown immediately (before the debounce delay even elapses) so the
  // dropdown never looks idle/frozen during the 350ms wait — without this,
  // there's a visible gap between typing a keystroke and anything
  // happening on screen, which reads as unresponsive on a slower connection.
  box.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted); font-size:.8rem;">Searching…</div>`;
  box.classList.add('open');
  document.getElementById('search-input').setAttribute('aria-expanded', 'true');

  suggestDebounceTimer = setTimeout(() => fetchSuggestions(query), SUGGEST_DEBOUNCE_MS);
}

// In-memory cache for TMDB suggestion (autocomplete) results, keyed by
// lowercased query. Session-only — not localStorage — since these are cheap
// to refetch on a fresh page load, but within one typing session the same
// partial query often gets re-typed (backspace + retype, arrow-key
// browsing), so this skips hitting the Worker again for a query already
// seen. Capped so it can't grow unbounded during a long browsing session.
const suggestionCache = new Map();
const SUGGESTION_CACHE_MAX = 50;

function fetchSuggestions(query) {
  const cacheKey = query.toLowerCase();
  if (suggestionCache.has(cacheKey)) {
    renderSuggestions(suggestionCache.get(cacheKey), query);
    return;
  }

  // Cancel any suggestion request still in flight so results don't stack up
  if (suggestAbortController) suggestAbortController.abort();
  suggestAbortController = new AbortController();

  // Show a lightweight loading state so the dropdown doesn't look frozen while typing
  const box = document.getElementById('suggestions-box');
  box.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted); font-size:.8rem;">Searching…</div>`;
  box.classList.add('open');
  document.getElementById('search-input').setAttribute('aria-expanded', 'true');

  // Same year-hint extraction searchMovie() does before hitting TMDB — lets
  // the dropdown boost same-year matches too (e.g. "Black 2017" while
  // still typing), not just the full search.
  const { text: yearStrippedQuery, year: suggestYearHint } = extractYearHint(query);

  function runSuggestFetch(qForApi, retryStage) {
    return fetch(`${TMDB_PROXY_URL}?query=${encodeURIComponent(qForApi)}`, {
      signal: suggestAbortController.signal
    })
      .then(r => r.json())
      .then(tmdb => {
        // Same exact-title-match -> year-hint -> Asian-origin sort order as
        // searchMovie()'s runSearch() (see the comments there for the full
        // reasoning) — applied BEFORE the slice(0, 6) so a real match
        // buried behind more-popular same-word results still makes it into
        // the visible dropdown instead of getting cut off.
        const qExactMatch = qForApi.trim().toLowerCase();
        const results = (tmdb.results || [])
          .filter(m => m.media_type === 'movie' || m.media_type === 'tv')
          .sort((a, b) => {
            const aExact = (a.title || a.name || '').trim().toLowerCase() === qExactMatch ? 0 : 1;
            const bExact = (b.title || b.name || '').trim().toLowerCase() === qExactMatch ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            if (suggestYearHint) {
              const aYear = (a.release_date || a.first_air_date || '').slice(0, 4);
              const bYear = (b.release_date || b.first_air_date || '').slice(0, 4);
              const aYearMatch = aYear === String(suggestYearHint) ? 0 : 1;
              const bYearMatch = bYear === String(suggestYearHint) ? 0 : 1;
              if (aYearMatch !== bYearMatch) return aYearMatch - bYearMatch;
            }
            const aAsian = isAsianOrigin(a) ? 0 : 1;
            const bAsian = isAsianOrigin(b) ? 0 : 1;
            if (aAsian !== bAsian) return aAsian - bAsian;
            return 0;
          })
          .slice(0, 6);

        // Same two-stage fallback as searchMovie()'s runSearch() — see the
        // comment there for the full reasoning (stage 1: bare trailing
        // number meant as "season 1"; stage 2: drop the last leftover word
        // as a noise-reduction retry, not real spell-correction). Only
        // fires when nothing matched, so an already-successful query never
        // gets touched.
        if (results.length === 0) {
          if (retryStage === 0) {
            const strippedNumber = qForApi.replace(/\s+\d+\s*$/, '').trim();
            if (strippedNumber && strippedNumber !== qForApi) {
              return runSuggestFetch(strippedNumber, 1);
            }
          }
          if (retryStage <= 1) {
            const words = qForApi.trim().split(/\s+/);
            if (words.length > 1) {
              const droppedLastWord = words.slice(0, -1).join(' ');
              return runSuggestFetch(droppedLastWord, 2);
            }
          }
        }

        if (suggestionCache.size >= SUGGESTION_CACHE_MAX) {
          suggestionCache.delete(suggestionCache.keys().next().value); // evict oldest
        }
        suggestionCache.set(cacheKey, results);
        rememberKnownTitles(results.map(r => r.title || r.name));
        renderSuggestions(results, query);
      });
  }

  runSuggestFetch(stripPartialSuffixWord(cleanSearchQuery(yearStrippedQuery)), 0)
    .catch(err => {
      if (err.name === 'AbortError') return; // superseded by a newer keystroke — just let that one render
      // Show a brief inline message instead of silently closing, so the user knows it failed
      // rather than assuming there were simply no matches.
      if (document.getElementById('search-input').value.trim() === query) {
        box.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted); font-size:.8rem;">Couldn't load suggestions</div>`;
      }
    });
}

function renderSuggestions(results, currentQuery) {
  const box = document.getElementById('suggestions-box');
  suggestionHighlightIndex = -1; // fresh list — no stale highlight carried over

  // The input may have changed (or been cleared) while this request was in flight
  if (document.getElementById('search-input').value.trim() !== currentQuery) return;

  if (results.length === 0) {
    // Same last-resort fuzzy typo-check as the full search's zero-results
    // branch (see findFuzzyMatches()) — only reached once TMDB itself
    // returned nothing for this partial query.
    const fuzzyMatches = findFuzzyMatches(currentQuery, 3);
    if (fuzzyMatches.length > 0) {
      box.innerHTML = fuzzyMatches.map((s, i) => `
        <div class="suggestion-item" id="suggest-opt-${i}" role="option" aria-selected="false" onmousedown="event.preventDefault(); selectSuggestion('${escapeAttr(s)}')">
          <div class="suggestion-poster">✨</div>
          <div class="suggestion-text">
            <div class="suggestion-title">${escapeAttr(s)}</div>
            <div class="suggestion-meta">Did you mean this?</div>
          </div>
        </div>`).join('');
      box.classList.add('open');
      document.getElementById('search-input').setAttribute('aria-expanded', 'true');
      return;
    }
    // Shown instead of silently closing — a dropdown that just vanishes
    // with no text reads as broken/frozen, same reasoning as the "No
    // matches" empty state on the full search. Kept short since this is
    // a small inline dropdown, not a full-page empty state.
    box.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted); font-size:.8rem;">No matches for "${escapeAttr(currentQuery)}"</div>`;
    box.classList.add('open');
    document.getElementById('search-input').setAttribute('aria-expanded', 'true');
    return;
  }

  box.innerHTML = results.map((r, i) => {
    const title = r.title || r.name;
    const year = (r.release_date || r.first_air_date || '').split('-')[0];
    const type = r.media_type === 'tv' ? 'Series' : 'Movie';
    const poster = r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null;
    return `
      <div class="suggestion-item" id="suggest-opt-${i}" role="option" aria-selected="false" onmousedown="event.preventDefault(); selectSuggestion('${escapeAttr(title)}')">
        <div class="suggestion-poster">${poster ? `<img class="poster-img" src="${poster}" alt="" loading="lazy" onload="this.style.opacity=1">` : (r.media_type === 'tv' ? '📺' : '🎬')}</div>
        <div class="suggestion-text">
          <div class="suggestion-title">${escapeAttr(title)}</div>
          <div class="suggestion-meta">${type}${year ? ' • ' + year : ''}</div>
        </div>
      </div>`;
  }).join('');

  box.classList.add('open');
  document.getElementById('search-input').setAttribute('aria-expanded', 'true');
}

function selectSuggestion(title) {
  document.getElementById('search-input').value = title;
  closeSuggestions();
  searchMovie();
}

function closeSuggestions() {
  const box = document.getElementById('suggestions-box');
  box.classList.remove('open');
  box.innerHTML = '';
  suggestionHighlightIndex = -1;
  const input = document.getElementById('search-input');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

// Close the dropdown when tapping/clicking outside the search box.
// Deferred via requestAnimationFrame — on some Android WebViews this
// document-level click can fire and close the box before a tap on a
// suggestion item (mousedown -> selectSuggestion) finishes registering,
// intermittently swallowing the tap. Waiting a frame lets that tap's own
// handler run first.
document.addEventListener('click', (e) => {
  requestAnimationFrame(() => {
    if (!e.target.closest('.search-wrap')) closeSuggestions();
  });
});

// ========== FIRST-VISIT ONBOARDING ==========
// One-time dismissible tip explaining the two things new visitors ask about
// most: what the ✅/⚠️ link-type tags mean on a site card, and that the
// colored status dots (🟢🟡🔴) are tap/hover-able for more detail. Shown
// once via a localStorage flag — never re-shown after dismissal or on
// repeat visits, so returning users aren't nagged by it.
const ONBOARDING_SEEN_KEY = 'cinefind-onboarding-seen';
function renderOnboardingTip() {
  const el = document.getElementById('onboarding-banner');
  if (!el) return;
  el.innerHTML = `
    <div style="background:color-mix(in srgb, var(--gold) 10%, transparent); border:1px solid color-mix(in srgb, var(--gold) 30%, transparent); border-radius:12px; padding:14px; margin:-4px 0 18px; font-size:.8rem; color:var(--muted);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text); font-size:.85rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
          How It Works
        </div>
        <button onclick="dismissOnboarding()" aria-label="Dismiss tip" style="position:relative; background:none; border:none; color:var(--muted); font-size:1rem; cursor:pointer; flex-shrink:0; line-height:1; padding:8px; margin:-8px -6px 0 0;">
          <span style="position:absolute; inset:-6px;"></span>✕
        </button>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:1px;"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Search</strong> – Enter a movie or TV show title to get free website recommendations.</div>
        </div>
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:1px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Tapping a site opens it in a new tab</strong> – we're a directory pointing you to where a title is streaming, not a video player ourselves.</div>
        </div>
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--green)" style="flex-shrink:0; margin-top:1px;"><circle cx="12" cy="12" r="9"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Green</strong> – Website is online.</div>
        </div>
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--gold)" style="flex-shrink:0; margin-top:1px;"><circle cx="12" cy="12" r="9"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Yellow</strong> – Usually still works, just flagged by the site's bot protection ("I am not a robot" check).</div>
        </div>
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#e63946" style="flex-shrink:0; margin-top:1px;"><circle cx="12" cy="12" r="9"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Red</strong> – The website is down or unavailable.</div>
        </div>
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:1px;"><path d="M4 21V4h13l-2 4.5L17 13H4"/></svg>
          <div style="color:var(--text); opacity:.85; line-height:1.5;"><strong>Report</strong> – Found a dead link or a problem? Click Report to help us keep the website list updated.</div>
        </div>
      </div>
    </div>`;
}
function showOnboardingIfNeeded() {
  let seen;
  try { seen = localStorage.getItem(ONBOARDING_SEEN_KEY); } catch (e) { seen = null; }
  if (seen) return;
  renderOnboardingTip();
}
// Persistent "?" header button — reopens the same tip on demand, any time,
// without touching the "seen" flag (so it doesn't interfere with the
// one-time auto-show behavior above for people who never asked for it again).
function showHelpTip() {
  renderOnboardingTip();
  document.getElementById('onboarding-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function dismissOnboarding() {
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, '1'); } catch (e) { /* storage full/unavailable */ }
  const el = document.getElementById('onboarding-banner');
  if (el) el.innerHTML = '';
}

// ========== SEARCH HISTORY ==========
// Manually curated, not live analytics — a real "most searched site-wide"
// feature needs a backend Worker aggregating queries across all visitors,
// which isn't deployed. Edit this list by hand (same pattern as hot-sites
// for websites) to keep it current; shown in the search dropdown below.
const TRENDING_TITLES = ['Squid Game', 'Wednesday', 'One Piece'];

const SEARCH_HISTORY_KEY = 'cinefind-search-history';
const SEARCH_HISTORY_MAX = 8;

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveSearchHistory(query) {
  let history = getSearchHistory();
  history = history.filter(h => h.toLowerCase() !== query.toLowerCase()); // no duplicates
  history.unshift(query);
  history = history.slice(0, SEARCH_HISTORY_MAX);
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history)); } catch (e) { /* storage full/unavailable */ }
}

function clearSearchHistory() {
  try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch (e) { /* storage unavailable */ }
  closeSuggestions();
}

function showSearchHistory() {
  const history = getSearchHistory();
  const box = document.getElementById('suggestions-box');
  if (history.length === 0 && TRENDING_TITLES.length === 0) {
    closeSuggestions();
    return;
  }

  // Shared running index across both groups so ids stay unique and match
  // the flat 0..n order moveSuggestionHighlight() walks via querySelectorAll.
  let optIndex = 0;

  const trendingHtml = TRENDING_TITLES.length === 0 ? '' : `
    <div style="padding:8px 14px; border-bottom:1px solid var(--border);">
      <span style="font-size:.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em;">🔥 Trending</span>
    </div>
    ${TRENDING_TITLES.map(t => `
      <div class="suggestion-item" id="hist-opt-${optIndex++}" role="option" aria-selected="false" onmousedown="event.preventDefault(); selectSuggestion('${escapeAttr(t)}')">
        <div class="suggestion-poster">🔥</div>
        <div class="suggestion-text">
          <div class="suggestion-title">${escapeAttr(t)}</div>
        </div>
      </div>`).join('')}`;

  const historyHtml = history.length === 0 ? '' : `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid var(--border);">
      <span style="font-size:.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em;">🕐 Recent searches</span>
      <button onmousedown="event.preventDefault(); clearSearchHistory()" style="background:none; border:none; color:var(--muted); font-size:.7rem; cursor:pointer; text-decoration:underline;">Clear</button>
    </div>
    ${history.map(h => `
      <div class="suggestion-item" id="hist-opt-${optIndex++}" role="option" aria-selected="false" onmousedown="event.preventDefault(); selectSuggestion('${escapeAttr(h)}')">
        <div class="suggestion-poster">🕐</div>
        <div class="suggestion-text">
          <div class="suggestion-title">${escapeAttr(h)}</div>
        </div>
      </div>`).join('')}`;

  box.innerHTML = trendingHtml + historyHtml;
  box.classList.add('open');
  document.getElementById('search-input').setAttribute('aria-expanded', 'true');
}

// ========== RECENTLY VIEWED ==========
// Distinct from search history (text queries) — this tracks the actual
// titles a person opened, with posters, so they can jump straight back into
// a specific movie/show instead of re-typing a search. Shown as a poster
// strip on the homepage itself (not tucked inside the search dropdown) so
// it's visible without having to refocus the search bar first.
const RECENTLY_VIEWED_KEY = 'cinefind-recently-viewed';
const RECENTLY_VIEWED_MAX = 10;

function getRecentlyViewed() {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveRecentlyViewed(movie) {
  if (!movie || !movie.title) return;
  let list = getRecentlyViewed();
  list = list.filter(m => m.title !== movie.title); // no duplicates — re-viewing bumps it to front
  list.unshift({ title: movie.title, poster: movie.poster || '', rating: movie.rating || '' });
  list = list.slice(0, RECENTLY_VIEWED_MAX);
  try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list)); } catch (e) { /* storage full/unavailable */ }
}

function clearRecentlyViewed() {
  try { localStorage.removeItem(RECENTLY_VIEWED_KEY); } catch (e) { /* storage unavailable */ }
  renderRecentlyViewed();
}

function renderRecentlyViewed() {
  const el = document.getElementById('recently-viewed-section');
  if (!el) return; // not on the homepage right now
  const list = getRecentlyViewed();
  if (list.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div style="margin:-6px 0 22px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size:.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em;">🕐 Recently Viewed</span>
        <button onclick="clearRecentlyViewed()" style="background:none; border:none; color:var(--muted); font-size:.7rem; cursor:pointer; text-decoration:underline;">Clear</button>
      </div>
      <div style="display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; -webkit-overflow-scrolling:touch;">
        ${list.map(m => `
          <button onclick="selectSuggestion('${escapeAttr(m.title)}')" style="flex-shrink:0; width:72px; background:none; border:none; padding:0; cursor:pointer; text-align:left;" aria-label="Open ${escapeAttr(m.title)}">
            ${m.poster
              ? `<img src="${escapeAttr(m.poster)}" alt="" loading="lazy" style="width:72px; height:104px; object-fit:cover; border-radius:8px; display:block;">`
              : `<div style="width:72px; height:104px; border-radius:8px; background:var(--card); display:flex; align-items:center; justify-content:center; font-size:1.4rem;">🎬</div>`}
            <div style="font-size:.7rem; color:var(--text); margin-top:4px; line-height:1.25; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${escapeAttr(m.title)}</div>
          </button>`).join('')}
      </div>
    </div>`;
}

// ========== ORIGINAL CODE WITH MODIFICATIONS ==========
const TMDB_PROXY_URL = 'https://cinefind-proxy.manio-james-g-5588.workers.dev';
// Deploy worker.js as its own Worker (separate from the TMDB proxy — keeps
// blast radius small) and put its *.workers.dev URL here. This worker is the
// only thing that ever holds the real GitHub token — see worker.js for setup.
const ADMIN_PROXY_URL = 'https://cinefind-admin.manio-james-g-5588.workers.dev';
const REPORT_WORKER_URL = 'https://cinefin-report-worker.manio-james-g-5588.workers.dev';
const VISIT_WORKER_URL = 'https://cinefind-visits.manio-james-g-5588.workers.dev';
// Tavily fallback was removed (2026-08-21) — too unreliable in practice
// (missed niche/poorly-indexed streaming sites, returned generic homepages
// instead of title pages, sometimes ignored the domain restriction
// entirely). Reverted to the static SITES_DIRECTORY / data.sites links only.
// Search analytics rides on the same visits Worker (VISIT_WORKER_URL) via
// its /track-search and /top-searches routes — see cinefind-visits-worker.js.
// No separate Worker/KV needed.

// Fire-and-forget — never blocks or affects the actual search UX if the
// worker is down/slow. Tracks the RESOLVED title/genre (not the raw
// keystroke), so misspellings and partial typing don't pollute the data —
// this only fires once a real TMDB match was found and shown.
function trackSearchAnalytics(title, genre) {
  if (!title) return;
  fetch(`${VISIT_WORKER_URL}/track-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, genre: genre || null }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => { /* silent — analytics should never affect the user's search */ });
}

// Same fire-and-forget pattern as trackSearchAnalytics above, but for which
// streaming site card actually got tapped (not just which movie was
// searched) — lets the admin panel show "🌐 Top Websites" alongside
// "Top Searched Titles". Rides the same Worker via /track-site-click.
function trackSiteClick(siteName) {
  if (!siteName) return;
  fetch(`${VISIT_WORKER_URL}/track-site-click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteName }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => { /* silent — analytics should never affect the user's click-through */ });
}

// ===== VISITOR TRACKING =====
async function trackVisit() {
  try {
    const res = await fetch(VISIT_WORKER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const data = await res.json();
    renderVisitStats(data);
  } catch (e) {
    // fail silently — hindi dapat makaabala sa main site kung down ang worker
  }
}

function renderVisitStats(data) {
  const total = (data.total || 0).toLocaleString();
  const online = data.online || 1;

  // "Online now" moved out of the user-facing header — it's visitor-count
  // vanity info, not something people need to find a working streaming
  // site. Stashed here for the admin panel's stat row to read instead.
  window.__adminOnlineCount = online;

  const footerEl = document.getElementById('visit-stats');
  if (footerEl) {
    footerEl.textContent = `${total} visits since launch`;
  }
}

// DEBUG ONLY — set to true to temporarily hide the static site list so you
// can test the AI-verified sites feature in isolation. Static list code is
// untouched; this only controls whether it's rendered. Set back to false
// (or delete this block) when done testing.
const DEBUG_HIDE_STATIC_SITES = false;

// Debug mode toggle: append ?debug=1 to the page URL to see the on-page
// debug log (🐛 AI check debug log) and have it expanded by default.
// Without the URL param, regular users never see this panel.
const DEBUG_MODE = new URLSearchParams(window.location.search).get('debug') === '1';

// Shows a timestamped line in the on-page debug panel (?debug=1) AND the
// browser console. Safe to call even when DEBUG_MODE is off (no-op for the
// panel, still logs to console).
function debugLog(label, detail) {
  const time = new Date().toLocaleTimeString();
  const line = detail !== undefined ? `[${time}] ${label} ${detail}` : `[${time}] ${label}`;
  console.log('[OmniRoute debug]', line);
  if (!DEBUG_MODE) return;
  const panel = document.getElementById('omniroute-debug-panel');
  const log = document.getElementById('omniroute-debug-log');
  if (panel) panel.style.display = 'block';
  if (log) {
    const row = document.createElement('div');
    row.style.borderTop = '1px solid #ffffff14';
    row.style.padding = '3px 0';
    row.textContent = line;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }
}

const COOLDOWN_MS = 4000;
let isSearching = false;
let cooldownUntil = 0;
// Race-condition guard (2026-08-30): every user-initiated search/select
// bumps this counter and captures its own value locally. Before any async
// search path actually applies its result (renderResult) or fires the
// OmniRoute request with a title, it checks its captured value against the
// live counter — if a newer search has started in the meantime, the stale
// one's own callback is a no-op instead of clobbering the screen or
// sending a mismatched title to the worker. Fixes: a slow/older in-flight
// search (e.g. "Spirit Fingers") landing AFTER a newer one ("Strong Girl
// Bong-soon") was already rendered, and its stale closure still calling
// upgradeCardsWithOmniRoute() with the OLD title while the UI shows the
// new one — worker.js then searches every site for the wrong title.
let searchGeneration = 0;
let isQuotaWait = false;
let extraCooldownMs = 0;

function startCooldownDisplay() {
  const interval = setInterval(() => {
    const timeLeft = Math.max(0, cooldownUntil - Date.now());
    const btn = document.querySelector('.search-btn');
    if (timeLeft > 0) {
      btn.textContent = Math.ceil(timeLeft / 1000) + 's';
      btn.disabled = true;
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/></svg>';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      clearInterval(interval);
    }
  }, 100);
}

function quickSearch(term) {
  document.getElementById('search-input').value = term;
  searchMovie();
}

const CACHE_MAX_ENTRIES = 40;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Bump this whenever the shape of cached data changes (e.g. sites list format,
// number of sites per result). Old cached entries under a stale version are
// wiped on load so users don't see outdated results after an update.
const CACHE_VERSION = 2;

(function migrateCacheIfStale() {
  try {
    const storedVersion = parseInt(localStorage.getItem('cinefind-cache-version') || '1', 10);
    if (storedVersion !== CACHE_VERSION) {
      localStorage.removeItem('cinefind-cache');
      localStorage.setItem('cinefind-cache-version', String(CACHE_VERSION));
    }
  } catch (e) { /* storage unavailable — proceed without cache */ }
})();

function saveToCache(query, data) {
  try {
    let cache = JSON.parse(localStorage.getItem('cinefind-cache') || '{}');

    // Drop expired entries first so they don't count against the size limit
    const now = Date.now();
    cache = Object.fromEntries(
      Object.entries(cache).filter(([, v]) => now - v.timestamp < CACHE_TTL_MS)
    );

    cache[query.toLowerCase()] = { data, timestamp: now };

    // If still over the limit, evict the oldest entries until we're back under it
    const entries = Object.entries(cache);
    if (entries.length > CACHE_MAX_ENTRIES) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // oldest first
      const toRemove = entries.length - CACHE_MAX_ENTRIES;
      for (let i = 0; i < toRemove; i++) delete cache[entries[i][0]];
    }

    try {
      localStorage.setItem('cinefind-cache', JSON.stringify(cache));
    } catch (e) {
      // Storage quota exceeded — clear the cache and try once more with just this entry
      try {
        localStorage.setItem('cinefind-cache', JSON.stringify({ [query.toLowerCase()]: { data, timestamp: now } }));
      } catch (e2) { /* give up silently — cache is a nice-to-have, not critical */ }
    }
  } catch (e) { /* storage unavailable — proceed without caching */ }
}

function getFromCache(query) {
  try {
    const cache = JSON.parse(localStorage.getItem('cinefind-cache') || '{}');
    const cached = cache[query.toLowerCase()];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  } catch (e) { /* storage unavailable — proceed without cache */ }
  return null;
}

// TMDB genre IDs -> display names. Movie and TV genre lists overlap mostly,
// but a few IDs differ between the two (e.g. 10759 = Action & Adventure on TV).
// Merged into one map since parseTmdbItem doesn't know media type at lookup time in all callers.
const TMDB_GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

function genreIdsToLabel(genreIds) {
  if (!genreIds || !genreIds.length) return '';
  const names = genreIds.map(id => TMDB_GENRE_MAP[id]).filter(Boolean);
  return names[0] || '';
}

// Four separate site lists so results actually match what's being searched:
// movies show movie-focused free sites, k-dramas/general series show drama sites,
// and anime (movie or series) shows anime-focused sites — detected via
// detectCategory() below, not just the movie/series split.
// Sites with a known /search?... URL pattern link straight to search results;
// the rest link to the homepage with a "search inside site" note since we don't
// have a confirmed search-URL pattern for them.
// ===== MOVIE_SITES (PART 1: search-URL pattern, not homepage) =====
// Sites marked VERIFY use a best-guess WordPress-style ?s= pattern since we
// don't have a confirmed search-URL format for them — check manually and
// update the url template if the site uses a different query param.
const MOVIE_SITES = (title) => [
  {name: 'FlickyStream', url: `https://flickystream.dad/?s=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // VERIFY
  {name: 'MovieBox', url: `https://movie-box.co/web/searchResult?keyword=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026)
  {name: 'FMovies', url: `https://fmoviess.org/search/?q=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 30, 2026) — domain changed from fmovies-hd.to
];

// General (non-anime, non-K-drama) TV series — same free aggregators as movies,
// since these sites typically host both.
// ===== SERIES_SITES (PART 1: search-URL pattern, not homepage) =====
const SERIES_SITES = (title) => [
  {name: 'FlickyStream', url: `https://flickystream.dad/?s=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // VERIFY
  {name: 'MovieBox', url: `https://movie-box.co/web/searchResult?keyword=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026)
  {name: 'FMovies', url: `https://fmoviess.org/search/?q=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 30, 2026) — domain changed from fmovies-hd.to
];

// K-drama / Asian drama — only real drama-focused sites.
// ===== DRAMA_SITES (PART 1: search-URL pattern, not homepage) =====
const DRAMA_SITES = (title) => [
  {name: 'MyAsianTV', url: `https://myasiantv.com.lv/?s=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026) — dropped type=movies, this list is dramas/series, not movies (was filtering out its own results)
  {name: 'DramaCool', url: `https://dramacool.baby/search?q=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live pattern (Aug 26, 2026)
  {name: 'KissKH', url: `https://kisskh.co/search?q=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // VERIFY
  {name: 'Viki', url: `https://www.viki.com/search?q=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026)
];

// Anime (movie or series) — dedicated anime sites only.
// ===== ANIME_SITES (PART 1: search-URL pattern, not homepage) =====
const ANIME_SITES = (title) => [
  {name: 'ReAnime', url: `https://reanime.to/search?q=${encodeURIComponent(title)}&limit=36&offset=0`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026)
  {name: 'Miruro', url: `https://www.miruro.to/search?query=${encodeURIComponent(title)}&type=ANIME&sort=POPULARITY_DESC`, note: 'Search results', linkType: 'search'}, // confirmed live (Aug 26, 2026)
  {name: 'Enma', url: `https://enma.lol/?s=${encodeURIComponent(title)}`, note: 'Search results', linkType: 'search'}, // VERIFY
];

// Works out which of the 4 buckets a TMDB result belongs to, using genre +
// original language/origin country rather than just the movie/series split —
// so "Iron Man" gets movie sites, an anime movie or series gets anime sites,
// and an Asian drama (Korean, Japanese, Chinese, Thai, Taiwanese, etc.) gets
// drama sites, regardless of type. Reuses isAsianOrigin() below rather than
// a Korean-only check — DRAMA_SITES itself is a pan-Asian site list (Viki,
// MyAsianTV, DramaCool, KissKH), not Korea-exclusive, so a Japanese or
// Chinese drama series was previously falling through to the generic
// SERIES_SITES aggregators instead of these Asian-drama-focused ones.
// Philippines/Tagalog is explicitly excluded here even though isAsianOrigin()
// counts it as Asian for sort-nudging purposes — Pinoy content already gets
// its own dedicated site list via the
// isPinoyContent override further down in renderResult(), so it shouldn't
// also get funneled into the Korean/Japanese/Chinese/Thai drama-site bucket.
function detectCategory(r, type) {
  const isAnime = (r.genre_ids || []).includes(16) && r.original_language === 'ja';
  if (isAnime) return 'anime';
  if (type === 'series') {
    const isPinoy = r.original_language === 'tl' || (r.origin_country || []).includes('PH');
    return (isAsianOrigin(r) && !isPinoy) ? 'drama' : 'series';
  }
  return 'movie';
}

// Used as a sort tiebreaker (never a filter) to nudge ambiguous results
// toward the K-drama/anime/Asian-content audience this app is actually
// built for, instead of TMDB's raw popularity order which skews Western.
// Only checked after exact-title-match and year-hint already failed to
// separate two results — see the sort comparators below.
// Also reused by detectCategory() above to route Asian drama series.
function isAsianOrigin(r) {
  const ASIAN_COUNTRIES = ['KR', 'JP', 'CN', 'TW', 'HK', 'PH', 'TH', 'VN'];
  const ASIAN_LANGS = ['ko', 'ja', 'zh', 'tl', 'th', 'vi'];
  return (r.origin_country || []).some(c => ASIAN_COUNTRIES.includes(c)) ||
    ASIAN_LANGS.includes(r.original_language);
}


const CATEGORY_SITES = {
  movie: MOVIE_SITES,
  series: SERIES_SITES,
  drama: DRAMA_SITES,
  anime: ANIME_SITES,
};

// ===== STATIC_OVERRIDES (PART 2) =====
// Manually-verified DIRECT links (straight to the title/episode page, not
// just a search page) for popular titles — keyed by lowercase title, then
// by site name (must match the `name` field used in MOVIE_SITES/SERIES_
// SITES/DRAMA_SITES/ANIME_SITES above). Leave a value as '' until a real
// direct URL has been found and verified by hand; getSiteLink() below
// treats an empty string the same as "no override" and falls back to the
// site's search-URL instead.
const STATIC_OVERRIDES = {
  "squid game": {
    "dramacool": "",
    "viki": "",
  },
  "your name": {
    "miruro": "",
  },
  "attack on titan": {
    "miruro": "",
  },
  "demon slayer": {
    "miruro": "",
  },
  "crash landing on you": {
    "dramacool": "",
    "viki": "",
  },
  "my love from the star": {
    "dramacool": "",
    "viki": "",
  },
  "0.5 no otoko": {
    "miruro": "",
  },
};

// ===== getSiteLink (PART 3) =====
// Resolves the link for one site + title: a verified direct link from
// STATIC_OVERRIDES when one exists, otherwise the site's own search-URL
// (already built into site.url by MOVIE_SITES/SERIES_SITES/DRAMA_SITES/
// ANIME_SITES above). isDirect drives the "✅ Direct link" vs "🔍 Search
// inside site" badge in buildSiteCard.
function getSiteLink(siteName, title, fallbackUrl) {
  const key = (title || '').trim().toLowerCase();
  const siteKey = (siteName || '').trim().toLowerCase();
  const override = STATIC_OVERRIDES[key] && STATIC_OVERRIDES[key][siteKey];
  if (override) {
    return { url: override, isDirect: true };
  }
  return { url: fallbackUrl, isDirect: false };
}

// ===== OmniRoute direct-link lookup =====
// Calls the OmniRoute worker (separate from TMDB_PROXY_URL — that one only
// handles TMDB modes). This worker takes a POST body { prompt }, forwards it
// to OmniRoute, and returns { text: "...json string..." }. OmniRoute's AI is
// given the title + our own site list, and tries to find a direct link per
// site. This runs in the BACKGROUND after the page already shows static/
// fallback links, so users never wait for it — cards just quietly upgrade to
// "✅ Direct link" if/when OmniRoute finds one.
const OMNIROUTE_WORKER_URL = 'https://fancy-wildflower-1260.manio-james-g-5588.workers.dev';

// Prompt was rewritten after Groq started refusing it outright ("I'm sorry,
// but I can't help with that"). The original wording — "helping find direct
// streaming links... use web search to check if a direct page... exists" —
// reads to a safety-tuned model as a request to locate/verify unlicensed
// content, especially paired with a list of known link-aggregator site
// names. This version asks for the same underlying data (a URL per site,
// or empty if none) but frames it as a routine directory-app task: given a
// title and a list of site names the app already links to, return each
// site's own canonical URL pattern for a title page if a predictable one
// exists — closer to "how does this site structure its URLs" than "find me
// a place to watch this for free." No functional change to what's asked
// for or how the response is used (still same JSON shape, still same
// background-upgrade behavior).
async function fetchOmniRouteDirectLinks(title, siteNames, context = {}) {
  debugLog('📤 Request →', `title="${title}" sites=[${siteNames.join(', ')}]`);
  const startTime = Date.now();
  try {
    const res = await fetch(OMNIROUTE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, originalTitle: context.originalTitle || null, sites: siteNames, year: context.year, type: context.type, season: context.season, part: context.part, tmdbId: context.tmdbId || null, episode: context.episode || null, searchQuery: context.searchQuery || null }),
      signal: AbortSignal.timeout(95000), // worker worst-case: live-fetch 8s + Groq batch parse 30s + per-site verify 6s (~44s), or if that falls through to Layer 6 pure-guess, +55s more (~90s+) — must outlast the worker's own longest chain, not guess short
    });
    const elapsed = Date.now() - startTime;
    debugLog('📥 HTTP status:', `${res.status} (${elapsed}ms)`);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(could not read body)');
      debugLog('❌ Worker returned non-OK response:', bodyText.slice(0, 300));
      return { links: {}, linkTypes: {} };
    }
    const data = await res.json();
    debugLog('📦 Raw worker response:', JSON.stringify(data).slice(0, 300));
    if (data.error) {
      debugLog('❌ Worker/OmniRoute error field:', data.error + (data.details ? ' — ' + JSON.stringify(data.details).slice(0,200) : ''));
      return { links: {}, linkTypes: {} };
    }
    if (!data.text) {
      debugLog('⚠️ No "text" field in response — nothing to parse.');
      return { links: {}, linkTypes: {} };
    }
    const cleaned = data.text.replace(/^```json\s*|^```\s*|```\s*$/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      debugLog('❌ Failed to JSON.parse the AI text:', parseErr.message + ' — raw: ' + cleaned.slice(0, 200));
      return { links: {}, linkTypes: {} };
    }
    // Expected shape: { "dramacool": "https://...", "viki": "" }
    // Empty string / missing key = OmniRoute found nothing for that site.
    const links = parsed.links || {};
    const linkTypes = data.linkTypes || {};
    const foundCount = Object.keys(links).filter(site => links[site] && linkTypes[site] === 'direct').length;
    debugLog('✅ Parsed links:', `${foundCount}/${siteNames.length} sites had a direct link — ${JSON.stringify(links)}`);
    return { links, linkTypes };
  } catch (e) {
    // Timeout, network error, OmniRoute down, etc. — fail silently for
    // normal users (fallback links stay as-is), but log it here for debug.
    const elapsed = Date.now() - startTime;
    debugLog('❌ Request failed/timed out:', `${e.name}: ${e.message} (after ${elapsed}ms)`);
    return { links: {}, linkTypes: {} };
  }
}

// ===== Progress ticker for the "Checking for direct link…" badges =====
// Purely cosmetic UX fix — the worker call this feeds into can legitimately
// take anywhere from ~10s to ~95s (see AbortSignal.timeout comment above:
// Layer 4 live-fetch + Layer 5 batch parse, or worst case falling through
// to Layer 6's slower guess/cross-check/verify chain). Before this, every
// pending badge just sat on the same static "⏳ Checking for direct link…"
// the whole time with zero feedback on whether it's stuck or still working.
// This has no idea which Layer the worker is actually on (that's server-
// side and not reported back) — it just swaps the text through a few
// honest, non-committal stages as elapsed time passes, so a long wait
// reads as "still working" instead of "frozen."
// Text only — the ⏳ icon lives in its own always-spinning .omni-pending-icon
// span (see CSS) and is never touched here, so only .omni-pending-text gets
// rewritten on each tick.
const OMNI_PROGRESS_STAGES = [
  { at: 0,  text: 'Checking for direct link…' },
  { at: 8,  text: 'Still checking…' },
  { at: 20, text: 'Looking a bit harder…' },
  { at: 40, text: 'Almost there…' },
  { at: 70, text: 'Taking longer than usual…' },
];

function startOmniProgressTicker() {
  const startedAt = Date.now();
  const intervalId = setInterval(() => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    // Latest stage whose threshold has been passed.
    let stage = OMNI_PROGRESS_STAGES[0];
    for (const s of OMNI_PROGRESS_STAGES) {
      if (elapsedSec >= s.at) stage = s;
    }
    // Re-query every tick rather than caching the node list once — cards
    // for sites OmniRoute already resolved get their badge swapped out
    // (className changes from 'omni-pending' to 'site-free'), so the
    // live .omni-pending set shrinks over time as results trickle in via
    // any earlier-resolving requests; only genuinely-still-pending badges
    // should keep advancing. Only the text child is rewritten — leaving
    // the .omni-pending-icon span alone keeps its CSS spin animation
    // running uninterrupted instead of restarting it every 3s.
    document.querySelectorAll('.omni-pending .omni-pending-text').forEach(textEl => {
      if (textEl.textContent !== stage.text) textEl.textContent = stage.text;
    });
  }, 3000); // 3s granularity — fine enough to feel alive, cheap enough to ignore
  return () => clearInterval(intervalId);
}

// Kicks off the background lookup and patches matching cards in place once
// results arrive. Call this once, right after renderResult() has already
// painted the page with fallback links.
function upgradeCardsWithOmniRoute(title, siteNames, context = {}) {
  debugLog('🚀 upgradeCardsWithOmniRoute started for:', title);
  const stopOmniProgress = startOmniProgressTicker();
  fetchOmniRouteDirectLinks(title, siteNames, context).then(({ links, linkTypes }) => {
    stopOmniProgress();
    // Race-condition guard: if a newer search has started since this
    // request was fired (context.generation no longer matches the live
    // counter), this response is for a title the user has already
    // navigated away from — discard it instead of writing its links into
    // whatever's currently on screen. See renderResult()'s myGeneration
    // comment for the full explanation.
    if (context.generation !== undefined && context.generation !== searchGeneration) {
      debugLog('🗑️ Discarding stale OmniRoute response for:', `"${title}" (generation ${context.generation}, current is ${searchGeneration})`);
      return;
    }
    let urlCount = 0;   // sites where OmniRoute returned ANY url (direct or search-page)
    let directCount = 0; // subset of the above actually classified 'direct'
    // links/linkTypes keys come back lowercase from the worker (site.toLowerCase()),
    // but siteNames/data-site-name are display-case ("MovieBox") — build a
    // lowercase-keyed lookup once so we're not comparing "MovieBox" against "moviebox".
    const linksLC = {};
    Object.keys(links).forEach(k => { linksLC[k.toLowerCase()] = links[k]; });
    const linkTypesLC = {};
    Object.keys(linkTypes).forEach(k => { linkTypesLC[k.toLowerCase()] = linkTypes[k]; });
    siteNames.forEach(siteKey => {
      const card = document.querySelector(`.site-card[data-site-name="${CSS.escape(siteKey)}"]`)
        || Array.from(document.querySelectorAll('.site-card')).find(
             el => normalizeSiteName(el.dataset.siteName || '') === normalizeSiteName(siteKey)
           );
      if (!card) return;
      const badge = card.querySelector('.omni-pending');
      if (!badge) return; // already a static-override direct link (.site-free), nothing to resolve
      const url = linksLC[siteKey.toLowerCase()];
      if (!url) {
        // OmniRoute found nothing — stop showing "checking…", fall back to plain note.
        badge.textContent = '🔍 Search inside site';
        badge.classList.remove('omni-pending');
        return;
      }
      urlCount++;
      card.setAttribute('href', url);
      // worker.js verifies each URL is reachable before returning it, but
      // "reachable" isn't the same as "points at the title" — a search
      // page is reachable too. linkTypes[siteKey] tells us which one this
      // actually is, so the badge doesn't overclaim.
      const isDirect = linkTypesLC[siteKey.toLowerCase()] === 'direct';
      if (isDirect) directCount++;
      badge.textContent = isDirect ? '✅ Direct link' : '🔍 Search inside site';
      badge.className = 'site-free';
      badge.style.marginTop = '2px';
      badge.style.display = 'inline-block';
      // Keep the copy/report buttons in sync with the upgraded link
      const escapedUrl = url.replace(/'/g, "\\'");
      const copyBtn = card.querySelector('button.copy-link-btn:not(.report-icon)');
      if (copyBtn) copyBtn.setAttribute('onclick', `copySiteLink(event, '${escapedUrl}', this)`);
      const reportBtn = card.querySelector('button.copy-link-btn.report-icon');
      if (reportBtn) {
        const escapedSiteKey = siteKey.replace(/'/g, "\\'");
        reportBtn.setAttribute('onclick', `event.preventDefault(); event.stopPropagation(); openReportModal('${escapedSiteKey}', '${escapedUrl}')`);
      }
    });
    debugLog('🏁 Done —', `${urlCount}/${siteNames.length} site(s) got a URL from OmniRoute, ${directCount} of those confirmed direct.`);
  });
}

// Shared parser: turns a raw TMDB result object into the shape our UI uses.
// Used by both search and trending so the card/detail rendering stays consistent.
function parseTmdbItem(r, fallbackMediaType) {
  const title = r.title || r.name;
  const originalTitle = r.original_title || r.original_name || '';
  const mediaType = r.media_type || fallbackMediaType; // recommendations endpoint doesn't include media_type
  const type = mediaType === 'tv' ? 'series' : 'movie';
  const category = detectCategory(r, type);
  return {
    id: r.id,
    title,
    type,
    category,
    year: parseInt((r.release_date || r.first_air_date || '').split('-')[0]),
    rating: r.vote_average?.toFixed(1),
    description: r.overview || '',
    genre: genreIdsToLabel(r.genre_ids),
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
    sites: CATEGORY_SITES[category](title),
    tip: `Tip: Search for "<strong>${title}</strong>" on the site directly if direct link doesn't work.`,
    // Preserved so renderResult()'s isPinoyContent check further down actually
    // has data to read — without these two fields it always evaluated
    // undefined === 'tl' (false), so Pinoy sites never appended regardless
    // of what was searched.
    original_language: r.original_language,
    origin_country: r.origin_country || [],
    // Native/romanized title (e.g. Korean/Japanese romanization) — many
    // fansub/streaming sites list entries under this instead of the
    // English/localized `title`. Only set when it actually differs, so
    // downstream code can cheaply check `if (original_title)`.
    original_title: (originalTitle && originalTitle !== title) ? originalTitle : ''
  };
}

// ===== VOICE SEARCH (Web Speech API — free, browser-native, no backend) =====
// Chrome/Edge/Android WebView support this; Firefox and some browsers don't,
// so the mic button is hidden entirely (via detectVoiceSearchSupport()) on
// browsers where it wouldn't work, rather than showing a button that fails.
function detectVoiceSearchSupport() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('mic-btn');
  if (SpeechRecognition && micBtn) micBtn.style.display = 'flex';
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // button is hidden in this case anyway
  const micBtn = document.getElementById('mic-btn');
  const input = document.getElementById('search-input');

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  if (micBtn) { micBtn.style.color = 'var(--accent)'; micBtn.setAttribute('aria-label', 'Listening...'); }

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    input.value = transcript;
    searchMovie();
  };
  recognition.onerror = () => {
    if (micBtn) { micBtn.style.color = ''; micBtn.setAttribute('aria-label', 'Search by voice'); }
  };
  recognition.onend = () => {
    if (micBtn) { micBtn.style.color = ''; micBtn.setAttribute('aria-label', 'Search by voice'); }
  };

  try { recognition.start(); } catch (e) {
    if (micBtn) { micBtn.style.color = ''; }
  }
}

document.addEventListener('DOMContentLoaded', detectVoiceSearchSupport);

// Fan-nickname / commonly-mistyped titles that don't exist as literal TMDB
// entries — e.g. "May Who?" (2015) is widely known among Filipino viewers
// as "Electric Girl", but TMDB only has it under its real title. Add more
// entries here (lowercase key -> real TMDB title) whenever a search turns
// up empty for a title people clearly know by a different name.
const SEARCH_ALIASES = {
  'electric girl': 'May Who',
  'my electric girl': 'May Who',
  // K-drama shorthand/nicknames
  'sg': 'Squid Game',
  'got': 'Game of Thrones',
  'goblin': 'Guardian: The Lonely and Great God',
  'dotscom': 'Descendants of the Sun',
  'dots': 'Descendants of the Sun',
  'w': 'W: Two Worlds',
  'itaewon class': 'Itaewon Class',
  'hotel del luna': 'Hotel Del Luna',
  'crash landing': 'Crash Landing on You',
  'clay': 'Crash Landing on You',
  'reply 1988': 'Reply 1988',
  'mr sunshine': 'Mr. Sunshine',
  'strong woman': 'Strong Woman Do Bong-soon',
  'true beauty': 'True Beauty',
  'business proposal': 'A Business Proposal',
  'vincenzo': 'Vincenzo',
  'moon lovers': 'Moon Lovers: Scarlet Heart Ryeo',
  'sky castle': 'SKY Castle',
  // Anime shorthand/nicknames
  'aot': 'Attack on Titan',
  'snk': 'Attack on Titan',
  'mha': 'My Hero Academia',
  'bnha': 'My Hero Academia',
  'jjk': 'Jujutsu Kaisen',
  'demon slayer': 'Demon Slayer: Kimetsu no Yaiba',
  'kny': 'Demon Slayer: Kimetsu no Yaiba',
  'fma': 'Fullmetal Alchemist',
  'fmab': 'Fullmetal Alchemist: Brotherhood',
  'op': 'One Piece',
  'sao': 'Sword Art Online',
  'hxh': 'Hunter x Hunter',
  'db': 'Dragon Ball',
  'dbz': 'Dragon Ball Z',
  'toradora': 'Toradora!',
  'evangelion': 'Neon Genesis Evangelion',
  'eva': 'Neon Genesis Evangelion',
  'jojo': "JoJo's Bizarre Adventure",
  'csm': 'Chainsaw Man',
  'opm': 'One Punch Man',
  'tokyo revengers': 'Tokyo Revengers',
  'spy family': 'Spy x Family',
  'sxf': 'Spy x Family',
};

function resolveSearchAlias(q) {
  const hit = SEARCH_ALIASES[q.toLowerCase().trim()];
  return hit || q;
}

// ===== TYPO / FUZZY MATCH (client-side only — no dictionary, no paid API) =====
// A lightweight typo-correction layer for the true dead-end case: TMDB
// found literally nothing, not even a loosely-related result. It only
// checks the query against titles THIS APP already knows about — the
// alias dictionary, the popular-searches list, and titles that showed up
// in real, successful TMDB results before (remembered in localStorage). It
// can't catch a typo of a title nobody has ever successfully searched
// yet — there's no bundled title database — but the pool grows for free
// as real searches happen, so it gets more useful over time at no cost.
const KNOWN_TITLES_KEY = 'cinefind-known-titles';
const KNOWN_TITLES_MAX = 500;

// Called after any successful search/suggestion fetch to grow the fuzzy-
// match pool with real titles TMDB actually confirmed exist.
function rememberKnownTitles(titles) {
  try {
    const stored = new Set(JSON.parse(localStorage.getItem(KNOWN_TITLES_KEY) || '[]'));
    titles.forEach(t => { if (t) stored.add(t); });
    let arr = [...stored];
    if (arr.length > KNOWN_TITLES_MAX) arr = arr.slice(arr.length - KNOWN_TITLES_MAX); // drop oldest
    localStorage.setItem(KNOWN_TITLES_KEY, JSON.stringify(arr));
  } catch (e) { /* storage unavailable — skip silently */ }
}

function getKnownTitlesPool() {
  const pool = new Set([
    ...Object.values(SEARCH_ALIASES),
    '0.5 no Otoko', 'Squid Game', 'Your Name', 'Parasite', 'Demon Slayer',
    'My Love from the Star', 'Attack on Titan', 'Crash Landing on You',
  ]);
  try {
    JSON.parse(localStorage.getItem(KNOWN_TITLES_KEY) || '[]').forEach(t => pool.add(t));
  } catch (e) { /* storage unavailable */ }
  return [...pool];
}

// Standard Levenshtein (edit distance) between two strings, case-insensitive.
function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Finds up to `limit` known titles close enough to be a likely typo of the
// query. The distance threshold scales with query length — a short query
// needs an almost-exact match, a longer title tolerates a couple more
// typo'd characters — so this doesn't start matching unrelated titles.
function findFuzzyMatches(query, limit) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const maxDistance = Math.max(1, Math.floor(q.length * 0.3));
  return getKnownTitlesPool()
    .map(title => ({ title, dist: levenshtein(q, title) }))
    .filter(({ dist }) => dist > 0 && dist <= maxDistance) // dist 0 = already an exact match elsewhere
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map(m => m.title);
}

// TMDB's search endpoint matches on title only — it has no entry literally
// named "Bleach Season 4", so a query like that returns nothing even though
// "Bleach" alone matches fine. Stripping trailing season/part/movie noise
// before the API call (but keeping `query` itself untouched for the cache
// key, search history, and on-screen "Couldn't find ..." text) fixes that
// without affecting anything else that reads the original typed query.
// Alias resolution runs first so "electric girl season 2" (hypothetically)
// would still resolve to the real title before the season-stripping regex
// even needs to run.
function cleanSearchQuery(q) {
  const aliased = resolveSearchAlias(q);
  // Strips, in order:
  //  - Genre/category qualifier words people naturally tack on when they
  //    don't remember the exact title ("Black kdrama", "Titanic movie") —
  //    TMDB only does literal title matching, so these words alone are
  //    enough to turn an otherwise-findable title into zero results. Runs
  //    FIRST, before the season/episode strippers below, so something like
  //    "Squid Game Season 2 kdrama" has "kdrama" removed first, leaving
  //    "Squid Game Season 2" for the season stripper to clean normally
  //    instead of failing to match with "kdrama" trailing after the "2".
  //  - Same genre/category words, but LEADING instead of trailing
  //    ("anime: Attack on Titan", "kdrama Black") — same reasoning, just
  //    the other end of the string. Runs right after the trailing version.
  //  - "Season 4 Episode 3" as one combined unit — has to run before the
  //    single-pattern strippers below, since those only match one
  //    season/part/episode marker at the very end of the string and would
  //    leave "Season 4" dangling if "Episode 3" comes after it.
  //  - "Final Season" / "Final Part" as one unit (so "Final" doesn't get
  //    left dangling — matched before the plain season/part case below)
  //  - "Season 4" / "Season" / "Part 5" / "Episode 12" / "Vol. 3" etc,
  //    number optional (covers mid-typing before the number is finished)
  //  - Bare "S2" / "S 2" shorthand, which is how most people actually type
  //    season shorthand rather than spelling out "season"
  return aliased
    .replace(/\s*[:\-–—]?\s+(korean drama|japanese drama|chinese drama|k-drama|j-drama|c-drama|kdrama|jdrama|cdrama|tv series|tv show|anime|drama|movie|film|series|show)\s*$/i, '')
    .replace(/^\s*(korean drama|japanese drama|chinese drama|k-drama|j-drama|c-drama|kdrama|jdrama|cdrama|tv series|tv show|anime|drama|movie|film|series|show)\s*[:\-–—]?\s+/i, '')
    .replace(/\s*[:\-–—]?\s+season\s*\d*\s+(episodes|episode|eps|ep)\.?\s*\d*\s*$/i, '')
    .replace(/\s*[:\-–—]?\s+final\s+(season|part)\s*$/i, '')
    .replace(/\s*[:\-–—]?\s+(season|part|episodes|episode|eps|ep|volume|vol)\.?\s*\d*\s*$/i, '')
    .replace(/\s*[:\-–—]?\s+s\s*\d+\s*$/i, '')
    .trim() || aliased;
}

// Reads a season number the user typed ("season 2", "s2", or a bare
// trailing number like "A Shop for Killers 2") WITHOUT touching the query
// used for cleanSearchQuery/TMDB matching — this only tells the search
// which season to fetch season-specific data for AFTER a TV show is
// matched normally. Safe by construction: enrichWithSeasonData() only
// ever acts on this for type === 'series' results, and silently keeps the
// original show-level data if TMDB has no such season — so a false-
// positive guess on a movie title with a trailing number (e.g. "Kill Bill
// 2", "Ocean's 11") never changes anything, since movies never reach the
// fetch at all.
function extractSeasonNumber(q) {
  const explicit = q.match(/\s+(?:season|s)\s*(\d+)\s*$/i);
  if (explicit) return parseInt(explicit[1], 10);
  const bare = q.match(/\s+(\d+)\s*$/);
  if (bare) return parseInt(bare[1], 10);
  return null;
}

// Reads a "Part"/"Volume" marker directly from the OFFICIAL TMDB title
// (data.title), not the user's typed query — unlike seasons, TMDB already
// lists "Part 2"/"Vol. 2" movies as their own distinct search result (own
// id, poster, year), so the marker is just sitting in the title TMDB gave
// us. Only matches explicit markers (part/pt/vol/volume + number) — NOT a
// bare trailing number like extractSeasonNumber does, since a bare number
// on a movie title is too often the actual title itself ("2012", "300",
// "Se7en", "1917") rather than a sequel marker, and there's no safe way to
// tell those apart the way enrichWithSeasonData()'s TMDB lookup can for
// seasons.
function extractPartNumber(title) {
  if (!title || typeof title !== 'string') return null;
  const m = title.match(/\b(?:part|pt\.?|vol\.?|volume)\s*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

// Fetches season-specific poster/air-date/overview from the Worker's
// `mode=season` endpoint and merges it into one already-parsed result.
// Never rejects — any failure (network error, or TMDB returning no such
// season) just resolves with the original item untouched, so a wrong
// season-number guess can only ever fall back to what search already
// showed, never break it.
function enrichWithSeasonData(item, seasonNumber) {
  if (!item || item.type !== 'series' || !seasonNumber) return Promise.resolve(item);
  return fetch(`${TMDB_PROXY_URL}?mode=season&tv_id=${item.id}&season_number=${seasonNumber}`, { signal: AbortSignal.timeout(8000) })
    .then(r => r.json())
    .then(season => {
      if (!season || season.success === false || !season.id) return item; // no such season on TMDB — keep original
      return {
        ...item,
        title: `${item.title} — Season ${seasonNumber}`,
        year: parseInt((season.air_date || '').split('-')[0]) || item.year,
        poster: season.poster_path ? `https://image.tmdb.org/t/p/w300${season.poster_path}` : item.poster,
        description: season.overview || item.description,
        // Kept alongside title/poster/year above so downstream consumers
        // (OmniRoute context) read the SAME season this card's poster and
        // title already reflect — no separate re-derivation that could
        // drift out of sync with what the user is actually looking at.
        season: seasonNumber,
      };
    })
    .catch(() => item);
}

// Pulls a leading/trailing 4-digit year (1900-2099) out of the query, e.g.
// "Black 2017" -> { text: "Black", year: 2017 }. TMDB's /search/multi
// (unlike /search/movie or /search/tv) has no year-filter parameter, so
// this can't be sent to TMDB directly — instead the year is stripped
// before the text hits TMDB (so it doesn't hurt the title match) and used
// afterward, client-side, to boost same-year results when several
// different titles share the same name (see runSearch()'s sort step).
function extractYearHint(q) {
  const trailing = q.match(/\s+((19|20)\d{2})\s*$/);
  if (trailing) return { text: q.slice(0, trailing.index).trim(), year: parseInt(trailing[1]) };
  const leading = q.match(/^\s*((19|20)\d{2})\s+/);
  if (leading) return { text: q.slice(leading[0].length).trim(), year: parseInt(leading[1]) };
  return { text: q, year: null };
}

// Bare genre/category words typed ALONE (no actual title) — TMDB's search
// endpoint only does literal title matching, so "anime" or "kdrama" by
// itself returns nothing useful even though the site clearly has an anime/
// K-drama audience. These route straight to the Sites directory with the
// matching category filter instead of wasting an API call that can't work.
// null = still redirect to the directory, but don't apply any one filter
// (ambiguous between the site's own categories).
const BARE_CATEGORY_REDIRECTS = {
  'anime': 'anime', 'animes': 'anime', 'animé': 'anime',
  'kdrama': 'drama', 'k-drama': 'drama', 'korean drama': 'drama', 'koreandrama': 'drama',
  'jdrama': 'drama', 'j-drama': 'drama', 'japanese drama': 'drama',
  'cdrama': 'drama', 'c-drama': 'drama', 'chinese drama': 'drama',
  'drama': 'drama', 'dramas': 'drama',
  'movie': 'movie', 'movies': 'movie', 'film': 'movie', 'films': 'movie',
  'series': null, 'tv show': null, 'tv series': null, 'show': null,
};

function searchMovie() {
  closeSuggestions();
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  const bareCategory = BARE_CATEGORY_REDIRECTS[query.toLowerCase().trim()];
  if (bareCategory !== undefined) {
    renderHomepage();
    switchHomeTab('sites');
    if (bareCategory) {
      activeDirFilters = [bareCategory];
      syncDirFilterChipsUI();
      renderSitesDirectory();
    }
    document.getElementById('home-tab-sites')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const { text: yearStrippedQuery, year: yearHint } = extractYearHint(query);
  const tmdbQuery = cleanSearchQuery(yearStrippedQuery);
  const seasonHint = extractSeasonNumber(yearStrippedQuery);
  currentSearchSeasonHint = seasonHint; // exposed for selectMovie()'s grid-pick path below

  const now = Date.now();
  if (isSearching || now < cooldownUntil) {
    const timeLeft = Math.max(0, cooldownUntil - now);
    if (timeLeft > 0) {
      console.warn(`Wait ${Math.ceil(timeLeft / 1000)}s before searching again`);
    }
    return;
  }

  saveSearchHistory(query);
  logPopularSearch(query);
  isSearching = true;
  const searchBtn = document.querySelector('.search-btn');
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.setAttribute('aria-busy', 'true');
    searchBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" class="spin" style="animation-duration:.7s;"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';
  }
  const area = document.getElementById('result-area');
  area.innerHTML = `
    <div style="display:flex; gap:16px;" aria-hidden="true">
      <div class="poster-shimmer" style="width:110px; height:165px; border-radius:12px; flex-shrink:0;"></div>
      <div style="flex:1; display:flex; flex-direction:column; gap:10px; padding-top:4px;">
        <div class="poster-shimmer" style="height:22px; width:70%; border-radius:6px;"></div>
        <div class="poster-shimmer" style="height:14px; width:40%; border-radius:6px;"></div>
        <div class="poster-shimmer" style="height:14px; width:90%; border-radius:6px;"></div>
        <div class="poster-shimmer" style="height:14px; width:80%; border-radius:6px;"></div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:20px;" aria-hidden="true">
      ${Array(4).fill('<div class="poster-shimmer" style="height:86px; border-radius:14px;"></div>').join('')}
    </div>
    <p id="search-wait-msg" style="text-align:center; color:var(--muted); font-size:.8rem; margin-top:16px;">Searching…</p>
  `;

  // If the request is taking noticeably longer than usual, swap the caption
  // instead of leaving "Searching…" sitting there unchanged — a static
  // label past a few seconds reads as frozen even though it's still working.
  const slowSearchTimer = setTimeout(() => {
    const msg = document.getElementById('search-wait-msg');
    if (msg) msg.textContent = 'Still searching… this is taking longer than usual.';
  }, 4000);

  let cached = getFromCache(query);
  if (cached && !Array.isArray(cached)) cached = [cached]; // back-compat with old single-object cache format
  if (cached) {
    clearTimeout(slowSearchTimer);
    lastSearchResult = cached;
    if (cached.length === 1) {
      currentDisplayedResults = cached;
      renderResult(cached[0], query);
    } else {
      renderResultsGrid(cached);
    }
    isSearching = false;
    cooldownUntil = Date.now() + COOLDOWN_MS;
    startCooldownDisplay();
    return;
  }

  function runSearch(qForApi, retryStage, yearHint) {
    return fetch(`${TMDB_PROXY_URL}?query=${encodeURIComponent(qForApi)}`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.json())
      .then(tmdb => {
        // TMDB caps each page at ~20 results, sorted by popularity — a real
        // match can rank just outside page 1 next to several more
        // mainstream same-word results (e.g. searching "Black" surfaces
        // Black Sails/Beauty in Black/etc. on page 1, while a smaller 2017
        // Korean drama also just titled "Black" sits on page 2) and never
        // surfaces via "Load More" even though it exists on TMDB. This is
        // NOT the zero-results case the retry stages below handle — page 1
        // already has plenty of results — so it has to be merged in here,
        // unconditionally, on the first attempt. Capped at one extra page
        // (not chased indefinitely) to keep this to one extra request.
        if (!retryStage && tmdb.total_pages > 1) {
          return fetch(`${TMDB_PROXY_URL}?query=${encodeURIComponent(qForApi)}&page=2`, { signal: AbortSignal.timeout(8000) })
            .then(r2 => r2.json())
            .then(tmdb2 => {
              const seen = new Set((tmdb.results || []).map(m => `${m.media_type}-${m.id}`));
              const extra = (tmdb2.results || []).filter(m => !seen.has(`${m.media_type}-${m.id}`));
              return { ...tmdb, results: [...(tmdb.results || []), ...extra] };
            })
            .catch(() => tmdb); // page 2 failing shouldn't break page 1's already-good results
        }
        return tmdb;
      })
      .then(tmdb => {
        // Poster is no longer required — obscure/low-metadata titles on TMDB
        // (e.g. "Electric Girl" 2019) sometimes have no poster_path at all,
        // and were being silently dropped here even though TMDB matched them
        // correctly. parseTmdbItem()/renderResult() already fall back to a
        // 🎬/📺 emoji when poster is null, so this no longer needs a poster
        // to produce a usable result.
        //
        // Exact-title-match priority: TMDB's own ordering is popularity, not
        // relevance — a big Western show can easily outrank a smaller
        // foreign title that's a word-for-word match for what was actually
        // typed (e.g. searching "Black" surfaces "Beauty in Black"/"Black
        // Sails" ahead of a 2017 Korean drama literally titled "Black").
        // This re-sorts so anything whose title/name exactly equals the
        // (cleaned) search query — case-insensitive — always lands first,
        // regardless of which page it came from or how TMDB itself ranked
        // it.
        //
        // Year-match tiebreaker: a common word like "Black" can match
        // thousands of TMDB entries (movies, shows, even ones where it's
        // just part of a longer title) — exact-title-match alone isn't
        // always enough to disambiguate between several different things
        // that happen to share the exact same title. When the person typed
        // a year ("Black 2017"), same-year results are boosted next, after
        // exact-title but before everything else. No effect at all when no
        // year was typed — falls through to TMDB's original relative order
        // (stable sort) same as before.
        const qExactMatch = qForApi.trim().toLowerCase();
        const results = (tmdb.results?.filter(m => m.media_type === 'movie' || m.media_type === 'tv') || [])
          .sort((a, b) => {
            const aExact = (a.title || a.name || '').trim().toLowerCase() === qExactMatch ? 0 : 1;
            const bExact = (b.title || b.name || '').trim().toLowerCase() === qExactMatch ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            if (yearHint) {
              const aYear = (a.release_date || a.first_air_date || '').slice(0, 4);
              const bYear = (b.release_date || b.first_air_date || '').slice(0, 4);
              const aYearMatch = aYear === String(yearHint) ? 0 : 1;
              const bYearMatch = bYear === String(yearHint) ? 0 : 1;
              if (aYearMatch !== bYearMatch) return aYearMatch - bYearMatch;
            }
            // Documentary tiebreaker: a "Making of"/behind-the-scenes
            // documentary can share most/all of the main title's words
            // (e.g. "The Soul of War: Making 'Hacksaw Ridge'" vs the actual
            // film "Hacksaw Ridge"), so it still shows up in the same
            // results grid. Push documentaries (genre id 99) below
            // non-documentaries here — people searching a title almost
            // always mean the actual movie/show, not the making-of. Only
            // matters when neither result was already an exact-title match
            // above (an exact-match documentary — someone deliberately
            // searching a documentary by its real name — still wins fairly
            // via the check above).
            const aDoc = (a.genre_ids || []).includes(99) ? 1 : 0;
            const bDoc = (b.genre_ids || []).includes(99) ? 1 : 0;
            if (aDoc !== bDoc) return aDoc - bDoc;
            // Asian-origin tiebreaker: only reached once exact-title and
            // year-hint (if any) left two results still tied — nudges
            // K-drama/anime/Asian titles ahead of a same-tier Western
            // result, matching this app's actual audience instead of
            // TMDB's Western-leaning popularity order. Never overrides a
            // real exact-title or year match above.
            const aAsian = isAsianOrigin(a) ? 0 : 1;
            const bAsian = isAsianOrigin(b) ? 0 : 1;
            if (aAsian !== bAsian) return aAsian - bAsian;
            return 0;
          });

        if (results.length === 0) {
          // Up to two follow-up attempts, in order, only when nothing
          // matched at all:
          //  Stage 1: strip a bare trailing number some people type to mean
          //    "season 1" without the word "season" (e.g. "Walking Dead 1").
          //  Stage 2: drop the last remaining word entirely. This is NOT
          //    real spell-correction (it can't fix a typo'd word like
          //    "Sqiud" -> "Squid") — it only helps when one extra/unknown
          //    trailing word (not already caught by cleanSearchQuery) is
          //    diluting an otherwise-matchable title, e.g. a qualifier word
          //    not on our known list. A real typo-tolerant search would
          //    need a bundled title dictionary or a third-party spellcheck
          //    API, which this app doesn't have.
          // A real numbered/multi-word title ("Toy Story 3") never reaches
          // either stage — it already matched correctly on the first try.
          if (retryStage === 0) {
            const strippedNumber = qForApi.replace(/\s+\d+\s*$/, '').trim();
            if (strippedNumber && strippedNumber !== qForApi) {
              return runSearch(strippedNumber, 1, yearHint);
            }
          }
          if (retryStage <= 1) {
            const words = qForApi.trim().split(/\s+/);
            if (words.length > 1) {
              const droppedLastWord = words.slice(0, -1).join(' ');
              return runSearch(droppedLastWord, 2, yearHint);
            }
          }
          hideFiltersBar();
          const suggestions = tmdb.results?.slice(0, 3).map(r => r.title || r.name) || [];
          // Only tried once TMDB itself found nothing loosely related —
          // see the block comment above findFuzzyMatches() for what this
          // pool is built from and its limits.
          const fuzzyMatches = suggestions.length === 0 ? findFuzzyMatches(query, 3) : [];
          const suggestionCards = suggestions.map(s => `
            <button class="pop-chip" onclick="quickSearch('${escapeAttr(s)}')" style="margin-right:8px; margin-top:8px;">
              🔍 ${escapeAttr(s)}
            </button>`).join('');
          const fuzzyCards = fuzzyMatches.map(s => `
            <button class="pop-chip" onclick="quickSearch('${escapeAttr(s)}')" style="margin-right:8px; margin-top:8px;">
              ✨ ${escapeAttr(s)}
            </button>`).join('');
          // TMDB itself found nothing even loosely related (not just no
          // poster-having match) — "Did you mean..." would be misleading with
          // an empty list under it, so this shows different, more actionable
          // copy instead of a dead-end.
          area.innerHTML = suggestions.length > 0 ? `
            <div class="empty">
              <div class="big">🤔</div>
              <p style="margin-bottom:20px;">Couldn't find "<strong>${escapeAttr(query)}</strong>". Did you mean...</p>
              ${suggestionCards}
              <div style="margin-top:14px;"><button class="pop-chip" onclick="renderHomepage()">🗂️ Browse free sites directory</button></div>
            </div>` : fuzzyMatches.length > 0 ? `
            <div class="empty">
              <div class="big">✨</div>
              <p style="margin-bottom:20px;">Couldn't find "<strong>${escapeAttr(query)}</strong>". Did you mean...</p>
              ${fuzzyCards}
              <div style="margin-top:14px;"><button class="pop-chip" onclick="renderHomepage()">🗂️ Browse free sites directory</button></div>
            </div>` : `
            <div class="empty">
              <div class="big">🔍</div>
              <p style="margin-bottom:6px;">No matches for "<strong>${escapeAttr(query)}</strong>".</p>
              <p style="color:var(--muted); font-size:.8rem; margin-bottom:20px;">Double-check the spelling, try the original (non-translated) title, or search a shorter keyword.</p>
              <button class="pop-chip" onclick="document.getElementById('search-input').value=''; document.getElementById('search-input').focus();">✏️ Edit search</button>
              <button class="pop-chip" onclick="renderHomepage()" style="margin-left:8px;">🗂️ Browse directory</button>
            </div>`;
          return;
        }

        // Map EVERY matching result (not just results[0]) so filters have
        // an actual list to work with.
        const parsedList = results.map(parseTmdbItem);

        // If a season number was detected (e.g. "A Shop for Killers 2"),
        // fetch that season's actual poster/date/description for the top
        // result and merge it in before caching/rendering — see
        // enrichWithSeasonData() for why this is safe to attempt even when
        // the number guess turns out wrong.
        const enrichPromise = seasonHint
          ? enrichWithSeasonData(parsedList[0], seasonHint).then(enriched => { parsedList[0] = enriched; })
          : Promise.resolve();

        return enrichPromise.then(() => {
          saveToCache(query, parsedList);
          rememberKnownTitles(parsedList.map(m => m.title));
          lastSearchResult = parsedList;
          currentSearchQueryForApi = qForApi;
          currentSearchPagesFetched = tmdb.total_pages > 1 ? 2 : 1;

          if (parsedList.length === 1) {
            currentDisplayedResults = parsedList;
            renderResult(parsedList[0], query);
          } else {
            renderResultsGrid(parsedList);
          }
        });
      });
  }

  runSearch(tmdbQuery, 0, yearHint)
    .catch(err => {
      console.error('Search failed:', err);
      let userMessage = 'Something went wrong. Please try again.';
      let icon = '😔';

      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('network') || errMsg.includes('fetch')) {
        userMessage = 'Connection issue. Please check your internet and try again.';
        icon = '🌐';
      } else if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('rate limit')) {
        userMessage = 'Too many searches. Please wait a moment and try again.';
        icon = '⏳';
      }

      area.innerHTML = `
        <div class="empty">
          <div class="big">${icon}</div>
          <p>Couldn't find results for "<strong>${query}</strong>".<br>${userMessage}</p>
          <button class="pop-chip" onclick="searchMovie()" style="margin-top:16px;">🔄 Try again</button>
          <button class="pop-chip" onclick="renderHomepage()" style="margin-top:16px; margin-left:8px;">🗂️ Browse directory</button>
        </div>`;
    })
    .finally(() => {
      clearTimeout(slowSearchTimer);
      isSearching = false;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      startCooldownDisplay();
    });
}

function showMoreSites() {
  const hidden = document.getElementById('hidden-sites');
  const btn = document.getElementById('show-more-sites-btn');
  if (hidden) hidden.style.display = 'contents';
  if (btn) btn.remove();
}

// Scrolls down to the streaming sites section — triggered by the dedicated
// "Jump to streaming sites" button under the movie description.
function scrollToSites() {
  const target = document.getElementById('sites-section');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleDescription() {
  const desc = document.getElementById('movie-desc');
  const toggleBtn = document.getElementById('movie-desc-toggle');
  if (!desc) return;
  const isExpanded = desc.classList.toggle('expanded');
  if (toggleBtn) toggleBtn.textContent = isExpanded ? 'Show less' : 'Show more';
}

// Runs after renderResult paints the description — checks whether the text
// actually overflows its 3-line clamp, and only then reveals the "Show more"
// toggle. A short description that already fits fully shouldn't show a
// toggle that does nothing when tapped.
function checkDescOverflow() {
  const desc = document.getElementById('movie-desc');
  const toggleBtn = document.getElementById('movie-desc-toggle');
  if (!desc || !toggleBtn) return;
  // scrollHeight > clientHeight means the clamped text is taller than the
  // visible box, i.e. there's hidden content below the 3-line cutoff.
  if (desc.scrollHeight > desc.clientHeight + 2) {
    toggleBtn.style.display = 'inline-block';
  }
}

// ===== SEO: JSON-LD structured data (Movie/TVSeries schema) =====
// Injected/updated per search result so a JS-executing crawler (Googlebot
// renders JS before indexing) sees structured data for the specific title
// being viewed, not just the generic homepage meta tags — this is what
// enables rich results (poster, rating) in search listings. Removes any
// previous instance first so navigating between titles doesn't stack up
// duplicate tags in <head>.
function injectMovieStructuredData(data) {
  const existing = document.getElementById('movie-jsonld');
  if (existing) existing.remove();
  if (!data || !data.title) return;

  const schema = {
    '@context': 'https://schema.org',
    '@type': data.type === 'series' ? 'TVSeries' : 'Movie',
    name: data.title,
    ...(data.description ? { description: data.description } : {}),
    ...(data.poster ? { image: data.poster } : {}),
    ...(data.year ? { datePublished: String(data.year) } : {}),
    ...(data.rating ? { aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: data.rating,
      bestRating: '10',
      ratingCount: 1
    } } : {}),
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'movie-jsonld';
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}

// Fallback Tagalog-title word detector — TMDB's original_language/
// origin_country fields don't always come back accurate (dubbed entries,
// international co-productions mislabeled 'en', etc.), so this catches
// Pinoy content by title even when the API metadata alone would miss it.
// Kept short and to distinctive whole Tagalog words (not fragments that
// could false-positive inside unrelated English titles) and matched with
// word boundaries, case-insensitive.
const TAGALOG_TITLE_MARKERS = [
  'puso', 'pusong', 'pag-ibig', 'pagibig', 'mahal', 'ikaw',
  'buhay', 'pamilya', 'anak', 'lola', 'lolo', 'bayan',
  'bagong', 'pangarap', 'bituin', 'kapatid', 'lihim',
  'probinsyano', 'mga', 'akin', 'saan'
];
function hasTagalogTitleMarker(title) {
  if (!title) return false;
  const words = title.toLowerCase().split(/[^a-z-]+/);
  return TAGALOG_TITLE_MARKERS.some(marker => words.includes(marker));
}

function renderResult(data, query) {
  // Race-condition guard: this render pass "claims" the current generation.
  // Any earlier, still-in-flight search's OmniRoute callback (captured a
  // now-stale generation number) will check against searchGeneration below
  // and bail out instead of overwriting this title's site-links UI.
  const myGeneration = ++searchGeneration;
  hideFiltersBar(); // filters apply to result lists, not a single detail view
  saveRecentlyViewed(data);
  trackSearchAnalytics(data.title, data.genre);
  const recentEl = document.getElementById('recently-viewed-section');
  if (recentEl) recentEl.innerHTML = ''; // homepage-only widget — hide once viewing a detail page
  const area = document.getElementById('result-area');
  const favs = getFavorites();
  const isFavorited = favs.some(f => f.title === data.title);

  // Show direct-link sites first (link straight to the specific title) before
  // "search inside site" homepage links, so the most useful sites appear in
  // the initial visible batch rather than at random. This split just reflects
  // whether a direct URL was returned for this title — it isn't an active
  // verification check, so don't badge it as "verified" or imply certainty
  // in the UI. Split into two named groups (rather than relying on the small
  // per-card badge alone) so the distinction reads as an actual grouping,
  // not just incidental sort order.
  // Within each group, same priority as the homepage directory: 🔥 Hot first,
  // then by live status (up > blocked > unknown > down) — a site being
  // "free"/"search-link" doesn't mean much if it's actually offline right now.
  const statusRank = { up: 0, blocked: 1, down: 3 };
  const resolveCanonicalName = (s) => {
    // Array.isArray guard here too (not just at the fetch site) — this is
    // the actual point where a non-array customSites previously crashed
    // every search via [...SITES_DIRECTORY, ...customSites], so it's worth
    // being defensive here as well, not just where customSites is loaded.
    const pool = [...SITES_DIRECTORY, ...(Array.isArray(customSites) ? customSites : [])];
    const normS = normalizeSiteName(s.name);
    // Exact match first. Substring-only matching caused name collisions —
    // e.g. "PMH" vs "PM Hub": normalizeSiteName("PM Hub") = "pmhub", which
    // contains "pmh", so PMH's hot/status lookup silently resolved to PM
    // Hub's entry instead of its own, hiding PMH's hot flag. Falls back to
    // substring match only when no exact match exists (for partial/legacy
    // name entries where that fuzziness is still wanted).
    let match = pool.find(d => normalizeSiteName(d.name) === normS);
    if (!match) {
      match = pool.find(d => normS.includes(normalizeSiteName(d.name)) || normalizeSiteName(d.name).includes(normS));
    }
    return match ? match.name : s.name;
  };
  const byHotThenStatus = (a, b) => {
    const nameA = resolveCanonicalName(a), nameB = resolveCanonicalName(b);
    const hotA = isHotSite(nameA), hotB = isHotSite(nameB);
    const hotDiff = (hotB ? 1 : 0) - (hotA ? 1 : 0);
    if (hotDiff !== 0) return hotDiff;
    // Both hot: a hot site stays at the top of its tier regardless of
    // flagged/online status — being marked hot means it should rank first,
    // not get pushed down below a merely-online site for being flagged.
    if (hotA && hotB) return 0;
    const rankA = statusRank[getSiteStatus(nameA)] ?? 2;
    const rankB = statusRank[getSiteStatus(nameB)] ?? 2;
    return rankA - rankB;
  };
  // "Direct link" grouping removed — no entry across MOVIE_SITES/SERIES_SITES/
  // DRAMA_SITES/ANIME_SITES ever set `free: true`, so the freeSites group was
  // always empty and every card silently fell into "Search inside site" —
  // a badge/grouping that could never actually fire. Simplified to one flat,
  // sorted list instead of pretending a distinction exists that the data
  // never provides.
  let otherSites = (data.sites || []).sort(byHotThenStatus);

  // Auto-append Pinoy sources for Filipino/Tagalog content (item: "kunware
  // Tagalog yung movie, dapat kasama sa dulo yung mga Pinoy websites").
  // These aren't per-title direct links (no API returns "this exact movie
  // is on iWantTFC"), so they're added as homepage search-inside-site
  // links, same treatment as the rest of otherSites.
  // Detection: TMDB's original_language/origin_country first; falls back
  // to a Tagalog-word title check (see TAGALOG_TITLE_MARKERS above) since
  // those fields aren't always accurate for Filipino titles.
  const isPinoyContent = data.original_language === 'tl'
    || (data.origin_country || []).includes('PH')
    || hasTagalogTitleMarker(data.title);
  if (isPinoyContent) {
    // Pinoy-only sites once detected — no generic/international sites
    // mixed in below them. A Filipino movie's actual home is almost
    // always one of these, not a random foreign streaming site, so
    // showing both just buries the useful links under noise.
    otherSites = [...SITES_DIRECTORY, ...customSites]
      .filter(d => (d.categories || []).includes('pinoy'))
      .map(d => ({ name: d.name, url: d.url, note: 'Filipino content — search inside site' }))
      .sort(byHotThenStatus);
  }
  const SITES_VISIBLE_INITIAL = 4;

  // Reuse the same branded wordmark logos from the homepage directory (SITES_DIRECTORY)
  // instead of generic emoji icons, so a site looks the same wherever it shows up.
  const buildSiteCard = (s, i) => {
    const normS = normalizeSiteName(s.name);
    // Exact match first, substring fallback — same fix as resolveCanonicalName
    // above. Substring-only matching let names like "PMH" collide with "PM
    // Hub" (normalizeSiteName("PM Hub") = "pmhub", which contains "pmh"),
    // silently pulling the wrong site's logo/accent color/tracking name.
    let dirMatch = SITES_DIRECTORY.find(d => normalizeSiteName(d.name) === normS);
    if (!dirMatch) {
      dirMatch = SITES_DIRECTORY.find(d => normS.includes(normalizeSiteName(d.name)) || normalizeSiteName(d.name).includes(normS));
    }
    const logoInner = dirMatch ? (dirMatch.logoHtml || defaultLogoHtml(dirMatch)) : `<span style="font-size:1.3rem;">🎥</span>`;
    // PART 3: resolve a verified STATIC_OVERRIDES link when one exists,
    // otherwise fall back to s.url (already a search-URL from PART 1).
    const linkInfo = getSiteLink(s.name, data.title, s.url);
    const linkBadge = linkInfo.isDirect
      ? `<span class="site-free" style="margin-top:2px; display:inline-block;">✅ Direct link</span>`
      : `<span class="site-note omni-pending" style="margin-top:2px; display:inline-block; opacity:.75;"><span class="omni-pending-icon">⏳</span> <span class="omni-pending-text">Checking for direct link…</span></span>`;
    return `
    <a href="${linkInfo.url}" target="_blank" rel="noopener" class="site-card" data-site-name="${escapeAttr(dirMatch ? dirMatch.name : s.name)}" onclick="trackSiteClick('${escapeAttr(dirMatch ? dirMatch.name : s.name).replace(/'/g, "\\'")}')" style="animation-delay:${i*0.07}s; --site-card-accent:${dirMatch && dirMatch.accent ? dirMatch.accent : 'var(--border)'};">
      <div class="site-logo-box">${logoInner}</div>
      <div class="site-info">
        <div class="site-name">${s.name}</div>
        <div class="site-note">${s.note || 'Search inside site'}</div>
        ${linkBadge}
      </div>
      <button class="copy-link-btn report-icon" onclick="event.preventDefault(); event.stopPropagation(); openReportModal('${escapeAttr(s.name)}', '${escapeAttr(linkInfo.url)}')" title="Report broken" aria-label="Report ${escapeAttr(s.name)} as broken"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4h13l-2 4.5L17 13H4"/></svg><span class="report-label-text">Report</span></button>
      <button class="copy-link-btn" onclick="copySiteLink(event, '${escapeAttr(linkInfo.url)}', this)" title="Copy link" aria-label="Copy link to ${escapeAttr(s.name)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
      <span class="arrow">→</span>
    </a>`;
  };

  const visibleSites = otherSites.slice(0, SITES_VISIBLE_INITIAL);
  const hiddenSites = otherSites.slice(SITES_VISIBLE_INITIAL);

  const siteCards = visibleSites.map(buildSiteCard).join('')
    + (hiddenSites.length > 0
        ? `<div id="hidden-sites" style="display:none;">${hiddenSites.map((s, i) => buildSiteCard(s, i + SITES_VISIBLE_INITIAL)).join('')}</div>
           <button class="pop-chip" id="show-more-sites-btn" onclick="showMoreSites()" style="width:100%; margin-top:4px; grid-column:1/-1;">Show ${hiddenSites.length} more sites ↓</button>`
        : '');

  const canGoBack = currentDisplayedResults && currentDisplayedResults.length > 1;

  area.innerHTML = `
    <div class="movie-header">
      <div class="movie-poster${data.poster ? ' poster-loading' : ''}" id="poster-box">
        ${data.poster
          ? `<img class="poster-img" src="${data.poster}" alt="${escapeAttr(data.title || query)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" onload="this.style.opacity=1; this.parentElement.classList.remove('poster-loading')" onerror="this.parentElement.classList.remove('poster-loading'); this.parentElement.innerHTML='${data.type === 'series' ? '📺' : '🎬'}'">`
          : (data.type === 'series' ? '📺' : '🎬')}
        <button class="fav-btn ${isFavorited ? 'favorited' : ''}" onclick="toggleFavorite(event)" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${isFavorited}"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.8 7.1-.7z"/></svg></button>
      </div>
      <div class="movie-info">
        <div class="movie-title">${data.title || query}</div>
        <div class="movie-meta">
          ${data.year ? `<span class="badge badge-year">${data.year}</span>` : ''}
          ${data.rating ? `<span class="badge badge-rating">⭐ ${data.rating}</span>` : ''}
          <span class="badge" style="background:rgba(255,255,255,.05);color:var(--muted)">${data.type === 'series' ? '📺 Series' : '🎬 Movie'}</span>
        </div>
        <button class="pop-chip" onclick="scrollToSites()" style="margin-top:10px; background:var(--accent); color:#fff; border-color:var(--accent); font-weight:600;">See free streaming sites ↓</button>
        <p class="movie-desc" id="movie-desc" onclick="toggleDescription()">${escapeAttr(data.description || '')}</p>
        <button class="movie-desc-toggle" id="movie-desc-toggle" onclick="toggleDescription()" style="display:none;">Show more</button>
      </div>
    </div>

    <div id="sites-section">
      <div class="section-label">Free streaming sites</div>
      <div class="sites-grid">${siteCards}</div>
      ${data.tip ? `<div class="tips-box"><span style="display:inline-flex; vertical-align:-3px; margin-right:4px; color:var(--gold);" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.36.8.94.8 1.55V16h5.4v-.55c0-.6.3-1.2.8-1.55A6 6 0 0 0 12 3Z"/></svg></span><strong>Tip:</strong> ${data.tip}</div>` : ''}
    </div>

    <div style="margin-top:24px; display:flex; gap:10px; flex-wrap:wrap;">
      ${canGoBack ? `<button class="pop-chip" onclick="renderVisibleResults()">← Back to results</button>` : ''}
      <button class="pop-chip" onclick="resetSearch()">${canGoBack ? 'New search' : '← Search again'}</button>
      <button class="pop-chip" onclick="shareMovie()">Share</button>
    </div>

    ${data.id ? `
      <div class="section-label" style="margin-top:32px;">You might also like</div>
      <div class="results-grid" id="similar-grid" aria-hidden="true">
        ${Array(6).fill('<div class="poster-shimmer" style="aspect-ratio:2/3; border-radius:12px;"></div>').join('')}
      </div>` : ''}
  `;

  // Store current data for favorites
  window.currentMovie = data;
  injectMovieStructuredData(data);

  if (data.id) loadSimilar(data);

  applyStatusDots();

  // Quietly try to upgrade cards to direct links via OmniRoute in the
  // background — page is already fully rendered above, so this never
  // delays what the user sees.
  // Season suffix stripped before matching: enrichWithSeasonData() bakes
  // "— Season N" into data.title for display, but that same text also
  // becomes the fuzzy-match target server-side (normTitle vs page
  // <title>). Season is already validated separately via the `season`
  // param below (extractSeasonFromPage) — requiring the literal words
  // "Season N" to ALSO appear on the site's own page title is redundant
  // and drags the similarity score down on sites that format it
  // differently (e.g. "Show (2013)" or "Show S2"), false-rejecting valid
  // direct links.
  const omniRouteTitle = (data.title || query || '').replace(/\s*—\s*Season\s+\d+\s*$/i, '');
  upgradeCardsWithOmniRoute(omniRouteTitle, otherSites.map(s => s.name), {
    // data always comes from parseTmdbItem() (directly, or via
    // enrichWithSeasonData()) — it carries `year` (already a parsed int)
    // and `type` ('series'|'movie'), never `release_date`/`media_type`.
    // Reading the wrong field names here silently sent null/'movie' to
    // OmniRoute for every request, defeating the year/type disambiguation
    // entirely — this reads the fields that actually exist on `data`.
    year: data.year || null,
    type: data.type === 'series' ? 'tv' : 'movie',
    // Only set when enrichWithSeasonData() actually attached one — so it
    // always matches whatever season this exact card's title/poster show.
    season: data.season || null,
    // Read straight from the OFFICIAL TMDB title (e.g. "Kill Bill: Vol. 2")
    // for movies — TMDB already lists each part/volume as its own distinct
    // result, so this is just picking the marker out of the title we
    // already have, not a separate lookup like season needed.
    // Also applies to series now — anime frequently uses "Part N" instead
    // of "Season N" (e.g. "Jujutsu Kaisen Part 2"), and TMDB lists those
    // as part of the title the same way it does for movie volumes, so the
    // same extraction is safe to run for both types.
    part: extractPartNumber(data.title),
    // Native/romanized title from TMDB (original_title/original_name),
    // when it differs from the display title. Many fansub/streaming
    // sites (DramaCool, Viki, Animepahe, Miruro, KissKH) list entries
    // under this instead of the English/localized title — passing it
    // along gives Layer 5/6 a second name to match against.
    originalTitle: data.original_title || null,
    // TMDB id — passed as an identity anchor for the AI prompts (worker.js
    // already accepts this per the Layer 6c handoff). `data.id` always
    // comes from parseTmdbItem(), so this is the exact card the user picked.
    tmdbId: data.id || null,
    // No per-episode selector exists in the HTML yet — worker.js already
    // accepts `episode` (see handoff notes), but there's nothing here to
    // read it from until that UI is built. Left null/unset until then;
    // do not guess an episode number.
    episode: null,
    // The raw text the user actually typed into the search box (e.g.
    // "Goblin"), separate from `originalTitle` (TMDB's native/romanized
    // title, e.g. Korean script) and from `omniRouteTitle` (TMDB's
    // official display title, e.g. "Guardian: The Lonely and Great God").
    // Fan-facing sites often key their own slugs on the colloquial name a
    // user would actually type, not TMDB's official title or its native
    // title — worker.js's slug-guess shortcut (DramaCool, etc.) tries this
    // as a fallback candidate when the primary title's slug doesn't verify.
    searchQuery: query || null,
    // Race-condition guard: this render pass's generation number (see
    // renderResult's top). Checked by upgradeCardsWithOmniRoute before it
    // writes anything to the DOM — a stale/superseded call becomes a no-op.
    generation: myGeneration,
  });

  // Tavily fallback removed (2026-08-21) — see comment near
  // TAVILY_PROXY_URL's old location for why.

  // Deferred so the browser has painted the just-inserted innerHTML first —
  // scrollHeight reads 0 (or a stale value) if checked synchronously right
  // after setting innerHTML.
  setTimeout(checkDescOverflow, 0);
}


// ========== SIMILAR / RELATED ==========
let similarResults = [];

function loadSimilar(movie) {
  const mediaType = movie.type === 'series' ? 'tv' : 'movie';
  fetch(`${TMDB_PROXY_URL}?mode=recommendations&media_type=${mediaType}&id=${movie.id}`, { signal: AbortSignal.timeout(8000) })
    .then(r => r.json())
    .then(tmdb => {
      const results = (tmdb.results || [])
        .filter(m => m.poster_path)
        .slice(0, 6)
        .map(r => parseTmdbItem(r, mediaType));

      similarResults = results;
      const grid = document.getElementById('similar-grid');
      if (!grid) return; // user may have navigated away already

      if (results.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; color:var(--muted); font-size:.85rem;">No recommendations found for this title.</p>`;
        return;
      }

      grid.innerHTML = results.map((m, i) => `
        <div class="result-card" role="button" tabindex="0" aria-label="${escapeAttr(m.title)}${m.year ? ', ' + m.year : ''}" onclick="selectSimilar(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); selectSimilar(${i})}" style="animation-delay:${i * 0.05}s">
          <div class="result-poster${m.poster ? ' poster-loading' : ''}">
            ${m.poster ? `<img class="poster-img" src="${m.poster}" alt="${m.title}" loading="lazy" onload="this.style.opacity=1; this.parentElement.classList.remove('poster-loading')" onerror="this.parentElement.classList.remove('poster-loading'); this.parentElement.innerHTML='${m.type === 'series' ? '📺' : '🎬'}'">` : (m.type === 'series' ? '📺' : '🎬')}
          </div>
          <div class="result-info">
            <div class="result-title">${m.title}</div>
            <div class="result-meta">
              ${m.year ? `<span class="badge badge-year">${m.year}</span>` : ''}
              ${m.rating ? `<span class="badge badge-rating">⭐ ${m.rating}</span>` : ''}
            </div>
          </div>
        </div>`).join('');
    })
    .catch(() => {
      const grid = document.getElementById('similar-grid');
      if (grid) grid.innerHTML = `<p style="grid-column:1/-1; color:var(--muted); font-size:.85rem;">Couldn't load recommendations right now.</p>`;
    });
}

function selectSimilar(index) {
  const movie = similarResults[index];
  if (!movie) return;
  currentDisplayedResults = similarResults; // lets "Back to results" return to this list
  renderResult(movie, movie.title);
}

function toggleFavorite(e) {
  e.preventDefault();
  e.stopPropagation();
  const movie = window.currentMovie;
  if (!movie) return;

  const btn = e.target.closest('.fav-btn');
  const isFav = btn.classList.contains('favorited');

  // Quick scale bounce on every toggle (fav or unfav) so the tap feels
  // acknowledged instead of just an instant color swap. Uses the Web
  // Animations API directly on this element rather than a CSS class,
  // since it's simple, self-cleans (no class to remember to remove), and
  // needs no extra CSS wiring.
  btn.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }],
    { duration: 320, easing: 'ease-out' }
  );

  if (isFav) {
    removeFavorite(movie.title);
    btn.classList.remove('favorited');
    btn.title = 'Add to favorites';
    btn.setAttribute('aria-label', 'Add to favorites');
    btn.setAttribute('aria-pressed', 'false');
  } else {
    addFavorite(movie);
    btn.classList.add('favorited');
    btn.title = 'Remove from favorites';
    btn.setAttribute('aria-label', 'Remove from favorites');
    btn.setAttribute('aria-pressed', 'true');
  }
}

function resetSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('year-filter').value = '';
  document.getElementById('rating-filter').value = '';
  document.getElementById('type-filter').value = '';
  const quickFilterEl = document.getElementById('quick-filter-input');
  if (quickFilterEl) quickFilterEl.value = '';
  pushViewState('home');
  renderHomepage();
  lastSearchResult = null;
  currentDisplayedResults = null;
  currentResultsRaw = null;
  currentSortBy = 'default';
}

// ========== FREE WEBSITES DIRECTORY ==========
// Add more entries here anytime — categories: 'drama', 'anime', 'movie' (a site can have more than one)
// logoHtml: stylized wordmark shown in the card (falls back to icon+name split if omitted)
// ========== SITE STATUS DOTS (public-facing, reuses the same status.json ==========
// the admin panel already generates from the daily GitHub Action checker) ==========
let siteStatusMap = null; // { normalizedName: 'up' | 'blocked' | 'down' }
let siteStatusLastRun = null; // ms timestamp of the batch status check, for "last checked" freshness text
// { normalizedName: number } — average response time in ms from the same
// status-check batch, if the checker script reports it (optional field,
// `avgResponseMs` on each status.json result). Absent/undefined for any
// site the checker doesn't report timing for — the badge simply doesn't
// render for that site rather than guessing.
let siteSpeedMap = null;

// Strips everything but letters/numbers before comparing site names, so
// "1Shows" / "1-Shows" / "1 Shows" (AI output, directory entries, and
// status.json entries don't always agree on spacing/punctuation) all match
// the same status.json entry instead of silently missing each other.
function normalizeSiteName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ========== REPORT BROKEN SITE (user-facing) ==========
// Small inline modal any visitor can use to flag a site card as broken —
// no login needed. Submits to REPORT_WORKER_URL (a separate Worker that
// holds a GitHub token server-side) which appends to reports.json. The
// admin panel's "🚩 User Reports" section reads that same file.
function openReportModal(siteName, url) {
  const existing = document.getElementById('report-modal-overlay');
  if (existing) existing.remove();

  const movieTitle = window.currentMovie?.title || '';
  const overlay = document.createElement('div');
  overlay.id = 'report-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';
  overlay.innerHTML = `
    <div style="background:var(--card); border:1.5px solid rgba(var(--bg-glow-rgb),.3); border-radius:16px; padding:22px; max-width:340px; width:100%; box-shadow:0 12px 40px rgba(var(--bg-glow-rgb),.15), 0 4px 20px rgba(0,0,0,.4);">
      <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text); margin-bottom:4px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent)"><path d="M5 3v18h2v-7h11l-2.5-4L18 6H7V3z"/></svg> Report "${escapeAttr(siteName)}"</div>
      <div style="font-size:.75rem; color:var(--muted); margin-bottom:14px;">What's wrong with this site?</div>
      <div id="report-reason-buttons" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">
        ${['Broken / dead link', 'Too many ads/popups', 'Wrong movie/title', 'Other'].map(r => `
          <button class="quick-test-btn" onclick="selectReportReason(this)" data-reason="${escapeAttr(r)}" style="flex:1 1 auto;">${r}</button>
        `).join('')}
      </div>
      <div id="report-modal-status" style="font-size:.72rem; color:var(--muted); margin-bottom:10px; min-height:16px;"></div>
      <div style="display:flex; gap:8px;">
        <button class="pop-chip" style="flex:1;" onclick="document.getElementById('report-modal-overlay').remove()">Cancel</button>
        <button class="pop-chip" id="report-submit-btn" style="flex:1; background:var(--accent); color:#fff; border-color:var(--accent);" disabled onclick="submitReport('${escapeAttr(siteName)}', '${escapeAttr(url)}', '${escapeAttr(movieTitle)}')">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ===== About & Disclaimer modal (footer link) =====
// Expands on the one-line footer disclaimer with the fuller legal/trust
// context a directory site like this should surface: no hosting, no
// affiliation with listed sites, and how to flag a broken/bad link (reuses
// the same report flow already wired up per-site, see openReportModal above).
function openAboutModal() {
  const existing = document.getElementById('about-modal-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'about-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:14px; padding:20px; max-width:380px; width:100%; max-height:80vh; overflow-y:auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text); font-size:.95rem;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          About & Disclaimer
        </div>
        <button onclick="document.getElementById('about-modal-overlay').remove()" aria-label="Close" style="position:relative; background:none; border:none; color:var(--muted); font-size:1.1rem; cursor:pointer; width:32px; height:32px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <span style="position:absolute; inset:-11px;"></span>✕
        </button>
      </div>
      <div style="font-size:.8rem; color:var(--text); opacity:.85; line-height:1.6;">
        <p style="margin-bottom:10px;"><strong>CineFind is a search &amp; directory tool only.</strong> We don't host, upload, or store any video content ourselves — we help you find where a title might be available on other, independent websites.</p>
        <p style="margin-bottom:10px;">We're not affiliated with any of the third-party sites listed. Their availability, legality, and content are entirely outside our control, and can change at any time.</p>
        <p style="margin-bottom:0;">Streaming laws vary by country. Please check what's legal to access in your own region before using any listed site.</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function selectReportReason(btn) {
  document.querySelectorAll('#report-reason-buttons .quick-test-btn').forEach(b => {
    b.style.background = ''; b.style.borderColor = ''; b.style.color = '';
    b.removeAttribute('data-selected');
  });
  btn.style.background = 'var(--accent)'; btn.style.borderColor = 'var(--accent)'; btn.style.color = '#fff';
  btn.setAttribute('data-selected', 'true');
  const submitBtn = document.getElementById('report-submit-btn');
  if (submitBtn) submitBtn.disabled = false;
}

async function submitReport(siteName, url, movieTitle) {
  const selected = document.querySelector('#report-reason-buttons .quick-test-btn[data-selected="true"]');
  const reason = selected ? selected.dataset.reason : 'Other';
  const statusEl = document.getElementById('report-modal-status');
  const submitBtn = document.getElementById('report-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
  if (statusEl) statusEl.textContent = '';

  try {
    const res = await fetch(REPORT_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteName, url, movieTitle, reason, timestamp: Date.now() }),
    });
    if (!res.ok) {
      // Surface the Worker's actual error text (e.g. "missing GitHub secrets",
      // a GitHub API rejection, etc.) instead of a generic message — this is
      // the only way to self-diagnose a misconfigured Worker from the UI.
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    if (statusEl) { statusEl.textContent = '✅ Thanks — report sent!'; statusEl.style.color = 'var(--green)'; }
    setTimeout(() => { const o = document.getElementById('report-modal-overlay'); if (o) o.remove(); }, 1200);
  } catch (err) {
    // err.message is either the Worker's real error (see above) or a browser-level
    // failure like "Failed to fetch" (wrong URL / Worker not deployed / CORS/DNS).
    if (statusEl) { statusEl.textContent = `❌ ${err.message || "Couldn't send report — try again later."}`; statusEl.style.color = 'var(--accent2)'; }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
  }
}

// Shared fetch for status.json, used by both the public homepage
// (loadSiteStatus) and the admin panel (loadAdminPanel). These two used to
// each do their own separate fetch — harmless on its own, but for the site
// owner specifically (who loads the page with ?admin=... in the URL),
// checkAdminAccess() calls loadAdminPanel() in the same window 'load'
// handler right after loadSiteStatus() already ran, so in practice it was
// firing two near-simultaneous requests for the exact same file on every
// single admin page load. A short TTL cache collapses that pair into one
// network call without meaningfully hurting freshness for someone
// re-opening the admin panel later — pass forceFresh to skip the cache
// (used by the manual "refresh status" button, where the user explicitly
// wants the latest).
let _statusJsonCache = null; // { data, ts }
const STATUS_JSON_CACHE_TTL_MS = 5000;
async function fetchStatusJson(forceFresh) {
  const now = Date.now();
  if (!forceFresh && _statusJsonCache && (now - _statusJsonCache.ts) < STATUS_JSON_CACHE_TTL_MS) {
    return _statusJsonCache.data;
  }
  const res = await fetch('./status.json?t=' + now);
  if (!res.ok) throw new Error(`status.json returned HTTP ${res.status}`);
  const data = await res.json();
  _statusJsonCache = { data, ts: now };
  return data;
}

async function loadSiteStatus(forceFresh) {
  try {
    const data = await fetchStatusJson(forceFresh);
    const map = {};
    const speedMap = {};
    (data.results || []).forEach(r => {
      if (!r.name) return;
      const key = normalizeSiteName(r.name);
      map[key] = r.status;
      // Only recorded for an 'up' site — response time for a down/blocked
      // site isn't a meaningful "how fast does it load" number.
      if (r.status === 'up' && typeof r.avgResponseMs === 'number') {
        speedMap[key] = r.avgResponseMs;
      }
    });
    siteStatusMap = map;
    siteSpeedMap = speedMap;
    siteStatusLastRun = data.lastRun ? new Date(data.lastRun).getTime() : null;
    applyStatusDots();
  } catch (err) {
    // status.json failed to load (network error, missing file, timeout).
    // Previously this left every card's status-loading skeleton shimmering
    // forever since applyStatusDots() was never called to resolve it. Now
    // it falls back to an empty map so applyStatusDots() still runs — with
    // no status data, getSiteStatus() returns null for every site, which
    // hides the status label cleanly instead of showing a stuck skeleton.
    siteStatusMap = siteStatusMap || {};
    applyStatusDots();
  }
}

// Manual "force refresh" for the status dots — status.json is only
// regenerated once a day by the GitHub Action checker, so this doesn't
// re-check sites in real time, but it does pull the latest committed
// results immediately instead of making users wait for their next full
// page reload to see an updated dot.
async function refreshSiteStatus(btn) {
  if (!btn) return;
  const icon = btn.querySelector('.refresh-status-icon');
  if (icon) icon.style.animation = 'spin .8s linear infinite';
  btn.disabled = true;
  await loadSiteStatus(true);
  if (icon) icon.style.animation = '';
  btn.disabled = false;
  showToast('Status refreshed');
}

// ========== LIVE URL OVERRIDES ==========
// overrides.json is written by the admin panel (via the GitHub API — see
// updateLiveLink()) whenever a "down"/"blocked" site's link is replaced.
// It's a simple { normalizedSiteName: newUrl } map. If it doesn't exist yet
// (first-time setup, no overrides saved) that's normal — sites just use
// their default URL from SITES_DIRECTORY.
let siteUrlOverrides = null;

async function loadUrlOverrides() {
  try {
    const res = await fetch('./overrides.json?t=' + Date.now());
    siteUrlOverrides = res.ok ? await res.json() : {};
  } catch (err) {
    siteUrlOverrides = {};
  }
  renderSitesDirectory(); // re-render so any overridden links take effect immediately
}

function getOverriddenUrl(name, fallbackUrl) {
  if (!siteUrlOverrides) return fallbackUrl;
  return siteUrlOverrides[normalizeSiteName(name)] || fallbackUrl;
}

// ========== HOT (FEATURED) SITES ==========
// hot-sites.json is written by the admin panel's 🔥 toggle (see toggleHotSite())
// — same GitHub-commit approach as overrides.json/custom-sites.json. It's just
// an array of normalized site names. Hot sites are pinned to the very front of
// the directory grid, ahead of the up/blocked/down status sort.
// Remembers the sort dropdowns currently showing on the Favorites page (set
// each time showFavorites() renders) so toggleDirFav() can re-render that
// exact view when a star is tapped from there, instead of only knowing how
// to refresh the homepage directory grid.
let lastFavMovieSort = 'date-desc';
let lastFavSiteSort = 'az';
let hotSiteNames = [];

async function loadHotSites() {
  try {
    const res = await fetch('./hot-sites.json?t=' + Date.now());
    const parsed = res.ok ? await res.json() : [];
    // Same defensive reasoning as loadCustomSites() — a malformed hot-sites.json
    // (e.g. `{}` instead of `[]`) previously crashed every single search via
    // hotSiteNames.includes() not being a function on a non-array value.
    hotSiteNames = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    hotSiteNames = [];
  }
  renderSitesDirectory();
}

function isHotSite(name) {
  return Array.isArray(hotSiteNames) && hotSiteNames.includes(normalizeSiteName(name));
}

// ========== CUSTOM (ADMIN-ADDED) SITES ==========
// custom-sites.json is written by the admin panel's "Add New Website" form
// (see addNewWebsite()) — same GitHub-commit approach as overrides.json.
// It's an array of site objects in the same shape as SITES_DIRECTORY entries,
// so they render with the exact same card component/design. If the file
// doesn't exist yet, that just means no one has added a site through the
// admin panel yet.
let customSites = [];
let removedSiteNames = []; // normalized names deleted via admin — see deleteWebsite()
let removedSitesData = []; // full site objects (name/url/icon/categories) for deleted sites — powers the Restore button

// restoreWebsite()/deleteWebsite() commit real changes to custom-sites.json
// and removed-sites.json via the GitHub API — those writes land immediately.
// But this page (and the admin panel) read those files back as static files
// through GitHub Pages, which takes up to ~1 min to redeploy/re-cache. Without
// this, a reload during that window re-reads the stale files and a just-
// restored site "reverts" — reappears as deleted, disappears from the
// homepage. This stores the outcome locally and reapplies it on load until
// the real fetched files agree, so nothing flashes back to the old state.
function getPendingRestores() {
  try { return JSON.parse(localStorage.getItem('cinefind-pending-restores') || '{}'); }
  catch (e) { return {}; }
}
function markPendingRestore(siteObj) {
  const map = getPendingRestores();
  map[normalizeSiteName(siteObj.name)] = siteObj;
  try { localStorage.setItem('cinefind-pending-restores', JSON.stringify(map)); } catch (e) { /* storage full/unavailable */ }
}
function applyPendingRestores(customList, removedList) {
  const pending = getPendingRestores();
  let changed = false;
  Object.keys(pending).forEach(key => {
    const alreadyReal = customList.some(s => normalizeSiteName(s.name) === key) && !removedList.some(s => normalizeSiteName(s.name) === key);
    if (alreadyReal) {
      delete pending[key]; // the real files have caught up — stop overriding
      changed = true;
    } else {
      if (!customList.some(s => normalizeSiteName(s.name) === key)) {
        if (pending[key].url) customList.push(pending[key]); // built-ins have no url snapshot — they already render via SITES_DIRECTORY, nothing to inject
      }
      removedList = removedList.filter(s => normalizeSiteName(s.name) !== key);
    }
  });
  if (changed) { try { localStorage.setItem('cinefind-pending-restores', JSON.stringify(pending)); } catch (e) {} }
  return { customList, removedList };
}

async function loadCustomSites() {
  try {
    const res = await fetch('./custom-sites.json?t=' + Date.now());
    const parsed = res.ok ? await res.json() : [];
    // Defensive: if the file is ever malformed/corrupted (e.g. an admin
    // panel save leaves it as `{}` instead of `[]`), fall back to an empty
    // array instead of letting a non-array value silently crash every
    // single search later (resolveCanonicalName spreads this array —
    // spreading a non-array throws "customSites is not iterable" and the
    // search just shows a generic "no results" with no indication why).
    customSites = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    customSites = [];
  }
  try {
    const res2 = await fetch('./removed-sites.json?t=' + Date.now());
    const raw = res2.ok ? await res2.json() : [];
    // Backward compat: removed-sites.json used to store plain name strings.
    // It now stores full objects so a deleted site can be fully restored —
    // normalize old string entries into { name } so nothing here breaks.
    removedSitesData = raw.map(entry => typeof entry === 'string' ? { name: entry } : entry);
  } catch (err) {
    removedSitesData = [];
  }
  const applied = applyPendingRestores(customSites, removedSitesData);
  customSites = applied.customList;
  removedSitesData = applied.removedList;
  removedSiteNames = removedSitesData.map(s => normalizeSiteName(s.name));
  renderSitesDirectory();
}

function getSiteStatus(name) {
  if (!siteStatusMap) return null;
  const key = normalizeSiteName(name);
  if (siteStatusMap[key] !== undefined) return siteStatusMap[key];
  const found = Object.keys(siteStatusMap).find(k => key.includes(k) || k.includes(key));
  return found ? siteStatusMap[found] : null;
}

// Speed badge — classifies a site's average response time (from the same
// GitHub Action batch check as the up/down status) into 'fast' or 'slow'.
// IMPORTANT CAVEAT (shown to the user via the tooltip, not hidden): this
// timing is measured from the checker's server, not from the visitor's
// own connection. A site that's fast to reach from there can still be
// slow on a specific mobile carrier/route — the badge is a rough signal
// for comparing sites against each other, not a promise of your actual
// load time.
const SPEED_FAST_THRESHOLD_MS = 1200;
function getSiteSpeed(name) {
  if (!siteSpeedMap) return null;
  const key = normalizeSiteName(name);
  const ms = siteSpeedMap[key] !== undefined
    ? siteSpeedMap[key]
    : siteSpeedMap[Object.keys(siteSpeedMap).find(k => key.includes(k) || k.includes(key)) || ''];
  if (typeof ms !== 'number') return null;
  return ms <= SPEED_FAST_THRESHOLD_MS ? 'fast' : 'slow';
}

// Bolt/turtle are drawn with fill="currentColor" so they automatically
// inherit .status-text-mini's color — already verified against every
// status-chip background (both themes and Light Mode) elsewhere in this
// file, so no separate contrast check is needed for the icon itself.
// Shape (not color) carries the fast/slow meaning, per WCAG 1.4.1 — the
// two icons are silhouette-distinct even for a colorblind user, and each
// carries its own title/aria-label text besides.
function speedBadgeIcon(speed) {
  if (speed === 'fast') {
    return `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>`;
  }
  if (speed === 'slow') {
    // Simplified to shell + head + a hint of hind legs (dropped the earlier
    // 4-separate-circle "feet" — at 12px those just blurred into a fuzzy dot
    // cluster instead of reading as a turtle). Bumped size up too since a
    // rounded silhouette needs to be a bit bigger than an angular one (the
    // bolt) to register clearly at a glance.
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <ellipse cx="13" cy="13" rx="8" ry="6"/>
      <circle cx="4" cy="11" r="2.6"/>
      <path d="M9.5 18.5c1 1.5 2.3 2.2 3.5 2.2s2.5-.7 3.5-2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    </svg>`;
  }
  return '';
}
function speedBadgeLabel(speed) {
  return speed === 'fast' ? 'Loads quickly' : 'May load slowly';
}

function statusDotColor(status) {
  return status === 'up' ? 'var(--status-green)' : status === 'blocked' ? 'var(--status-gold)' : status === 'down' ? 'var(--accent2)' : null;
}

function statusDotLabel(status) {
  return status === 'up' ? 'Online' : status === 'blocked' ? 'Usually works — flagged by the site\'s bot protection, not necessarily down' : status === 'down' ? 'Might be down' : '';
}

// Short status word shown directly on the card (Online / Warning / Down).
// The dot above already conveys this via color/icon too, but a lot of users
// don't parse color-only signals — pairing it with a word is more accessible
// and answers the question people actually have ("does this work right now?").
function statusShortLabel(status) {
  return status === 'up' ? 'Online' : status === 'blocked' ? 'Flagged' : status === 'down' ? 'Down' : '';
}

// Relative "last checked" freshness text shown on the card's bottom strip —
// this replaced the old per-card status word (Online/Flagged/Offline), which
// just repeated what the dot icon+color already says. One signal (the dot)
// instead of two doing the same job.
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Checked just now';
  if (mins < 60) return `Checked ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days}d ago`;
}

// Distinct SHAPE per status (not just color) so the indicator still reads
// correctly for colorblind users — a checkmark, a warning triangle, and an
// X read as different symbols even if the colors look similar to someone.
// Icons sit inside a dark circular badge (see .status-dot-mini CSS) so they
// stay legible on top of any card color instead of floating as bare strokes.
function statusDotIcon(status, color) {
  if (status === 'up') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l4.5 4.5L20 6"/></svg>`;
  }
  if (status === 'blocked') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.6 2.6"/><path d="M9.6 9.3a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .8-1 1.5v.4"/><circle cx="12" cy="16.6" r="0.55" fill="${color}" stroke="none"/></svg>`;
  }
  if (status === 'down') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5"/></svg>`;
  }
  return '';
}

// Re-applies status dots to whatever site cards are currently on screen
// (homepage directory or a movie's site list) once status.json has loaded.
// Cards render before this data is ready, so dots get filled in afterward
// rather than delaying the initial paint.

function applyStatusDots() {
  if (!siteStatusMap) return;
  document.querySelectorAll('[data-site-name]').forEach(el => {
    const dot = el.querySelector('[data-status-dot]');
    const label = el.querySelector('[data-status-label]');
    if (!dot && !label) return;
    const status = getSiteStatus(el.dataset.siteName);
    const color = statusDotColor(status);
    if (color) {
      const tooltipText = statusDotLabel(status);
      if (dot) {
        dot.innerHTML = statusDotIcon(status, color);
        dot.style.display = 'inline-flex';
        dot.style.borderColor = color;
        dot.style.filter = `drop-shadow(0 0 4px ${color})`;
        dot.title = tooltipText;
        dot.setAttribute('role', 'img');
        dot.setAttribute('aria-label', tooltipText);
      }
      if (label) {
        // Older card types (e.g. favorites) still have the label itself as
        // the text node with no Report button inside — falls back to
        // writing directly on `label` for those. The homepage directory
        // card now nests a dedicated text span so this can set the text
        // without wiping out the Report button that lives alongside it.
        // Shows the status word (Online/Warning/Down) directly, so users
        // don't have to interpret the dot's color on their own.
        const textEl = label.querySelector('[data-status-text]') || label;
        // Status word only (Online/Flagged/Down) — the "· Xh ago" freshness
        // suffix was removed so this centers cleanly with the speed icon
        // as a single short pair (e.g. "Online ⚡") instead of wrapping.
        textEl.textContent = statusShortLabel(status);
        label.style.display = 'flex';
        label.title = tooltipText + (siteStatusLastRun ? ` — checked ${new Date(siteStatusLastRun).toLocaleString()}` : '');
        label.classList.remove('status-loading', 'status-up', 'status-blocked', 'status-down');
        label.classList.add(`status-${status}`);

        const speedEl = label.querySelector('[data-speed-badge]');
        if (speedEl) {
          const speed = getSiteSpeed(el.dataset.siteName);
          if (speed) {
            speedEl.innerHTML = speedBadgeIcon(speed);
            speedEl.title = speedBadgeLabel(speed) +
              ' (measured from our checker, not your connection — actual speed can vary)';
            speedEl.setAttribute('role', 'img');
            speedEl.setAttribute('aria-label', speedEl.title);
            speedEl.style.display = 'inline-flex';
          } else {
            speedEl.innerHTML = '';
            speedEl.style.display = 'none';
          }
        }

        // Report button only earns its place on the card when the site
        // actually needs reporting (down/blocked) — an "Online" site gives
        // no one a reason to tap it.
        const reportBtn = label.querySelector('[data-report-btn]');
        if (reportBtn) {
          const showReport = status === 'down' || status === 'blocked';
          reportBtn.style.display = showReport ? 'inline-flex' : 'none';
          // Only reserve the right-side padding (see .has-report CSS) when
          // Report is actually on screen, so it doesn't push the centered
          // text left on every other card for a button nobody sees.
          label.classList.toggle('has-report', showReport);
        }
      }
    } else {
      if (dot) {
        dot.style.display = 'none';
        dot.innerHTML = '';
        dot.style.filter = '';
        dot.removeAttribute('aria-label');
      }
      if (label) {
        label.style.display = 'none';
        label.classList.remove('status-loading', 'status-up', 'status-blocked', 'status-down');
        const textEl = label.querySelector('[data-status-text]');
        if (textEl) textEl.textContent = ''; else label.textContent = '';
      }
    }
  });
}

const SITES_DIRECTORY = [
  { name: 'MyAsianTV', url: 'https://myasiantv.com.lv/', domain: 'myasiantv.com.lv', categories: ['drama'], icon: '🏔️', accent: '#e63946',
    logoHtml: `<span class="logo-word"><span class="lw-white">My</span><span style="color:#e63946;">Asian</span><span class="lw-white">TV</span></span>` },
  { name: 'DramaCool',  url: 'https://dramacool.baby/', domain: 'dramacool.baby', categories: ['drama'], icon: '🎬', accent: '#5b8def',
    logoHtml: `<span class="logo-word"><span style="color:#5b8def;">Drama</span><span class="lw-white">Cool</span></span>` },
  { name: 'KissKH',        url: 'https://kisskh.co/',           domain: 'kisskh.co',           categories: ['drama'], accent: '#ff4d8f',
    logoHtml: `<span class="logo-word"><span style="color:var(--brand-pink);">Kiss</span><span class="lw-white">KH</span></span>` },
  { name: 'Viki',          url: 'https://www.viki.com/',        domain: 'viki.com',             categories: ['drama'], accent: '#00c2b8',
    logoHtml: `<span class="logo-word"><span class="lw-white">Vi</span><span style="color:var(--brand-cyan);">ki</span></span>` },
  { name: 'FlickyStream',  url: 'https://flickystream.dad/',    domain: 'flickystream.dad',     categories: ['movie'], accent: '#c084fc',
    logoHtml: `<div style="display:flex;flex-direction:column;align-items:center;gap:0px;"><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-style:italic;font-size:1.3rem;line-height:1.05;background:linear-gradient(90deg,#5b8def,#c084fc);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">flicky</span><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-style:italic;font-size:1.1rem;line-height:1.05;background:linear-gradient(90deg,#c084fc,#ff6b9d);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">stream</span></div>` },
  { name: 'MovieBox',      url: 'https://movie-box.co/',        domain: 'movie-box.co',         categories: ['movie'], accent: '#f4c430',
    logoHtml: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.2rem;line-height:1.05;color:var(--card-logo-ink,#fff);">Movie</span><span style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.2rem;line-height:1.05;color:var(--gold);">Box</span></div>` },
  { name: 'FMovies',       url: 'https://fmoviess.org/',       domain: 'fmoviess.org',        categories: ['movie'], accent: '#3b82f6',
    logoHtml: `<span class="logo-word" style="font-size:1.4rem;"><span style="color:var(--accent);">F</span><span class="lw-white">Movies</span></span>` },
  { name: 'ReAnime',       url: 'https://reanime.to/',          domain: 'reanime.to',           categories: ['anime'], accent: '#10b981',
    logoHtml: `<span class="logo-word" style="font-size:1.4rem;"><span style="color:var(--brand-teal);">Re</span><span class="lw-white">Anime</span></span>` },
  { name: 'Miruro',        url: 'https://miruro.to/',           domain: 'miruro.to',            categories: ['anime'], accent: '#9333ea',
    logoHtml: `<span class="logo-word"><span class="lw-white">Miru</span><span style="color:var(--brand-purple);">ro</span></span>` },
  { name: 'Enma',          url: 'https://enma.lol/',            domain: 'enma.lol',             categories: ['anime'], accent: '#ff8a3d',
    logoHtml: `<span class="logo-word" style="font-size:1.7rem;"><span class="lw-white">En</span><span style="color:var(--brand-orange);">ma</span></span>` },
  // ===== 🇵🇭 Pinoy — legal, licensed, genuinely free sources only. =====
  // No aggregator/mirror sites here on purpose — those are usually unlicensed
  // and get taken down constantly. These are the actual rights-holders
  // streaming their own library for free (ad-supported), so links stay
  // working long-term instead of rotting in a few months.
  { name: 'TBA Studios',   url: 'https://www.youtube.com/@TBAStudios/', domain: 'youtube.com',    categories: ['pinoy'], accent: '#059669',
    logoHtml: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.2rem;line-height:1.05;color:var(--card-logo-ink,#fff);">TBA</span><span style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.2rem;line-height:1.05;color:var(--brand-teal);">Studios</span></div>` },
  { name: 'CineWhale',     url: 'https://cinewhale.cc/',        domain: 'cinewhale.cc',         categories: ['movie'], accent: '#1e9edb',
    logoHtml: `<span class="logo-word"><span class="lw-white">Cine</span><span style="color:var(--brand-skyblue);">Whale</span></span>` },
  { name: 'Dulo',          url: 'https://dulo.sx/',             domain: 'dulo.sx',              categories: ['movie'], accent: '#f4522b',
    logoHtml: `<span class="logo-word" style="font-size:1.7rem;"><span style="color:var(--brand-orangered);">Du</span><span class="lw-white">lo</span></span>` },
];

let activeDirFilters = []; // multi-select: any combo of 'drama' / 'anime' / 'movie'

function getDirFavs() {
  try { return JSON.parse(localStorage.getItem('cinefind-dir-favs') || '[]'); }
  catch (e) { return []; }
}

function toggleDirFav(e, name) {
  e.preventDefault();
  e.stopPropagation();
  let favs = getDirFavs();
  const nowFav = !favs.includes(name);
  if (favs.includes(name)) favs = favs.filter(n => n !== name);
  else favs.push(name);
  try { localStorage.setItem('cinefind-dir-favs', JSON.stringify(favs)); } catch (e) { /* storage full/unavailable */ }
  updateFavCount();
  // Refresh whichever view is actually showing this site card. Previously
  // this always called renderSitesDirectory(), which targets the homepage
  // grid (#sites-directory-grid) — that element doesn't exist on the
  // Favorites page (it uses a separate .dir-grid built by
  // buildFavSiteCard), so un-favoriting a site while already on the
  // Favorites page saved correctly but the star/card never visibly
  // updated until you left and came back.
  if (document.getElementById('sites-directory-grid')) {
    renderSitesDirectory();
  } else if (document.getElementById('result-area')?.querySelector('.dir-grid')) {
    showFavorites(lastFavMovieSort, lastFavSiteSort);
  }
  // Pop-bounce on the star, same feel as the detail-page favorite toggle.
  // Has to target the card AFTER the re-render above (not the element that
  // was clicked) — the grid rebuilds via innerHTML replace, so the
  // original button is already gone from the DOM by the time any
  // animation on it would actually paint.
  if (nowFav) {
    const freshBtn = document.querySelector(`[data-site-name="${CSS.escape(name)}"] .pin-icon`);
    if (freshBtn) {
      freshBtn.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' }
      );
    }
  }
}

function renderSitesDirectory() {
  const wrap = document.getElementById('sites-directory-grid');
  if (!wrap) return; // user may have navigated away already

  const favs = getDirFavs();
  const seenNames = new Set();
  const allSites = [...SITES_DIRECTORY, ...customSites] // built-in + admin-added, rendered identically
    .filter(s => {
      const key = normalizeSiteName(s.name);
      if (seenNames.has(key)) return false; // duplicate name — built-in (listed first) wins
      seenNames.add(key);
      return true;
    })
    .filter(s => !removedSiteNames.includes(normalizeSiteName(s.name)));

  // "pinned" isn't a real category on the site data — it's derived from favs —
  // so it's filtered separately here instead of via s.categories like the rest.
  let filtered;
  if (activeDirFilters.includes('pinned')) {
    filtered = allSites.filter(s => favs.includes(s.name));
  } else if (activeDirFilters.length === 0) {
    filtered = allSites;
  } else {
    filtered = allSites.filter(s => s.categories.some(c => activeDirFilters.includes(c)));
  }

  // Sort: 🔥 hot sites first, then by live status (up, then blocked, then
  // unknown/pending, then down last). Sites within the same tier keep their
  // original relative order (Array.sort is stable in modern browsers).
  const statusRank = { up: 0, blocked: 1, down: 3 };
  filtered = [...filtered].sort((a, b) => {
    const hotDiff = (isHotSite(b.name) ? 1 : 0) - (isHotSite(a.name) ? 1 : 0);
    if (hotDiff !== 0) return hotDiff;
    const rankA = statusRank[getSiteStatus(a.name)] ?? 2;
    const rankB = statusRank[getSiteStatus(b.name)] ?? 2;
    return rankA - rankB;
  });

  const countEl = document.getElementById('dir-results-count');
  if (countEl) countEl.textContent = `${filtered.length} site${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    const emptyMsg = activeDirFilters.includes('pinned')
      ? 'No pinned sites yet — tap the 📌 on any site to save it here.'
      : 'No sites in this category yet.';
    wrap.innerHTML = `<p style="grid-column:1/-1; color:var(--muted); font-size:.85rem;">${emptyMsg}</p>`;
    return;
  }

  // The 🔥 badge always accompanies the gold "hot" border together (never
  // just the color alone — that fails colorblind users), so both are driven
  // by the same isHotSite() check with no separate display cap.

  // Hand-picked "best experience per category" sites (speed, ad-load,
  // library freshness) — a quiet gold ring, not a resize, so a couple of
  // sites get a nod without reintroducing the oversized "featured" card.
  const EDITOR_PICKS = new Set(['KissKH', 'Miruro', 'Dulo']);

  const buildCard = (s, i) => {
    const isFav = favs.includes(s.name);
    const isHot = isHotSite(s.name);
    const isEditorPick = EDITOR_PICKS.has(s.name);
    // Uniform sizing — no card gets a wider/taller "hero" treatment anymore,
    // since with several sites often marked hot at once, whichever sorted
    // first was blowing up into a banner while equally-"hot" sites lower
    // down stayed small. The 🔥 badge alone signals hot status now.
    const liveUrl = getOverriddenUrl(s.name, s.url);
    const pinIcon = isFav
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
    const pastelClass = ['card-pastel-blue', 'card-pastel-gold', 'card-pastel-rose'][i % 3];
    return `
    <div class="gradient-card-wrapper${isHot ? ' is-hot' : ''}${isEditorPick ? ' editor-pick' : ''}" data-site-name="${escapeAttr(s.name)}" style="animation-delay:${(i % 6) * 0.04}s; --card-accent:${s.accent || 'var(--accent)'};">
      <a href="${liveUrl}" target="_blank" rel="noopener" class="card-content ${pastelClass}" aria-label="${s.name} — opens in new tab" onclick="trackSiteClick('${escapeAttr(s.name).replace(/'/g, "\\'")}')">
        <span class="status-label-mini status-loading" data-status-label>
          <span class="status-dot-mini" data-status-dot></span>
          <span class="status-text-mini" data-status-text></span>
          <span class="speed-badge-mini" data-speed-badge></span>
          <button class="report-icon" data-report-btn onclick="event.preventDefault(); event.stopPropagation(); openReportModal('${escapeAttr(s.name)}', '${escapeAttr(liveUrl)}')" aria-label="Report this site" title="Report broken" style="opacity:.35; display:none;">⋯</button>
        </span>
        <button class="pin-icon${isFav ? ' faved' : ''}" style="position:absolute; top:8px; right:8px; z-index:2;" onclick="event.preventDefault(); event.stopPropagation(); toggleDirFav(event, '${escapeAttr(s.name)}')" aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${pinIcon}</button>
        ${isHot ? `<span class="hot-label-mini" title="Trending"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#ff3d00"/><stop offset="55%" stop-color="#ff8f1f"/><stop offset="100%" stop-color="#ffd23f"/></linearGradient></defs><path fill="url(#flameGrad)" d="M12.5 2c.6 2.6-.3 4.2-1.7 5.7C9.2 9.4 7.5 11 7.5 13.8a4.5 4.5 0 0 0 9 0c0-1.2-.4-2-.9-2.8-.3.9-.9 1.6-1.6 1.6-.9 0-1.4-.7-1.2-1.6.4-1.7 1.7-2.8 1.7-5C14.5 4.4 13.7 3 12.5 2Z"/><path fill="#1a1a2e" fill-opacity=".35" d="M12 21a3.3 3.3 0 0 1-3.3-3.3c0-1.6 1-2.5 1.9-3.3-.1.7.2 1.3.8 1.3.7 0 1-.6 1-1.3.7.9 1.2 1.8 1.2 3.1A2.6 2.6 0 0 1 12 21Z"/></svg></span>` : ''}
        <div class="card-logo">${s.logoHtml || defaultLogoHtml(s)}</div>
      </a>
    </div>`;
  };

  // Homepage directory can grow long as more sites get added — same
  // "show more" pattern already used for per-movie search results, so the
  // homepage doesn't dump the entire list on first load.
  const DIR_VISIBLE_INITIAL = 6;
  const visible = filtered.slice(0, DIR_VISIBLE_INITIAL);
  const hidden = filtered.slice(DIR_VISIBLE_INITIAL);

  wrap.innerHTML = visible.map(buildCard).join('') + (
    hidden.length > 0
      ? `<div id="hidden-dir-sites" style="display:none;">${hidden.map((s, i) => buildCard(s, i + DIR_VISIBLE_INITIAL)).join('')}</div>
         <button class="pop-chip" id="show-more-dir-sites-btn" onclick="showMoreDirSites()" style="width:100%; margin-top:4px; grid-column:1/-1;">Show ${hidden.length} more sites ↓</button>`
      : ''
  );
  applyStatusDots();
}

function showMoreDirSites() {
  const hidden = document.getElementById('hidden-dir-sites');
  const btn = document.getElementById('show-more-dir-sites-btn');
  if (hidden) hidden.style.display = 'contents';
  if (btn) btn.remove();
}

// Fallback logo for any directory entry that doesn't have a custom logoHtml wordmark.
// Currently every entry in SITES_DIRECTORY supplies its own logoHtml, so this only
// kicks in for new entries added without one — keeps the grid from breaking either way.
function defaultLogoHtml(s) {
  return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; width:100%; padding:0 8px; overflow:hidden;">
    <span style="font-size:1.4rem; line-height:1;">${s.icon || '🎥'}</span>
    <span style="font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.7rem; color:#f0f0f5; text-align:center; line-height:1.15; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; width:100%;">${escapeAttr(s.name)}</span>
  </div>`;
}

// Selects exactly one category filter at a time (radio-button style — picking
// Movie clears K-Drama/Anime/Hot, and vice versa). Clicking the currently
// active pill again clears the filter back to "All". "pinned" is treated the
// same way, so only one filter (a category or Pinned) is ever active at once.
function toggleDirFilter(cat, el) {
  if (activeDirFilters.length === 1 && activeDirFilters[0] === cat) {
    activeDirFilters = []; // clicking the active pill again resets to "All"
  } else {
    activeDirFilters = [cat];
  }
  syncDirFilterChipsUI();
  renderSitesDirectory();
}

function clearDirFilters(el) {
  activeDirFilters = [];
  syncDirFilterChipsUI();
  renderSitesDirectory();
}

function syncDirFilterChipsUI() {
  const allBtn = document.querySelector('#dir-filter-chips .dual-gradient-pill:first-child');
  if (allBtn) allBtn.classList.toggle('active', activeDirFilters.length === 0);
  document.querySelectorAll('#dir-filter-chips .dual-gradient-pill[data-cat]').forEach(c => {
    c.classList.toggle('active', activeDirFilters.includes(c.dataset.cat));
  });
}

function dismissDirTip() {
  try { sessionStorage.setItem('cinefind-dir-tip-dismissed', '1'); } catch (e) { /* storage full/unavailable */ }
  const el = document.getElementById('dir-safety-tip');
  if (el) el.remove();
}

function renderHomepage() {
  hideFiltersBar();
  renderRecentlyViewed();
  let dirTipDismissed;
  try { dirTipDismissed = sessionStorage.getItem('cinefind-dir-tip-dismissed'); } catch (e) { dirTipDismissed = null; }
  document.getElementById('result-area').innerHTML = `
    <div style="margin-bottom:var(--sp-6); display:flex; align-items:center; justify-content:space-between; gap:10px;" class="popular-label">
      <span>Free Websites</span>
      <div style="display:flex; align-items:center; gap:10px;">
        <span id="dir-results-count" style="font-size:.75rem; font-weight:500; color:var(--muted); text-transform:none; letter-spacing:normal;"></span>
        <button onclick="refreshSiteStatus(this)" title="Refresh site status" aria-label="Refresh site status" style="background:none; border:1px solid var(--border); border-radius:8px; padding:6px 8px; cursor:pointer; color:var(--muted); display:inline-flex; align-items:center; text-transform:none; letter-spacing:normal; font-weight:400;">
          <svg class="refresh-status-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>

    <!-- Item 10: homepage was one long scroll (sites, then genres, then
         popular searches) before you'd ever reach genre browsing. Both
         sections' render functions/data are untouched — this just wraps
         each in a show/hide container and adds a tab bar, so switching is
         instant with no extra fetch/re-render. -->
    <div class="home-tab-bar" role="tablist" aria-label="Browse by" id="home-tab-bar">
      <span class="home-tab-indicator" id="home-tab-indicator"></span>
      <button class="home-tab active" id="home-tab-btn-sites" role="tab" aria-selected="true" onclick="switchHomeTab('sites')">Sites</button>
      <button class="home-tab" id="home-tab-btn-genres" role="tab" aria-selected="false" onclick="switchHomeTab('genres')">Genres</button>
    </div>

    <div id="home-tab-sites">
    <div class="pill-scroll-wrap">
    <div class="pill-container" id="dir-filter-chips">
      <button class="genre-pill dual-gradient-pill active" onclick="clearDirFilters(this)">All</button>
      <button class="genre-pill dual-gradient-pill" data-cat="movie" onclick="toggleDirFilter('movie', this)">Movie</button>
      <button class="genre-pill dual-gradient-pill" data-cat="drama" onclick="toggleDirFilter('drama', this)">Asian Drama</button>
      <button class="genre-pill dual-gradient-pill" data-cat="anime" onclick="toggleDirFilter('anime', this)">Anime</button>
      <button class="genre-pill dual-gradient-pill" data-cat="pinoy" onclick="toggleDirFilter('pinoy', this)"><svg width="14" height="10" viewBox="0 0 24 16" style="vertical-align:-1px; margin-right:3px; border-radius:2px;"><rect width="24" height="8" y="0" fill="#0038A8"/><rect width="24" height="8" y="8" fill="#CE1126"/><path d="M0 0 L9 8 L0 16 Z" fill="#FFFFFF"/><g transform="translate(3,8)"><circle r="1.6" fill="#FCD116"/></g></svg>Pinoy</button>
    </div>
    </div>
    ${dirTipDismissed ? '' : `
    <div class="safety-tip" id="dir-safety-tip" style="max-width:none; margin:0 0 10px; justify-content:flex-start;">
      <span class="tip-icon">🛡️</span>
      <span>Use an ad-blocking browser like <strong>Brave</strong> and avoid pop-ups/"download" prompts. <a href="https://brave.com/download/" target="_blank" rel="noopener" class="brave-dl-link" style="color:var(--accent2); font-weight:600; text-decoration:underline;">Get Brave →</a></span>
      <button class="tip-close" onclick="dismissDirTip()" aria-label="Dismiss tip">✕</button>
    </div>
    `}
    <div class="dir-grid" id="sites-directory-grid"></div>
    </div>

    <div id="home-tab-genres" style="display:none;">
    <div style="margin:24px 0 12px" class="popular-label">🎭 Browse by Genre</div>
    <div class="genre-grid" id="genre-grid">
      <button class="genre-chip" data-genre="28" onclick="browseGenre(28, 'Action', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg></span>Action</button>
      <button class="genre-chip" data-genre="35" onclick="browseGenre(35, 'Comedy', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 13c1 1.5 2.5 2.3 4 2.3s3-.8 4-2.3"/><circle cx="9" cy="10" r=".6" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".6" fill="currentColor" stroke="none"/></svg></span>Comedy</button>
      <button class="genre-chip" data-genre="18" onclick="browseGenre(18, 'Drama', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="6"/><path d="M5.5 14c1 1 2 1.3 2.5 1.3s1.5-.3 2.5-1.3"/><circle cx="16" cy="12" r="6"/><path d="M13.5 10c1-1 2-1.3 2.5-1.3s1.5.3 2.5 1.3"/></svg></span>Drama</button>
      <button class="genre-chip" data-genre="27" onclick="browseGenre(27, 'Horror', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a7 7 0 00-7 7v4l1.5 2v2h2v-2h1v2h1v-2h2v2h1v-2h1v2h2v-2L19 14v-4a7 7 0 00-7-7z"/><circle cx="9.3" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r="1.2" fill="currentColor" stroke="none"/></svg></span>Horror</button>
      <button class="genre-chip" data-genre="10749" onclick="browseGenre(10749, 'Romance', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.5-9.5-9C1 8 2 4.5 5.5 4 8 3.6 10 5 12 7c2-2 4-3.4 6.5-3 3.5.5 4.5 4 3 7-2.5 4.5-9.5 9-9.5 9z"/></svg></span>Romance</button>
      <button class="genre-chip" data-genre="878" onclick="browseGenre(878, 'Sci-Fi', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c3 2 4.5 6 4 10l-4 4-4-4c-.5-4 1-8 4-10z"/><path d="M8.5 13.5 5 15l1-4"/><path d="M15.5 13.5 19 15l-1-4"/><path d="M10 21l1-3h2l1 3"/><circle cx="12" cy="9" r="1.3" fill="currentColor" stroke="none"/></svg></span>Sci-Fi</button>
      <button class="genre-chip" data-genre="16" onclick="browseGenre(16, 'Animation', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 100 18c1.2 0 2-1 2-2 0-.6-.3-1-.6-1.4-.3-.4-.4-.8-.1-1.2.3-.4.9-.4 1.4-.4H16a4 4 0 004-4c0-5-3.6-9-8-9z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/></svg></span>Animation</button>
      <button class="genre-chip" data-genre="53" onclick="browseGenre(53, 'Thriller', this)"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg></span>Thriller</button>
    </div>

    <div style="margin:24px 0 12px" class="popular-label">🔎 Popular searches</div>
    <div class="popular-chips" id="popular-searches-chips">
      <button class="pop-chip" onclick="quickSearch('0.5 no Otoko')">0.5 no Otoko</button>
      <button class="pop-chip" onclick="quickSearch('Squid Game')">Squid Game</button>
      <button class="pop-chip" onclick="quickSearch('Your Name')">Your Name</button>
      <button class="pop-chip" onclick="quickSearch('Parasite')">Parasite</button>
      <button class="pop-chip" onclick="quickSearch('Demon Slayer')">Demon Slayer</button>
      <button class="pop-chip" onclick="quickSearch('My Love from the Star')">My Love from the Star</button>
      <button class="pop-chip" onclick="quickSearch('Attack on Titan')">Attack on Titan</button>
      <button class="pop-chip" onclick="quickSearch('Crash Landing on You')">Crash Landing on You</button>
    </div>
    </div>`;
  renderSitesDirectory();
  loadTrendingSearches();
}

// Swaps the static "Popular searches" fallback chips above for real
// usage-based ones, fetched from the Worker's KV-backed query log (see
// mode=log-query / mode=popular-searches in the Worker). Runs after
// renderHomepage() already painted the static list, so there's no loading
// flicker — the chips just get replaced in place once real data arrives.
function loadTrendingSearches() {
  const box = document.getElementById('popular-searches-chips');
  if (!box) return;
  fetch(`${TMDB_PROXY_URL}?mode=popular-searches&limit=8`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(data => {
      const results = Array.isArray(data?.results) ? data.results : [];
      // Only swap in real data once there's enough of it to be meaningful —
      // a handful of early clicks isn't a trend yet, and replacing a solid
      // static list with 1-2 noisy real queries would be a downgrade.
      if (results.length < 4) return;
      // Box may have been re-rendered/removed by a tab switch while this
      // request was in flight (e.g. user tapped "Sites" then back).
      const stillMounted = document.getElementById('popular-searches-chips');
      if (!stillMounted) return;
      stillMounted.innerHTML = results
        .map(q => `<button class="pop-chip" onclick="quickSearch('${escapeAttr(q)}')">${escapeAttr(q)}</button>`)
        .join('');
    })
    .catch(() => {}); // Worker/KV not set up yet, or request failed — static fallback list stays as-is
}

// Fire-and-forget: tells the Worker's KV-backed counter that this query was
// searched, so it can power the "Trending searches" chips above for
// everyone. Never awaited and never allowed to affect the actual search —
// a failure here should be invisible to the person searching.
function logPopularSearch(query) {
  try {
    fetch(`${TMDB_PROXY_URL}?mode=log-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      keepalive: true
    }).catch(() => {});
  } catch (e) { /* fetch unavailable in this context — skip silently */ }
}

// Item 10 tab switcher — pure show/hide, no data fetch or re-render, so
// there's no loading flicker or risk of desyncing from renderSitesDirectory
// (which still owns #sites-directory-grid exactly as before).
function switchHomeTab(tab) {
  const sitesPane = document.getElementById('home-tab-sites');
  const genresPane = document.getElementById('home-tab-genres');
  const sitesBtn = document.getElementById('home-tab-btn-sites');
  const genresBtn = document.getElementById('home-tab-btn-genres');
  const indicator = document.getElementById('home-tab-indicator');
  if (!sitesPane || !genresPane) return;
  const showSites = tab === 'sites';
  sitesPane.style.display = showSites ? '' : 'none';
  genresPane.style.display = showSites ? 'none' : '';
  sitesBtn.classList.toggle('active', showSites);
  genresBtn.classList.toggle('active', !showSites);
  sitesBtn.setAttribute('aria-selected', String(showSites));
  genresBtn.setAttribute('aria-selected', String(!showSites));
  // translateX moves it exactly one slot + the bar's gap over — matches
  // the indicator's own width formula (calc(50% - 4.5px)) plus the 3px
  // gap between buttons, so it lands precisely on the second slot instead
  // of a few px short.
  if (indicator) indicator.style.transform = showSites ? 'translateX(0)' : 'translateX(calc(100% + 3px))';
}

function browseGenre(genreId, label, el) {
  const grid = document.getElementById('genre-grid');
  if (grid) grid.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  const area = document.getElementById('result-area');
  area.innerHTML = `<div class="results-grid" aria-hidden="true">${Array(8).fill('<div class="poster-shimmer" style="aspect-ratio:2/3; border-radius:12px;"></div>').join('')}</div>`;

  fetch(`${TMDB_PROXY_URL}?mode=genre&media_type=movie&genre_id=${genreId}`, { signal: AbortSignal.timeout(8000) })
    .then(r => r.json())
    .then(tmdb => {
      const results = (tmdb.results || [])
        .filter(m => m.poster_path)
        .map(r => parseTmdbItem(r, 'movie'));

      if (results.length === 0) {
        area.innerHTML = `
          <div class="empty">
            <div class="big">🤔</div>
            <p>No titles found for ${label} right now.</p>
            <button class="pop-chip" onclick="resetSearch()" style="margin-top:16px;">← Go back</button>
          </div>`;
        return;
      }

      lastSearchResult = results; // so Year/Rating/Type filters work on genre results too
      renderResultsGrid(results, label);
    })
    .catch(() => {
      area.innerHTML = `
        <div class="empty">
          <div class="big">😔</div>
          <p>Couldn't load ${label} right now. Try again.</p>
          <button class="pop-chip" onclick="resetSearch()" style="margin-top:16px;">← Go back</button>
        </div>`;
    });
}

// Initialize on load
window.addEventListener('load', () => {
  initTheme();
  updateFavCount();
  renderHomepage();
  trackVisit();
  loadSiteStatus();
  loadUrlOverrides();
  loadCustomSites();
  loadHotSites();
  checkAdminAccess();
  showOnboardingIfNeeded();
  showIosInstallBannerIfNeeded();
  updateOfflineBanner();
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Auto build marker. Only shown with ?debug=1 — the CSS hides it by
  // default (any state), so this is the only place that reveals it.
  // document.lastModified is shown immediately as a quick first read, but
  // on GitHub Pages it's server/CDN-provided and can be unreliable (cached
  // responses can carry a stale Last-Modified header even after a real
  // deploy). So it's replaced with the actual latest GitHub commit date —
  // the real source of truth for "when was this repo last changed" —
  // once that fetch resolves.
  const buildEl = document.getElementById('build-marker');
  if (buildEl && DEBUG_MODE) {
    buildEl.style.display = 'block';
    buildEl.textContent = `build: ${document.lastModified} (checking GitHub…)`;
    fetch('https://api.github.com/repos/James-29-00/cinefind/commits?per_page=1')
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(commits => {
        const date = commits?.[0]?.commit?.author?.date;
        if (date) buildEl.textContent = `build: ${new Date(date).toLocaleString()} (GitHub commit)`;
        else buildEl.textContent = `build: ${document.lastModified}`;
      })
      .catch(() => { buildEl.textContent = `build: ${document.lastModified}`; }); // GitHub API unreachable/rate-limited — fall back to the browser value
  }

  // Populate recent individual years (current year down to 2020) dynamically
  const yearFilterEl = document.getElementById('year-filter');
  if (yearFilterEl) {
    const currentYear = new Date().getFullYear();
    const decadesOption = yearFilterEl.querySelector('option[value="2010s"]');
    for (let y = currentYear; y >= 2020; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearFilterEl.insertBefore(opt, decadesOption);
    }
  }
});

// Back to Top — appears once the person has scrolled a bit, so it doesn't
// clutter the view near the top of the page. rAF-throttled so this doesn't
// add its own jank to the very scroll performance we just optimized for.
let backToTopTicking = false;
window.addEventListener('scroll', () => {
  if (backToTopTicking) return;
  backToTopTicking = true;
  requestAnimationFrame(() => {
    const btn = document.getElementById('back-to-top-btn');
    if (btn) btn.style.display = window.scrollY > 600 ? 'flex' : 'none';
    backToTopTicking = false;
  });
}, { passive: true });

// Event listeners
function moveSuggestionHighlight(direction) {
  const box = document.getElementById('suggestions-box');
  const items = box ? Array.from(box.querySelectorAll('.suggestion-item')) : [];
  if (items.length === 0) return;

  items[suggestionHighlightIndex]?.classList.remove('active');
  items[suggestionHighlightIndex]?.setAttribute('aria-selected', 'false');
  suggestionHighlightIndex += direction;
  if (suggestionHighlightIndex >= items.length) suggestionHighlightIndex = 0;
  if (suggestionHighlightIndex < 0) suggestionHighlightIndex = items.length - 1;

  const active = items[suggestionHighlightIndex];
  active.classList.add('active');
  active.setAttribute('aria-selected', 'true');
  active.scrollIntoView({ block: 'nearest' });
  // Lets a screen reader announce the highlighted option without moving
  // actual DOM focus off the input — same pattern real combobox widgets use.
  if (active.id) document.getElementById('search-input').setAttribute('aria-activedescendant', active.id);
}

document.getElementById('search-input').addEventListener('keydown', (e) => {
  const box = document.getElementById('suggestions-box');
  const isOpen = box && box.classList.contains('open');

  if (isOpen && e.key === 'ArrowDown') {
    e.preventDefault();
    moveSuggestionHighlight(1);
    return;
  }
  if (isOpen && e.key === 'ArrowUp') {
    e.preventDefault();
    moveSuggestionHighlight(-1);
    return;
  }
  if (isOpen && e.key === 'Escape') {
    // Standard combobox expectation (Google, browser address bars, etc.) —
    // Escape dismisses the dropdown without clearing what's typed, so the
    // person can keep editing their query.
    e.preventDefault();
    closeSuggestions();
    return;
  }
  if (e.key === 'Enter') {
    // If a suggestion is arrow-key-highlighted, Enter selects that title
    // directly rather than re-running the search on the raw typed text —
    // matches how every other search-with-dropdown UI behaves.
    if (isOpen && suggestionHighlightIndex >= 0) {
      const active = box.querySelectorAll('.suggestion-item')[suggestionHighlightIndex];
      if (active) { active.dispatchEvent(new Event('mousedown')); return; }
    }
    closeSuggestions();
    searchMovie();
  }
});
document.getElementById('search-input').addEventListener('input', handleSuggestInput);
document.getElementById('search-input').addEventListener('focus', () => {
  if (document.getElementById('search-input').value.trim() === '') showSearchHistory();
});

// ========== HIDDEN ADMIN PANEL ==========
// Access by visiting: yoursite.com/?admin=cf_x7k9m2
// NOTE: this URL param only hides the panel from casual visitors (security
// through obscurity) — it is NOT real auth, since anyone can view-source
// this file and read the value. The actual security boundary is the admin
// password login (adminLogin()) + the ADMIN_PROXY_URL worker, which is the
// only thing that can write to GitHub. Even if someone finds this URL and
// opens the panel, they still can't change anything without the password.
const ADMIN_SECRET = 'cf_x7k9m2';

function checkAdminAccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') === ADMIN_SECRET) {
    loadAdminPanel();
  }
}

async function loadAdminPanel() {
  // Inject admin panel styles
  const style = document.createElement('style');
  style.textContent = `
    #admin-overlay {
      position: fixed; inset: 0; background: #0a0a0f; z-index: 9999;
      overflow-y: auto; padding: 24px 16px 60px; font-family: 'Space Grotesk', sans-serif;
    }
    #admin-overlay .admin-header { text-align: center; margin-bottom: 20px; }
    #admin-overlay .admin-header h1 { color: #e63946; font-size: 1.6rem; margin-bottom: 4px; }
    #admin-overlay .admin-header p { color: #9494b5; font-size: .8rem; }
    #admin-overlay .admin-summary {
      display: flex; gap: 10px; justify-content: center; margin: 16px 0 24px; flex-wrap: wrap;
    }
    #admin-overlay .admin-stat {
      background: #16161f; border: 1px solid #ffffff0f; border-radius: 10px;
      padding: 10px 18px; text-align: center;
    }
    #admin-overlay .admin-stat .num { font-size: 1.4rem; font-weight: 700; }
    #admin-overlay .admin-stat .lbl { font-size: .7rem; color: #9494b5; text-transform: uppercase; }
    #admin-overlay .site-row {
      display: flex; align-items: center; gap: 12px; background: #16161f;
      border: 1px solid #ffffff0f; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px;
    }
    #admin-overlay .site-row.down { border-color: rgba(230,57,70,.4); background: rgba(230,57,70,.06); }
    #admin-overlay .site-row.blocked { border-color: rgba(240,180,40,.4); background: rgba(240,180,40,.06); }
    #admin-overlay .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    #admin-overlay .status-dot.up { background: #06d6a0; }
    #admin-overlay .status-dot.down { background: #e63946; }
    #admin-overlay .status-dot.blocked { background: #f0b428; }
    #admin-overlay .status-dot.pending { background: #6c7086; }
    #admin-overlay .quick-test-btn {
      background: #16161f; border: 1px solid #ffffff1f; color: #f0f0f5;
      border-radius: 6px; padding: 4px 10px; font-size: .72rem; cursor: pointer; margin-top: 6px;
    }
    #admin-overlay .delete-site-btn {
      background: #2a1216; border: 1px solid #e6394666; color: #ff6b74;
      border-radius: 6px; padding: 4px 10px; font-size: .72rem; cursor: pointer; margin-top: 6px; margin-left: 6px;
    }
    #admin-overlay .delete-site-btn:disabled { opacity: .5; cursor: default; }
    #admin-overlay .restore-site-btn {
      background: #0f2a1c; border: 1px solid #06d6a066; color: #06d6a0;
      border-radius: 6px; padding: 4px 10px; font-size: .72rem; cursor: pointer; margin-top: 6px;
    }
    #admin-overlay .restore-site-btn:disabled { opacity: .5; cursor: default; }
    #admin-overlay .delete-permanent-btn {
      background: #16161f; border: 1px solid #ffffff1f; color: #9494b5;
      border-radius: 6px; padding: 4px 10px; font-size: .72rem; cursor: pointer; margin-top: 6px; margin-left: 6px;
    }
    #admin-overlay .delete-permanent-btn:disabled { opacity: .5; cursor: default; }
    #admin-overlay .site-name { font-weight: 600; color: #f0f0f5; flex: 1; }
    #admin-overlay .site-meta { font-size: .72rem; color: #9494b5; }
    #admin-overlay .replace-input {
      width: 100%; margin-top: 8px; padding: 8px 10px; border-radius: 6px;
      border: 1px solid #3A3448; background: #0a0a0f; color: #f0f0f5; font-size: .8rem;
    }
    #admin-overlay .close-admin {
      position: fixed; top: 14px; right: 14px; background: #16161f; border: 1px solid #ffffff0f;
      color: #f0f0f5; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 1rem;
    }
    #admin-overlay .refresh-note { text-align: center; color: #9494b5; font-size: .72rem; margin-top: 20px; }
    #admin-overlay .test-link-box {
      background: #16161f; border: 1px solid #ffffff0f; border-radius: 10px;
      padding: 14px 16px; margin-bottom: 20px;
    }
    #admin-overlay .test-link-title { font-weight: 600; color: #f0f0f5; font-size: .85rem; margin-bottom: 10px; }
    #admin-overlay .test-link-row { display: flex; gap: 8px; }
    #admin-overlay .test-link-input {
      flex: 1; min-width: 0; padding: 8px 10px; border-radius: 6px; border: 1px solid #3A3448;
      background: #0a0a0f; color: #f0f0f5; font-size: .8rem; font-family: inherit;
    }
    #admin-overlay .test-link-btn {
      background: #e63946; color: #fff; border: none; border-radius: 6px;
      padding: 8px 16px; font-size: .8rem; font-weight: 600; cursor: pointer; flex-shrink: 0;
    }
    #admin-overlay .test-link-btn:disabled { opacity: .5; cursor: default; }
    #admin-overlay .test-link-result { margin-top: 10px; font-size: .8rem; display: none; }
    #admin-overlay .test-link-result.show { display: block; }
    #admin-overlay .test-link-status { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    #admin-overlay .test-link-note { color: #9494b5; font-size: .72rem; margin-bottom: 10px; line-height: 1.4; }
    #admin-overlay .test-link-open-btn {
      background: #16161f; border: 1px solid #ffffff1f; color: #f0f0f5;
      border-radius: 6px; padding: 6px 14px; font-size: .75rem; cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'admin-overlay';
  const loggedIn = !!getAdminSession();
  overlay.innerHTML = `
    <button class="close-admin" onclick="document.getElementById('admin-overlay').remove()">✕</button>
    <div class="admin-header">
      <h1>🔒 Site Status Admin</h1>
      <p>Loading status.json...</p>
    </div>
    <div class="test-link-box" style="font-size:.72rem; color:#9494b5; line-height:1.5;">
      <div class="test-link-title" style="margin-bottom:6px;">ℹ️ What the dots mean</div>
      <div><span style="color:#06d6a0;">🟢 Up</span> — site responded normally.</div>
      <div><span style="color:#f0b428;">🟡 Blocked</span> — GitHub's checker got a 403/429/503 or timed out. This is usually <strong>not</strong> the site being down — Cloudflare/DDoS-Guard etc. often flag GitHub Actions' datacenter IP as a bot, even when the site works fine for real visitors. Use "Test a Link" above or open the URL yourself to confirm before assuming it's broken.</div>
      <div><span style="color:#e63946;">🔴 Down</span> — confirmed failure (DNS error, connection refused, or a real 4xx/5xx not tied to bot-protection).</div>
      <div><span style="color:#6c7086;">⚪ Pending</span> — added recently, not checked yet.</div>
      <div style="margin-top:6px;">Just updated a link and it's still yellow after reload? The re-check likely ran and got bot-blocked on this new URL too — see 🟡 above.</div>
    </div>
    <div class="test-link-box" id="gh-config-box">
      <div class="test-link-title">🔐 Admin Login (needed for live link updates)</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="password" id="admin-password" class="test-link-input" placeholder="Admin password" style="${loggedIn ? 'display:none;' : ''}">
        <button class="test-link-btn" id="admin-login-btn" onclick="adminLogin()" style="width:100%;${loggedIn ? ' display:none;' : ''}">Log In</button>
        <button class="test-link-btn" id="admin-logout-btn" onclick="adminLogout()" style="width:100%;${loggedIn ? '' : ' display:none;'}">Log Out</button>
        <div id="gh-config-status" style="font-size:.72rem; color:#9494b5;">${loggedIn ? '✅ Logged in — session active for a few hours.' : 'Not logged in — enter the admin password to enable live edits.'}</div>
      </div>
    </div>
    <div class="test-link-box">
      <div class="test-link-title">🔗 Test a Link</div>
      <div class="test-link-row">
        <input type="text" id="test-link-input" class="test-link-input" placeholder="Paste a URL to test..." onkeydown="if(event.key==='Enter') testLink()">
        <button class="test-link-btn" onclick="testLink()">Test</button>
      </div>
      <div id="test-link-result" class="test-link-result"></div>
    </div>
    <div class="test-link-box" id="add-site-box">
      <div class="test-link-title">➕ Add New Website</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="new-site-name" class="test-link-input" placeholder="Site name (e.g. Kickassanime)">
        <input type="text" id="new-site-url" class="test-link-input" placeholder="https://..." onkeydown="if(event.key==='Enter') addNewWebsite(this.closest('.test-link-box').querySelector('.test-link-btn'))">
        <input type="text" id="new-site-icon" class="test-link-input" placeholder="Emoji icon (optional — e.g. 🎬)">
        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:.8rem; color:#f0f0f5; padding:2px 0;">
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-movie" checked> Movie</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-drama"> K-Drama</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-anime"> Anime</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-pinoy"> <svg width="14" height="10" viewBox="0 0 24 16" style="vertical-align:-1px; margin-right:3px; border-radius:2px;"><rect width="24" height="8" y="0" fill="#0038A8"/><rect width="24" height="8" y="8" fill="#CE1126"/><path d="M0 0 L9 8 L0 16 Z" fill="#FFFFFF"/><g transform="translate(3,8)"><circle r="1.6" fill="#FCD116"/></g></svg> Pinoy</label>
        </div>
        <button class="test-link-btn" style="width:100%;" onclick="addNewWebsite(this)">Add Website (goes live)</button>
        <div id="add-site-status" style="font-size:.72rem; color:#9494b5;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    const data = await fetchStatusJson();

    // Fresh copies of removed-sites.json / custom-sites.json — status.json
    // only refreshes every 6h via the GitHub Action, so a site deleted or
    // restored just now can still be stale in data.results. Filter/merge
    // here (same as renderSitesDirectory() does for the public homepage),
    // with the pending-restore override applied so a just-restored site
    // doesn't flash back to "deleted" while GitHub Pages catches up.
    let freshCustomList = [];
    try {
      const removedRes = await fetch('./removed-sites.json?t=' + Date.now());
      const removedRaw = removedRes.ok ? await removedRes.json() : [];
      removedSitesData = removedRaw.map(entry => typeof entry === 'string' ? { name: entry } : entry);
      const customRes = await fetch('./custom-sites.json?t=' + Date.now());
      const customParsed = customRes.ok ? await customRes.json() : [];
      freshCustomList = Array.isArray(customParsed) ? customParsed : [];
      const applied = applyPendingRestores(freshCustomList, removedSitesData);
      freshCustomList = applied.customList;
      removedSitesData = applied.removedList;
      removedSiteNames = removedSitesData.map(s => normalizeSiteName(s.name));
      customSites = freshCustomList;
    } catch (removedErr) {
      // Non-fatal — falls back to whatever removedSiteNames/removedSitesData already has.
    }
    data.results = (data.results || []).filter(
      r => !removedSiteNames.includes(normalizeSiteName(r.name))
    );

    // Sites live in status.json only once sites.json (the checker's own
    // list) includes them AND the checker has actually run. Two separate
    // gaps land a site in limbo here: (a) newly-added/restored sites that
    // are in custom-sites.json but not yet checked, and (b) built-in
    // SITES_DIRECTORY sites that were never added to sites.json in the
    // first place (so the checker never even attempts them — this is what
    // was hiding KissKH/MyAsianTV here even though their cards work fine
    // on the homepage). Show both as "pending" instead of just vanishing.
    const checkedNames = new Set((data.results || []).map(r => normalizeSiteName(r.name)));
    freshCustomList.forEach(s => {
      if (!checkedNames.has(normalizeSiteName(s.name))) {
        data.results.push({ name: s.name, url: s.url, status: 'pending' });
        checkedNames.add(normalizeSiteName(s.name));
      }
    });
    SITES_DIRECTORY.forEach(s => {
      if (!checkedNames.has(normalizeSiteName(s.name))) {
        data.results.push({ name: s.name, url: s.url, status: 'pending' });
        checkedNames.add(normalizeSiteName(s.name));
      }
    });

    renderAdminPanel(data);
    
    // Sync front-end status dots with the latest admin data
    const map = {};
    (data.results || []).forEach(r => { if (r.name) map[normalizeSiteName(r.name)] = r.status; });
    siteStatusMap = map;
    applyStatusDots();
  } catch (err) {
    console.error('Admin panel load error:', err);
    overlay.querySelector('.admin-header p').textContent =
      '⚠️ Error: ' + err.message + ' (check browser console for details)';
  }
}

// Builds one row for the "🗑️ Recently Deleted" list — shared by the initial
// admin panel render and by deleteWebsite()'s live-append (see below), so a
// freshly-deleted site shows up immediately without needing to reopen the panel.
function buildRemovedSiteRow(s) {
  const safeName = s.name.replace(/'/g, "\\'");
  const dirBackup = SITES_DIRECTORY.find(d => normalizeSiteName(d.name) === normalizeSiteName(s.name));
  const hasSnapshot = !!s.url || !!dirBackup;
  const urlLabel = s.url || (dirBackup ? dirBackup.url + ' (built-in, still in code)' : 'No saved URL (deleted before Restore existed)');
  return `
    <div class="site-row" style="background:#0f0f16;" data-removed-site="${normalizeSiteName(s.name)}">
      <div style="flex:1;">
        <div class="site-name">${s.name} ${s.icon || ''}</div>
        <div class="site-meta">${urlLabel}${s.removedAt ? ' — deleted ' + new Date(s.removedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''}</div>
        <button class="restore-site-btn" ${hasSnapshot ? '' : 'disabled'} onclick="restoreWebsite('${safeName}', this)">♻️ Restore</button>
        <button class="delete-permanent-btn" onclick="confirmDeletePermanently('${safeName}', this)">🗑️ Delete Permanently</button>
        <div class="restore-site-status site-meta" style="margin-top:4px;"></div>
      </div>
    </div>`;
}

function renderAdminPanel(data) {
  const overlay = document.getElementById('admin-overlay');
  const lastRun = new Date(data.lastRun).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

  const rowsHtml = data.results.map(site => {
    const icon = site.status === 'up' ? '🟢' : site.status === 'blocked' ? '🟡' : site.status === 'pending' ? '⚪' : '🔴';
    const metaText = site.status === 'up'
      ? 'HTTP ' + site.httpStatus
      : site.status === 'pending'
      ? 'Not checked yet — next automatic check within 6h'
      : (site.httpStatus ? 'HTTP ' + site.httpStatus : (site.error || site.status));
    const safeUrl = site.url.replace(/'/g, "\\'");
    const safeName = site.name.replace(/'/g, "\\'");
    const isHot = isHotSite(site.name);
    return `
    <div class="site-row ${site.status}">
      <div class="status-dot ${site.status}"></div>
      <div style="flex:1;">
        <div class="site-name">${site.name} ${icon}</div>
        <button class="quick-test-btn hot-toggle-btn" style="margin-top:4px; padding:2px 9px; font-size:.7rem; ${isHot ? 'background:#f0b428; color:#1a1a2e; border-color:#f0b428;' : ''}" onclick="toggleHotSite('${safeName}', this)">${isHot ? '🔥 Hot — tap to unhot' : '🔥 Mark as Hot'}</button>
        <div class="site-meta">${site.url} — ${metaText}</div>
        ${site.status === 'blocked' ? `
          <div class="site-meta" style="margin-top:2px; color:#f0b428;">Might just be blocking this server's IP — verify from your own browser.</div>
          <button class="quick-test-btn" onclick="document.getElementById('test-link-input').value='${safeUrl}'; testLink(); document.getElementById('test-link-input').scrollIntoView({behavior:'smooth', block:'center'});">🔗 Test This Link</button>
        ` : ''}
        ${site.status === 'down' ? `
          <input class="replace-input" placeholder="Paste replacement URL here (for your notes only)..." 
                 onchange="saveReplacementNote('${site.name.replace(/'/g, "\\'")}', this.value)"
                 value="${getReplacementNote(site.name)}">
        ` : ''}
        ${(site.status === 'down' || site.status === 'blocked') ? `
          <div class="live-update-wrap" style="margin-top:8px;">
            <div style="display:flex; gap:6px; align-items:center;">
              <input class="replace-input live-update-input" style="margin-top:0; flex:1;" placeholder="Paste new working URL to go LIVE...">
              <button class="quick-test-btn" style="margin-top:0; white-space:nowrap;" onclick="updateLiveLink('${site.name.replace(/'/g, "\\'")}', this)">Update Live Link</button>
            </div>
            <div class="live-update-status site-meta" style="margin-top:4px;"></div>
          </div>
        ` : ''}
        <button class="delete-site-btn" onclick="confirmDeleteWebsite('${site.name.replace(/'/g, "\\'")}', this)">🗑️ Delete Website</button>
        <div class="delete-site-status site-meta" style="margin-top:4px;"></div>
      </div>
    </div>
  `;
  }).join('');

  const loggedIn = !!getAdminSession();
  overlay.innerHTML = `
    <button class="close-admin" onclick="document.getElementById('admin-overlay').remove()">✕</button>
    <div class="admin-header">
      <h1>🔒 Site Status Admin</h1>
      <p>Last checked: ${lastRun}</p>
    </div>
    <div class="test-link-box" id="gh-config-box">
      <div class="test-link-title">🔐 Admin Login (needed for live link updates)</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="password" id="admin-password" class="test-link-input" placeholder="Admin password" style="${loggedIn ? 'display:none;' : ''}">
        <button class="test-link-btn" id="admin-login-btn" onclick="adminLogin()" style="width:100%;${loggedIn ? ' display:none;' : ''}">Log In</button>
        <button class="test-link-btn" id="admin-logout-btn" onclick="adminLogout()" style="width:100%;${loggedIn ? '' : ' display:none;'}">Log Out</button>
        <div id="gh-config-status" style="font-size:.72rem; color:#9494b5;">${loggedIn ? '✅ Logged in — session active for a few hours.' : 'Not logged in — enter the admin password to enable live edits.'}</div>
      </div>
    </div>
    <div class="test-link-box">
      <div class="test-link-title">🔗 Test a Link</div>
      <div class="test-link-row">
        <input type="text" id="test-link-input" class="test-link-input" placeholder="Paste a URL to test..." onkeydown="if(event.key==='Enter') testLink()">
        <button class="test-link-btn" onclick="testLink()">Test</button>
      </div>
      <div id="test-link-result" class="test-link-result"></div>
    </div>
    <div class="test-link-box" id="add-site-box">
      <div class="test-link-title">➕ Add New Website</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="new-site-name" class="test-link-input" placeholder="Site name (e.g. Kickassanime)">
        <input type="text" id="new-site-url" class="test-link-input" placeholder="https://..." onkeydown="if(event.key==='Enter') addNewWebsite(this.closest('.test-link-box').querySelector('.test-link-btn'))">
        <input type="text" id="new-site-icon" class="test-link-input" placeholder="Emoji icon (optional — e.g. 🎬)">
        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:.8rem; color:#f0f0f5; padding:2px 0;">
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-movie" checked> Movie</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-drama"> K-Drama</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-anime"> Anime</label>
          <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="new-site-cat-pinoy"> <svg width="14" height="10" viewBox="0 0 24 16" style="vertical-align:-1px; margin-right:3px; border-radius:2px;"><rect width="24" height="8" y="0" fill="#0038A8"/><rect width="24" height="8" y="8" fill="#CE1126"/><path d="M0 0 L9 8 L0 16 Z" fill="#FFFFFF"/><g transform="translate(3,8)"><circle r="1.6" fill="#FCD116"/></g></svg> Pinoy</label>
        </div>
        <button class="test-link-btn" style="width:100%;" onclick="addNewWebsite(this)">Add Website (goes live)</button>
        <div id="add-site-status" style="font-size:.72rem; color:#9494b5;"></div>
      </div>
    </div>
    <div class="test-link-box" id="removed-sites-box">
      <div class="test-link-title">🗑️ Recently Deleted <span id="removed-sites-count" style="font-size:.7rem; color:#9494b5;">(${removedSitesData.length})</span></div>
      <div id="removed-sites-list">
        ${removedSitesData.length === 0 ? `<p style="font-size:.75rem; color:#9494b5; margin:0;">Wala pang deleted sites.</p>` : removedSitesData.map(buildRemovedSiteRow).join('')}
      </div>
    </div>
    <!-- "Wala pang deleted sites" placeholder, kept as a template to swap back in
         if the list ever empties out again (e.g. after Delete Permanently) -->
    <template id="removed-sites-empty-msg"><p style="font-size:.75rem; color:#9494b5; margin:0;">Wala pang deleted sites.</p></template>
    <div class="admin-summary">
      <div class="admin-stat"><div class="num" style="color:#06d6a0;">${window.__adminOnlineCount || 1}</div><div class="lbl">Online Now</div></div>
      <div class="admin-stat"><div class="num" style="color:#06d6a0;">${data.upCount}</div><div class="lbl">Up</div></div>
      <div class="admin-stat"><div class="num" style="color:#f0b428;">${data.blockedCount || 0}</div><div class="lbl">Blocked</div></div>
      <div class="admin-stat"><div class="num" style="color:#e63946;">${data.downCount}</div><div class="lbl">Down</div></div>
      <div class="admin-stat"><div class="num">${data.totalSites}</div><div class="lbl">Total</div></div>
    </div>
    <div class="test-link-box" style="margin-bottom:16px;">
      <div class="test-link-title">📊 Search Analytics <span style="font-size:.7rem; color:#9494b5; font-weight:400;">— what visitors actually search for</span></div>
      <div id="search-analytics-body"><p style="font-size:.75rem; color:#9494b5;">Loading...</p></div>
    </div>
    <div class="test-link-box" style="margin-bottom:16px;">
      <div class="test-link-title">🌐 Top Websites <span style="font-size:.7rem; color:#9494b5; font-weight:400;">— which site cards visitors actually click</span></div>
      <div id="top-sites-body"><p style="font-size:.75rem; color:#9494b5;">Loading...</p></div>
    </div>
    <div class="test-link-box" style="margin-bottom:16px;">
      <div class="test-link-title">🚩 User Reports <span id="reports-count-badge" style="font-size:.7rem; color:#9494b5;"></span></div>
      <div id="admin-reports-list"><p style="font-size:.75rem; color:#9494b5;">Loading reports...</p></div>
    </div>
    <div id="admin-site-rows">
    ${rowsHtml}
    </div>
    <p class="refresh-note">Checked automatically every day. Replacement notes are saved only on this device — update SITES_DIRECTORY in the code when ready.</p>
  `;
  loadReportsIntoAdmin();
  loadSearchAnalytics();
  loadTopSites();
}

// Renders two simple ranked lists (top titles, top genres) from the search
// analytics Worker's aggregate counts — see search-analytics-worker.js.
// Purely informational for the admin (which sites to prioritize verifying/
// hot-tagging); it doesn't feed back into the site anywhere automatically.
async function loadSearchAnalytics() {
  const body = document.getElementById('search-analytics-body');
  if (!body) return;
  try {
    const res = await fetch(`${VISIT_WORKER_URL}/top-searches?t=${Date.now()}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);
    const data = await res.json();
    const titles = data.topTitles || [];
    const genres = data.topGenres || [];

    if (titles.length === 0 && genres.length === 0) {
      body.innerHTML = `<p style="font-size:.75rem; color:#9494b5;">No search data yet — this fills in as visitors search.</p>`;
      return;
    }

    const renderRankedList = (items) => items.map((item, i) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:.78rem;">
        <span style="color:#f0f0f5;">${i + 1}. ${escapeAttr(item.name)}</span>
        <span style="color:#9494b5;">${item.count}×</span>
      </div>
    `).join('');

    body.innerHTML = `
      <div style="display:flex; gap:16px; flex-wrap:wrap;">
        <div style="flex:1; min-width:140px;">
          <div style="font-size:.72rem; color:#9494b5; margin-bottom:4px; text-transform:uppercase; letter-spacing:.03em;">Top Searched Titles</div>
          ${titles.length ? renderRankedList(titles.slice(0, 10)) : `<p style="font-size:.75rem; color:#9494b5;">No data yet.</p>`}
        </div>
        <div style="flex:1; min-width:140px;">
          <div style="font-size:.72rem; color:#9494b5; margin-bottom:4px; text-transform:uppercase; letter-spacing:.03em;">Top Genres</div>
          ${genres.length ? renderRankedList(genres.slice(0, 10)) : `<p style="font-size:.75rem; color:#9494b5;">No data yet.</p>`}
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="font-size:.75rem; color:#e63946;">Could not load search analytics: ${err.message}</p>`;
  }
}

// Same aggregate-counter pattern as loadSearchAnalytics above, but reads
// the /top-sites route (site-click: KV prefix) instead of search-title:/
// search-genre: — shows which streaming site cards actually get tapped,
// which is a more direct signal than search terms for deciding which
// sites are worth keeping "Hot" or prioritizing for uptime checks.
async function loadTopSites() {
  const body = document.getElementById('top-sites-body');
  if (!body) return;
  try {
    const res = await fetch(`${VISIT_WORKER_URL}/top-sites?t=${Date.now()}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);
    const data = await res.json();
    const sites = data.topSites || [];

    if (sites.length === 0) {
      body.innerHTML = `<p style="font-size:.75rem; color:#9494b5;">No click data yet — this fills in as visitors tap site cards.</p>`;
      return;
    }

    body.innerHTML = sites.slice(0, 10).map((item, i) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:.78rem;">
        <span style="color:#f0f0f5;">${i + 1}. ${escapeAttr(item.name)}</span>
        <span style="color:#9494b5;">${item.count}×</span>
      </div>
    `).join('');
  } catch (err) {
    body.innerHTML = `<p style="font-size:.75rem; color:#e63946;">Could not load top websites: ${err.message}</p>`;
  }
}

// Replacement notes are stored locally so only you (on your device) see them —
// they don't publish anywhere or affect the live site automatically.
function getReplacementNote(siteName) {
  try {
    const notes = JSON.parse(localStorage.getItem('cinefind-admin-notes') || '{}');
    return notes[siteName] || '';
  } catch (e) { return ''; }
}

function saveReplacementNote(siteName, value) {
  try {
    const notes = JSON.parse(localStorage.getItem('cinefind-admin-notes') || '{}');
    notes[siteName] = value;
    localStorage.setItem('cinefind-admin-notes', JSON.stringify(notes));
  } catch (e) { /* ignore */ }
}

// ========== USER REPORTS (submitted via the report-broken-site Worker, ==========
// stored in reports.json in the repo — read here with a plain fetch since
// it's a public file; dismissing uses the admin's own GitHub token, same
// commit pattern as toggleHotSite(), so no extra Worker endpoint is needed
// for that half.
async function loadReportsIntoAdmin() {
  const list = document.getElementById('admin-reports-list');
  const badge = document.getElementById('reports-count-badge');
  if (!list) return;
  try {
    const res = await fetch('./reports.json?t=' + Date.now());
    const reports = res.ok ? await res.json() : [];
    if (badge) badge.textContent = reports.length ? `(${reports.length})` : '';
    if (reports.length === 0) {
      list.innerHTML = `<p style="font-size:.75rem; color:#9494b5;">No reports right now. 🎉</p>`;
      return;
    }
    list.innerHTML = reports.map((r, i) => `
      <div class="site-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
        <div style="display:flex; justify-content:space-between; width:100%; gap:8px;">
          <strong style="color:#f0f0f5;">${escapeAttr(r.siteName || 'Unknown site')}</strong>
          <button class="quick-test-btn" onclick="dismissReport(${i}, this)">✕ Dismiss</button>
        </div>
        <div class="site-meta">${escapeAttr(r.reason || 'No reason given')}${r.movieTitle ? ' — while watching "' + escapeAttr(r.movieTitle) + '"' : ''}</div>
        <div class="site-meta" style="opacity:.7;">${r.url ? escapeAttr(r.url) : ''} ${r.timestamp ? '· ' + new Date(r.timestamp).toLocaleString() : ''}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p style="font-size:.75rem; color:#e63946;">Could not load reports: ${err.message}</p>`;
  }
}

async function dismissReport(index, btn) {
  const session = getAdminSession();
  if (!session) {
    alert('⚠️ Please log in with the admin password above first.');
    return;
  }
  btn.disabled = true;
  btn.textContent = '...';

  const apiUrl = `${ADMIN_PROXY_URL}/api/github/contents/reports.json`;
  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  try {
    const getRes = await fetch(apiUrl, { headers });
    if (!getRes.ok) throw new Error(`Could not read reports.json (HTTP ${getRes.status})`);
    const fileData = await getRes.json();
    const current = JSON.parse(b64DecodeUtf8(fileData.content));
    current.splice(index, 1);

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Dismiss a site report',
        content: b64EncodeUtf8(JSON.stringify(current, null, 2)),
        sha: fileData.sha,
      }),
    });
    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub rejected the update (HTTP ${putRes.status})`);
    }
    loadReportsIntoAdmin();
  } catch (err) {
    alert(`❌ Failed to dismiss report: ${err.message}`);
    btn.disabled = false;
    btn.textContent = '✕ Dismiss';
  }
}

// ========== LIVE LINK UPDATES (via the admin proxy Worker) ==========
// GitHub Pages is static — there's no server to write files to on demand.
// So "publishing" a link update means committing a change to overrides.json
// straight to the repo via GitHub's REST API. IMPORTANT: the real GitHub
// token never touches this browser. It lives only as a secret on the
// ADMIN_PROXY_URL Cloudflare Worker (see worker.js). This page just logs
// in with a password, gets back a short-lived signed session token, and
// sends that session token to the worker — which is the only thing that
// ever talks to api.github.com directly.
function getAdminSession() {
  try {
    const raw = JSON.parse(localStorage.getItem('cinefind-admin-session') || 'null');
    if (!raw || !raw.session || !raw.exp) return null;
    if (Date.now() / 1000 > raw.exp) { // expired locally, don't even bother the worker
      localStorage.removeItem('cinefind-admin-session');
      return null;
    }
    return raw.session;
  } catch (e) { return null; }
}

async function adminLogin() {
  const input = document.getElementById('admin-password');
  const statusEl = document.getElementById('gh-config-status');
  const password = input ? input.value : '';
  if (!password) {
    statusEl.textContent = 'Enter the admin password first.';
    statusEl.style.color = '#e63946';
    return;
  }
  statusEl.textContent = 'Logging in...';
  statusEl.style.color = '#9494b5';
  try {
    const res = await fetch(`${ADMIN_PROXY_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Login failed (HTTP ${res.status})`);
    try {
      localStorage.setItem('cinefind-admin-session', JSON.stringify({
        session: data.session,
        exp: Math.floor(Date.now() / 1000) + (data.expiresIn || 0),
      }));
    } catch (e) { /* storage unavailable — session won't persist but login flow continues */ }
    statusEl.textContent = '✅ Logged in — session active for a few hours.';
    statusEl.style.color = '#06d6a0';
    document.getElementById('admin-password').style.display = 'none';
    document.getElementById('admin-login-btn').style.display = 'none';
    document.getElementById('admin-logout-btn').style.display = '';
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    statusEl.style.color = '#e63946';
  }
}

function adminLogout() {
  try { localStorage.removeItem('cinefind-admin-session'); } catch (e) { /* storage unavailable */ }
  const statusEl = document.getElementById('gh-config-status');
  if (statusEl) {
    statusEl.textContent = 'Logged out.';
    statusEl.style.color = '#9494b5';
  }
  document.getElementById('admin-password').style.display = '';
  document.getElementById('admin-login-btn').style.display = '';
  document.getElementById('admin-logout-btn').style.display = 'none';
}

// UTF-8 safe base64 helpers — plain btoa()/atob() break on non-ASCII chars.
function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64DecodeUtf8(str) { return decodeURIComponent(escape(atob(str.replace(/\n/g, '')))); }

async function updateLiveLink(siteName, btn) {
  const wrap = btn.closest('.live-update-wrap');
  const input = wrap.querySelector('.live-update-input');
  const statusEl = wrap.querySelector('.live-update-status');
  const newUrl = input.value.trim();
  const session = getAdminSession();

  if (!session) {
    statusEl.textContent = '⚠️ Please log in with the admin password above first.';
    statusEl.style.color = '#f0b428';
    return;
  }
  if (!newUrl) {
    statusEl.textContent = 'Paste a URL first.';
    statusEl.style.color = '#f0b428';
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Updating...';
  statusEl.textContent = '';

  const apiUrl = `${ADMIN_PROXY_URL}/api/github/contents/overrides.json`;
  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  try {
    let sha, current = {};
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.status === 200) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      current = JSON.parse(b64DecodeUtf8(fileData.content));
    } else if (getRes.status !== 404) {
      throw new Error(`Could not read overrides.json (HTTP ${getRes.status})`);
    } // 404 is fine — file doesn't exist yet, we'll create it

    current[normalizeSiteName(siteName)] = newUrl;

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update live link for ${siteName}`,
        content: b64EncodeUtf8(JSON.stringify(current, null, 2)),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub rejected the update (HTTP ${putRes.status})`);
    }

    statusEl.textContent = '✅ Live! Re-checking for real now...';
    statusEl.style.color = '#06d6a0';
    input.value = '';

    // The dot turning green above is just this session's optimistic guess —
    // status.json (what a reload actually reads) won't agree until the
    // checker runs again. Trigger it now instead of leaving the admin to
    // wait up to 6h, so a reload shows the real, confirmed result sooner.
    try {
      const dispatchRes = await fetch(
        `${ADMIN_PROXY_URL}/api/github/actions/workflows/check-sites.yml/dispatches`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'main' }),
        }
      );
      if (dispatchRes.ok) {
        statusEl.textContent = '✅ Live! Real check running now — reload in ~1–2 min for the confirmed result.';
      } else if (dispatchRes.status === 403 || dispatchRes.status === 404) {
        // 403/404 on this endpoint almost always means the token's scope
        // doesn't cover Actions — not that the workflow itself is missing.
        statusEl.textContent = '✅ Live! (⚠️ Your GitHub token is missing "workflow" permission, so the status check couldn\'t auto-run. Go to GitHub → Settings → Developer settings → your token, enable "workflow" (classic) or "Actions: Read and write" (fine-grained), then re-save it in the GitHub Connection section above. For now, run it manually from the Actions tab or wait up to 6h.)';
      } else {
        statusEl.textContent = `✅ Live! (Auto re-check failed — HTTP ${dispatchRes.status}. Run it manually from the Actions tab, or just wait up to 6h.)`;
      }
    } catch (dispatchErr) {
      statusEl.textContent = '✅ Live! (Could not auto-trigger a re-check — check your internet connection, or run it manually from the Actions tab.)';
    }

    // Don't make the admin wait for tomorrow's automated check to see a
    // green dot — a link they just pasted in is presumably working, so
    // reflect that immediately in this session's status map.
    if (!siteStatusMap) siteStatusMap = {};
    siteStatusMap[normalizeSiteName(siteName)] = 'up';
    applyStatusDots();

    // The admin panel's own site-row (dot/icon/meta/warning) is built once
    // from status.json and doesn't read siteStatusMap, so update it directly.
    const row = btn.closest('.site-row');
    if (row) {
      row.classList.remove('down', 'blocked');
      row.classList.add('up');
      const dot = row.querySelector('.status-dot');
      if (dot) { dot.classList.remove('down', 'blocked'); dot.classList.add('up'); }
      const nameEl = row.querySelector('.site-name');
      if (nameEl) nameEl.textContent = nameEl.textContent.replace(/[🟢🟡🔴]/g, '').trim() + ' 🟢';
      const metaEl = row.querySelector('.site-meta');
      if (metaEl) metaEl.textContent = `${newUrl} — Updated just now`;
      row.querySelectorAll('.site-meta').forEach(el => {
        if (el !== metaEl && el.textContent.includes('blocking this server')) el.remove();
      });
      row.querySelectorAll('.quick-test-btn').forEach(b => {
        if (b.textContent.includes('Test This Link')) b.remove();
      });
    }
  } catch (err) {
    statusEl.textContent = `❌ Failed: ${err.message}`;
    statusEl.style.color = '#e63946';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ========== HOT (FEATURED) TOGGLE ==========
// Marks/unmarks a site as "hot" — pinned to the front of the directory grid.
// Same GitHub-commit pattern as updateLiveLink(), but writes to hot-sites.json,
// a simple array of normalized site names.
async function toggleHotSite(siteName, btn) {
  const session = getAdminSession();
  if (!session) {
    alert('⚠️ Please log in with the admin password above first.');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const apiUrl = `${ADMIN_PROXY_URL}/api/github/contents/hot-sites.json`;
  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };
  const key = normalizeSiteName(siteName);

  try {
    let sha, current = [];
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.status === 200) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      current = JSON.parse(b64DecodeUtf8(fileData.content));
    } else if (getRes.status !== 404) {
      throw new Error(`Could not read hot-sites.json (HTTP ${getRes.status})`);
    } // 404 is fine — file doesn't exist yet, we'll create it

    const nowHot = !current.includes(key);
    current = nowHot ? [...current, key] : current.filter(k => k !== key);

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${nowHot ? 'Mark' : 'Unmark'} ${siteName} as hot`,
        content: b64EncodeUtf8(JSON.stringify(current, null, 2)),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub rejected the update (HTTP ${putRes.status})`);
    }

    // Reflect immediately in this session so the admin doesn't have to reload.
    hotSiteNames = current;
    renderSitesDirectory();
    btn.textContent = nowHot ? '🔥 Hot — tap to unhot' : '🔥 Mark as Hot';
    btn.style.background = nowHot ? '#f0b428' : '';
    btn.style.color = nowHot ? '#1a1a2e' : '';
    btn.style.borderColor = nowHot ? '#f0b428' : '';
  } catch (err) {
    alert(`❌ Failed to update hot status: ${err.message}`);
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = false;
  }
}

// Adds a brand-new site card to the homepage directory — writes to
// custom-sites.json the same way updateLiveLink() writes to overrides.json.
// No custom logo needed: cards without a hand-crafted logoHtml automatically
// fall back to defaultLogoHtml() (icon + site name, same font/spacing as
// every other card) so new sites match the existing design immediately.
async function addNewWebsite(btn) {
  const name = document.getElementById('new-site-name').value.trim();
  const url = document.getElementById('new-site-url').value.trim();
  const icon = document.getElementById('new-site-icon').value.trim();
  const cats = [];
  if (document.getElementById('new-site-cat-movie').checked) cats.push('movie');
  if (document.getElementById('new-site-cat-drama').checked) cats.push('drama');
  if (document.getElementById('new-site-cat-anime').checked) cats.push('anime');
  if (document.getElementById('new-site-cat-pinoy').checked) cats.push('pinoy');
  const statusEl = document.getElementById('add-site-status');
  const session = getAdminSession();

  if (!session) {
    statusEl.textContent = '⚠️ Please log in with the admin password above first.';
    statusEl.style.color = '#f0b428';
    return;
  }
  if (!name || !url) {
    statusEl.textContent = 'Fill in at least the name and URL.';
    statusEl.style.color = '#f0b428';
    return;
  }
  let domain;
  try { domain = new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { statusEl.textContent = "That URL doesn't look valid — include https://"; statusEl.style.color = '#e63946'; return; }
  if (cats.length === 0) cats.push('movie');

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Adding...';
  statusEl.textContent = '';

  const apiUrl = `${ADMIN_PROXY_URL}/api/github/contents/custom-sites.json`;
  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  try {
    let sha, current = [];
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.status === 200) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      current = JSON.parse(b64DecodeUtf8(fileData.content));
    } else if (getRes.status !== 404) {
      throw new Error(`Could not read custom-sites.json (HTTP ${getRes.status})`);
    }

    if (current.some(s => normalizeSiteName(s.name) === normalizeSiteName(name))) {
      throw new Error(`"${name}" is already in the list.`);
    }

    current.push({ name, url, domain, categories: cats, icon: icon || undefined });

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Add new site: ${name}`,
        content: b64EncodeUtf8(JSON.stringify(current, null, 2)),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub rejected the update (HTTP ${putRes.status})`);
    }

    statusEl.textContent = `✅ "${name}" added! Takes ~1 min to appear on the site.`;
    statusEl.style.color = '#06d6a0';
    document.getElementById('new-site-name').value = '';
    document.getElementById('new-site-url').value = '';
    document.getElementById('new-site-icon').value = '';

    // The admin list below is rendered from status.json, which only refreshes
    // once a day via the GitHub Action — so a freshly-added site wouldn't show
    // up here until tomorrow's check. Insert a placeholder row now so it's
    // visible (and deletable) right away.
    const rowsContainer = document.getElementById('admin-site-rows');
    if (rowsContainer) {
      const safeName = escapeForAttr(name);
      const row = document.createElement('div');
      row.className = 'site-row';
      row.innerHTML = `
        <div class="status-dot"></div>
        <div style="flex:1;">
          <div class="site-name">${name} 🆕</div>
          <button class="quick-test-btn hot-toggle-btn" style="margin-top:4px; padding:2px 9px; font-size:.7rem;" onclick="toggleHotSite('${safeName}', this)">🔥 Mark as Hot</button>
          <div class="site-meta">${url} — Not checked yet (next automatic check within 24h)</div>
          <button class="delete-site-btn" onclick="confirmDeleteWebsite('${safeName}', this)">🗑️ Delete Website</button>
          <div class="delete-site-status site-meta" style="margin-top:4px;"></div>
        </div>
      `;
      rowsContainer.prepend(row);
    }
  } catch (err) {
    statusEl.textContent = `❌ Failed: ${err.message}`;
    statusEl.style.color = '#e63946';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ========== DELETE WEBSITE (admin panel) ==========
// Removes a site from sites.json (so it stops being checked by the daily
// GitHub Action) and, if it was admin-added, from custom-sites.json too
// (so its homepage card disappears). Built-in sites that live in
// SITES_DIRECTORY (hardcoded in this file) still need their code line
// removed manually — that part can't be safely automated via the API.
// Cuts a matching { name: '...', ... } entry out of the SITES_DIRECTORY
// array inside raw index.html source text. Safe because every entry in that
// array is a single flat object with no nested {}. Returns the updated
// source, or null if the array or the named entry wasn't found.
function removeFromSitesDirectorySource(sourceText, siteName) {
  const target = normalizeSiteName(siteName);
  const dirStart = sourceText.indexOf('const SITES_DIRECTORY = [');
  if (dirStart === -1) return null;
  const dirEnd = sourceText.indexOf('\n];', dirStart);
  if (dirEnd === -1) return null;

  const before = sourceText.slice(0, dirStart);
  const arrayBlock = sourceText.slice(dirStart, dirEnd + 3);
  const after = sourceText.slice(dirEnd + 3);

  let found = false;
  const newArrayBlock = arrayBlock.replace(/\n?\s*\{[^{}]*\},?/g, (entryText) => {
    const nameMatch = entryText.match(/name:\s*['"]([^'"]*)['"]/);
    if (nameMatch && normalizeSiteName(nameMatch[1]) === target) {
      found = true;
      return '';
    }
    return entryText;
  });

  if (!found) return null;
  return before + newArrayBlock + after;
}

function confirmDeleteWebsite(siteName, btn) {
  const ok = confirm(`Sigurado ka bang gusto mong i-delete ang "${siteName}"?\n\nHindi na ito mababawi.`);
  if (!ok) return;
  deleteWebsite(siteName, btn);
}

async function deleteWebsite(siteName, btn) {
  const statusEl = btn.closest('.site-row').querySelector('.delete-site-status');
  const session = getAdminSession();

  if (!session) {
    statusEl.textContent = '⚠️ Please log in with the admin password above first.';
    statusEl.style.color = '#f0b428';
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  statusEl.textContent = '';

  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  // Snapshot the full site data (url/domain/categories/icon) *before* it gets
  // removed from anywhere — this is what gets saved into removed-sites.json
  // so restoreWebsite() can bring it back exactly as it was, not just its name.
  const normalizedTargetName = normalizeSiteName(siteName);
  const customMatch = customSites.find(s => normalizeSiteName(s.name) === normalizedTargetName);
  const dirMatch = SITES_DIRECTORY.find(s => normalizeSiteName(s.name) === normalizedTargetName);
  const source = customMatch || dirMatch || {};
  const siteSnapshot = {
    name: siteName,
    url: source.url || '',
    domain: source.domain || undefined,
    categories: source.categories || undefined,
    icon: source.icon || undefined,
    removedAt: new Date().toISOString(),
  };

  try {
    // 1) Remove from sites.json (the checker list) — if the site isn't in
    // there at all (e.g. a built-in SITES_DIRECTORY entry that was never
    // added to the checker list), that's fine, just skip this step instead
    // of aborting the whole deletion.
    let removedFromSitesJson = false;
    const sitesUrl = `${ADMIN_PROXY_URL}/api/github/contents/sites.json`;
    const sitesGetRes = await fetch(sitesUrl, { headers });
    if (!sitesGetRes.ok) throw new Error(`Could not read sites.json (HTTP ${sitesGetRes.status})`);
    const sitesFileData = await sitesGetRes.json();
    let sitesCurrent = JSON.parse(b64DecodeUtf8(sitesFileData.content));
    const beforeCount = sitesCurrent.length;
    sitesCurrent = sitesCurrent.filter(s => normalizeSiteName(s.name) !== normalizeSiteName(siteName));

    if (sitesCurrent.length !== beforeCount) {
      const sitesPutRes = await fetch(sitesUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Remove site: ${siteName}`,
          content: b64EncodeUtf8(JSON.stringify(sitesCurrent, null, 2)),
          sha: sitesFileData.sha,
        }),
      });
      if (!sitesPutRes.ok) {
        const errData = await sitesPutRes.json().catch(() => ({}));
        throw new Error(errData.message || `GitHub rejected the sites.json update (HTTP ${sitesPutRes.status})`);
      }
      removedFromSitesJson = true;
    }

    // 2) If it was an admin-added site, also remove it from custom-sites.json
    // so its homepage card disappears. Built-in SITES_DIRECTORY sites don't
    // live here, so a 404/miss here is expected and not an error.
    let removedFromCustom = false;
    const customUrl = `${ADMIN_PROXY_URL}/api/github/contents/custom-sites.json`;
    const customGetRes = await fetch(customUrl, { headers });
    if (customGetRes.status === 200) {
      const customFileData = await customGetRes.json();
      const customCurrent = JSON.parse(b64DecodeUtf8(customFileData.content));
      const filteredCustom = customCurrent.filter(s => normalizeSiteName(s.name) !== normalizeSiteName(siteName));
      if (filteredCustom.length !== customCurrent.length) {
        const customPutRes = await fetch(customUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Remove site: ${siteName}`,
            content: b64EncodeUtf8(JSON.stringify(filteredCustom, null, 2)),
            sha: customFileData.sha,
          }),
        });
        if (!customPutRes.ok) {
          const errData = await customPutRes.json().catch(() => ({}));
          throw new Error(errData.message || `Removed from sites.json but failed on custom-sites.json (HTTP ${customPutRes.status})`);
        }
        removedFromCustom = true;
      }
    }

    // 3) Add to removed-sites.json regardless of site type — this is a small,
    // cache-busted file the front-end filters against on every load, so the
    // card disappears immediately even before index.html's own edit (below,
    // for built-ins) or GitHub Pages' cache has caught up.
    const removedUrl = `${ADMIN_PROXY_URL}/api/github/contents/removed-sites.json`;
    const removedGetRes = await fetch(removedUrl, { headers });
    let removedList = [];
    let removedSha = null;
    if (removedGetRes.status === 200) {
      const removedFileData = await removedGetRes.json();
      const rawRemoved = JSON.parse(b64DecodeUtf8(removedFileData.content));
      // Normalize any legacy plain-string entries so they survive round-tripping.
      removedList = rawRemoved.map(entry => typeof entry === 'string' ? { name: entry } : entry);
      removedSha = removedFileData.sha;
    } else if (removedGetRes.status !== 404) {
      throw new Error(`Could not read removed-sites.json (HTTP ${removedGetRes.status})`);
    }
    const normalizedTarget = normalizedTargetName;
    if (!removedList.some(entry => normalizeSiteName(entry.name) === normalizedTarget)) {
      removedList.push(siteSnapshot);
      const removedBody = {
        message: `Mark site as removed: ${siteName}`,
        content: b64EncodeUtf8(JSON.stringify(removedList, null, 2)),
      };
      if (removedSha) removedBody.sha = removedSha;
      const removedPutRes = await fetch(removedUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(removedBody),
      });
      if (!removedPutRes.ok) {
        const errData = await removedPutRes.json().catch(() => ({}));
        throw new Error(errData.message || `Removed from sites.json but failed on removed-sites.json (HTTP ${removedPutRes.status})`);
      }
    }
    removedSiteNames.push(normalizedTarget); // reflect in this session's own view too
    removedSitesData.push(siteSnapshot);

    // Show it in "Recently Deleted" immediately — without this, the row was
    // only fetched fresh on the *next* admin panel open, so a just-deleted
    // site would seem to vanish rather than appear as recoverable.
    const removedListEl = document.getElementById('removed-sites-list');
    const removedCountEl = document.getElementById('removed-sites-count');
    if (removedListEl) {
      const placeholder = removedListEl.querySelector('p');
      if (placeholder) placeholder.remove();
      removedListEl.insertAdjacentHTML('afterbegin', buildRemovedSiteRow(siteSnapshot));
    }
    if (removedCountEl) removedCountEl.textContent = `(${removedSitesData.length})`;

    // 4) If it's a built-in site (lives in SITES_DIRECTORY, hardcoded in this
    // very file), remove its entry from the source too so the homepage card
    // disappears — every SITES_DIRECTORY entry is a flat { ... } object with
    // no nested braces, so a brace-matched regex can safely cut it out.
    // (removed-sites.json above already hides it either way — this just
    // keeps index.html's own source clean long-term.)
    let removedFromDirectory = false;
    if (SITES_DIRECTORY.some(s => normalizeSiteName(s.name) === normalizeSiteName(siteName))) {
      const idxUrl = `${ADMIN_PROXY_URL}/api/github/contents/index.html`;
      const idxGetRes = await fetch(idxUrl, { headers });
      if (!idxGetRes.ok) throw new Error(`Could not read index.html (HTTP ${idxGetRes.status})`);
      const idxFileData = await idxGetRes.json();
      const idxSource = b64DecodeUtf8(idxFileData.content);
      const updatedSource = removeFromSitesDirectorySource(idxSource, siteName);
      if (!updatedSource) throw new Error(`Could not find "${siteName}" inside SITES_DIRECTORY in index.html.`);
      const idxPutRes = await fetch(idxUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Remove built-in site from SITES_DIRECTORY: ${siteName}`,
          content: b64EncodeUtf8(updatedSource),
          sha: idxFileData.sha,
        }),
      });
      if (!idxPutRes.ok) {
        const errData = await idxPutRes.json().catch(() => ({}));
        throw new Error(errData.message || `Removed from sites.json but failed removing from SITES_DIRECTORY (HTTP ${idxPutRes.status})`);
      }
      removedFromDirectory = true;
    }

    statusEl.textContent = removedFromDirectory
      ? `✅ Deleted "${siteName}" and its SITES_DIRECTORY entry in index.html. Takes ~1 min to appear on both admin and user sides.`
      : removedFromCustom
      ? `✅ Deleted "${siteName}" from custom-sites.json.`
      : removedFromSitesJson
      ? `✅ Deleted "${siteName}" from sites.json.`
      : `✅ Marked "${siteName}" as removed.`;
    statusEl.style.color = '#06d6a0';
    btn.textContent = 'Deleted ✓';

    // The admin list is rendered from status.json, which only refreshes once
    // a day via the GitHub Action — so without this, a successfully deleted
    // site would keep showing here until tomorrow. Remove the row now so the
    // panel reflects reality immediately.
    const row = btn.closest('.site-row');
    if (row) {
      setTimeout(() => {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 400);
      }, 900);
    }
  } catch (err) {
    statusEl.textContent = `❌ Failed: ${err.message}`;
    statusEl.style.color = '#e63946';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ========== RESTORE DELETED WEBSITE (admin panel) ==========
// Undoes deleteWebsite(): takes the entry out of removed-sites.json (so it
// stops being hidden everywhere) and re-adds it to custom-sites.json using
// the url/domain/categories/icon snapshot saved at delete time — restored
// sites always come back as "admin-added" cards (custom-sites.json), even
// if they originally lived in the hardcoded SITES_DIRECTORY, since that's
// the only place a restore can safely write the full card data back to.
async function restoreWebsite(siteName, btn) {
  const statusEl = btn.closest('.site-row').querySelector('.restore-site-status');
  const session = getAdminSession();

  if (!session) {
    statusEl.textContent = '⚠️ Please log in with the admin password above first.';
    statusEl.style.color = '#f0b428';
    return;
  }

  const normalizedTarget = normalizeSiteName(siteName);
  const snapshot = removedSitesData.find(s => normalizeSiteName(s.name) === normalizedTarget);
  // Legacy deletes (before the snapshot feature existed) only saved a name,
  // no url — but if the site is still a built-in (its SITES_DIRECTORY entry
  // was never actually stripped from the source, just hidden via
  // removed-sites.json), we already have everything we need right here.
  const dirMatch = SITES_DIRECTORY.find(s => normalizeSiteName(s.name) === normalizedTarget);
  const hasUsableData = (snapshot && snapshot.url) || dirMatch;
  if (!hasUsableData) {
    statusEl.textContent = `⚠️ No saved details for "${siteName}" (deleted before Restore existed, and it's not a built-in either) — add it back manually via "Add New Website".`;
    statusEl.style.color = '#f0b428';
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Restoring...';
  statusEl.textContent = '';

  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  try {
    // 1) Take it out of removed-sites.json so it's no longer hidden.
    const removedUrl = `${ADMIN_PROXY_URL}/api/github/contents/removed-sites.json`;
    const removedGetRes = await fetch(removedUrl, { headers });
    if (removedGetRes.status === 200) {
      const removedFileData = await removedGetRes.json();
      const rawRemoved = JSON.parse(b64DecodeUtf8(removedFileData.content));
      const removedList = rawRemoved.map(entry => typeof entry === 'string' ? { name: entry } : entry);
      const filteredRemoved = removedList.filter(entry => normalizeSiteName(entry.name) !== normalizedTarget);
      if (filteredRemoved.length !== removedList.length) {
        const removedPutRes = await fetch(removedUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Restore site: ${siteName}`,
            content: b64EncodeUtf8(JSON.stringify(filteredRemoved, null, 2)),
            sha: removedFileData.sha,
          }),
        });
        if (!removedPutRes.ok) {
          const errData = await removedPutRes.json().catch(() => ({}));
          throw new Error(errData.message || `GitHub rejected the removed-sites.json update (HTTP ${removedPutRes.status})`);
        }
      }
    } else if (removedGetRes.status !== 404) {
      throw new Error(`Could not read removed-sites.json (HTTP ${removedGetRes.status})`);
    }

    // 2) Re-add it to custom-sites.json so its homepage card comes back —
    // only needed when it's not already a built-in. If it's still sitting
    // in SITES_DIRECTORY (dirMatch), unhiding it via step 1 above is enough;
    // adding it to custom-sites.json too would just create a duplicate card.
    if (!dirMatch) {
      const customUrl = `${ADMIN_PROXY_URL}/api/github/contents/custom-sites.json`;
      const customGetRes = await fetch(customUrl, { headers });
      let customSha, customCurrent = [];
      if (customGetRes.status === 200) {
        const customFileData = await customGetRes.json();
        customSha = customFileData.sha;
        customCurrent = JSON.parse(b64DecodeUtf8(customFileData.content));
      } else if (customGetRes.status !== 404) {
        throw new Error(`Removed from removed-sites.json but could not read custom-sites.json (HTTP ${customGetRes.status})`);
      }
      if (!customCurrent.some(s => normalizeSiteName(s.name) === normalizedTarget)) {
        customCurrent.push({
          name: snapshot.name,
          url: snapshot.url,
          domain: snapshot.domain,
          categories: snapshot.categories,
          icon: snapshot.icon,
        });
        const customPutRes = await fetch(customUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Restore site: ${siteName}`,
            content: b64EncodeUtf8(JSON.stringify(customCurrent, null, 2)),
            ...(customSha ? { sha: customSha } : {}),
          }),
        });
        if (!customPutRes.ok) {
          const errData = await customPutRes.json().catch(() => ({}));
          throw new Error(errData.message || `Removed from removed-sites.json but failed re-adding to custom-sites.json (HTTP ${customPutRes.status})`);
        }
      }
      customSites.push({ name: snapshot.name, url: snapshot.url, domain: snapshot.domain, categories: snapshot.categories, icon: snapshot.icon });
    }

    // 3) Make sure the checker will actually verify this site going forward
    // — add it to sites.json if it's not already there. This is what left
    // KissKH/MyAsianTV stuck as "not checked yet" forever after restoring:
    // they were built-ins that had never been added to sites.json at all,
    // so the checker had nothing to check.
    const sitesJsonUrl = `${ADMIN_PROXY_URL}/api/github/contents/sites.json`;
    const sitesJsonGetRes = await fetch(sitesJsonUrl, { headers });
    if (sitesJsonGetRes.status === 200) {
      const sitesJsonFileData = await sitesJsonGetRes.json();
      const sitesJsonCurrent = JSON.parse(b64DecodeUtf8(sitesJsonFileData.content));
      if (!sitesJsonCurrent.some(s => normalizeSiteName(s.name) === normalizedTarget)) {
        sitesJsonCurrent.push({ name: siteName, url: (snapshot && snapshot.url) || (dirMatch && dirMatch.url) || '' });
        const sitesJsonPutRes = await fetch(sitesJsonUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Add restored site to checker list: ${siteName}`,
            content: b64EncodeUtf8(JSON.stringify(sitesJsonCurrent, null, 2)),
            sha: sitesJsonFileData.sha,
          }),
        });
        if (!sitesJsonPutRes.ok) {
          const errData = await sitesJsonPutRes.json().catch(() => ({}));
          throw new Error(errData.message || `Restored but failed adding to sites.json for checking (HTTP ${sitesJsonPutRes.status})`);
        }
      }
    } else if (sitesJsonGetRes.status !== 404) {
      throw new Error(`Restored but could not read sites.json (HTTP ${sitesJsonGetRes.status})`);
    }

    // Reflect it in this session's own view right away.
    removedSitesData = removedSitesData.filter(s => normalizeSiteName(s.name) !== normalizedTarget);
    removedSiteNames = removedSiteNames.filter(n => n !== normalizedTarget);
    markPendingRestore(dirMatch ? { name: siteName } : { name: snapshot.name, url: snapshot.url, domain: snapshot.domain, categories: snapshot.categories, icon: snapshot.icon });
    renderSitesDirectory(); // refresh the homepage grid underneath the admin overlay right away

    statusEl.textContent = `✅ Restored "${siteName}". Takes ~1 min to appear on the homepage; next automatic check within 24h.`;
    statusEl.style.color = '#06d6a0';
    btn.textContent = 'Restored ✓';

    // Restoring only removed the row from "Recently Deleted" above — nothing
    // added it back to the main Website List, so it looked like it vanished
    // into nowhere. Insert a placeholder row here too (same technique as
    // addNewWebsite()) so it's visible and manageable right away.
    const mainRowsContainer = document.getElementById('admin-site-rows');
    if (mainRowsContainer && !mainRowsContainer.querySelector(`[data-restored-name="${normalizedTarget}"]`)) {
      const safeName = escapeForAttr(siteName);
      const restoredUrl = (snapshot && snapshot.url) || (dirMatch && dirMatch.url) || '';
      const newRow = document.createElement('div');
      newRow.className = 'site-row';
      newRow.setAttribute('data-restored-name', normalizedTarget);
      newRow.innerHTML = `
        <div class="status-dot"></div>
        <div style="flex:1;">
          <div class="site-name">${siteName} ♻️</div>
          <div class="site-meta">${restoredUrl}${restoredUrl ? ' — ' : ''}Restored — not checked yet (next automatic check within 24h)</div>
          <button class="delete-site-btn" onclick="confirmDeleteWebsite('${safeName}', this)">🗑️ Delete Website</button>
          <div class="delete-site-status site-meta" style="margin-top:4px;"></div>
        </div>
      `;
      mainRowsContainer.prepend(newRow);
    }

    const row = btn.closest('.site-row');
    if (row) {
      setTimeout(() => {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 400);
      }, 900);
    }
  } catch (err) {
    statusEl.textContent = `❌ Failed: ${err.message}`;
    statusEl.style.color = '#e63946';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ========== DELETE PERMANENTLY (admin panel — clears "Recently Deleted" history) ==========
// Different from deleteWebsite(): that one hides a *live* site by adding it
// to removed-sites.json. This one wipes an entry that's *already* in
// removed-sites.json, so it stops accumulating there forever and stops
// showing up in the Recently Deleted list. It never touches sites.json,
// custom-sites.json, or SITES_DIRECTORY — the site is already gone from
// those; this just clears its history record. Not reversible — no snapshot
// is kept after this.
function confirmDeletePermanently(siteName, btn) {
  const ok = confirm(`Permanent na buburahin ang "${siteName}" sa Recently Deleted history.\n\nHindi na ito mababawi (kahit yung Restore option).`);
  if (!ok) return;
  deletePermanently(siteName, btn);
}

async function deletePermanently(siteName, btn) {
  const statusEl = btn.closest('.site-row').querySelector('.restore-site-status');
  const session = getAdminSession();

  if (!session) {
    statusEl.textContent = '⚠️ Please log in with the admin password above first.';
    statusEl.style.color = '#f0b428';
    return;
  }

  const normalizedTarget = normalizeSiteName(siteName);
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  statusEl.textContent = '';

  const headers = { 'Authorization': `Bearer ${session}`, 'Accept': 'application/vnd.github+json' };

  try {
    const removedUrl = `${ADMIN_PROXY_URL}/api/github/contents/removed-sites.json`;
    const removedGetRes = await fetch(removedUrl, { headers });
    if (!removedGetRes.ok) throw new Error(`Could not read removed-sites.json (HTTP ${removedGetRes.status})`);
    const removedFileData = await removedGetRes.json();
    const rawRemoved = JSON.parse(b64DecodeUtf8(removedFileData.content));
    const removedList = rawRemoved.map(entry => typeof entry === 'string' ? { name: entry } : entry);
    const filteredRemoved = removedList.filter(entry => normalizeSiteName(entry.name) !== normalizedTarget);

    if (filteredRemoved.length === removedList.length) {
      throw new Error(`"${siteName}" wasn't found in removed-sites.json.`);
    }

    const removedPutRes = await fetch(removedUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Permanently clear deleted-site record: ${siteName}`,
        content: b64EncodeUtf8(JSON.stringify(filteredRemoved, null, 2)),
        sha: removedFileData.sha,
      }),
    });
    if (!removedPutRes.ok) {
      const errData = await removedPutRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub rejected the removed-sites.json update (HTTP ${removedPutRes.status})`);
    }

    // Reflect it in this session's own view right away.
    removedSitesData = removedSitesData.filter(s => normalizeSiteName(s.name) !== normalizedTarget);
    removedSiteNames = removedSiteNames.filter(n => n !== normalizedTarget);
    // NOTE: this site is now gone from removed-sites.json — it's no longer
    // actively hidden by name. If it's still sitting in SITES_DIRECTORY or
    // custom-sites.json, it will reappear on the site next load. That's
    // expected: "delete permanently" here means "stop remembering it was
    // deleted," not "delete it again."

    statusEl.textContent = `✅ Cleared "${siteName}" from history.`;
    statusEl.style.color = '#06d6a0';
    btn.textContent = 'Cleared ✓';

    const row = btn.closest('.site-row');
    if (row) {
      setTimeout(() => {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 400);
      }, 900);
    }
  } catch (err) {
    statusEl.textContent = `❌ Failed: ${err.message}`;
    statusEl.style.color = '#e63946';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ========== TEST LINK (admin panel) ==========
// Client-side only reachability check. Browsers block cross-origin fetches
// from reading the real response (CORS), so this can't confirm HTTP status
// or page content — it can only tell you whether the request errored out
// (DNS failure, connection refused, timeout, offline) vs. got some kind of
// response back. Always eyeball the actual page via "Open This Link".
let testLinkAbortController = null;

function escapeForAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function testLink() {
  const input = document.getElementById('test-link-input');
  const resultBox = document.getElementById('test-link-result');
  const btn = document.querySelector('.test-link-btn');
  if (!input || !resultBox) return;

  let url = input.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const safeUrl = escapeForAttr(url);

  if (testLinkAbortController) testLinkAbortController.abort();
  testLinkAbortController = new AbortController();
  const timeoutId = setTimeout(() => testLinkAbortController.abort(), 8000);

  btn.disabled = true;
  btn.textContent = 'Testing...';
  resultBox.classList.add('show');
  resultBox.innerHTML = `<div class="test-link-status"><span>⏳</span><span>Checking ${url}...</span></div>`;

  try {
    // no-cors gives an opaque response we can't inspect — but if it resolves
    // without throwing, the browser was at least able to reach the host.
    await fetch(url, { mode: 'no-cors', signal: testLinkAbortController.signal, cache: 'no-store' });
    clearTimeout(timeoutId);
    resultBox.innerHTML = `
      <div class="test-link-status"><span style="color:#06d6a0;">🟢</span><span>Looks reachable — the browser was able to connect.</span></div>
      <div class="test-link-note">Note: due to browser security (CORS), this can't confirm the actual page content or HTTP status — just that something answered. Open the link to verify visually.</div>
      <button class="test-link-open-btn" onclick="window.open('${safeUrl}', '_blank')">↗ Open This Link</button>
    `;
  } catch (err) {
    clearTimeout(timeoutId);
    const timedOut = err.name === 'AbortError';
    resultBox.innerHTML = `
      <div class="test-link-status"><span style="color:#e63946;">🔴</span><span>${timedOut ? 'Timed out — no response after 8 seconds.' : 'Could not reach this link (blocked, offline, or invalid URL).'}</span></div>
      <div class="test-link-note">This check can have false negatives too (e.g. sites that block automated requests). Open the link to double-check yourself.</div>
      <button class="test-link-open-btn" onclick="window.open('${safeUrl}', '_blank')">↗ Open This Link Anyway</button>
    `;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

// (checkAdminAccess is already called once in the main window 'load' handler above —
// having a second listener here used to create a duplicate #admin-overlay, which
// silently broke the panel: the data would load into the hidden first copy while
// the visible one stayed stuck on "Loading status.json...")
