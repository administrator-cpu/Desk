import crypto from "node:crypto";

// Wired up now so Phase 2 doesn't require a signaling-server rework
// (PRD Phase 1 functional requirement), even though no real coturn/managed
// TURN provider is provisioned yet (that's Day 0 step 0.4 — infra, not code).
// Set these once that provisioning is done:
//   TURN_SHARED_SECRET   - the coturn `static-auth-secret`
//   TURN_URLS            - comma-separated turn:/turns: URLs
const DEFAULT_TTL_SECONDS = 3600; // session duration + 5min buffer is applied by caller if known

function getConfig() {
  const sharedSecret = process.env.TURN_SHARED_SECRET || "dev-placeholder-secret-not-for-prod";
  const urls = (process.env.TURN_URLS || "turn:turn.example.invalid:3478,turns:turn.example.invalid:5349")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return { sharedSecret, urls };
}

/**
 * Mints short-lived, per-session TURN credentials (coturn's REST-style
 * time-limited credential scheme). Nothing here is persisted — see
 * Backend Schema §3.3: recomputing from the same inputs before expiry
 * yields the same value, so there's no need for a DB row.
 */
export function issueTurnCredentials({ sessionId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const { sharedSecret, urls } = getConfig();
  const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiryTimestamp}:${sessionId ?? crypto.randomUUID()}`;
  const credential = crypto.createHmac("sha1", sharedSecret).update(username).digest("base64");

  return {
    urls,
    username,
    credential,
    ttl: ttlSeconds,
  };
}
