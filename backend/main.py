import json
import threading
import time
import uuid as _uuid
from datetime import date, datetime, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from database import init_db, DB_PATH

load_dotenv(dotenv_path="../.env")

app = FastAPI(title="Humblebee")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Each thread gets its own DuckDB connection to avoid concurrency issues.
_local = threading.local()


def db():
    import duckdb
    if not getattr(_local, "con", None):
        _local.con = duckdb.connect(str(DB_PATH))
    return _local.con


@app.on_event("startup")
def startup():
    init_db()
    # Migration: clear colonies saved in the old flat-conditions format
    import duckdb as _duckdb
    con = _duckdb.connect(str(DB_PATH))
    try:
        done = con.execute("SELECT 1 FROM migrations WHERE version = 2").fetchone()
    except Exception:
        done = None
    if not done:
        con.execute("DELETE FROM hives")
        try:
            con.execute("INSERT INTO migrations VALUES (2)")
        except Exception:
            con.execute("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)")
            con.execute("INSERT INTO migrations VALUES (2)")
    con.close()
    print("Humblebee: database initialised.")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


# ── Sites ─────────────────────────────────────────────────────────────────────

@app.get("/api/sites")
def list_sites():
    rows = db().execute(
        "SELECT site_id, site_uuid, site_name, domain, created_at FROM sites ORDER BY site_name"
    ).fetchall()
    return [
        {
            "site_id": r[0], "site_uuid": r[1], "site_name": r[2],
            "domain": r[3], "created_at": str(r[4]),
        }
        for r in rows
    ]


# ── Overview stats ────────────────────────────────────────────────────────────

@app.get("/api/stats")
def stats(
    site_id: str | None = None,
    start: str | None = None,
    end: str | None = None,
):
    where = []

    if site_id:
        where.append("site_id = $site_id")
    if start:
        where.append("timestamp >= $start::TIMESTAMP")
    if end:
        where.append("timestamp < $end::TIMESTAMP + INTERVAL 1 DAY")

    clause = (" WHERE " + " AND ".join(where)) if where else ""

    # Only include params actually referenced in the query
    named: dict = {}
    if site_id:
        named["site_id"] = site_id
    if start:
        named["start"] = start
    if end:
        named["end"] = end

    def q(sql: str, extra_named: dict | None = None):
        p = {**named, **(extra_named or {})}
        return db().execute(sql, p) if p else db().execute(sql)

    totals = q(
        f"SELECT COUNT(DISTINCT uuid), COUNT(DISTINCT session_id), COUNT(*) FROM events{clause}"
    ).fetchone()

    actions_clause = clause + (" AND " if clause else " WHERE ") + "event_name != 'page_view'"
    total_actions = q(f"SELECT COUNT(*) FROM events{actions_clause}").fetchone()[0]

    pv_clause = clause + (" AND " if clause else " WHERE ") + "event_name = 'page_view'"
    total_pageviews = q(f"SELECT COUNT(*) FROM events{pv_clause}").fetchone()[0]
    top_pages = q(
        f"SELECT page_path, COUNT(*) as views FROM events{pv_clause} GROUP BY page_path ORDER BY views DESC LIMIT 50"
    ).fetchall()

    top_events = q(
        f"SELECT event_name, COUNT(*) as count FROM events{clause} GROUP BY event_name ORDER BY count DESC LIMIT 50"
    ).fetchall()

    return {
        "total_uuids": totals[0],
        "total_sessions": totals[1],
        "total_events": totals[2],
        "total_actions": total_actions,
        "total_pageviews": total_pageviews,
        "top_pages": [{"page_path": r[0], "views": r[1]} for r in top_pages],
        "top_events": [{"event_name": r[0], "count": r[1]} for r in top_events],
    }


# ── Paginated top pages / top events ──────────────────────────────────────────

def _stat_filters(site_id, start, end):
    filters: list[str] = []
    params: list = []
    if site_id:
        filters.append("site_id = ?")
        params.append(site_id)
    if start:
        filters.append("timestamp >= CAST(? AS TIMESTAMP)")
        params.append(start)
    if end:
        filters.append("timestamp < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
        params.append(end)
    clause = (" WHERE " + " AND ".join(filters)) if filters else ""
    return clause, params


@app.get("/api/pages")
def list_pages(
    site_id: str | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    clause, params = _stat_filters(site_id, start, end)
    pv = clause + (" AND " if clause else " WHERE ") + "event_name = 'page_view'"
    total = db().execute(
        f"SELECT COUNT(DISTINCT page_path) FROM events{pv}", params
    ).fetchone()[0]
    rows = db().execute(
        f"SELECT page_path, COUNT(*) as views FROM events{pv} GROUP BY page_path ORDER BY views DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    return {"total": total, "items": [{"page_path": r[0], "views": r[1]} for r in rows]}


@app.get("/api/events")
def list_events(
    site_id: str | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    clause, params = _stat_filters(site_id, start, end)
    actions = clause + (" AND " if clause else " WHERE ") + "event_name != 'page_view'"
    total = db().execute(
        f"SELECT COUNT(DISTINCT event_name) FROM events{actions}", params
    ).fetchone()[0]
    rows = db().execute(
        f"SELECT event_name, COUNT(*) as count FROM events{actions} GROUP BY event_name ORDER BY count DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    return {"total": total, "items": [{"event_name": r[0], "count": r[1]} for r in rows]}


# ── UUID listing ──────────────────────────────────────────────────────────────

@app.get("/api/uuids")
def list_uuids(
    site_id: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
    start: str | None = None,
    end: str | None = None,
):
    where = []
    params: list = []

    if site_id:
        where.append("e.site_id = ?")
        params.append(site_id)
    if q:
        where.append("e.uuid LIKE ?")
        params.append(f"%{q}%")
    if start:
        where.append("e.timestamp >= CAST(? AS TIMESTAMP)")
        params.append(start)
    if end:
        where.append("e.timestamp < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
        params.append(end)

    clause = (" WHERE " + " AND ".join(where)) if where else ""

    total = db().execute(
        f"SELECT COUNT(DISTINCT e.uuid) FROM events e{clause}",
        params,
    ).fetchone()[0]

    rows = db().execute(
        f"""
        SELECT e.uuid, e.site_id, s.site_name,
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen,
               COUNT(DISTINCT e.session_id) as session_count,
               SUM(CASE WHEN e.event_name = 'page_view' THEN 1 ELSE 0 END)::INTEGER as page_count,
               MIN(CASE WHEN e.event_name != 'page_view' THEN e.event_name END) as first_custom_event,
               SUM(CASE WHEN e.event_name != 'page_view' THEN 1 ELSE 0 END)::INTEGER as custom_event_count
        FROM events e
        JOIN sites s ON s.site_id = e.site_id
        {clause}
        GROUP BY e.uuid, e.site_id, s.site_name
        ORDER BY last_seen DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return {
        "total": total,
        "items": [_uuid_row(r) for r in rows],
    }


def _uuid_row(r: tuple) -> dict:
    return {
        "uuid": r[0], "site_id": r[1], "site_name": r[2],
        "first_seen": str(r[3]), "last_seen": str(r[4]),
        "session_count": r[5],
        "page_count": r[6],
        "first_custom_event": r[7],
        "custom_event_count": r[8],
    }


# ── Journey ───────────────────────────────────────────────────────────────────

@app.get("/api/journey/{visitor_uuid}")
def get_journey(visitor_uuid: str, site_id: str | None = None):
    where = "WHERE e.uuid = ?"
    params: list = [visitor_uuid]

    if site_id:
        where += " AND e.site_id = ?"
        params.append(site_id)

    rows = db().execute(
        f"""
        SELECT e.event_id, e.site_id, e.session_id, e.event_name,
               e.page_path, e.timestamp, e.properties, s.site_name
        FROM events e
        JOIN sites s ON s.site_id = e.site_id
        {where}
        ORDER BY e.timestamp ASC
        """,
        params,
    ).fetchall()

    events = []
    for r in rows:
        props = None
        if r[6]:
            try:
                props = json.loads(r[6])
            except (json.JSONDecodeError, TypeError):
                pass
        events.append({
            "event_id": r[0], "site_id": r[1], "session_id": r[2],
            "event_name": r[3], "page_path": r[4], "timestamp": str(r[5]),
            "properties": props, "site_name": r[7],
        })

    return {"uuid": visitor_uuid, "events": events}


# ── Hives ─────────────────────────────────────────────────────────────────────

class HiveCreate(BaseModel):
    name: str
    steps: list[dict]
    site_id: str | None = None


@app.get("/api/hives")
def list_hives(site_id: str | None = None):
    if site_id:
        rows = db().execute(
            "SELECT id, name, site_id, conditions, created_at, updated_at FROM hives WHERE site_id = ? ORDER BY created_at DESC",
            [site_id],
        ).fetchall()
    else:
        rows = db().execute(
            "SELECT id, name, site_id, conditions, created_at, updated_at FROM hives WHERE site_id IS NULL ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            "id": r[0], "name": r[1], "site_id": r[2],
            "steps": json.loads(r[3]),
            "created_at": str(r[4]), "updated_at": str(r[5]),
        }
        for r in rows
    ]


@app.post("/api/hives", status_code=201)
def create_hive(body: HiveCreate):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    if not body.steps:
        raise HTTPException(400, "At least one step is required")

    hive_id = str(_uuid.uuid4())
    now = datetime.now().isoformat()
    db().execute(
        "INSERT INTO hives (id, name, site_id, conditions, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [hive_id, body.name.strip(), body.site_id or None, json.dumps(body.steps), now, now],
    )
    return {"id": hive_id, "name": body.name.strip(), "site_id": body.site_id or None,
            "steps": body.steps, "created_at": now, "updated_at": now}


@app.delete("/api/hives/{hive_id}")
def delete_hive(hive_id: str):
    row = db().execute("SELECT id FROM hives WHERE id = ?", [hive_id]).fetchone()
    if not row:
        raise HTTPException(404, "Hive not found")
    db().execute("DELETE FROM hives WHERE id = ?", [hive_id])
    return {"ok": True}


@app.get("/api/hives/{hive_id}/count")
def hive_count(
    hive_id: str,
    start: str | None = None,
    end: str | None = None,
):
    row = db().execute("SELECT conditions, site_id FROM hives WHERE id = ?", [hive_id]).fetchone()
    if not row:
        raise HTTPException(404, "Hive not found")
    steps = json.loads(row[0])
    hive_site_id = row[1]

    filters = []
    params: list = []
    if hive_site_id:
        filters.append("site_id = ?")
        params.append(hive_site_id)
    if start:
        filters.append("timestamp >= CAST(? AS TIMESTAMP)")
        params.append(start)
    if end:
        filters.append("timestamp < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
        params.append(end)

    where = (" WHERE " + " AND ".join(filters)) if filters else ""

    # Fetch full event history for UUIDs active in the date/site scope.
    # Subquery finds qualifying UUIDs; outer query gets their complete history
    # so _mark_entries correctly identifies the true first-ever page view.
    site_clause = " AND site_id = ?" if hive_site_id else ""
    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp, properties
        FROM events
        WHERE uuid IN (SELECT DISTINCT uuid FROM events{where}){site_clause}
        ORDER BY uuid, timestamp
        """,
        params + ([hive_site_id] if hive_site_id else []),
    ).fetchall()

    if not events_rows:
        return {"hive_id": hive_id, "count": 0}

    journeys: dict[str, list[tuple]] = {}
    for r in events_rows:
        journeys.setdefault(r[0], []).append(r)

    count = 0
    for uuid, evts in journeys.items():
        if _journey_matches(evts, steps):
            count += 1

    return {"hive_id": hive_id, "count": count}


# ── Shared helper ─────────────────────────────────────────────────────────────

_uuid_set_cache: dict[tuple, tuple[frozenset, float]] = {}
_UUID_CACHE_TTL = 300  # 5 minutes


def _matching_uuids(hive_id: str, start: str | None, end: str | None) -> set[str]:
    """Return the set of UUIDs matching a hive's steps for the given date range.

    Results are cached per (hive_id, start, end) for up to 5 minutes so that
    multiple pollination count/overlap requests sharing a colony only pay the
    computation cost once.
    """
    key = (hive_id, start or "", end or "")
    today = date.today().isoformat()
    is_live = end is None or end >= today

    if not is_live:
        cached = _uuid_set_cache.get(key)
        if cached:
            result, ts = cached
            if time.time() - ts < _UUID_CACHE_TTL:
                return set(result)

    row = db().execute("SELECT conditions, site_id FROM hives WHERE id = ?", [hive_id]).fetchone()
    if not row:
        return set()
    steps = json.loads(row[0])
    hive_site_id = row[1]

    filters: list[str] = []
    params: list = []
    if hive_site_id:
        filters.append("site_id = ?")
        params.append(hive_site_id)
    if start:
        filters.append("timestamp >= CAST(? AS TIMESTAMP)")
        params.append(start)
    if end:
        filters.append("timestamp < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
        params.append(end)

    where = (" WHERE " + " AND ".join(filters)) if filters else ""
    site_clause = " AND site_id = ?" if hive_site_id else ""
    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp, properties
        FROM events
        WHERE uuid IN (SELECT DISTINCT uuid FROM events{where}){site_clause}
        ORDER BY uuid, timestamp
        """,
        params + ([hive_site_id] if hive_site_id else []),
    ).fetchall()

    if not events_rows:
        if not is_live:
            _uuid_set_cache[key] = (frozenset(), time.time())
        return set()

    journeys: dict[str, list[tuple]] = {}
    for r in events_rows:
        journeys.setdefault(r[0], []).append(r)

    result = frozenset(uid for uid, evts in journeys.items() if _journey_matches(evts, steps))
    if not is_live:
        _uuid_set_cache[key] = (result, time.time())
    return set(result)


# ── Pollinations ──────────────────────────────────────────────────────────────

class PollinationCreate(BaseModel):
    name: str
    site_id: str | None = None
    hive_a_id: str
    hive_b_id: str


@app.get("/api/pollinations")
def list_pollinations(site_id: str | None = None):
    if site_id:
        rows = db().execute(
            "SELECT id, name, site_id, hive_a_id, hive_b_id, created_at FROM pollinations WHERE site_id = ? ORDER BY created_at DESC",
            [site_id],
        ).fetchall()
    else:
        rows = db().execute(
            "SELECT id, name, site_id, hive_a_id, hive_b_id, created_at FROM pollinations WHERE site_id IS NULL ORDER BY created_at DESC"
        ).fetchall()
    return [
        {"id": r[0], "name": r[1], "site_id": r[2], "hive_a_id": r[3], "hive_b_id": r[4], "created_at": str(r[5])}
        for r in rows
    ]


@app.post("/api/pollinations", status_code=201)
def create_pollination(body: PollinationCreate):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    pol_id = str(_uuid.uuid4())
    now = datetime.now().isoformat()
    db().execute(
        "INSERT INTO pollinations (id, name, site_id, hive_a_id, hive_b_id, created_at) VALUES (?,?,?,?,?,?)",
        [pol_id, body.name.strip(), body.site_id or None, body.hive_a_id, body.hive_b_id, now],
    )
    return {"id": pol_id, "name": body.name.strip(), "site_id": body.site_id or None,
            "hive_a_id": body.hive_a_id, "hive_b_id": body.hive_b_id, "created_at": now}


@app.delete("/api/pollinations/{pol_id}")
def delete_pollination(pol_id: str):
    row = db().execute("SELECT id FROM pollinations WHERE id = ?", [pol_id]).fetchone()
    if not row:
        raise HTTPException(404, "Pollination not found")
    db().execute("DELETE FROM pollinations WHERE id = ?", [pol_id])
    return {"ok": True}


@app.get("/api/pollinations/{pol_id}/count")
def pollination_count(
    pol_id: str,
    start: str | None = None,
    end: str | None = None,
):
    row = db().execute("SELECT hive_a_id, hive_b_id FROM pollinations WHERE id = ?", [pol_id]).fetchone()
    if not row:
        raise HTTPException(404, "Pollination not found")
    set_a = _matching_uuids(row[0], start, end)
    set_b = _matching_uuids(row[1], start, end)
    overlap = set_a & set_b
    return {
        "pol_id": pol_id,
        "a_count": len(set_a),
        "b_count": len(set_b),
        "overlap": len(overlap),
        "a_only": len(set_a - set_b),
        "b_only": len(set_b - set_a),
    }


@app.get("/api/pollinations/{pol_id}/overlap-uuids")
def pollination_overlap_uuids(
    pol_id: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    row = db().execute("SELECT hive_a_id, hive_b_id FROM pollinations WHERE id = ?", [pol_id]).fetchone()
    if not row:
        raise HTTPException(404, "Pollination not found")
    set_a = _matching_uuids(row[0], start, end)
    set_b = _matching_uuids(row[1], start, end)
    overlap = sorted(set_a & set_b)
    total = len(overlap)
    page = overlap[offset: offset + limit]
    if not page:
        return {"total": total, "items": []}
    placeholders = ",".join(["?"] * len(page))
    rows = db().execute(
        f"""
        SELECT e.uuid, e.site_id, s.site_name,
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen,
               COUNT(DISTINCT e.session_id) as session_count,
               SUM(CASE WHEN e.event_name = 'page_view' THEN 1 ELSE 0 END)::INTEGER as page_count,
               MIN(CASE WHEN e.event_name != 'page_view' THEN e.event_name END) as first_custom_event,
               SUM(CASE WHEN e.event_name != 'page_view' THEN 1 ELSE 0 END)::INTEGER as custom_event_count
        FROM events e
        JOIN sites s ON s.site_id = e.site_id
        WHERE e.uuid IN ({placeholders})
        GROUP BY e.uuid, e.site_id, s.site_name
        ORDER BY last_seen DESC
        """,
        page,
    ).fetchall()
    return {"total": total, "items": [_uuid_row(r) for r in rows]}


class ConditionSearch(BaseModel):
    steps: list[dict]
    site_id: str | None = None
    limit: int = 100
    offset: int = 0
    start: str | None = None
    end: str | None = None


@app.post("/api/journey/search")
def journey_search(body: ConditionSearch):
    if not body.steps:
        raise HTTPException(400, "At least one step is required")

    filters = []
    params: list = []
    if body.site_id:
        filters.append("site_id = ?")
        params.append(body.site_id)
    if body.start:
        filters.append("timestamp >= CAST(? AS TIMESTAMP)")
        params.append(body.start)
    if body.end:
        filters.append("timestamp < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
        params.append(body.end)

    where = (" WHERE " + " AND ".join(filters)) if filters else ""

    # Fetch full event history for UUIDs active in the date/site scope.
    # Subquery finds qualifying UUIDs; outer query gets their complete history
    # so _mark_entries correctly identifies the true first-ever page view.
    site_clause = " AND site_id = ?" if body.site_id else ""
    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp, properties
        FROM events
        WHERE uuid IN (SELECT DISTINCT uuid FROM events{where}){site_clause}
        ORDER BY uuid, timestamp
        """,
        params + ([body.site_id] if body.site_id else []),
    ).fetchall()

    if not events_rows:
        return {"total": 0, "items": []}

    journeys: dict[str, list[tuple]] = {}
    for r in events_rows:
        journeys.setdefault(r[0], []).append(r)

    matching: list[str] = []
    for uid, evts in journeys.items():
        if _journey_matches(evts, body.steps):
            matching.append(uid)

    total = len(matching)
    page = matching[body.offset : body.offset + body.limit]

    if not page:
        return {"total": total, "items": []}

    placeholders = ",".join(["?"] * len(page))
    rows = db().execute(
        f"""
        SELECT e.uuid, e.site_id, s.site_name,
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen,
               COUNT(DISTINCT e.session_id) as session_count,
               SUM(CASE WHEN e.event_name = 'page_view' THEN 1 ELSE 0 END)::INTEGER as page_count,
               MIN(CASE WHEN e.event_name != 'page_view' THEN e.event_name END) as first_custom_event,
               SUM(CASE WHEN e.event_name != 'page_view' THEN 1 ELSE 0 END)::INTEGER as custom_event_count
        FROM events e
        JOIN sites s ON s.site_id = e.site_id
        WHERE e.uuid IN ({placeholders})
        GROUP BY e.uuid, e.site_id, s.site_name
        ORDER BY last_seen DESC
        """,
        page,
    ).fetchall()

    return {
        "total": total,
        "items": [_uuid_row(r) for r in rows],
    }


def _mark_entries(events: list[tuple]) -> list[tuple]:
    """Append is_entry bool (index 6) — True only for the very first page_view."""
    first_done = False
    result = []
    for ev in events:
        is_entry = not first_done and ev[2] == "page_view"
        if is_entry:
            first_done = True
        result.append(ev + (is_entry,))
    return result


def _row_matches_event(event: tuple, row: dict) -> bool:
    """Return True if a single event satisfies the condition row (field applies + value matches)."""
    field    = row.get("field", "event_name")
    match    = row.get("match", "is")
    value    = row.get("value", "")
    negate   = match in ("is_not", "does_not_contain")
    contains = match in ("contains", "does_not_contain")
    if not _event_field_applies(event, field):
        return False
    hit = _event_matches(event, field, value, contains)
    return (not negate and hit) or (negate and not hit)


def _find_in_range(events: list[tuple], row: dict, start: int, session: str | None = None) -> int | None:
    """Return the index of the first event from `start` matching the condition row.
    If session is set, stop searching when the session changes.
    """
    for i in range(start, len(events)):
        if session is not None and events[i][1] != session:
            break
        if _row_matches_event(events[i], row):
            return i
    return None


def _journey_matches(events: list[tuple], steps: list[dict]) -> bool:
    """Check if a visitor's journey satisfies all steps in order.
    Each step has: sequence, operator ('and'|'or'), conditions (list of rows).

    AND step: find a single event satisfying ALL conditions simultaneously.
    OR  step: find the earliest event satisfying ANY condition.

    sequence="immediately": the very next event after the previous match must satisfy this step.
    sequence="next_session": scan the entire next session for a match.
    sequence="anytime": scan any event after the previous match.
    """
    if not steps:
        return False

    events = _mark_entries(events)
    prev_idx = -1

    for si, step in enumerate(steps):
        sequence   = step.get("sequence", "anytime")
        operator   = step.get("operator", "and")
        conditions = step.get("conditions", [])

        if not conditions:
            return False

        # ── "immediately" — the very next event in the same session must satisfy this step ──
        if si > 0 and sequence == "immediately":
            next_i = prev_idx + 1
            if next_i >= len(events):
                return False
            # Must still be in the same session — don't cross session boundaries
            if events[next_i][1] != events[prev_idx][1]:
                return False
            candidate = events[next_i]
            if operator == "and":
                ok = all(_row_matches_event(candidate, row) for row in conditions)
            else:
                ok = any(_row_matches_event(candidate, row) for row in conditions)
            if not ok:
                return False
            prev_idx = next_i
            continue

        # ── Determine search window ───────────────────────────────────────
        if si == 0:
            search_start = 0
            session: str | None = None
        elif sequence == "next_session":
            cur_session = events[prev_idx][1]
            next_start = next(
                (i for i in range(prev_idx + 1, len(events)) if events[i][1] != cur_session),
                None,
            )
            if next_start is None:
                return False
            search_start = next_start
            session = events[next_start][1]
        else:  # anytime
            search_start = prev_idx + 1
            session = None

        # ── Search for a matching event ───────────────────────────────────
        if operator == "and":
            found_idx: int | None = None
            for i in range(search_start, len(events)):
                if session is not None and events[i][1] != session:
                    break
                if all(_row_matches_event(events[i], row) for row in conditions):
                    found_idx = i
                    break
            if found_idx is None:
                return False
            prev_idx = found_idx

        else:  # or
            best: int | None = None
            for row in conditions:
                idx = _find_in_range(events, row, search_start, session)
                if idx is not None and (best is None or idx < best):
                    best = idx
            if best is None:
                return False
            prev_idx = best

    return True


def _event_field_applies(event: tuple, field: str) -> bool:
    """Returns True if this event is the right type for the given field."""
    event_name = event[2] or ""
    is_entry   = event[6] if len(event) > 6 else False
    if field == "event_name":
        return event_name != "page_view"
    elif field in ("page_path", "page_referrer"):
        return event_name == "page_view"
    elif field == "entry_page":
        return bool(is_entry)
    return False


def _event_matches(event: tuple, field: str, value: str, contains: bool = False) -> bool:
    """Positive match only — check if the event's field value equals (or contains) value.
    Call _event_field_applies first to confirm the event is the right type.
    event = (uuid, session_id, event_name, page_path, timestamp, properties, is_entry)
    """
    page_path = event[3] or ""

    if field == "event_name":
        target = event[2] or ""
    elif field in ("page_path", "entry_page"):
        target = page_path
    elif field == "page_referrer":
        try:
            props = json.loads(event[5]) if event[5] else {}
        except (json.JSONDecodeError, TypeError):
            props = {}
        target = props.get("referrer", "")
    else:
        return False

    return (value in target) if contains else (target == value)
