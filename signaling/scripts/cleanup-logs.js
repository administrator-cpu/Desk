// Standalone log-retention cleanup, meant to be run independently of the
// main signaling server process — e.g. via Windows Task Scheduler once a
// day. This is the guide's §3.3 fallback option: it works even if the app
// itself isn't running at the moment, or crashed, or was restarted in a
// way that skipped its own in-app cleanup cycle.
//
// Usage (Task Scheduler action): run this with node, pointed at the same
// CERT_IN_LOG_DIR / CERT_IN_LOG_RETENTION_DAYS env vars the app uses (or
// just rely on the same defaults if you haven't overridden them):
//
//   node scripts/cleanup-logs.js
//
// Safe to run alongside the app's own in-app schedule — deleting an
// already-deleted file is a no-op, not an error.

import { cleanupOldLogs, LOG_DIR_PATH, RETENTION_DAYS_CONFIG } from "../src/complianceLog.js";

console.log(`Cleaning up compliance logs in ${LOG_DIR_PATH} (retention: ${RETENTION_DAYS_CONFIG} days)...`);
cleanupOldLogs();
console.log("Done.");
