import duckdb
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "storage" / "databee.duckdb"


def init_db() -> duckdb.DuckDBPyConnection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))

    con.execute("""
        CREATE TABLE IF NOT EXISTS sites (
            site_id   TEXT PRIMARY KEY,
            site_uuid TEXT UNIQUE,
            site_name TEXT,
            domain    TEXT,
            created_at TIMESTAMP
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS events (
            event_id   TEXT PRIMARY KEY,
            site_id    TEXT,
            uuid       TEXT,
            session_id TEXT,
            event_name TEXT,
            page_path  TEXT,
            timestamp  TIMESTAMP,
            properties TEXT
        )
    """)

    # Index for journey sequencing
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_uuid_timestamp
        ON events (uuid, timestamp)
    """)

    # Index for site filtering
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_site_id
        ON events (site_id)
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS hives (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            conditions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT current_timestamp,
            updated_at TIMESTAMP DEFAULT current_timestamp
        )
    """)

    return con
