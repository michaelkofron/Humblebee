# 🐝 Humblebee

https://github.com/user-attachments/assets/2d2ef9b2-ebb4-4bca-8d5a-5bb9a6c30006

Most analytics tools tell you what happened. Humblebee helps you understand *who* did it — and where those people overlap.

It's a self-hosted web analytics and audience segmentation tool. A small JavaScript snippet on your site sends events to your own server. From there you can explore traffic, build behavioral audience segments called Colonies, and run overlap analysis between them called Pollinations — think Venn diagrams for your user base.

The whole backend is four Python files and a single DuckDB database file. The frontend is a Vite/React SPA. Total Python dependencies: four packages.

---

## Features

**Tracking snippet** — drop one `<script>` tag on any site and you're collecting data. The snippet sets a persistent visitor cookie, manages session boundaries, tracks page views automatically including SPA navigation, and exposes a simple API for custom actions. You can also add `data-buzz-on-click` or `data-buzz-on-view` attributes to any element to fire events without writing JavaScript.

**Overview** — top-line stats for any date range: unique visitors, sessions, pageviews, and custom actions. Below that, a paginated breakdown of top pages and top events. Everything updates when you change the date range or switch sites.

**Colonies** — a visual condition builder for defining behavioral audience segments. Stack conditions on event name, page path, referrer, or entry page with flexible matching (is / is not / contains / does not contain). Chain steps together with AND/OR logic, and specify whether steps need to happen in the same session or across any sessions. Preview matching users in real time before saving.

**Pollinations** — pick two saved Colonies and see their overlap rendered as a live Venn diagram. You get the total count for each Colony, the number of users in both, and the users unique to each side. Useful for questions like "how many of my newsletter subscribers have also visited the pricing page?"

**Multi-site** — manage multiple sites from a single dashboard. Each site gets its own tracking ID and an allowlist of valid action names so arbitrary strings can't be submitted. The site picker in the top bar filters every view at once, and your last-selected site is remembered.

**Date range picker** — presets for the common cases (past 24 hours, last 7/28/90 days, this month, last month, year to date) plus a custom from/to picker. Your selection is persisted between sessions.

**Password protection** — optional. Set `AUTH_ENABLED=true` and `ADMIN_PASSWORD` in your `.env` and the dashboard is gated behind a login screen. Uses a secure HMAC session cookie — no database, no user table, just an env variable.

---

## Requirements

- Python 3.11+
- Node 18+

---

## Getting started

**1. Clone and install**

```bash
git clone https://github.com/yourusername/humblebee.git
cd humblebee
./install.sh
```

This creates a Python virtualenv, installs backend dependencies, and runs `npm install` for the frontend.

**2. (Optional for testing purposes) Seed the database with sample data**

```bash
cd backend && python seed.py
```

Generates ~15,000 realistic visitors across 90 days, spread across behavioral archetypes — bouncers, browsers, returners, deep readers, converters — with randomized page paths, sessions, and events. Good for exploring the UI before your real data comes in. Re-runnable; clears and reseeds each time.

**3. Start**

```bash
./start.sh
```

Opens at [http://localhost:5173](http://localhost:5173). Backend runs on port 8000. Press Ctrl+C to stop both.

---

## Adding the tracking snippet to your site

Go to the **Sites** tab, create a site, and copy the install snippet. It looks like this:

```html
<script src="https://your-humblebee-host.com/hb.js" data-site="YOUR-SITE-ID"></script>
```

Paste it into the `<head>` of every page. That's it — page views start flowing immediately.

**Custom actions**

```html
<!-- Fire an event when an element is clicked -->
<button data-buzz-on-click="signup_click">Sign up</button>

<!-- Fire an event when an element scrolls into view (once per page load) -->
<div data-buzz-on-view="pricing_seen">...</div>
```

```js
// Fire an event programmatically
humblebee.buzz('video_played')
```

---

## Dependencies

**Python** — `fastapi`, `uvicorn`, `duckdb`, `python-dotenv`

**Node** — `react`, `vite`, `typescript`
