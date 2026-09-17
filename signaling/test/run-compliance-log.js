import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Uses a temp dir + dynamic import (after setting env vars) rather than a
// static import, since complianceLog.js reads CERT_IN_LOG_DIR once at
// module-evaluation time — a static import would run before this test
// gets a chance to point it at a throwaway directory.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "certin-log-test-"));
process.env.CERT_IN_LOG_DIR = tmpDir;
process.env.CERT_IN_LOG_RETENTION_DAYS = "1";

const { logEvent, cleanupOldLogs } = await import("../src/complianceLog.js");

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const today = new Date().toISOString().slice(0, 10);
const todayFile = path.join(tmpDir, `${today}.log`);

// --- Writing ---
logEvent("room_created", { code: "123456789", sourceIp: "1.2.3.4" });
check("log file created for today", fs.existsSync(todayFile));

const firstLines = fs.readFileSync(todayFile, "utf8").trim().split("\n");
const entry = JSON.parse(firstLines[firstLines.length - 1]);
check("entry has a timestamp", typeof entry.ts === "string" && !Number.isNaN(Date.parse(entry.ts)));
check("entry has the event type", entry.event === "room_created");
check("entry carries the code field", entry.code === "123456789");
check("entry carries the source IP", entry.sourceIp === "1.2.3.4");
check(
  "never logs session content (video/keystrokes/mouse)",
  !("video" in entry) && !("keystrokes" in entry) && !("mouseX" in entry) && !("frame" in entry)
);

// --- Appending (multiple events same day -> same file) ---
logEvent("session_start", { code: "123456789" });
const afterSecond = fs.readFileSync(todayFile, "utf8").trim().split("\n");
check("second event appended to the same day's file", afterSecond.length === 2);

// --- Retention cleanup ---
const oldFile = "2020-01-01.log"; // far past any real retention window
fs.writeFileSync(path.join(tmpDir, oldFile), JSON.stringify({ ts: "2020-01-01T00:00:00Z", event: "test" }) + "\n");
fs.writeFileSync(path.join(tmpDir, "notes.txt"), "unrelated file, must not be touched");

cleanupOldLogs();

check("file past retention window gets deleted", !fs.existsSync(path.join(tmpDir, oldFile)));
check("today's file is kept (within retention)", fs.existsSync(todayFile));
check("non-dated files are never touched by cleanup", fs.existsSync(path.join(tmpDir, "notes.txt")));

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nALL COMPLIANCE LOG TESTS PASSED");
} else {
  console.error(`\n${failures} COMPLIANCE LOG TEST(S) FAILED`);
  process.exitCode = 1;
}
