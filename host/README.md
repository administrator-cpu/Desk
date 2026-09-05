# rap-host

Electron host app — the controlled side (Phase 3), with a throwaway React
stand-in used during Phase 2.

Not started yet. Per the implementation plan:
- Phase 2 (step 2.4): a minimal throwaway React "sender" — not Electron —
  that calls `host:create-room` and captures its own tab via
  `getDisplayMedia`. This proves the video pipe without touching Electron.
- Phase 3 (step 3.1): scaffold the real Electron + React host app, port the
  proven signaling logic over, then swap in `desktopCapturer` and `nut.js`.

See `remote-access-platform-app-flow.md` (Part B) for every screen this app
needs: B1 Tray -> B2 Code Display -> B3 Accept/Decline -> B4 Active Session
(host view) -> B5 Settings.
