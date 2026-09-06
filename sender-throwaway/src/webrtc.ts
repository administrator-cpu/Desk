export type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
};

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
