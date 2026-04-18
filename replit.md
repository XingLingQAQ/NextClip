# CloudClip - Web Clipboard (网络剪贴板)

## Overview
Real-time cross-platform web clipboard app with Apple Fluid Glass (Glassmorphism) design. Users join password-protected rooms to sync clipboard content across devices instantly.

## Tech Stack
- **Frontend**: React (Vite) + Tailwind CSS v4 + Framer Motion + Lucide Icons
- **Backend**: Node.js + Express + Socket.io (real-time sync)
- **Database**: SQLite via better-sqlite3 (persistent history)
- **Routing**: wouter (client-side), Express (server API)

## Architecture
- `/` — Landing page with hero, features, and security sections
- `/app` — Main clipboard app (room join → compose → clip grid)
- `/login` — Login page
- `/register` — Registration page

### Backend
- `server/index.ts` — Express + HTTP server setup
- `server/routes.ts` — REST API routes + Socket.io event handlers
- `server/storage.ts` — SQLite storage layer with migration support + room passwords
- `shared/schema.ts` — Shared TypeScript types (Clip, Attachment, RoomMessage, RoomInfo, User)

### Frontend
- `client/src/pages/Landing.tsx` — Marketing/landing page (i18n supported)
- `client/src/pages/Home.tsx` — Main app (room join, compose, clip grid, detail modal, settings)
- `client/src/pages/Auth.tsx` — Login/register page (i18n supported)
- `client/src/i18n.ts` — Internationalization system (Chinese/English)
- `client/src/App.tsx` — Router setup with wouter
- `Dockerfile` / `docker-compose.dev.yml` — Containerized runtime/deploy baseline
- `.github/workflows/ci.yml` — CI pipeline for typecheck/test/build

## Core Features
1. **Room-based sync**: Enter room code to join/create. Password optional — only prompted when room has one set
2. **Real-time updates**: Socket.io broadcasts new clips, deletes, clears, updates to all room members
3. **Mixed content clips**: A single clip can contain text + images + files together
4. **File/Image upload**: Drag-drop or file picker; attachments preview in compose area before sending
5. **Image preview**: Click image clips for full-screen preview with download button
6. **File display**: Files show filename only in card; click to preview text files or download
7. **Detail/Edit modal**: Click any text/code/link clip to open full-content view with edit capability
8. **Content truncation**: Long content truncated with line-clamp in cards; full view in modal
9. **Download support**: Images and files have download buttons (not just copy)
10. **Search & Filter**: Filter by type (text/link/image/code/file/mixed), favorites, search
11. **Shared pinning**: Pin clips persisted server-side and synchronized to all room members
12. **Sensitive masking**: Mark clips as sensitive, content hidden until revealed
13. **Burn after read**: Clips auto-delete after being copied once
14. **Lock screen**: PIN-based app lock
15. **Incognito mode**: Visual indicator for privacy-conscious usage
16. **Dark/Light theme**: Full theme support with glassmorphism design
17. **User accounts**: Session-based login/register via HttpOnly cookie
18. **Room expiry**: Configurable auto-destroy (1h/24h/7d/30d/permanent). Only logged-in users can set permanent
19. **Room tokens**: Server issues room access tokens on successful join; REST and socket both validate tokens
20. **Room owner enforcement**: Room management uses server-side session identity + valid room token
21. **i18n (Chinese/English)**: Full bilingual support. Default language is Chinese. Globe toggle on every screen.
22. **Interactive onboarding**: Step-by-step tooltips pointing at UI elements (room code input → join button on join screen; compose area → send button → settings button on main app). Skippable, persisted in localStorage.
23. **PinInput numbers-only**: Room password input accepts only digits (6-digit numeric PIN).
24. **Custom device identity**: Device name can be edited in Settings and persisted in localStorage for cross-session targeting labels.
25. **Security headers baseline**: Server sets CSP and common browser hardening headers in production.
26. **Soft delete + restore**: Clip delete/clear performs soft-delete and supports restore API.
27. **Audit trail**: Server writes room audit events for create/update/delete/clear/pin operations.
28. **Idempotent clip creation**: Optional idempotency key support for REST clip create to prevent duplicates.
29. **Incremental sync endpoint**: Server supports `since`-timestamp incremental clip fetch.

## i18n System
- File: `client/src/i18n.ts`
- Default language: Chinese (`zh`)
- Stored in `cloudclip-lang` localStorage key
- `useT()` hook returns `{ t, lang, setLang }`
- `setLang()` triggers page reload
- `LangToggle` component (Globe button) available on join screen, password screen, settings modal, auth pages, landing page

## Database
- SQLite file: `clipboard.db` (gitignored)
- Tables:
  - `users`: id, username, password_hash (scrypt + legacy SHA-256 migration), created_at
  - `clips`: id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments (JSON)
  - `rooms`: room_code, password_hash (scrypt, nullable), owner_id, expires_at, created_at
  - `pinned_clips`: room_code, clip_id, created_at
  - `user_sessions`: sid, expires_at, data
- Auto-migration on startup for schema changes
- Expired rooms auto-cleaned on startup + every 60 seconds

## Socket.io Events
- `join-room` → server sends `clip:history`
- `send-clip` → server broadcasts `clip:new` (supports attachments array)
- `update-clip` → server broadcasts `clip:update`
- `delete-clip` → server broadcasts `clip:delete`
- `clear-room` → server broadcasts `clip:clear`
- `pin-clip` → server broadcasts `clip:pin` with updated pinned ids
- `room-users` → online device count updates
- `room-devices` → online device list updates

## API Routes
- `GET /api/rooms/:roomCode` — Room summary + `canManage` capability (minimal fields by default)
- `POST /api/rooms/:roomCode/join` — Create or join room and return room token
- `POST /api/rooms/:roomCode/password` — Set/remove room password (owner-only when ownerId set)
- `POST /api/rooms/:roomCode/expiry` — Set room expiry (owner-only when ownerId set)
- `POST /api/rooms/:roomCode/clips` — Create clip (room-token protected)
- `GET /api/rooms/:roomCode/clips` — Get room clips
- `GET /api/rooms/:roomCode/clips/since/:timestamp` — Incremental sync since timestamp
- `DELETE /api/rooms/:roomCode/clips/:clipId` — Delete single clip
- `DELETE /api/rooms/:roomCode/clips` — Clear all room clips
- `POST /api/rooms/:roomCode/clips/:clipId/restore` — Restore soft-deleted clip
- `GET /api/rooms/:roomCode/audit` — Query audit events (auth + room-token)
- `POST /api/auth/register` — Create user account
- `POST /api/auth/login` — Login and get user info
- `GET /api/auth/me` — Get current session user
- `POST /api/auth/logout` — Logout current session

## Design System
- Glassmorphism: `glass-panel`, `glass-card`, `glass-input`, `glass-button` utilities
- Background: fixed landscape photo at `/images/background.jpg`
- Fonts: Plus Jakarta Sans + Inter
- Input text colors: `text-gray-900 dark:text-white` with matching light/dark backgrounds
