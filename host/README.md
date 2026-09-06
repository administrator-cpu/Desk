# rap-host

Electron host app — the controlled side (Phase 3).

## Current scope (step 3.1)

- **B1 (tray icon)**: left/double-click opens B2, right-click shows
  Show / Generate New Code / Quit.
- **B2 (code display window)**: shows the current 9-digit code with a
  countdown, Copy Code, and Refresh Code.
- The socket connection and room state live in the **main process**
  (`src/main/index.js`), not the renderer — this matches App Flow B2's
  spec that "Generate New Code" works from the tray even with no window
  open. The renderer is a thin view fed by IPC.

Not yet built: B3 (Accept/Decline), B4 (Active Session), B5 (Settings),
`desktopCapturer` screen capture, or `nut.js` input — those are steps
3.2–3.10.

## Running locally

You need **two terminals** (no bundler glue between them yet — keep it
simple until packaging becomes relevant in step 3.13+):

```
# Terminal 1 — renderer dev server (must be running first)
npm install
npm run dev:renderer

# Terminal 2 — Electron itself
SIGNALING_URL=http://localhost:4000 npm run dev:electron
```

Point `SIGNALING_URL` at your deployed signaling server if you're not
running one locally.

You should see a small teal dot appear in your system tray (not a visible
window) — click it to open the B2 code-display window.

## What I could and couldn't verify from the sandbox this was built in

- ✅ Renderer type-checks (`tsc --noEmit`) and builds (`vite build`) cleanly
- ✅ `main/index.js` and `preload/index.js` pass a Node syntax check
- ✅ Attempting to launch Electron headlessly hit only environment-specific
  failures (no dbus system bus for the tray, no GPU) — no JavaScript errors
- ❌ Could NOT visually confirm the tray icon or window actually render —
  that needs a real desktop, which the build sandbox doesn't have

This is the first thing in this project you'll need to run yourself to
confirm before we move to step 3.2.
