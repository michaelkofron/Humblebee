# ── Stage 1: build frontend ──────────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend source
COPY backend/ ./backend/

# Built frontend (from stage 1)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Writable storage dir for DuckDB (override with DB_PATH env var + Railway Volume)
RUN mkdir -p storage

EXPOSE 8000

CMD ["sh", "-c", "cd backend && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
