"""Tracking script and event collection endpoint."""

import json
import re
import time
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

_HB_JS_PATH = Path(__file__).parent / "static" / "hb.js"


def _minify_js(source: str) -> str:
    """Strip comments and collapse whitespace to produce a minified JS bundle."""
    # Remove single-line comments (but not URLs with //)
    out = re.sub(r'(?<![:\"\'])//[^\n]*', '', source)
    # Remove multi-line comments
    out = re.sub(r'/\*.*?\*/', '', out, flags=re.DOTALL)
    # Collapse whitespace: newlines, tabs, multiple spaces → single space
    out = re.sub(r'\s+', ' ', out)
    # Remove spaces around operators / punctuation
    out = re.sub(r'\s*([{};,=():\[\]<>+\-*/%!&|?])\s*', r'\1', out)
    return out.strip()


router = APIRouter()

# ── Rate limiter (in-memory) ─────────────────────────────────────────────────

_rate: dict[str, list[float]] = {}
_RATE_LIMIT = 100  # max events per minute per uuid
_rate_cleanup_counter = 0


def _check_rate(uid: str) -> bool:
    global _rate_cleanup_counter
    now = time.time()
    window = _rate.setdefault(uid, [])
    _rate[uid] = [t for t in window if now - t < 60]
    if len(_rate[uid]) >= _RATE_LIMIT:
        return False
    _rate[uid].append(now)

    _rate_cleanup_counter += 1
    if _rate_cleanup_counter >= 500:
        _rate_cleanup_counter = 0
        stale = [k for k, v in _rate.items() if not v or now - v[-1] > 120]
        for k in stale:
            del _rate[k]

    return True


# ── Tracking script ──────────────────────────────────────────────────────────

@router.get("/hb.js")
def serve_tracking_script():
    return Response(
        content=_minify_js(_HB_JS_PATH.read_text()),
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ── Event collection ─────────────────────────────────────────────────────────

class CollectEvent(BaseModel):
    site_uuid: str
    uuid: str
    session_id: str
    event_name: str
    page_path: str
    properties: dict | None = None


def _get_db():
    """Import db lazily to avoid circular imports."""
    from main import db
    return db()


@router.post("/api/collect", status_code=204)
def collect(body: CollectEvent, request: Request):
    import json as _json

    row = _get_db().execute(
        "SELECT site_id, domain, allowed_actions FROM sites WHERE site_uuid = ?",
        [body.site_uuid],
    ).fetchone()
    if not row:
        raise HTTPException(400, "Unknown site")

    site_id, domain, allowed_actions_raw = row
    allowed_actions = _json.loads(allowed_actions_raw) if allowed_actions_raw else []

    # page_view is always allowed; custom actions must be on the allowlist
    if body.event_name != "page_view":
        if not allowed_actions or body.event_name not in allowed_actions:
            raise HTTPException(400, "Action not allowed")

    # Validate origin — reject if header is missing (blocks curl/console abuse)
    # or if the hostname doesn't exactly match the registered domain.
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    origin_host = urlparse(origin).hostname or "" if origin else ""
    if not origin_host or origin_host == "":
        # Allow localhost for development; reject everything else with no origin
        if not (request.headers.get("host") or "").startswith("localhost"):
            raise HTTPException(403, "Missing origin")
    elif origin_host != "localhost":
        # Exact match: origin must be the domain itself or a subdomain of it.
        # e.g. domain="blog.com" accepts "blog.com" and "www.blog.com"
        # but rejects "fakeblog.com".
        if origin_host != domain and not origin_host.endswith("." + domain):
            raise HTTPException(403, "Origin mismatch")

    if not _check_rate(body.uuid):
        raise HTTPException(429, "Rate limit exceeded")

    props = json.dumps(body.properties) if body.properties else None

    _get_db().execute(
        "INSERT INTO events (event_id, site_id, uuid, session_id, event_name, page_path, timestamp, properties) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            str(_uuid.uuid4()),
            site_id,
            body.uuid,
            body.session_id,
            body.event_name,
            body.page_path,
            datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            props,
        ],
    )

    return Response(status_code=204)
