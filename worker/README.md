# NextClip - Cloudflare Workers Deployment

This directory contains the Cloudflare Workers version of the NextClip backend.

## Architecture

- **Runtime:** Cloudflare Workers (edge)
- **Database:** Cloudflare D1 (SQLite at edge)
- **WebSocket:** Durable Objects
- **Password hashing:** PBKDF2 via Web Crypto API
- **Framework:** Hono (lightweight, Workers-native)

## Setup

### 1. Install dependencies

```bash
cd worker
npm install
```

### 2. Create D1 database

```bash
npx wrangler d1 create nextclip-db
```

Copy the returned `database_id` into `wrangler.toml`.

### 3. Run migrations

```bash
# Local development
npm run db:migrate

# Remote (production)
npm run db:migrate:remote
```

### 4. Development

```bash
npm run dev
```

This starts a local Workers dev server on `http://localhost:8787`.

### 5. Deploy

```bash
# Build client first
cd .. && npm run build:client && cd worker

# Deploy worker
npm run deploy
```

## Differences from Go Server

| Feature | Go Server | CF Workers |
|---------|-----------|------------|
| Password hashing | scrypt | PBKDF2 (Web Crypto) |
| WebSocket | gorilla/websocket | Durable Objects |
| Database | SQLite file | D1 (distributed SQLite) |
| Session storage | SQLite | D1 |
| Deployment | Docker/binary | `wrangler deploy` |
| Room tokens | In-memory (single process) | In-memory (per-isolate) |

## Important Notes

- **Scrypt passwords from Go server cannot be verified in Workers** (Web Crypto doesn't support scrypt). Users migrating from Go will need to reset passwords.
- **Room tokens are per-isolate**: In a multi-isolate deployment, a token issued by one isolate won't be recognized by another. For production, consider storing tokens in D1 or KV.
- The WebSocket implementation uses a simplified "global hub" Durable Object. For better scaling, route each room to its own DO instance based on roomCode.
