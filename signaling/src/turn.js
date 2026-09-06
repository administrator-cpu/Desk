import crypto from "node:crypto";

// Wired up now so Phase 2 doesn't require a signaling-server rework
// (PRD Phase 1 functional requirement). Supports three TURN backends,
// selected by which env vars are present (checked in this order):
//
// 1. Metered.ca — static credential (GET flow). Set METERED_APP_NAME +
//    METERED_API_KEY. This matches a credential you generate once on the
//    Metered dashboard: the apiKey identifies that stored credential, and
//    fetching it returns its full ICE servers array directly. It's a
//    fixed, reusable credential rather than a fresh one minted per
//    session — fine for getting TURN working, but see the TRD §2.3 note
//    below if you want true per-session credentials later.
// 2. Metered.ca — minted credential (POST flow). Set METERED_APP_NAME +
//    METERED_SECRET_KEY instead. Mints a brand-new, genuinely time-limited
//    credential per session via Metered's create-credential endpoint.
// 3. Self-hosted coturn — set TURN_SHARED_SECRET, using coturn's REST-style
//    time-limited HMAC credential scheme computed locally.
//
// Option 2 and 3 need TURN_URLS set separately (they return/compute a
// username+credential but not server URLs). Option 1 doesn't — the GET
// response already includes its own URLs, so TURN_URLS is ignored there.
const DEFAULT_TTL_SECONDS = 3600; // session duration + 5min buffer is applied by caller if known

function getTurnUrls() {
  return (process.env.TURN_URLS || "turn:turn.example.invalid:3478,turns:turn.example.invalid:5349")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Metered's GET credentials endpoint returns a ready-to-use RTCIceServer[]
 * array (STUN entry with no username, one or more TURN entries all sharing
 * the same username/credential). We flatten that into this app's single
 * {urls, username, credential} shape — Backend Schema §3.3/§4 documents
 * turnCredentials as one shared set of urls, not a full ICE server array,
 * so we normalize here rather than changing that contract.
 */
async function issueMeteredStaticCredentials() {
  const appName = process.env.METERED_APP_NAME;
  const apiKey = process.env.METERED_API_KEY;
  const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Metered credentials request failed: ${res.status} ${await res.text()}`);
  }
  const iceServers = await res.json();
  const turnEntries = iceServers.filter((entry) => entry.username && entry.credential);
  if (turnEntries.length === 0) {
    throw new Error("Metered response had no TURN entries with a username/credential");
  }

  const urls = turnEntries.flatMap((entry) => (Array.isArray(entry.urls) ? entry.urls : [entry.urls]));
  return {
    urls,
    username: turnEntries[0].username,
    credential: turnEntries[0].credential,
    ttl: DEFAULT_TTL_SECONDS, // informational only — this credential's real expiry (if any) is whatever it was created with on Metered's side, not controlled per-call here.
  };
}

async function issueMeteredMintedCredentials(sessionId, ttlSeconds) {
  const appName = process.env.METERED_APP_NAME;
  const secretKey = process.env.METERED_SECRET_KEY;
  const url = `https://${appName}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiryInSeconds: ttlSeconds, label: sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Metered credential request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return {
    urls: getTurnUrls(),
    username: data.username,
    credential: data.password,
    ttl: ttlSeconds,
  };
}

function issueLocalHmacCredentials(sessionId, ttlSeconds) {
  const sharedSecret = process.env.TURN_SHARED_SECRET || "dev-placeholder-secret-not-for-prod";
  const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiryTimestamp}:${sessionId}`;
  const credential = crypto.createHmac("sha1", sharedSecret).update(username).digest("base64");
  return { urls: getTurnUrls(), username, credential, ttl: ttlSeconds };
}

/**
 * Mints/fetches short-lived, per-session TURN credentials. Nothing here is
 * persisted (Backend Schema §3.3) — for the local-HMAC path, recomputing
 * from the same inputs before expiry yields the same value, so there's no
 * need for a database row; for the Metered paths, the provider holds the
 * credential state on their end instead.
 */
export async function issueTurnCredentials({ sessionId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const id = sessionId ?? crypto.randomUUID();
  if (process.env.METERED_APP_NAME && process.env.METERED_API_KEY) {
    return issueMeteredStaticCredentials();
  }
  if (process.env.METERED_APP_NAME && process.env.METERED_SECRET_KEY) {
    return issueMeteredMintedCredentials(id, ttlSeconds);
  }
  return issueLocalHmacCredentials(id, ttlSeconds);
}
