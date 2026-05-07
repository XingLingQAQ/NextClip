# NextClip

Real-time cross-device clipboard sharing. Instantly sync text, links, code, and images across all your devices.

## Architecture

```
┌─────────────────┐        ┌──────────────────────────┐
│  React SPA      │──HTTP──▶│  Go Backend              │
│  (Vite + TS)    │──WS────▶│  ├─ net/http (REST API)  │
│  client/        │         │  ├─ gorilla/websocket     │
└─────────────────┘         │  └─ SQLite (modernc.org)  │
                            └──────────────────────────┘
```

- **Backend**: Go 1.23+ — single binary, ~15MB, <100ms cold start
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + Framer Motion
- **Database**: SQLite (WAL mode) — same schema as legacy Node.js version
- **Realtime**: Native WebSocket (JSON protocol) replacing Socket.io

## Quick Start

### Prerequisites

- Go 1.23+
- Node.js 20+ (for frontend build only)

### Development

```bash
# Terminal 1: Start Go backend
make dev

# Terminal 2: Start Vite dev server (proxies /api and /ws to :5000)
cd client && npm install && npm run dev
```

Open http://localhost:3000

### Production Build

```bash
# Full build (frontend + backend binary)
make all

# Run
export SESSION_SECRET=$(openssl rand -base64 32)
./bin/nextclip
```

### Docker

```bash
export SESSION_SECRET=$(openssl rand -base64 32)
docker compose up --build
```

## Project Structure

```
NextClip/
├── cmd/server/main.go          # Entry point
├── internal/
│   ├── config/                 # Environment configuration
│   ├── model/                  # Shared types (User, Clip, Room, etc.)
│   ├── store/                  # SQLite data access layer
│   │   ├── sqlite.go          # DB init + migrations + cleanup
│   │   ├── users.go           # User CRUD + scrypt passwords
│   │   ├── rooms.go           # Room CRUD + token management
│   │   ├── clips.go           # Clip CRUD + burn-after-read
│   │   └── sessions.go        # Session store
│   ├── handler/                # HTTP route handlers
│   │   ├── auth.go            # /api/auth/*
│   │   ├── room.go            # /api/rooms/*
│   │   ├── clip.go            # /api/rooms/:code/clips/*
│   │   ├── ws.go              # WebSocket upgrade
│   │   └── static.go          # SPA file serving
│   ├── middleware/             # HTTP middleware chain
│   │   ├── security.go        # HSTS, CSP, X-Frame-Options
│   │   ├── cors.go            # CORS (strict in production)
│   │   ├── ratelimit.go       # Per-IP rate limiting
│   │   └── logger.go          # Request logging + ID
│   └── ws/                     # WebSocket layer
│       ├── hub.go             # Room broadcast + connection pool
│       └── client.go          # Per-connection message handling
├── client/                     # React SPA (built separately)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
├── web-clipper/                # Chrome extension
├── Makefile
├── Dockerfile
├── docker-compose.yml
└── go.mod
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | — | Secret for session signing (min 32 chars) |
| `PORT` | No | `5000` | HTTP listen port |
| `DB_PATH` | No | `clipboard.db` | SQLite database file path |
| `ALLOWED_ORIGINS` | No* | — | Comma-separated allowed CORS origins |
| `NODE_ENV` | No | `development` | Set to `production` for security hardening |
| `LOG_DEBUG` | No | `false` | Enable debug logging |

\* In production mode, if `ALLOWED_ORIGINS` is empty, all cross-origin WebSocket connections are rejected.

## API Endpoints

### Auth
- `GET /api/auth/csrf` — Get CSRF token
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Current user
- `POST /api/auth/logout` — Logout
- `POST /api/auth/password` — Change password
- `DELETE /api/auth/account` — Delete account

### Rooms
- `GET /api/rooms/:code` — Room info
- `POST /api/rooms/:code/join` — Join/create room
- `POST /api/rooms/:code/password` — Set room password
- `POST /api/rooms/:code/expiry` — Set room expiry
- `GET /api/rooms/:code/audit` — Audit log

### Clips
- `POST /api/rooms/:code/clips` — Create clip
- `GET /api/rooms/:code/clips` — List clips (paginated)
- `GET /api/rooms/:code/clips/since/:ts` — Incremental sync
- `DELETE /api/rooms/:code/clips/:id` — Delete clip
- `DELETE /api/rooms/:code/clips` — Clear all
- `POST /api/rooms/:code/clips/:id/restore` — Restore
- `POST /api/rooms/:code/clips/:id/consume` — Burn-after-read

### WebSocket
- `GET /ws` — WebSocket upgrade

Message format: `{"type": "<event>", "data": {...}}`

Events: `join-room`, `send-clip`, `delete-clip`, `clear-room`, `pin-clip`, `consume-clip`, `update-clip`

## Migration from Node.js

The Node.js/TypeScript backend is preserved on the `nodejs-backend` branch. The Go backend uses the same SQLite schema, so the `clipboard.db` file is directly compatible — no data migration needed.

Key differences:
- WebSocket uses native protocol instead of Socket.io (Engine.IO)
- Session cookie name changed from `connect.sid` to `session_id`
- Attachment size limit reduced to 2MB/file, max 5 files

## License

MIT
