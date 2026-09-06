export {};

type Room = { code: string; expiresAt: number } | null;
type ViewerMeta = { ip?: string; userAgent?: string };
type ViewerRequestJoin = { viewerSocketId: string; viewerMeta?: ViewerMeta };
type TurnCredentials = { urls: string[]; username: string; credential: string; ttl: number };
type SdpPayload = { sdp: { type: RTCSdpType; sdp: string } };
type IceCandidatePayload = { candidate: RTCIceCandidateInit };

declare global {
  interface Window {
    electronAPI: {
      onRoomState(callback: (room: Room) => void): () => void;
      getRoomState(): Promise<Room>;
      requestNewCode(): Promise<void>;

      onViewerRequestJoin(callback: (payload: ViewerRequestJoin) => void): () => void;
      acceptRequest(viewerSocketId: string): Promise<void>;
      rejectRequest(viewerSocketId: string): Promise<void>;

      onHostAcceptAck(callback: (payload: { turnCredentials: TurnCredentials }) => void): () => void;
      onSignalAnswer(callback: (payload: SdpPayload) => void): () => void;
      onSignalIceCandidate(callback: (payload: IceCandidatePayload) => void): () => void;
      onSessionEnd(callback: (payload: { reason: string }) => void): () => void;
      onSocketError(callback: (payload: { error: string }) => void): () => void;
      onEndSessionRequested(callback: () => void): () => void;
      sendSignalOffer(payload: SdpPayload): Promise<void>;
      sendSignalIceCandidate(payload: IceCandidatePayload): Promise<void>;
      sendSessionEnd(payload: { reason: string }): Promise<void>;
      notifySessionStarted(): Promise<void>;
      notifySessionEnded(): Promise<void>;
      forwardPointerInput(msg: Record<string, unknown>): void;
      forwardReliableInput(msg: Record<string, unknown>): void;
    };
  }
}
