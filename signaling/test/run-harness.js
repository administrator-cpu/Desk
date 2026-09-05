// Step 1.9 (and 1.10, if SIGNALING_URL points at a deployed server): a
// throwaway harness — not a real host/viewer app — that proves the Phase 1
// exit criterion: two clients, hitting the signaling server, can pair via a
// code and exchange a text message.
//
// Usage:
//   node test/run-harness.js                          # spawns the server locally
//   SIGNALING_URL=https://your-app.onrender.com node test/run-harness.js   # step 1.10

import { io as ioClient } from "socket.io-client";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const EXTERNAL_URL = process.env.SIGNALING_URL;
const LOCAL_PORT = 4100;
const URL = EXTERNAL_URL || `http://localhost:${LOCAL_PORT}`;

let serverProcess = null;

function log(label, ...args) {
  console.log(`[harness:${label}]`, ...args);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  cleanup();
}

function cleanup() {
  if (serverProcess) serverProcess.kill();
}

async function startLocalServerIfNeeded() {
  if (EXTERNAL_URL) return;
  log("setup", `spawning local signaling server on :${LOCAL_PORT}`);
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    env: { ...process.env, PORT: String(LOCAL_PORT) },
    stdio: "inherit",
  });
  // Give it a moment to bind the port.
  await delay(600);
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  await startLocalServerIfNeeded();

  const host = ioClient(URL, { transports: ["websocket"] });
  const viewer = ioClient(URL, { transports: ["websocket"] });

  await Promise.all([waitFor(host, "connect"), waitFor(viewer, "connect")]);
  log("setup", `both clients connected to ${URL}`);

  // 1. host:create-room -> room:created
  host.emit("host:create-room", {});
  const { code } = await waitFor(host, "room:created");
  log("host", `got code ${code}`);

  // 2. viewer:join-room
  const requestJoinPromise = waitFor(host, "viewer:request-join");
  viewer.emit("viewer:join-room", { code });
  const { viewerSocketId } = await requestJoinPromise;
  log("host", `viewer:request-join received for ${viewerSocketId}`);

  // 3. host:accept -> viewer receives host:accepted
  const acceptedPromise = waitFor(viewer, "host:accepted");
  host.emit("host:accept", { viewerSocketId });
  const accepted = await acceptedPromise;
  if (!accepted?.turnCredentials?.username) {
    fail("host:accepted payload missing turnCredentials");
    return;
  }
  log("viewer", "host:accepted received (with TURN credentials present)");

  // 4. free-text message exchange, both directions
  const viewerGotMessage = waitFor(viewer, "message");
  host.emit("message", { from: "host", text: "hello viewer" });
  const viewerMsg = await viewerGotMessage;
  if (viewerMsg.text !== "hello viewer") {
    fail(`viewer received unexpected message: ${JSON.stringify(viewerMsg)}`);
    return;
  }
  log("viewer", "received:", viewerMsg);

  const hostGotMessage = waitFor(host, "message");
  viewer.emit("message", { from: "viewer", text: "hello host" });
  const hostMsg = await hostGotMessage;
  if (hostMsg.text !== "hello host") {
    fail(`host received unexpected message: ${JSON.stringify(hostMsg)}`);
    return;
  }
  log("host", "received:", hostMsg);

  console.log("\nPASS: create -> join -> accept -> bidirectional message exchange all succeeded.");
  host.close();
  viewer.close();
  cleanup();
}

main().catch((err) => {
  fail(err.message);
});
