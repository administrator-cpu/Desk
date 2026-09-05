import crypto from "node:crypto";

const CODE_LENGTH = 9;
// 120s per TRD §2.1 / Backend Schema §3.1. Overridable via env purely so the
// test harness can verify expiry behavior without a real 2-minute wait —
// never override this in a deployed environment.
const TTL_MS = process.env.ROOM_TTL_MS ? Number(process.env.ROOM_TTL_MS) : 120_000;

/**
 * Thrown for all room-lifecycle failures. `code` matches the standardized
 * error enum in Backend Schema §6 so callers can emit it directly.
 */
export class RoomError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * In-memory implementation of the room:{code} map (Backend Schema §3.1).
 * Single-instance only — swap for a Redis-backed implementation with the
 * same method signatures before horizontally scaling the signaling server
 * (see TRD §7, "Signaling server: Stateless-capable").
 */
export class RoomStore {
  constructor({ ttlMs = TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, NodeJS.Timeout>} */
    this.timers = new Map();
  }

  _generateCode() {
    // CSPRNG per TRD §2.1 — never Math.random() for anything access-control-relevant.
    let code;
    do {
      code = String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * host:create-room — creates a fresh room in "open" status.
   * @returns {{ code: string, expiresAt: number }}
   */
  createRoom(hostSocketId) {
    const code = this._generateCode();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.ttlMs;

    /** @typedef {{
     *   code: string, hostSocketId: string, createdAt: number, expiresAt: number,
     *   status: "open"|"pending_accept"|"paired"|"expired", pendingViewerSocketId: string|null
     * }} Room */
    const room = {
      code,
      hostSocketId,
      createdAt,
      expiresAt,
      status: "open",
      pendingViewerSocketId: null,
    };
    this.rooms.set(code, room);
    this._armTtl(code);
    return { code, expiresAt };
  }

  _armTtl(code) {
    this._clearTtl(code);
    const room = this.rooms.get(code);
    if (!room) return;
    const delay = Math.max(0, room.expiresAt - Date.now());
    const timer = setTimeout(() => this._onTtlFired(code), delay);
    // Don't let a lingering timer keep the process alive during tests/shutdown.
    if (typeof timer.unref === "function") timer.unref();
    this.timers.set(code, timer);
  }

  _clearTtl(code) {
    const existing = this.timers.get(code);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(code);
    }
  }

  _onTtlFired(code) {
    const room = this.rooms.get(code);
    // Lifecycle rule (Backend Schema §3.1 step 5): TTL only deletes the room
    // if status isn't "paired" — a paired room is already deleted on accept.
    if (!room || room.status === "paired") return;
    this.rooms.delete(code);
    this.timers.delete(code);
    if (this.onExpire) this.onExpire(room);
  }

  /** Looks up a room by code, or null. Does not mutate state. */
  getRoom(code) {
    return this.rooms.get(code) ?? null;
  }

  /**
   * viewer:join-room — validates code against an "open" room and marks it
   * pending_accept. Throws RoomError("invalid_code") / RoomError("code_expired").
   */
  requestJoin(code, viewerSocketId) {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("invalid_code");
    if (room.status === "expired" || Date.now() >= room.expiresAt) {
      throw new RoomError("code_expired");
    }
    if (room.status !== "open") {
      // Someone else is already mid-handshake on this code, or it's paired.
      throw new RoomError("invalid_code");
    }
    room.status = "pending_accept";
    room.pendingViewerSocketId = viewerSocketId;
    return room;
  }

  /**
   * viewer:cancel-request / host:reject — reverts to "open" so the same code
   * remains usable within its original 120s window (Backend Schema §3.1 step 4).
   */
  reject(code, hostSocketId) {
    const room = this.rooms.get(code);
    if (!room || room.hostSocketId !== hostSocketId) throw new RoomError("invalid_code");
    const viewerSocketId = room.pendingViewerSocketId;
    room.status = "open";
    room.pendingViewerSocketId = null;
    return { room, viewerSocketId };
  }

  /**
   * host:accept — transitions to "paired" then immediately deletes the room
   * (single-use invalidation, TRD §2.1 / Backend Schema §3.1 step 3).
   */
  accept(code, hostSocketId) {
    const room = this.rooms.get(code);
    if (!room || room.hostSocketId !== hostSocketId) throw new RoomError("invalid_code");
    if (room.status !== "pending_accept" || !room.pendingViewerSocketId) {
      throw new RoomError("invalid_code");
    }
    const viewerSocketId = room.pendingViewerSocketId;
    this._clearTtl(code);
    this.rooms.delete(code);
    return { viewerSocketId };
  }

  /** Cleans up a room tied to a socket that disconnected (host went away). */
  deleteRoomsForSocket(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      if (room.hostSocketId === socketId) {
        this._clearTtl(code);
        this.rooms.delete(code);
      }
    }
  }

  size() {
    return this.rooms.size;
  }
}
