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

### Backend
- `server/index.ts` — Express + HTTP server setup
- `server/routes.ts` — REST API routes + Socket.io event handlers
- `server/storage.ts` — SQLite storage layer with migration support + room passwords
- `shared/schema.ts` — Shared TypeScript types (Clip, Attachment, RoomMessage, RoomInfo)

### Frontend
- `client/src/pages/Landing.tsx` — Marketing/landing page
- `client/src/pages/Home.tsx` — Main app (room join, compose, clip grid, detail modal)
- `client/src/App.tsx` — Router setup with wouter

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
11. **Favorites**: Star clips (stored in localStorage per device)
12. **Sensitive masking**: Mark clips as sensitive, content hidden until revealed
13. **Burn after read**: Clips auto-delete after being copied once
14. **Lock screen**: PIN-based app lock
15. **Incognito mode**: Visual indicator for privacy-conscious usage
16. **Dark/Light theme**: Full theme support with glassmorphism design
17. **User accounts**: Login/register for unlocking permanent room creation
18. **Room expiry**: Configurable auto-destroy (1h/24h/7d/30d/permanent). Only logged-in users can set permanent
19. **Room tokens**: Server issues access tokens on successful join; socket.io validates tokens before sending data

## Database
- SQLite file: `clipboard.db` (gitignored)
- Tables:
  - `users`: id, username, password_hash (SHA-256), created_at
  - `clips`: id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments (JSON)
  - `rooms`: room_code, password_hash (SHA-256, nullable), owner_id, expires_at, created_at
- Auto-migration on startup for schema changes

## Socket.io Events
- `join-room` → server sends `clip:history`
- `send-clip` → server broadcasts `clip:new` (supports attachments array)
- `update-clip` → server broadcasts `clip:update`
- `delete-clip` → server broadcasts `clip:delete`
- `clear-room` → server broadcasts `clip:clear`
- `room-users` → online device count updates

## API Routes
- `GET /api/rooms/:roomCode` — Check if room exists
- `POST /api/rooms/:roomCode/join` — Create or join room with password
- `GET /api/rooms/:roomCode/clips` — Get room clips
- `DELETE /api/rooms/:roomCode/clips/:clipId` — Delete single clip
- `DELETE /api/rooms/:roomCode/clips` — Clear all room clips

## Design System
- Glassmorphism: `glass-panel`, `glass-card`, `glass-input`, `glass-button` utilities
- Background: fixed landscape photo at `/images/background.jpg`
- Fonts: Plus Jakarta Sans + Inter
