import json
import threading
import uuid as _uuid
from datetime import datetime, timedelta

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
    # Run migrations/table creation once on the main thread.
    init_db()
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

    pv_clause = clause + (" AND " if clause else " WHERE ") + "event_name = 'page_view'"
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
        "top_pages": [{"page_path": r[0], "views": r[1]} for r in top_pages],
        "top_events": [{"event_name": r[0], "count": r[1]} for r in top_events],
    }


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
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen
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
        "items": [
            {
                "uuid": r[0], "site_id": r[1], "site_name": r[2],
                "first_seen": str(r[3]), "last_seen": str(r[4]),
            }
            for r in rows
        ],
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
    conditions: list[dict]
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
            "conditions": json.loads(r[3]),
            "created_at": str(r[4]), "updated_at": str(r[5]),
        }
        for r in rows
    ]


@app.post("/api/hives", status_code=201)
def create_hive(body: HiveCreate):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    if not body.conditions:
        raise HTTPException(400, "At least one condition is required")

    hive_id = str(_uuid.uuid4())
    now = datetime.now().isoformat()
    db().execute(
        "INSERT INTO hives (id, name, site_id, conditions, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [hive_id, body.name.strip(), body.site_id or None, json.dumps(body.conditions), now, now],
    )
    return {"id": hive_id, "name": body.name.strip(), "site_id": body.site_id or None,
            "conditions": body.conditions, "created_at": now, "updated_at": now}


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
    conditions = json.loads(row[0])
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

    # Get all events grouped by uuid
    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp, properties
        FROM events{where}
        ORDER BY uuid, timestamp
        """,
        params,
    ).fetchall()

    # Group into journeys
    journeys: dict[str, list[tuple]] = {}
    for r in events_rows:
        journeys.setdefault(r[0], []).append(r)

    count = 0
    for uuid, evts in journeys.items():
        if _journey_matches(_mark_entries(evts), conditions):
            count += 1

    return {"hive_id": hive_id, "count": count}


class ConditionSearch(BaseModel):
    conditions: list[dict]
    site_id: str | None = None
    limit: int = 100
    offset: int = 0
    start: str | None = None
    end: str | None = None


@app.post("/api/journey/search")
def journey_search(body: ConditionSearch):
    if not body.conditions:
        raise HTTPException(400, "At least one condition is required")

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

    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp, properties
        FROM events{where}
        ORDER BY uuid, timestamp
        """,
        params,
    ).fetchall()

    journeys: dict[str, list[tuple]] = {}
    for r in events_rows:
        journeys.setdefault(r[0], []).append(r)

    matching: list[str] = []
    for uid, evts in journeys.items():
        if _journey_matches(_mark_entries(evts), body.conditions):
            matching.append(uid)

    total = len(matching)
    page = matching[body.offset : body.offset + body.limit]

    if not page:
        return {"total": total, "items": []}

    placeholders = ",".join(["?"] * len(page))
    rows = db().execute(
        f"""
        SELECT e.uuid, e.site_id, s.site_name,
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen
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
        "items": [
            {
                "uuid": r[0], "site_id": r[1], "site_name": r[2],
                "first_seen": str(r[3]), "last_seen": str(r[4]),
            }
            for r in rows
        ],
    }


def _mark_entries(events: list[tuple]) -> list[tuple]:
    """Append an is_entry bool (index 6) — True only for the very first page_view of the journey."""
    first_done = False
    result = []
    for ev in events:
        is_entry = not first_done and ev[2] == "page_view"
        if is_entry:
            first_done = True
        result.append(ev + (is_entry,))
    return result


def _journey_matches(events: list[tuple], conditions: list[dict]) -> bool:
    """Check if a visitor's event sequence matches all hive conditions in order.
    events must be pre-processed by _mark_entries (index 6 = is_entry bool).
    """
    if not conditions:
        return False

    idx = 0
    prev_idx = -1

    for ci, cond in enumerate(conditions):
        field    = cond.get("field", "event_name")
        match    = cond.get("match", "equals")
        value    = cond.get("value", "")
        sequence = cond.get("sequence", "anytime")
        negate   = match in ("is_not", "does_not_contain")
        contains = match in ("contains", "does_not_contain")

        start = idx if ci == 0 else (prev_idx + 1)
        found = False

        if sequence == "immediately" and ci > 0:
            if start < len(events):
                prev_session = events[prev_idx][1]
                candidate = events[start]
                same_session = candidate[1] == prev_session
                if same_session and _event_field_applies(candidate, field):
                    hit = _event_matches(candidate, field, value, contains)
                    if (not negate and hit) or (negate and not hit):
                        prev_idx = start
                        idx = start + 1
                        found = True

        elif sequence == "next_session" and ci > 0:
            prev_session = events[prev_idx][1]
            next_session_id = None
            next_session_start = None
            for i in range(prev_idx + 1, len(events)):
                if events[i][1] != prev_session:
                    next_session_id = events[i][1]
                    next_session_start = i
                    break
            if next_session_id is not None:
                last_i = next_session_start
                for i in range(next_session_start, len(events)):
                    if events[i][1] != next_session_id:
                        break
                    last_i = i
                    if not _event_field_applies(events[i], field):
                        continue
                    hit = _event_matches(events[i], field, value)
                    if (not negate and hit) or (negate and not hit):
                        prev_idx = i
                        idx = i + 1
                        found = True
                        break

        else:
            # "anytime" — scan forward
            for i in range(start, len(events)):
                if negate:
                    # Find first event of the right field type whose value doesn't match
                    if _event_field_applies(events[i], field) and not _event_matches(events[i], field, value, contains):
                        prev_idx = i
                        idx = i + 1
                        found = True
                        break
                else:
                    if _event_field_applies(events[i], field) and _event_matches(events[i], field, value, contains):
                        prev_idx = i
                        idx = i + 1
                        found = True
                        break

        if not found:
            return False

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
