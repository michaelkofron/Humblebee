import json
import uuid as _uuid
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from database import init_db

load_dotenv(dotenv_path="../.env")

app = FastAPI(title="DataBee")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_db = None


def db():
    return _db


@app.on_event("startup")
def startup():
    global _db
    _db = init_db()
    print("DataBee: database initialised.")


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
    params: list = []

    if site_id:
        where.append("site_id = ?")
        params.append(site_id)
    if start:
        where.append("timestamp >= ?")
        params.append(start)
    if end:
        where.append("timestamp < ? + INTERVAL 1 DAY")
        params.append(end)

    clause = (" WHERE " + " AND ".join(where)) if where else ""

    total_uuids = db().execute(
        f"SELECT COUNT(DISTINCT uuid) FROM events{clause}", params
    ).fetchone()[0]
    total_sessions = db().execute(
        f"SELECT COUNT(DISTINCT session_id) FROM events{clause}", params
    ).fetchone()[0]
    total_events = db().execute(
        f"SELECT COUNT(*) FROM events{clause}", params
    ).fetchone()[0]

    pv_clause = clause + (" AND " if clause else " WHERE ") + "event_name = 'page_view'"
    top_pages = db().execute(
        f"SELECT page_path, COUNT(*) as views FROM events{pv_clause} GROUP BY page_path ORDER BY views DESC LIMIT 10",
        params,
    ).fetchall()

    ev_clause = clause + (" AND " if clause else " WHERE ") + "event_name != 'page_view'"
    top_events = db().execute(
        f"SELECT event_name, COUNT(*) as count FROM events{ev_clause} GROUP BY event_name ORDER BY count DESC LIMIT 10",
        params,
    ).fetchall()

    return {
        "total_uuids": total_uuids,
        "total_sessions": total_sessions,
        "total_events": total_events,
        "top_pages": [{"page_path": r[0], "views": r[1]} for r in top_pages],
        "top_events": [{"event_name": r[0], "count": r[1]} for r in top_events],
    }


# ── UUID listing ──────────────────────────────────────────────────────────────

@app.get("/api/uuids")
def list_uuids(
    site_id: str | None = None,
    q: str | None = None,
    limit: int = 30,
):
    where = []
    params: list = []

    if site_id:
        where.append("e.site_id = ?")
        params.append(site_id)
    if q:
        where.append("e.uuid LIKE ?")
        params.append(f"%{q}%")

    clause = (" WHERE " + " AND ".join(where)) if where else ""

    rows = db().execute(
        f"""
        SELECT e.uuid, e.site_id, s.site_name,
               MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen
        FROM events e
        JOIN sites s ON s.site_id = e.site_id
        {clause}
        GROUP BY e.uuid, e.site_id, s.site_name
        ORDER BY last_seen DESC
        LIMIT ?
        """,
        params + [limit],
    ).fetchall()

    return [
        {
            "uuid": r[0], "site_id": r[1], "site_name": r[2],
            "first_seen": str(r[3]), "last_seen": str(r[4]),
        }
        for r in rows
    ]


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


@app.get("/api/hives")
def list_hives():
    rows = db().execute(
        "SELECT id, name, conditions, created_at, updated_at FROM hives ORDER BY created_at DESC"
    ).fetchall()
    return [
        {
            "id": r[0], "name": r[1],
            "conditions": json.loads(r[2]),
            "created_at": str(r[3]), "updated_at": str(r[4]),
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
        "INSERT INTO hives (id, name, conditions, created_at, updated_at) VALUES (?,?,?,?,?)",
        [hive_id, body.name.strip(), json.dumps(body.conditions), now, now],
    )
    return {"id": hive_id, "name": body.name.strip(), "conditions": body.conditions,
            "created_at": now, "updated_at": now}


@app.delete("/api/hives/{hive_id}")
def delete_hive(hive_id: str):
    row = db().execute("SELECT id FROM hives WHERE id = ?", [hive_id]).fetchone()
    if not row:
        raise HTTPException(404, "Hive not found")
    db().execute("DELETE FROM hives WHERE id = ?", [hive_id])
    return {"ok": True}


@app.get("/api/hives/{hive_id}/count")
def hive_count(hive_id: str, site_id: str | None = None):
    row = db().execute("SELECT conditions FROM hives WHERE id = ?", [hive_id]).fetchone()
    if not row:
        raise HTTPException(404, "Hive not found")
    conditions = json.loads(row[0])

    where = ""
    params: list = []
    if site_id:
        where = " WHERE site_id = ?"
        params = [site_id]

    # Get all events grouped by uuid
    events_rows = db().execute(
        f"""
        SELECT uuid, session_id, event_name, page_path, timestamp
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
        if _journey_matches(evts, conditions):
            count += 1

    return {"hive_id": hive_id, "count": count}


def _journey_matches(events: list[tuple], conditions: list[dict]) -> bool:
    """Check if a visitor's event sequence matches all hive conditions in order."""
    if not conditions:
        return False

    idx = 0  # current position in the event list
    prev_idx = -1

    for ci, cond in enumerate(conditions):
        ctype = cond.get("type", "")
        value = cond.get("value", "")
        sequence = cond.get("sequence", "anytime")

        start = idx if ci == 0 else (prev_idx + 1)
        found = False

        if sequence == "immediately" and ci > 0:
            # Must be the very next event
            if start < len(events):
                if _event_matches(events[start], ctype, value):
                    prev_idx = start
                    idx = start + 1
                    found = True
        else:
            # "anytime" — scan forward
            for i in range(start, len(events)):
                if _event_matches(events[i], ctype, value):
                    prev_idx = i
                    idx = i + 1
                    found = True
                    break

        if not found:
            return False

    return True


def _event_matches(event: tuple, ctype: str, value: str) -> bool:
    """Check if a single event matches a condition. event = (uuid, session_id, event_name, page_path, timestamp)."""
    event_name = event[2]
    page_path = event[3] or ""

    if ctype == "event_name":
        return event_name == value
    elif ctype == "page_path_equals":
        return page_path == value
    elif ctype == "page_path_contains":
        return value in page_path
    return False
