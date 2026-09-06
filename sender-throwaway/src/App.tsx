import { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";
import { buildRtcConfig, type TurnCredentials } from "./webrtc";

// This app is a deliberate throwaway (implementation plan step 2.4): it
// stands in for the eventual Electron Host app so Phase 2's video pipe can
// be built and tested without touching Electron yet. Step 3.1 ports this
// logic into the real host app. The Accept/Decline UI here is intentionally
// minimal — the real B3 modal (App Flow) is Phase 3 work.

type ViewerMeta = { ip?: string; userAgent?: string };
type SdpPayload = { sdp: { type: RTCSdpType; sdp: string } };
type IceCandidatePayload = { candidate: RTCIceCandidateInit };

export default function App() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [pending, setPending] = useState<{ viewerSocketId: string; meta?: ViewerMeta } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Tracks the viewerSocketId we've emitted host:accept for but haven't
  // heard confirmed-or-denied yet, so a late "error" event can be tied back
  // to the right attempt and the capture can be torn down if it failed.
  const acceptAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = getSocket();

    function createRoom() {
      socket.emit("host:create-room", {});
    }

    function onRoomCreated(payload: { code: string; expiresAt: number }) {
      setCode(payload.code);
      setExpiresAt(payload.expiresAt);
    }

    function onRequestJoin(payload: { viewerSocketId: string; viewerMeta?: ViewerMeta }) {
      setPending({ viewerSocketId: payload.viewerSocketId, meta: payload.viewerMeta });
    }

    function onCodeExpired() {
      // Mirrors B2: auto-generate a fresh code without requiring a click.
      setCode(null);
      setExpiresAt(null);
      createRoom();
    }

    function onSessionEnd() {
      closeSession();
      createRoom();
    }

    // The server only replies to a *failed* host:accept — success is
    // implicit (the viewer gets host:accepted directly, we get nothing).
    // Without this, a failed accept (e.g. the room's 120s TTL expired while
    // the OS screen-picker dialog was open) looked identical to success on
    // this side: capture would start, but the viewer would sit on "Waiting"
    // forever with no error to explain why.
    function onError(payload: { error: string }) {
      if (acceptAttemptRef.current) {
        closeSession();
        setErrorMsg(
          payload.error === "code_expired" || payload.error === "invalid_code"
            ? "The code expired before the connection completed — generating a new one."
            : `Couldn't complete the connection (${payload.error}).`
        );
        acceptAttemptRef.current = null;
        createRoom();
      }
    }

    // host:accept-ack (see signaling/src/index.js) — not part of the
    // original Backend Schema event table, added so the host can build its
    // own RTCPeerConnection with valid TURN credentials, same as the viewer
    // gets via host:accepted.
    function onAcceptAck(payload: { turnCredentials: TurnCredentials }) {
      console.log("[sender] host:accept-ack received, starting WebRTC setup");
      void createOfferAndSend(payload.turnCredentials);
    }

    function onAnswer(payload: SdpPayload) {
      console.log("[sender] received answer");
      const pc = pcRef.current;
      if (!pc) return;
      void pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    }

    function onRemoteIceCandidate(payload: IceCandidatePayload) {
      const pc = pcRef.current;
      if (!pc) return;
      void pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }

    socket.on("connect", createRoom);
    socket.on("room:created", onRoomCreated);
    socket.on("viewer:request-join", onRequestJoin);
    socket.on("room:code-expired", onCodeExpired);
    socket.on("session:end", onSessionEnd);
    socket.on("error", onError);
    socket.on("host:accept-ack", onAcceptAck);
    socket.on("signal:answer", onAnswer);
    socket.on("signal:ice-candidate", onRemoteIceCandidate);

    if (socket.connected) createRoom();

    return () => {
      socket.off("connect", createRoom);
      socket.off("room:created", onRoomCreated);
      socket.off("viewer:request-join", onRequestJoin);
      socket.off("room:code-expired", onCodeExpired);
      socket.off("session:end", onSessionEnd);
      socket.off("error", onError);
      socket.off("host:accept-ack", onAcceptAck);
      socket.off("signal:answer", onAnswer);
      socket.off("signal:ice-candidate", onRemoteIceCandidate);
    };
  }, []);

  // Attach the captured stream once the <video> element actually exists.
  // It only mounts when `capturing` is true, so doing this assignment
  // directly inside handleAccept (before that re-render happens) silently
  // no-ops against a null ref.
  useEffect(() => {
    if (capturing && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [capturing]);

  // Close the peer connection and release the capture stream on unmount.
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function stopCapture() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function closeSession() {
    pcRef.current?.close();
    pcRef.current = null;
    setConnectionState(null);
    stopCapture();
    setCapturing(false);
  }

  async function createOfferAndSend(turnCredentials: TurnCredentials) {
    const stream = streamRef.current;
    if (!stream) return; // shouldn't happen — capture always precedes accept

    try {
      const forceRelay = import.meta.env.VITE_FORCE_RELAY === "true";
      const pc = new RTCPeerConnection(buildRtcConfig(turnCredentials, { forceRelay }));
      pcRef.current = pc;
      console.log("[sender] RTCPeerConnection created", forceRelay ? "(forced relay)" : "");

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[sender] sending ICE candidate");
          getSocket().emit("signal:ice-candidate", { candidate: event.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        console.log("[sender] connectionState ->", pc.connectionState);
        setConnectionState(pc.connectionState);
        if (pc.connectionState === "failed") {
          setErrorMsg("Couldn't establish a connection to the viewer.");
        }
      };
      pc.oniceconnectionstatechange = () => {
        console.log("[sender] iceConnectionState ->", pc.iceConnectionState);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("[sender] sending offer");
      // Sent as a plain object matching Backend Schema §4's sdp shape —
      // RTCSessionDescription's own fields aren't reliably JSON-serializable.
      getSocket().emit("signal:offer", { sdp: { type: offer.type, sdp: offer.sdp ?? "" } });
    } catch (err) {
      console.error("[sender] WebRTC setup failed:", err);
      setErrorMsg(`Couldn't set up the connection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleAccept() {
    if (!pending) return;
    setErrorMsg(null);
    try {
      // Phase 2: getDisplayMedia (browser API). Phase 3 swaps this for
      // Electron's desktopCapturer feeding the same pipeline — see TRD §3.2.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      streamRef.current = stream;

      // If the user stops sharing via the browser's own "Stop sharing" UI.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        closeSession();
        getSocket().emit("session:end", { reason: "host_ended" });
      });

      acceptAttemptRef.current = pending.viewerSocketId;
      getSocket().emit("host:accept", { viewerSocketId: pending.viewerSocketId });
      setCapturing(true);
      setPending(null);
    } catch {
      setErrorMsg("Screen share was cancelled or blocked — can't accept without it.");
    }
  }

  function handleDecline() {
    if (!pending) return;
    getSocket().emit("host:reject", { viewerSocketId: pending.viewerSocketId });
    setPending(null);
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ color: "#8b95a1", fontSize: 13, marginBottom: 4 }}>
        rap-signaling throwaway sender · Phase 2 stand-in for the Host app
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 24px" }}>
        Host session
      </h1>

      {import.meta.env.VITE_FORCE_RELAY === "true" && (
        <p style={{ color: "#e2725b", fontSize: 13, margin: "-16px 0 24px" }}>
          Forced TURN relay is ON — direct P2P is disabled for this test (step 2.10).
        </p>
      )}

      {!code && !capturing && <p>Requesting a code…</p>}

      {code && !pending && !capturing && (
        <div>
          <p style={{ color: "#8b95a1", marginBottom: 8 }}>Share this code with the viewer:</p>
          <div style={{ fontSize: 40, letterSpacing: 4, color: "#4fd8c4" }}>{code}</div>
          {expiresAt && <Countdown expiresAt={expiresAt} />}
        </div>
      )}

      {pending && (
        <div style={{ border: "1px solid #2a333b", padding: 20, marginTop: 16 }}>
          <p style={{ margin: "0 0 4px" }}>A device wants to connect.</p>
          <p style={{ color: "#8b95a1", fontSize: 13, margin: "0 0 16px" }}>
            {pending.meta?.ip ?? "unknown IP"} · {pending.meta?.userAgent ?? "unknown browser"}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={handleAccept} style={buttonStyle("#4fd8c4")}>
              Accept
            </button>
            <button onClick={handleDecline} style={buttonStyle("#8b95a1")}>
              Decline
            </button>
          </div>
        </div>
      )}

      {errorMsg && <p style={{ color: "#e2725b", marginTop: 12 }}>{errorMsg}</p>}

      {capturing && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "#4fd8c4", marginBottom: 8 }}>
            Capturing your screen — sending to the viewer
            {connectionState ? ` (${connectionState})` : "…"}
          </p>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", border: "1px solid #2a333b" }}
          />
        </div>
      )}
    </main>
  );
}

function buttonStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}`,
    color,
    padding: "10px 20px",
    fontFamily: "inherit",
    fontSize: 14,
    cursor: "pointer",
  };
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
  return (
    <p style={{ color: "#8b95a1", fontSize: 13, marginTop: 8 }}>
      Expires in {secondsLeft}s
    </p>
  );
}
