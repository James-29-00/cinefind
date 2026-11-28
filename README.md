# CineFind

A directory of websites where you can watch movies, series, drama and anime for free. Search a title, see which listed sites to try, and check each one yourself.

**Live:** https://mycinefind.vercel.app/

> CineFind does not host, stream or upload any media. It only links to third-party websites, and availability is not verified.

<!-- Add screenshots here, for example: ![CineFind home](assets/screenshot-home.png) -->

## Features

- **Title search** with suggestions and recent searches
- **Popular titles** with posters and details from the TMDB API
- **Category filters** with counts, plus sorting
- **Site status** labels (working, flagged, down) and a "Hot" tag for popular sites
- **Favorites** you can save with a star
- **Five color themes** through a "Choose your vibe" picker
- **Installable PWA** with a web manifest and service worker
- **Responsive**, with a bottom navigation bar on phones
- **Accessible**: keyboard focus styles, 44px tap targets, and reduced-motion support
- **Admin page** for managing the site list

## Tech stack

| Area | Tools |
| --- | --- |
| Front end | HTML, CSS, JavaScript (no framework) |
| Data | TMDB API, JSON site lists |
| Backend | Cloudflare Workers, D1 (database), KV (rate limit, search cache, stats) |
| Hosting | Vercel (front end), Cloudflare (Worker) |
| PWA | `manifest.json`, `sw.js` |

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | The app: markup, styles and scripts |
| `admin.html` | Admin page |
| `sites.json` and other `*.json` files | Site list and related data |
| `dramacool-search-worker.js` | Cloudflare Worker (search API) |
| `wrangler.toml` | Worker config (D1 and KV bindings) |
| `tmdb-proxy/` | TMDB proxy |
| `manifest.json`, `sw.js` | PWA files |
| `DESIGN.md` | Design tokens and rules |
| `privacy.html`, `terms.html` | Legal pages |

## Run locally

The front end is static, so any local web server works:

```bash
git clone https://github.com/James-29-00/cinefind.git
cd cinefind
npx serve .
```

Then open the address it prints.

### Worker (optional)

The search API runs as a Cloudflare Worker. To deploy your own:

1. Create a D1 database and three KV namespaces (`RATE_LIMIT_KV`, `SEARCH_CACHE`, `STATS_KV`) in your Cloudflare account.
2. Put their IDs in `wrangler.toml` and set `GITHUB_REPO` to your own repo.
3. Run `npx wrangler deploy`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.

Built by [James G. Manio](https://github.com/James-29-00).
