# Tallymancer — CLAUDE.md

## Project overview
Tallymancer is a real-time, shareable score/life tracker for any TCG (Lorcana, MTG, Star Wars Unlimited, Yu-Gi-Oh!, Custom). PWA-first, no login required, session-link model.

**Full spec:** `docs/project_brief.md`

## Tech stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.x, SQLite (dev) → Postgres-ready
- **Frontend:** React 18 + Vite, PWA (planned step 3+)
- **Infra:** Docker + Docker Compose, deployed behind Traefik on Hostinger VPS

## Directory layout
```
tallymancer/
├── backend/          # FastAPI app
│   ├── app/
│   │   ├── main.py         # FastAPI app entry point
│   │   ├── database.py     # SQLAlchemy engine + session factory
│   │   ├── models.py       # ORM models (sessions, players, score_events)
│   │   ├── schemas.py      # Pydantic request/response schemas
│   │   ├── presets.py      # Game preset definitions (data, not code)
│   │   └── routers/
│   │       ├── sessions.py
│   │       ├── players.py
│   │       └── scores.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/         # React + Vite (step 3+)
├── docs/
│   └── project_brief.md
├── docker-compose.yml
└── CLAUDE.md
```

## Build order (from spec)
- [x] **Step 1** — Data model + FastAPI REST skeleton
- [x] **Step 2** — WebSocket broadcast layer + reconnect/resync
- [x] **Step 3** — React UI (list view, +/−, free-text math, editable names)
- [x] **Step 4** — Share links + role enforcement (player vs audience)
- [x] **Step 5** — Table view rotation mode
- [x] **Step 6** — PWA manifest/SW, Docker + Traefik deployment
- [x] **Step 7** — Polish: undo, history log, presets, session expiry

## Running locally (backend)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Swagger UI: http://localhost:8000/docs
```

## Key conventions
- Code must be **heavily commented** — developer is learning. Explain the *why*, WebSocket patterns, token/role model, etc.
- All config via environment variables; never hardcode URLs, secrets, or domain names.
- The append-only `score_events` table is sacred — never mutate rows, only append.
- Token→role enforcement always happens server-side. Never trust a client-supplied role flag.
- `owner_id` on sessions is nullable (null = anonymous); don't build auth, but the column must exist.
- Link/token model supports distinct *types* (player, audience, overlay…) via a `token_type` column so new types can be added without schema changes.

## Data model summary
- **sessions:** id, player_token, audience_token, game_preset, preset_config (JSON), owner_id (nullable), created_at, last_activity_at
- **players:** id, session_id, name, color (nullable), seat_position, created_at, is_active
- **score_events:** id, session_id, player_id, counter_name (default "life"), delta, resulting_score, created_at — append-only log; current score = latest `resulting_score` per player+counter

## Environment variables
| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy DB URL | `sqlite:///./tallymancer.db` |
| `PUBLIC_BASE_URL` | Used to generate share links | `http://localhost:8000` |
| `SESSION_EXPIRY_HOURS` | Hours of inactivity before archiving | `48` |

## Deployment notes
- Development on Windows; deployment target is Docker on Linux VPS (72.62.91.176)
- `docker-compose.yml` works for both local dev and production (env-var driven)
- Traefik handles HTTPS + WebSocket upgrade; domain is `tallymancer.com`
- Frontend API URL set via `VITE_API_URL` env var
