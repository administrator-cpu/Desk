import { io as ioClient } from "socket.io-client";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 4102;
const URL = `http://localhost:${PORT}`;

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
  const serverProcess = spawn(process.execPath, ["src/index.js"], {
    env: { ...process.env, PORT: String(PORT), ROOM_TTL_MS: "1000" },
    stdio: "inherit",
  });
  await delay(600);

  const host = ioClient(URL, { transports: ["websocket"] });
  await waitFor(host, "connect");

  host.emit("host:create-room", {});
  const { code } = await waitFor(host, "room:created");
  console.log(`got code ${code}, waiting for room:code-expired (TTL=1000ms)...`);

  const expiredPromise = waitFor(host, "room:code-expired", 2500);
  const expired = await expiredPromise;
  console.log("PASS: room:code-expired received:", expired);

  // Confirm the code is now unusable.
  const viewer = ioClient(URL, { transports: ["websocket"] });
  await waitFor(viewer, "connect");
  const errPromise = waitFor(viewer, "error");
  viewer.emit("viewer:join-room", { code });
  const err = await errPromise;
  console.log(err.error === "invalid_code" || err.error === "code_expired" ? "PASS: expired code rejected" : `FAIL: got ${err.error}`);

  host.close();
  viewer.close();
  serverProcess.kill();
}

main().catch((e) => { console.error("FAIL:", e.message); process.exitCode = 1; });
