# rap-signaling

Phase 1 of the browser-based remote access platform: the matchmaker. Two
clients can join the same room via a 9-digit code and exchange messages
through the server. No WebRTC media flows through here — see the `viewer`
and `host` repos for that (Phase 2+).

## What's implemented (implementation-plan steps 1.1–1.9)

- Express app with Socket.io attached, `/health` endpoint (1.1)
- `room:{code}` in-memory `Map` exactly per Backend Schema §3.1 (1.2)
- `host:create-room` with CSPRNG code generation (1.3)
- `viewer:join-room` with code validation (1.4)
- Accept/reject branch: `viewer:request-join` → `host:accept`/`host:reject` (1.5)
- 120s TTL expiry + single-use invalidation on accept (1.6)
- Rate limiting on `viewer:join-room` per source IP, 10/min (1.7)
- `zod` validation rejecting malformed/extra fields on every event (1.8)
- Test harness: two plain Socket.io clients exercising the full
  create → join → accept → message flow (1.9)
- TURN credential issuance (TRD §2.3) wired into `host:accepted`, using
  placeholder URLs until real TURN infra (step 0.4) is provisioned
- Blind relay of `signal:offer`/`signal:answer`/`signal:ice-candidate`/
  `session:end` between paired sockets — ready for Phase 2 to start using
  without touching this server again

## Running locally

```
npm install
npm start          # listens on :4000 (PORT env var to override)
```

## Testing

```
npm run test:harness           # steps 1.9: create -> join -> accept -> message
node test/run-edgecases.js     # invalid code, rate limit, reject-and-reuse, malformed payload
node test/run-ttl.js           # TTL expiry -> room:code-expired -> code rejected after
```

To re-run the harness against a deployed instance (step 1.10):

```
SIGNALING_URL=https://your-app.onrender.com node test/run-harness.js
```

## Still open (not code — infra/accounts, per Day 0 and cross-cutting notes)

- [ ] Deploy this to Render (or equivalent) — step 1.10
- [ ] Provision real TURN (self-hosted `coturn` or managed provider) and set
      `TURN_SHARED_SECRET` / `TURN_URLS` env vars — step 0.4. Until then,
      `host:accepted` ships syntactically-valid but non-functional TURN
      credentials pointed at a placeholder host.
- [ ] Apple Developer Program enrollment + Windows code-signing cert — step
      0.3, needed by Phase 3, has multi-day lead time, start now.
- [ ] MongoDB Atlas cluster — step 0.5, not needed until Phase 4.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP/Socket.io listen port |
| `ALLOWED_ORIGIN` | `*` | CORS origin for Socket.io (set to the Viewer's deployed URL before going live) |
| `TURN_SHARED_SECRET` | dev placeholder | coturn `static-auth-secret` for HMAC credential signing |
| `TURN_URLS` | placeholder invalid host | comma-separated `turn:`/`turns:` URLs |
| `ROOM_TTL_MS` | `120000` | **test-only** override for the room TTL; never set in production |
