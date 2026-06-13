# Project Brief: Tallymancer — Universal TCG Score Tracker

**Tagline:** One scorecard to rule them all.

## One-line summary
Tallymancer is a real-time, shareable score/life tracker for any trading card game (Lorcana, Magic: The Gathering, Star Wars Unlimited, Yu-Gi-Oh!, and others), supporting any number of players, built as a PWA with a future path to app stores and Twitch overlays.

## Developer context
- Developer is a newer Python dev, comfortable with FastAPI, React (via guided builds), n8n, and Linux VPS administration.
- Deployment target: existing Hostinger VPS running Traefik as reverse proxy (Docker-based). Netlify available for static frontend hosting if preferred.
- Development happens in VS Code with Claude Code.

## Core product decisions (already made — do not revisit)
1. **PWA-first.** Single React codebase, installable on mobile, responsive on desktop. Capacitor wrap for app stores is a later phase, so avoid browser-only APIs without fallbacks.
2. **FastAPI backend with WebSockets** for real-time sync. SQLite to start (single VPS, low traffic), with SQLAlchemy so a Postgres migration later is trivial.
3. **Session-link model is the heart of the product.** No accounts/login in v1. Sessions are created anonymously and accessed via links.

## Functional requirements

### Game sessions
- Anyone can create a new session instantly (no signup).
- Creator chooses: game preset (Lorcana, MTG, Star Wars Unlimited, Yu-Gi-Oh!, Custom) or a fully custom setup.
- Presets define: starting score (e.g., MTG 20/40, Yu-Gi-Oh! 8000, Lorcana 0 counting up to 20), whether score counts up or down, and win condition display (optional, informational only).
- Unlimited players per session (practically capped at ~12 for UI sanity).
- Players have **editable names** at any time during the session (tap name to rename).
- Players can be added or removed mid-session.
- Optional per-player color/avatar for quick identification.

### Scoring
- Big +1 / −1 buttons per player (primary interaction, must be thumb-friendly).
- Long-press or secondary buttons for +5 / −5 (configurable step sizes).
- **Free-text math input:** typing "-5", "+12", or "1000" into a player's input applies it arithmetically to the current score. Support negative results unless the preset floors at 0.
- Full score history/log per session (who changed what, when) with an undo for the last change.
- Support multiple counters per player in presets that need it (e.g., MTG: life + poison + commander damage). v1 can ship with life only, but model the data so additional counters slot in.

### Shareable sessions (the killer feature)
- On session creation, generate two links:
  - **Player link** (edit rights): anyone with it can join as a player or edit scores.
  - **Audience link** (view-only): live scoreboard, no controls.
- Links contain unguessable tokens (UUID4 or similar); role is determined server-side by token, never by a client-side flag.
- All connected clients receive score updates in real time via WebSocket. Handle reconnects gracefully (resync full state on reconnect).
- Sessions persist on the server (survive page refresh and phone lock). Auto-expire/archive after e.g. 48h of inactivity.

### Table view (phone-in-the-middle mode)
- A display mode where one phone/tablet lies flat on the table and each player's score panel is **rotated to face that player's seat**.
- 2 players: panels rotated 180° from each other. 3–4+ players: panels arranged around the screen edges facing outward (like MTG companion apps do).
- Each rotated panel keeps its own +/− buttons so players tap from their own side.
- Toggleable between "list view" (normal orientation, good for one person holding the phone) and "table view".

### Future phases (design for, don't build yet)
- **Twitch overlay:** a third link type rendering a minimal, transparent-background, view-only scoreboard sized for OBS browser sources. The audience-link architecture should make this nearly free.
- Capacitor wrap for iOS/Android app stores.
- Optional accounts for saved player profiles and match history.
- n8n webhook on session events (e.g., game end) for automation experiments.

## Technical architecture

### Backend (FastAPI, Python)
- REST endpoints: create session, get session state, add/remove/rename player, apply score delta, undo.
- WebSocket endpoint per session for live state broadcast.
- Token-based authorization: every request/WS connection carries the link token; server maps token → session + role (player/viewer) and enforces permissions.
- SQLite + SQLAlchemy. Tables: sessions, players, score_events (append-only log — current score is derived or cached).
- Dockerized, deployed behind Traefik with HTTPS and WebSocket support (Traefik handles WS upgrade natively).

### Frontend (React + Vite, PWA)
- Mobile-first responsive design. Large touch targets.
- State synced via WebSocket; optimistic UI updates with server reconciliation.
- PWA manifest + service worker (installable, basic offline shell; scores require connectivity by nature).
- Table view implemented with CSS transforms (rotate panels per seat position).
- Host on Netlify or serve from the VPS — developer's choice; API URL configurable via env.

### Non-functional
- No personal data collected in v1 (names are session-scoped, ephemeral). Keep it GDPR-trivial.
- Target: score update visible on all devices in <500ms on normal connections.
- Code should be heavily commented — developer is learning and wants to understand the patterns, especially WebSockets and the token/role model.

## Monetization roadmap (informs architecture, not v1 scope)

### Tier model
1. **Anonymous (no login) — the full core product.** Create sessions, unlimited players, all game presets, +/− and free-text scoring, player and audience share links, table view, offline PWA use. Share links must never require the recipient to log in. This tier is the growth engine; never gate it.
2. **Free account (optional login).** Adds persistence: saved favorite games/presets (e.g., your go-to format loads in one tap instead of menu-digging), default player names/colors, session history list. Login is additive only — nothing anonymous users have is taken away.
3. **Paid (subscription ~€2–4/mo or one-time unlock, pricing TBD).** Twitch/OBS overlay link type with customizable styling (strongest paid feature — streamers pay for overlay tooling), persistent match history and stats across sessions, custom themes/branding, advanced counters (e.g., commander damage grid).
4. **B2B / Tournaments (later, higher price point).** Tournament mode for local game stores and event organizers: multi-table dashboard, round/pairing display, store branding. Treated as a separate paid product tier, not a consumer feature.

### Explicitly rejected
- **Ads** — would poison the audience/overlay views and table experience.
- **Gating share links or core scoring** — share links are the marketing channel.

### Architectural hooks required in v1 (cheap now, expensive later)
- `owner_id` on sessions: nullable, null = anonymous session. No auth system built yet, but the column exists.
- Keep the append-only score event log (already specced) — it becomes the paid match-history feature with zero migration.
- Link/token model supports distinct link *types* (player, audience, overlay, future: tournament-admin) so new types can be added and gated without schema changes.
- Preset definitions stored as data (DB/JSON), not hardcoded, so user-saved custom presets slot in later.
- No payment provider integration in v1. When needed: Stripe or Paddle (Paddle is merchant-of-record, which simplifies EU/German VAT for a solo Freiberufler — evaluate at that time).

## Domain & DNS
- **Chosen name: Tallymancer.** Domains purchased (Hostinger package): **tallymancer.com** (primary — all hosting, links, and DNS live here), plus **.org** and **.online** to be set up as 301 redirects to the .com via Hostinger domain forwarding (panel task, still TODO). Never serve content from the redirect domains.
- **DNS is already configured (June 2026):** apex A record → VPS at 72.62.91.176 (srv1198285); `www` is a CNAME to the apex (kept from Hostinger defaults, follows automatically); `www` AAAA → 2a02:4780:41:8f87::1. Known gap: apex AAAA record may be missing — verify/re-add in hPanel (AAAA, @, 2a02:4780:41:8f87::1). TTLs are set low (300s) for setup; raise to 3600 once stable.
- Traefik on the VPS can issue Let's Encrypt certs for tallymancer.com as soon as a service is deployed with that hostname rule. Until then, the domain returns a Traefik 404 — expected.
- Build everything hostname-agnostic regardless:
  - Frontend API/WS base URL via environment variable (`VITE_API_URL` or similar), never hardcoded.
  - Traefik router rules driven by a `DOMAIN` env var in the compose file, so the hostname is a one-line change.
  - Share links generated from a configurable `PUBLIC_BASE_URL`, not from request headers.
- DNS: A record for the apex (and `www` if desired) pointing to the VPS IP; Traefik handles Let's Encrypt certs automatically.
- Consider a separate subdomain for the API (`api.domain.tld`) vs serving frontend and API from one host with path routing — developer preference; path routing on one domain is simpler and keeps share links clean.

## Suggested build order
1. Data model + FastAPI REST skeleton (create session, players, score deltas) with tests via curl/httpie.
2. WebSocket broadcast layer + reconnect/resync logic.
3. React UI: list view with +/− buttons, free-text math input, editable names.
4. Share links + role enforcement (player vs audience views).
5. Table view rotation mode.
6. PWA manifest/service worker, Docker + Traefik deployment. **Note: development happens on Windows, deployment target is Docker on a Linux VPS — set up a `docker-compose.yml` usable for local development too, so the local and production environments match ("works on my machine" = "works on the VPS").**
7. Polish: undo, history log, presets, session expiry.

## Definition of done for v1
Two phones on the same game: one creates a session with an MTG preset, renames players, shares the player link to phone 2 and an audience link to a laptop. Score changes from either phone appear on all three devices in under a second. Table view works with the phone flat between two players. Deployed on the VPS with HTTPS.