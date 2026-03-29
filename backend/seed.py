"""
seed.py — populate DuckDB with realistic fake event data for development.
Re-runnable: clears both tables before seeding.
"""

import json
import random
import uuid
from datetime import datetime, timedelta

from database import init_db

# ── Config ────────────────────────────────────────────────────────────────────

SEED = 42
random.seed(SEED)

NOW = datetime.now()
WINDOW_DAYS = 90

TARGET_UUIDS = 15_000

# Archetype weights: (name, weight)
ARCHETYPES = [
    ("bounce",      0.40),
    ("browser",     0.30),
    ("returner",    0.15),
    ("deep_reader", 0.08),
    ("converter",   0.07),
]

# ── Site definitions ──────────────────────────────────────────────────────────

SITES = [
    {
        "site_name": "The Daily Read",
        "domain": "thedailyread.com",
        "pages": [
            "/", "/blog", "/blog/getting-started", "/blog/advanced-tips",
            "/blog/case-study", "/blog/news", "/blog/opinion", "/blog/interviews",
            "/about", "/newsletter", "/archive", "/search",
        ],
        "conversion_events": ["signup", "newsletter_subscribe"],
        "extra_events": ["signup", "newsletter_subscribe", "share", "bookmark", "download"],
    },
    {
        "site_name": "ShopNest",
        "domain": "shopnest.com",
        "pages": [
            "/", "/products", "/products/item-a", "/products/item-b",
            "/products/item-c", "/products/item-d", "/products/item-e",
            "/cart", "/checkout", "/confirmation", "/account", "/wishlist", "/sale",
        ],
        "conversion_events": ["purchase", "add_to_cart"],
        "extra_events": ["add_to_cart", "remove_from_cart", "purchase", "add_to_wishlist", "apply_coupon"],
    },
    {
        "site_name": "Launchpad",
        "domain": "launchpadapp.com",
        "pages": [
            "/", "/features", "/pricing", "/blog", "/docs", "/docs/quickstart",
            "/docs/api", "/login", "/signup", "/dashboard", "/integrations", "/changelog",
        ],
        "conversion_events": ["signup", "upgrade"],
        "extra_events": ["signup", "upgrade", "video_play", "demo_request", "docs_search"],
    },
    {
        "site_name": "Pixel Studio",
        "domain": "pixelstudio.io",
        "pages": [
            "/", "/gallery", "/gallery/brand", "/gallery/web", "/gallery/print",
            "/services", "/services/branding", "/services/web-design",
            "/about", "/blog", "/contact", "/portfolio",
        ],
        "conversion_events": ["contact_form", "quote_request"],
        "extra_events": ["contact_form", "quote_request", "portfolio_download", "gallery_view"],
    },
    {
        "site_name": "Wanderlust",
        "domain": "wanderlustblog.com",
        "pages": [
            "/", "/destinations", "/destinations/europe", "/destinations/asia",
            "/destinations/americas", "/guides", "/guides/packing", "/guides/budget",
            "/about", "/newsletter", "/travel-tips", "/gear",
        ],
        "conversion_events": ["newsletter_subscribe", "affiliate_click"],
        "extra_events": ["newsletter_subscribe", "affiliate_click", "share", "bookmark", "download"],
    },
    {
        "site_name": "FitTrack",
        "domain": "fittrackapp.com",
        "pages": [
            "/", "/features", "/workouts", "/workouts/strength", "/workouts/cardio",
            "/workouts/flexibility", "/nutrition", "/pricing", "/blog",
            "/app/download", "/community", "/challenges",
        ],
        "conversion_events": ["signup", "app_download"],
        "extra_events": ["signup", "app_download", "video_play", "workout_saved", "challenge_joined"],
    },
    {
        "site_name": "Bloom",
        "domain": "bloomgarden.com",
        "pages": [
            "/", "/plants", "/plants/indoor", "/plants/outdoor", "/plants/succulents",
            "/guides", "/guides/beginners", "/guides/seasonal",
            "/shop", "/blog", "/about", "/care-calendar",
        ],
        "conversion_events": ["purchase", "newsletter_subscribe"],
        "extra_events": ["purchase", "newsletter_subscribe", "add_to_cart", "care_reminder_set", "share"],
    },
    {
        "site_name": "CodeCraft",
        "domain": "codecraft.dev",
        "pages": [
            "/", "/tools", "/tools/formatter", "/tools/linter", "/tools/diff",
            "/docs", "/docs/getting-started", "/docs/api-reference",
            "/pricing", "/blog", "/changelog", "/community",
        ],
        "conversion_events": ["signup", "upgrade"],
        "extra_events": ["signup", "upgrade", "tool_used", "docs_search", "feedback_submitted"],
    },
    {
        "site_name": "Nomad Finance",
        "domain": "nomadfinance.io",
        "pages": [
            "/", "/features", "/pricing", "/security", "/blog",
            "/blog/investing", "/blog/taxes", "/blog/budgeting",
            "/about", "/login", "/signup", "/partners",
        ],
        "conversion_events": ["signup", "upgrade"],
        "extra_events": ["signup", "upgrade", "calculator_used", "report_downloaded", "demo_request"],
    },
    {
        "site_name": "MindSpace",
        "domain": "mindspaceapp.com",
        "pages": [
            "/", "/features", "/programs", "/programs/anxiety", "/programs/sleep",
            "/programs/focus", "/pricing", "/blog", "/blog/meditation",
            "/blog/stress", "/about", "/app/download",
        ],
        "conversion_events": ["signup", "app_download"],
        "extra_events": ["signup", "app_download", "video_play", "program_started", "share"],
    },
]

# ── Properties helpers ────────────────────────────────────────────────────────

REFERRERS = ["google.com", "twitter.com", "linkedin.com", "reddit.com", "direct", None]

def _props_page_view(is_first: bool) -> str | None:
    if is_first and random.random() < 0.55:
        ref = random.choice(REFERRERS)
        if ref:
            return json.dumps({"referrer": ref})
    return None

# ── Session builder ───────────────────────────────────────────────────────────

def _make_session(site: dict, archetype: str, session_start: datetime) -> list[dict]:
    """Return a list of event dicts for one session."""
    pages = site["pages"]
    events: list[dict] = []
    t = session_start
    session_id = str(uuid.uuid4())

    def _ev(event_name: str, page_path: str, props: str | None) -> dict:
        nonlocal t
        t += timedelta(seconds=random.randint(5, 90))
        return {
            "event_id":   str(uuid.uuid4()),
            "session_id": session_id,
            "event_name": event_name,
            "page_path":  page_path,
            "timestamp":  t,
            "properties": props,
        }

    if archetype == "bounce":
        page = random.choice(pages)
        events.append(_ev("page_view", page, _props_page_view(True)))

    elif archetype == "browser":
        n_pages = random.randint(2, 5)
        visited = random.sample(pages, min(n_pages, len(pages)))
        for i, page in enumerate(visited):
            events.append(_ev("page_view", page, _props_page_view(i == 0)))

    elif archetype == "deep_reader":
        n_pages = random.randint(6, 10)
        for i in range(n_pages):
            page = random.choice(pages)
            events.append(_ev("page_view", page, _props_page_view(i == 0)))

    elif archetype == "converter":
        n_pages = random.randint(2, 5)
        visited = random.sample(pages, min(n_pages, len(pages)))
        for i, page in enumerate(visited):
            events.append(_ev("page_view", page, _props_page_view(i == 0)))
        conv = random.choice(site["conversion_events"])
        events.append(_ev(conv, visited[-1], None))

    elif archetype == "returner":
        n_pages = random.randint(2, 4)
        visited = random.sample(pages, min(n_pages, len(pages)))
        for i, page in enumerate(visited):
            events.append(_ev("page_view", page, _props_page_view(i == 0)))
        if random.random() < 0.35:
            conv = random.choice(site["conversion_events"])
            events.append(_ev(conv, visited[-1], None))

    # Occasionally sprinkle an extra non-conversion action mid-session
    if archetype in ("browser", "deep_reader") and random.random() < 0.15:
        extra = site["extra_events"]
        ev_name = random.choice(extra)
        if ev_name not in site["conversion_events"]:
            page = random.choice(pages)
            events.append(_ev(ev_name, page, None))

    return events

# ── UUID journey builder ──────────────────────────────────────────────────────

def _random_start() -> datetime:
    offset = random.randint(0, WINDOW_DAYS * 24 * 60)  # minutes
    return NOW - timedelta(minutes=offset)

def _build_journey(site: dict, archetype: str) -> list[dict]:
    """Return all events for one UUID across one or more sessions."""
    if archetype != "returner":
        start = _random_start()
        return _make_session(site, archetype, start)

    # Returner: 2-5 sessions spread across different days
    n_sessions = random.randint(2, 5)
    first_start = _random_start()
    all_events: list[dict] = []
    session_start = first_start
    session_ids_used: set[str] = set()

    for _ in range(n_sessions):
        session_events = _make_session(site, "returner", session_start)
        sid = session_events[0]["session_id"]
        while sid in session_ids_used:
            new_sid = str(uuid.uuid4())
            for ev in session_events:
                ev["session_id"] = new_sid
            sid = new_sid
        session_ids_used.add(sid)
        all_events.extend(session_events)
        session_start += timedelta(days=random.randint(1, 14))
        if session_start > NOW:
            break

    return all_events

# ── Main ──────────────────────────────────────────────────────────────────────

def seed():
    con = init_db()

    print("Clearing existing data...")
    con.execute("DELETE FROM events")
    con.execute("DELETE FROM sites")
    con.execute("DELETE FROM colonies")
    print("  done.")

    # ── Insert sites ──────────────────────────────────────────────────────────
    site_rows = []
    for s in SITES:
        site_id   = str(uuid.uuid4())
        site_uuid = str(uuid.uuid4())
        s["site_id"] = site_id
        site_rows.append((
            site_id,
            site_uuid,
            s["site_name"],
            s["domain"],
            NOW - timedelta(days=random.randint(100, 365)),
        ))

    con.executemany(
        "INSERT INTO sites (site_id, site_uuid, site_name, domain, created_at) VALUES (?,?,?,?,?)",
        site_rows,
    )
    print(f"Sites created: {len(site_rows)}")

    # ── Distribute UUIDs across sites ─────────────────────────────────────────
    site_weights = [0.15, 0.12, 0.12, 0.08, 0.10, 0.10, 0.08, 0.10, 0.08, 0.07]
    archetype_names   = [a[0] for a in ARCHETYPES]
    archetype_weights = [a[1] for a in ARCHETYPES]

    total_events = 0
    total_sessions = 0
    batch: list[tuple] = []
    BATCH_SIZE = 5_000

    def flush(batch):
        con.executemany(
            "INSERT INTO events "
            "(event_id, site_id, uuid, session_id, event_name, page_path, timestamp, properties) "
            "VALUES (?,?,?,?,?,?,?,?)",
            batch,
        )

    print(f"Generating {TARGET_UUIDS:,} UUIDs...")

    for i in range(TARGET_UUIDS):
        site      = random.choices(SITES, weights=site_weights)[0]
        archetype = random.choices(archetype_names, weights=archetype_weights)[0]
        user_uuid = str(uuid.uuid4())
        journey   = _build_journey(site, archetype)

        seen_sessions: set[str] = set()
        for ev in journey:
            seen_sessions.add(ev["session_id"])
            batch.append((
                ev["event_id"],
                site["site_id"],
                user_uuid,
                ev["session_id"],
                ev["event_name"],
                ev["page_path"],
                ev["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
                ev["properties"],
            ))
            total_events += 1

        total_sessions += len(seen_sessions)

        if len(batch) >= BATCH_SIZE:
            flush(batch)
            batch.clear()
            print(f"  {i + 1:,} UUIDs / {total_events:,} events...", end="\r")

    if batch:
        flush(batch)

    print(f"  {TARGET_UUIDS:,} UUIDs / {total_events:,} events...   ")

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("── Seed complete ──────────────────────────────")
    print(f"  Sites:    {len(site_rows)}")
    print(f"  UUIDs:    {TARGET_UUIDS:,}")
    print(f"  Sessions: {total_sessions:,}")
    print(f"  Events:   {total_events:,}")
    print("───────────────────────────────────────────────")

    con.close()


if __name__ == "__main__":
    seed()
