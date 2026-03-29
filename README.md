# Humblebee

![Humblebee screenshot](screenshot.png)

Most analytics tools tell you what happened. Humblebee helps you understand *who* did it — and where those people overlap.

It's a self-hosted web analytics and audience segmentation tool. Events come in through a lightweight tracking snippet, and from there you can build behavioral audience segments (Colonies) and run overlap analysis between them (Pollinations) — think Venn diagrams for your user base. No third-party data sharing, no per-seat pricing, runs entirely on your machine.

Currently in active development. The core analytics and segmentation loop is fully working; the JS tracking snippet and multi-site ingestion are coming next.

Built with a FastAPI backend, DuckDB for query storage, and a React/TypeScript frontend.

---

## Features

- **Overview** — top-line stats for any date range: unique users, sessions, events, actions, pageviews, top pages, and top events; date range presets plus custom ranges, all persisted between sessions
- **Colonies** — build behavioral audience segments with a multi-step condition builder; conditions support event name, page path, page referrer, and entry page with is / is not / contains / does not contain matching; steps can be combined with AND/OR and chained sequentially or across sessions; preview matching users live before saving
- **Pollinations** — pick two Colonies and see their overlap as a live Venn diagram; shows total users in each, overlap count, and users unique to each side; saved Pollinations reload instantly
- **Multi-site** — data is scoped per site; a site picker in the top bar filters all views simultaneously
- **Date range picker** — built-in presets (Past 24 hours, Last 3/7/28/90 days, This month, Last month, Year to date) plus custom from/to; selection persists in localStorage

---

## Requirements

- Python 3.11+
- Node 18+

---

## Install

```bash
./install.sh
```

Creates a Python venv, installs backend deps, runs `npm install` for the frontend.

---

## Seed data

Since the JS tracking snippet isn't wired up yet, a seed script generates realistic fake event data so you can explore the full UI immediately.

```bash
cd backend && python seed.py
```

Populates the database with ~15,000 users across 90 days, spread across behavioural archetypes (bouncers, browsers, returners, deep readers, converters) with randomised page paths, events, and session patterns. Re-runnable — clears and reseeds each time.

---

## Run

```bash
./start.sh
```

Opens at [http://localhost:5173](http://localhost:5173). Press Ctrl+C to stop.

---

## Dependencies

**Python** (`backend/requirements.txt`)
- `fastapi` + `uvicorn` — API server
- `duckdb` — analytics query engine and local storage
- `python-dotenv` — loads `.env` file if present

**Node** (`frontend/package.json`)
- `react`, `vite`, `typescript`
