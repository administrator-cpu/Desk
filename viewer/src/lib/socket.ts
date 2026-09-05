"use client";

import { io, type Socket } from "socket.io-client";

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL || "http://localhost:4000";

let socket: Socket | null = null;

/**
 * Lazily creates (and reuses) a single Socket.io connection for the whole
 * app. Matches the App Flow spec: the viewer connects once and drives every
 * screen transition (A1 -> A2 -> A3 -> A4) off the same socket's events.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SIGNALING_URL, {
      transports: ["websocket"],
      autoConnect: true,
    });
  }
  return socket;
}
