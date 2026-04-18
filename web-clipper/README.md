# CloudClip Web Clipper (P3 scaffold)

A minimal Chrome/Edge Manifest V3 extension that clips current-page content into a CloudClip room.

## Features
- Clip current text selection + page metadata.
- Clip page title + URL as a link entry.
- Uses existing CloudClip room flow:
  1. `POST /api/rooms/:roomCode/join` to obtain room token.
  2. `POST /api/rooms/:roomCode/clips` to create clip via REST.

## Load locally
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `web-clipper/` folder.

## Configure
In the popup set:
- **App URL**: your CloudClip server origin (e.g. `https://your-app.example.com`)
- **Room Code**
- **Room Password** (optional)
- **Room Token** (optional, if already obtained in app settings)

Then click **Clip Selection** or **Clip Page Link**.
