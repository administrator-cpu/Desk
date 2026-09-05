export type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
};

/**
 * Builds the ICE server config both peers use (TRD §3.1). STUN alone is
 * enough on the same network but fails for the platform's actual target
 * scenario (PRD §5.1) — TURN must always be included, not added later.
 */
export function buildRtcConfig(turnCredentials: TurnCredentials): RTCConfiguration {
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: turnCredentials.urls,
        username: turnCredentials.username,
        credential: turnCredentials.credential,
      },
    ],
    iceTransportPolicy: "all", // switch to "relay" only for forced-TURN debugging (step 2.10)
  };
}
