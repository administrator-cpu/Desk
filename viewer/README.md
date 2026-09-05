# rap-viewer

Next.js browser app — the controlling side (Phase 2+).

Not started yet. Per the implementation plan, this repo's first real work is
Phase 2, step 2.1: scaffold Next.js + Tailwind and build the A1 (Pairing
screen) UI against the `rap-signaling` server that's already passing its
Phase 1 tests.

    npx create-next-app@latest . --tailwind --eslint --app

See `remote-access-platform-app-flow.md` (Part A) for every screen this app
needs, in order: A1 Pairing -> A2 Waiting -> A3 Connecting -> A4 Active
Session -> A5 Ended -> (Phase 4) A6 Login -> A7 Dashboard.
