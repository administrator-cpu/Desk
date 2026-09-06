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
 *
 * `forceRelay` sets iceTransportPolicy to "relay" instead of "all" — this is
 * step 2.10's explicit cross-network test: it disables the P2P/STUN path
 * entirely so a successful connection *proves* the TURN path specifically
 * works, rather than a same-network test where P2P succeeding would mask
 * whether TURN was ever actually reachable.
 */
export function buildRtcConfig(
  turnCredentials: TurnCredentials,
  options?: { forceRelay?: boolean }
): RTCConfiguration {
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: turnCredentials.urls,
        username: turnCredentials.username,
        credential: turnCredentials.credential,
      },
    ],
    iceTransportPolicy: options?.forceRelay ? "relay" : "all",
  };
}
