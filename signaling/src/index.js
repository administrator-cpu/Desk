import express from "express";
import http from "node:http";
import { Server } from "socket.io";

import { RoomStore, RoomError } from "./rooms.js";
import { RateLimiter } from "./rateLimiter.js";
import { validate } from "./schemas.js";
import { issueTurnCredentials } from "./turn.js";
import { logEvent, startCleanupSchedule } from "./complianceLog.js";

const PORT = process.env.PORT || 4000;

const app = express();

// Step 1.1 — single /health REST endpoint for deploy verification.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: rooms.size(), uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || "*" },
});

const rooms = new RoomStore();
const rateLimiter = new RateLimiter();

// Tracks the active host<->viewer socket pairing once a room has been
// accepted (and therefore deleted from `rooms`). This is purely ephemeral
// routing state for blind relay of signal:*/session:end/message events —
// it is NOT the persistent `sessions` Mongo collection from Phase 4, which
// only gets written once WebRTC actually connects (Backend Schema §2.3).
const activePairs = new Map(); // socketId -> peerSocketId

function pairSockets(a, b) {
  activePairs.set(a, b);
  activePairs.set(b, a);
}

function unpairSocket(socketId) {
  const peer = activePairs.get(socketId);
  if (peer) activePairs.delete(peer);
  activePairs.delete(socketId);
  return peer;
}

// Emitted whenever a room's TTL fires without ever being paired.
rooms.onExpire = (room) => {
  io.to(room.hostSocketId).emit("room:code-expired", {});
};

function getSourceIp(socket) {
  // x-forwarded-for first (Render/most PaaS sit behind a proxy), fall back
  // to the raw socket address for local/dev testing.
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return socket.handshake.address;
}

/** Validates an incoming payload against schemas.js; emits `error` and returns null on failure. */
function parseOrReject(socket, eventName, payload) {
  const result = validate(eventName, payload);
  if (!result.ok) {
    socket.emit("error", { error: "invalid_payload", event: eventName });
    return null;
  }
  return result.data;
}

io.on("connection", (socket) => {
  socket.on("host:create-room", (payload) => {
    if (!parseOrReject(socket, "host:create-room", payload)) return;
    const { code, expiresAt } = rooms.createRoom(socket.id);
    logEvent("room_created", { code, sourceIp: getSourceIp(socket) });
    socket.emit("room:created", { code, expiresAt });
  });

  socket.on("viewer:join-room", (payload) => {
    const data = parseOrReject(socket, "viewer:join-room", payload);
    if (!data) return;

    const sourceIp = getSourceIp(socket);
    if (!rateLimiter.attempt(sourceIp)) {
      // Never leak whether the code itself was valid (Backend Schema §3.2 / TRD §2.1).
      logEvent("join_attempt", { code: data.code, sourceIp, outcome: "rate_limited" });
      socket.emit("error", { error: "rate_limited" });
      return;
    }

    try {
      const room = rooms.requestJoin(data.code, socket.id);
      logEvent("join_attempt", { code: data.code, sourceIp, outcome: "pending_accept" });
      socket.emit("viewer:join-accepted-pending"); // internal ack the viewer app can ignore/use for loading state
      io.to(room.hostSocketId).emit("viewer:request-join", {
        viewerSocketId: socket.id,
        viewerMeta: { ip: sourceIp, userAgent: socket.handshake.headers["user-agent"] },
      });
    } catch (err) {
      if (err instanceof RoomError) {
        logEvent("join_attempt", { code: data.code, sourceIp, outcome: err.code });
        socket.emit("error", { error: err.code });
      } else {
        throw err;
      }
    }
  });

  socket.on("viewer:cancel-request", (payload) => {
    if (!parseOrReject(socket, "viewer:cancel-request", payload)) return;
    // Find any room where this socket is the pending viewer and revert it to open.
    for (const room of rooms.rooms.values()) {
      if (room.pendingViewerSocketId === socket.id) {
        rooms.reject(room.code, room.hostSocketId);
        break;
      }
    }
  });

  socket.on("host:accept", async (payload) => {
    const data = parseOrReject(socket, "host:accept", payload);
    if (!data) return;

    // Find the room this host owns whose pending viewer matches.
    const room = [...rooms.rooms.values()].find(
      (r) => r.hostSocketId === socket.id && r.pendingViewerSocketId === data.viewerSocketId
    );
    if (!room) {
      socket.emit("error", { error: "invalid_code" });
      return;
    }

    try {
      const { viewerSocketId } = rooms.accept(room.code, socket.id);
      pairSockets(socket.id, viewerSocketId);
      logEvent("session_start", { code: room.code, hostSourceIp: getSourceIp(socket), viewerSocketId });
      // Both peers configure ICE independently against the TURN
      // provider/secret, so each can be issued its own credential — they
      // don't need to be identical, just each independently valid. The
      // event contract (TRD §2.2/Backend Schema §4) only specifies
      // host:accepted carrying credentials to the *viewer*; the host needs
      // the same thing to build its own RTCPeerConnection, so it gets an
      // equivalent ack here.
      // turnCredentials may be null (no TURN configured, or the provider is
      // unreachable/over quota) — issueTurnCredentials() never throws, and
      // callers on both ends build a STUN-only ICE config when it's null,
      // so pairing itself never blocks on TURN being available.
      const turnCredentials = await issueTurnCredentials({ sessionId: `${room.code}-${Date.now()}` });
      io.to(viewerSocketId).emit("host:accepted", { turnCredentials });
      socket.emit("host:accept-ack", { turnCredentials });
    } catch (err) {
      if (err instanceof RoomError) {
        socket.emit("error", { error: err.code });
      } else {
        throw err;
      }
    }
  });

  socket.on("host:reject", (payload) => {
    const data = parseOrReject(socket, "host:reject", payload);
    if (!data) return;

    const room = [...rooms.rooms.values()].find(
      (r) => r.hostSocketId === socket.id && r.pendingViewerSocketId === data.viewerSocketId
    );
    if (!room) {
      socket.emit("error", { error: "invalid_code" });
      return;
    }
    rooms.reject(room.code, socket.id);
    logEvent("session_reject", { code: room.code, sourceIp: getSourceIp(socket) });
    io.to(data.viewerSocketId).emit("host:reject");
  });

  // Blind relay events — server never inspects sdp/candidate contents beyond
  // shape validation (TRD §2.2: "sdp blobs which get relayed blind").
  for (const eventName of ["signal:offer", "signal:answer", "signal:ice-candidate"]) {
    socket.on(eventName, (payload) => {
      const data = parseOrReject(socket, eventName, payload);
      if (!data) return;
      const peer = activePairs.get(socket.id);
      if (!peer) return; // no active pairing to relay to
      io.to(peer).emit(eventName, data);
    });
  }

  socket.on("session:end", (payload) => {
    const data = parseOrReject(socket, "session:end", payload);
    if (!data) return;
    logEvent("session_end", { reason: data.reason, sourceIp: getSourceIp(socket) });
    const peer = unpairSocket(socket.id);
    if (peer) io.to(peer).emit("session:end", data);
  });

  // Phase 1 exit-criterion helper only: free-text message exchange used by
  // the throwaway test harness (step 1.9) to prove pairing works before any
  // WebRTC code exists. Not part of the Backend Schema event contract.
  socket.on("message", (payload) => {
    const peer = activePairs.get(socket.id);
    if (!peer) return;
    io.to(peer).emit("message", payload);
  });

  socket.on("disconnect", () => {
    rooms.deleteRoomsForSocket(socket.id);
    const peer = unpairSocket(socket.id);
    if (peer) io.to(peer).emit("session:end", { reason: "error" });
  });
});

server.listen(PORT, () => {
  startCleanupSchedule(); // CERT-In compliance logging — see complianceLog.js
  console.log(`Signaling server listening on :${PORT}`);
});
