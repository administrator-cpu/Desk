export type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
} | null;

/**
 * Builds the ICE server config both peers use (TRD §3.1). Falls back to
 * STUN-only when `turnCredentials` is null — no TURN provider configured,
 * or the provider is unreachable/over quota. Most connections between two
 * normal home networks work fine on P2P alone (TURN only exists as a
 * fallback for the harder NAT cases, PRD §5.1); this way a missing/broken
 * TURN provider degrades pairing gracefully instead of blocking it.
 *
 * `forceRelay` sets iceTransportPolicy to "relay" instead of "all" — this is
 * step 2.10's explicit cross-network test: it disables the P2P/STUN path
 * entirely so a successful connection *proves* the TURN path specifically
 * works, rather than a same-network test where P2P succeeding would mask
 * whether TURN was ever actually reachable. Meaningless without TURN
 * configured — forcing relay-only with no TURN server means nothing can
 * ever connect, so this is ignored when turnCredentials is null.
 */
export function buildRtcConfig(
  turnCredentials: TurnCredentials,
  options?: { forceRelay?: boolean }
): RTCConfiguration {
  const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (turnCredentials) {
    iceServers.push({
      urls: turnCredentials.urls,
      username: turnCredentials.username,
      credential: turnCredentials.credential,
    });
  }
  return {
    iceServers,
    iceTransportPolicy: options?.forceRelay && turnCredentials ? "relay" : "all",
  };
}
