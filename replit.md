# CloudClip - Web Clipboard (网络剪贴板)

## Overview
Real-time cross-platform web clipboard app with Apple Fluid Glass (Glassmorphism) design. Users join rooms by code to sync clipboard content across devices instantly.

## Tech Stack
- **Frontend**: React (Vite) + Tailwind CSS v4 + Framer Motion + Lucide Icons
- **Backend**: Node.js + Express + Socket.io (real-time sync)
- **Database**: SQLite via better-sqlite3 (persistent history)
- **Routing**: wouter (client-side), Express (server API)

## Architecture
- `/` — Landing page with hero, features, and security sections
- `/app` — Main clipboard app with room-based authentication

### Backend
- `server/index.ts` — Express + HTTP server setup
- `server/routes.ts` — REST API routes + Socket.io event handlers
- `server/storage.ts` — SQLite storage layer with migration support
- `shared/schema.ts` — Shared TypeScript types (Clip, RoomMessage)

### Frontend
- `client/src/pages/Landing.tsx` — Marketing/landing page
- `client/src/pages/Home.tsx` — Main app (room join, compose, clip grid)
- `client/src/App.tsx` — Router setup with wouter

## Core Features
1. **Room-based sync**: Enter a room code, all devices in same room share clips via WebSocket
2. **Real-time updates**: Socket.io broadcasts new clips, deletes, clears to all room members
3. **Multi-format**: Auto-detects text, links, code snippets; supports image upload (base64)
4. **File/Image upload**: Drag-drop or file picker for images, displays preview in cards
5. **Search & Filter**: Filter by type (text/link/image/code), favorites, search by content
6. **Favorites**: Star clips (stored in localStorage per device)
7. **Sensitive masking**: Mark clips as sensitive, content hidden until revealed
8. **Burn after read**: Clips auto-delete after being copied once
9. **Lock screen**: PIN-based app lock (client-side visual lock)
10. **Incognito mode**: Visual indicator for privacy-conscious usage
11. **Dark/Light theme**: Full theme support with glassmorphism design
12. **PWA**: manifest.json configured for installability

## Database
- SQLite file: `clipboard.db` (gitignored)
- Single `clips` table with columns: id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read
- Auto-migration on startup for schema changes

## Socket.io Events
- `join-room` → server sends `clip:history`
- `send-clip` → server broadcasts `clip:new`
- `delete-clip` → server broadcasts `clip:delete`
- `clear-room` → server broadcasts `clip:clear`
- `room-users` → online device count updates

## Design System
- Glassmorphism: `glass-panel`, `glass-card`, `glass-input`, `glass-button` utilities
- Background: fixed landscape photo at `/images/background.jpg`
- Fonts: Plus Jakarta Sans + Inter
