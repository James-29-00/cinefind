# POS & Sales Analytics

A mobile-first point-of-sale web app that helps small store owners record sales, compute change, manage stock, and understand their business through analytics.

**Live demo:** https://pos-sales-analytics-beta.vercel.app/ (sign in with a Google account to use it)

**Status:** In development.

> UI inspired by the BuildFlow concept design. The code and the POS app are my own work.

## The Problem
Small store owners often track sales and stock by hand, so it's hard to know what sells best, when customers come, and what's running low.

## The Solution
A fast, simple POS for checkout, plus a dashboard that turns sales records into clear insights.

## Features
- Fast checkout: cart, quick-cash buttons, automatic change
- Cash, GCash, and Maya payment recording
- Product and stock management with low-stock alerts
- Editable categories, with ready-made setups for a sari-sari store and a clothing shop
- Sales history with filters, search, digital receipts (share / print), and void sale
- Analytics: best-sellers, peak hours, sales by category, profit estimate
- Best-sellers shown first; long-press a product to set quantity
- Google (Gmail) sign-in required before using the app, powered by Supabase, with owner and cashier roles and cloud sync
- Offline-first: keeps working without internet
- Settings: store name, light/dark/auto theme, currency, backup and restore (JSON)

## Screenshots
| Login | Home | New Sale |
|---|---|---|
| ![Login](screenshots/login.png) | ![Home](screenshots/home.png) | ![New Sale](screenshots/new-sale.png) |

| Checkout | Receipt | Products |
|---|---|---|
| ![Checkout](screenshots/checkout.png) | ![Receipt](screenshots/receipt.png) | ![Products](screenshots/products.png) |

| Sales History | Reports |
|---|---|
| ![Sales History](screenshots/sales-history.png) | ![Reports](screenshots/reports.png) |

## Tech Stack
- React 19 (JavaScript)
- Tailwind CSS
- Supabase (Google sign-in and cloud sync)
- Inter font

## Challenges and Decisions
- **Data layer kept separate from the screens.** The app started with localStorage, and keeping the data code apart from the UI let a backend replace it without rewriting the screens.
- **Analytics as the main difference.** Most small-shop POS apps stop at checkout, so best-sellers, peak hours and profit estimates are built in from the start.
- **One app for different shops.** Categories are editable, and each store type (sari-sari, clothing) keeps its own setup, so changing one never affects the other.
- **Offline first.** Shops often have unreliable internet, so the app keeps working offline and syncs to the cloud when a connection is available.

## Project Structure
```
index.html   page shell
styles.css   Tailwind CSS
app.js       app code (screens, data, routing)
vendor.js    React runtime
```

## Run Locally
Open `index.html` in a browser. No build step needed.

## Deploy
Static site: upload the folder to GitHub, then import the repo in Vercel (no build command, output is the root folder).

## Roadmap
PayMongo test mode, export to CSV/PDF.
