# Tallymancer

Real-time score tracker for any trading card game — Lorcana, MTG, Star Wars Unlimited, Yu-Gi-Oh!, or a custom setup. No login required.

## Features

- **Instant sessions** — create a game, get two share links (player + audience), done
- **Live sync** — score changes appear on all devices in under a second via WebSocket
- **Table view** — lay the phone flat; each player's panel rotates to face their seat
- **Score history** — full event log with undo, voided events marked inline
- **PWA** — installable on Android and iOS, offline app shell
- **Multi-game presets** — MTG (20 / 40 life), Lorcana, Star Wars Unlimited, Yu-Gi-Oh!, Custom

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, SQLite → Postgres-ready |
| Frontend | React 18, Vite, vite-plugin-pwa |
| Infra | Docker + nginx, deployed behind Traefik on a Linux VPS |

## Quick start (local dev, no Docker)

```bash
# 1. Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# API + Swagger UI: http://localhost:8000/docs

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/ws/*` to the backend automatically — no CORS config needed.

## Local dev with Docker Compose

```bash
docker compose up --build
# App: http://localhost   (nginx serves built frontend)
# API: http://localhost:8000
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:////app/data/tallymancer.db` | SQLAlchemy DB URL |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | Base URL for generated share links |
| `SESSION_EXPIRY_HOURS` | `48` | Hours of inactivity before a session expires |

Copy `.env.example` → `.env` and edit before deploying.

## Production deployment (Traefik + VPS)

```bash
# On the VPS, in the project directory:
cp .env.example .env
# Edit .env: set PUBLIC_BASE_URL=https://tallymancer.com, DOMAIN=tallymancer.com

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` adds Traefik labels and joins the `traefik` external network. Traefik issues Let's Encrypt certs automatically once DNS is pointed at the VPS.

Prerequisites:
- Traefik running and attached to a Docker network named `traefik`
- DNS A record for `tallymancer.com` → VPS IP
- Traefik configured with `entrypoints.websecure` (:443) and a `letsencrypt` cert resolver

## Project structure

```
tallymancer/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, CORS, router includes
│   │   ├── database.py      # SQLAlchemy engine + session factory
│   │   ├── models.py        # ORM models: Session, SessionToken, Player, ScoreEvent
│   │   ├── schemas.py       # Pydantic request/response schemas
│   │   ├── presets.py       # Game preset definitions
│   │   ├── state.py         # Shared helpers: current scores, session payload
│   │   ├── ws_manager.py    # WebSocket connection registry + broadcast
│   │   └── routers/
│   │       ├── sessions.py  # POST /api/sessions, GET /api/sessions/{token}
│   │       ├── players.py   # Player CRUD
│   │       ├── scores.py    # Score deltas, undo, history
│   │       └── websocket.py # ws://.../ws/{token}
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api.js                     # REST client
│   │   ├── hooks/useWebSocket.js      # WS hook with reconnect + heartbeat
│   │   ├── pages/
│   │   │   ├── HomePage.jsx           # Session creation form
│   │   │   └── SessionPage.jsx        # Main game view
│   │   └── components/
│   │       ├── PlayerCard.jsx         # Score display + controls
│   │       ├── TableView.jsx          # Phone-flat rotation mode
│   │       ├── HistoryPanel.jsx       # Score event log
│   │       └── ConnectionStatus.jsx   # WS status indicator
│   ├── public/                        # PWA icons
│   ├── nginx.conf                     # SPA routing + API/WS proxy
│   ├── Dockerfile
│   └── vite.config.js
├── scripts/
│   └── generate_icons.py              # Generates PWA PNG icons (no deps)
├── docker-compose.yml                 # Local + base production config
├── docker-compose.prod.yml            # Traefik labels overlay
└── .env.example
```

## Token / role model

Sessions have two share links, each backed by a UUID token in the `session_tokens` table:

| Token type | Rights |
|---|---|
| `player` | Apply score deltas, rename players, add/remove players, undo |
| `audience` | Read-only live scoreboard |

The role is resolved entirely server-side on every request and WebSocket connection. The client never sends a role claim — the token *is* the credential.

## Score history

All score changes are stored in `score_events` as an append-only log. Current score = the `resulting_score` of the most recent non-voided event per `(player_id, counter_name)`. Undo sets `is_voided = true` on the last event — no rows are ever deleted or updated.

## Adding a new game preset

Edit `backend/app/presets.py` and add an entry to the `PRESETS` dict:

```python
"mygame": {
    "slug": "mygame",
    "name": "My Game",
    "counters": [
        {"name": "hp", "label": "HP", "starting": 40, "floor": 0, "ceiling": None, "counts_up": False},
    ],
    "win_condition": "Last player with HP > 0 wins",
},
```

No DB migration needed — presets are data, not schema.
