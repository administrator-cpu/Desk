import { io as ioClient } from "socket.io-client";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 4101;
const URL = `http://localhost:${PORT}`;
let serverProcess;
let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
  });
  await delay(600);

  // --- Test 1: invalid code is rejected ---
  const v1 = ioClient(URL, { transports: ["websocket"] });
  await waitFor(v1, "connect");
  const err1Promise = waitFor(v1, "error");
  v1.emit("viewer:join-room", { code: "000000000" });
  const err1 = await err1Promise;
  check("invalid code -> error: invalid_code", err1.error === "invalid_code");
  v1.close();

  // --- Test 2: malformed payload rejected before handler logic ---
  const v2 = ioClient(URL, { transports: ["websocket"] });
  await waitFor(v2, "connect");
  const err2Promise = waitFor(v2, "error");
  v2.emit("viewer:join-room", { code: "12345" }); // wrong length
  const err2 = await err2Promise;
  check("malformed payload -> error: invalid_payload", err2.error === "invalid_payload");
  v2.close();

  // --- Test 3: reject flow reverts room to open, same code re-usable ---
  const host3 = ioClient(URL, { transports: ["websocket"] });
  const viewer3a = ioClient(URL, { transports: ["websocket"] });
  const viewer3b = ioClient(URL, { transports: ["websocket"] });
  await Promise.all([waitFor(host3, "connect"), waitFor(viewer3a, "connect"), waitFor(viewer3b, "connect")]);

  host3.emit("host:create-room", {});
  const { code } = await waitFor(host3, "room:created");

  const req1Promise = waitFor(host3, "viewer:request-join");
  viewer3a.emit("viewer:join-room", { code });
  const req1 = await req1Promise;

  const rejectSeen = waitFor(viewer3a, "host:reject");
  host3.emit("host:reject", { viewerSocketId: req1.viewerSocketId });
  await rejectSeen;

  // Same code should still work for a second viewer.
  const req2Promise = waitFor(host3, "viewer:request-join");
  viewer3b.emit("viewer:join-room", { code });
  const req2 = await req2Promise;
  check("code remains usable after reject", req2.viewerSocketId === viewer3b.id);
  host3.close();
  viewer3a.close();
  viewer3b.close();

  // --- Test 4: rate limiting kicks in after 10 attempts/min from one IP ---
  const v4 = ioClient(URL, { transports: ["websocket"] });
  await waitFor(v4, "connect");
  let rateLimited = false;
  for (let i = 0; i < 12; i++) {
    const errPromise = waitFor(v4, "error", 1000).catch(() => null);
    v4.emit("viewer:join-room", { code: "111111111" }); // invalid but shape-valid
    const e = await errPromise;
    if (e?.error === "rate_limited") {
      rateLimited = true;
      break;
    }
  }
  check("rate limiting triggers within 12 attempts", rateLimited);
  v4.close();

  console.log(failures === 0 ? "\nALL EDGE-CASE CHECKS PASSED" : `\n${failures} EDGE-CASE CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
  serverProcess.kill();
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exitCode = 1;
  if (serverProcess) serverProcess.kill();
});
