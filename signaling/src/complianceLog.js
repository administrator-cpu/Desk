import fs from "node:fs";
import path from "node:path";

// CERT-In 2022 Directions: log connection/access events (who connected,
// when — never session content) to India-hosted storage, retain 180 days,
// producible on request. Implements cert-in-logging-setup-guide.md.
//
// Deliberately separate from the MongoDB `sessions` collection (Backend
// Schema §2.3) and the in-memory/Redis room state — this is its own
// append-only, file-based record that exists purely for compliance, with
// zero impact on application request latency or database load. Per the
// guide's explicit scope: never logs video, keystrokes, mouse coordinates,
// or any session content — only who connected, when, from where.

const LOG_DIR = process.env.CERT_IN_LOG_DIR || path.join(process.cwd(), "logs", "signaling");
const RETENTION_DAYS = Number(process.env.CERT_IN_LOG_RETENTION_DAYS || 180);

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function todayFileName() {
  return `${new Date().toISOString().slice(0, 10)}.log`; // YYYY-MM-DD.log — one file per day (guide §3.1)
}

/**
 * Logs one connection/access event as a single JSON line, appended to
 * today's dated log file. Every call gets a timestamp automatically;
 * `fields` carries whatever's relevant to that event (source IP, room
 * code, outcome, etc. — guide §2's "what to log" list).
 */
export function logEvent(eventType, fields = {}) {
  try {
    ensureLogDir();
    const entry = {
      ts: new Date().toISOString(),
      event: eventType,
      ...fields,
    };
    fs.appendFileSync(path.join(LOG_DIR, todayFileName()), JSON.stringify(entry) + "\n");
  } catch (err) {
    // Logging must never crash or block the actual signaling flow — a
    // failed compliance-log write shouldn't take down pairing.
    console.error("compliance log write failed:", err.message);
  }
}

const DATE_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.log$/;

/**
 * Deletes log files past the retention window (guide §3.3). Parses the
 * date from the filename itself rather than trusting filesystem mtime,
 * which can change on copy/backup and would no longer reflect the log's
 * actual date — the filename IS the ground truth here.
 */
export function cleanupOldLogs() {
  try {
    ensureLogDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const filename of fs.readdirSync(LOG_DIR)) {
      const match = filename.match(DATE_FILE_RE);
      if (!match) continue; // ignore anything that isn't one of our dated log files
      const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`).getTime();
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, filename));
        console.log(`compliance log cleanup: deleted ${filename} (past ${RETENTION_DAYS}-day retention)`);
      }
    }
  } catch (err) {
    console.error("compliance log cleanup failed:", err.message);
  }
}

/**
 * Starts the in-app daily cleanup — runs once immediately at startup, then
 * every 24h. The setup guide also offers an independent Windows Task
 * Scheduler script (scripts/cleanup-logs.js) as a fallback that works
 * regardless of whether this app process is even running — both can be
 * used together without conflict, since deleting an already-deleted file
 * is a harmless no-op.
 */
export function startCleanupSchedule() {
  cleanupOldLogs();
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000).unref();
}

export const LOG_DIR_PATH = LOG_DIR;
export const RETENTION_DAYS_CONFIG = RETENTION_DAYS;
