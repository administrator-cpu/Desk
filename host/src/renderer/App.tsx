import { useEffect, useRef, useState } from "react";
import B3AcceptModal from "./B3AcceptModal";
import { buildRtcConfig, type TurnCredentials } from "./webrtc";

type Room = { code: string; expiresAt: number } | null;
type ViewerMeta = { ip?: string; userAgent?: string };
type Pending = { viewerSocketId: string; viewerMeta?: ViewerMeta } | null;

const B3_TIMEOUT_MS = 30_000; // App Flow B3: auto-dismiss after 30s, treated as implicit decline.
const DISCONNECT_GRACE_MS = 20_000; // Real cross-network paths (TURN relay, genuine internet hops) can have longer transient dips than same-LAN testing showed — 5s (App Flow's literal spec value) was killing sessions that would've self-recovered. 20s gives real reconnection attempts room to succeed.

export default function App() {
  const [room, setRoom] = useState<Room>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [capturing, setCapturing] = useState(false);
  const [activeViewerMeta, setActiveViewerMeta] = useState<ViewerMeta | undefined>(undefined);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputReliableRef = useRef<RTCDataChannel | null>(null);
  const inputPointerRef = useRef<RTCDataChannel | null>(null);
  const acceptAttemptRef = useRef<string | null>(null);
  const declineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Pull the current state immediately on mount rather than only waiting
    // on the next push from main — a push sent before this listener was
    // attached (e.g. right at window creation, or around any reload) would
    // otherwise be lost with no way to recover until the next code refresh.
    window.electronAPI.getRoomState().then(setRoom);

    const unsubs = [
      window.electronAPI.onRoomState((next) => setRoom(next)),

      window.electronAPI.onViewerRequestJoin((payload) => {
        setPending(payload);
        declineTimerRef.current = setTimeout(() => {
          // Modal auto-dismiss/timeout — App Flow B3: treated as implicit decline.
          handleDecline(payload.viewerSocketId);
        }, B3_TIMEOUT_MS);
      }),

      window.electronAPI.onHostAcceptAck((payload) => {
        void createOfferAndSend(payload.turnCredentials);
      }),

      window.electronAPI.onSignalAnswer((payload) => {
        const pc = pcRef.current;
        if (!pc) return;
        void pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }),

      window.electronAPI.onSignalIceCandidate((payload) => {
        const pc = pcRef.current;
        if (!pc) return;
        void pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }),

      window.electronAPI.onSessionEnd(() => {
        // The viewer (or the server) already ended it — just tear down
        // locally, no need to emit session:end back (that'd be redundant).
        closeSession();
      }),

      window.electronAPI.onSocketError((payload) => {
        if (acceptAttemptRef.current) {
          closeSession();
          setErrorMsg(`Couldn't complete the connection (${payload.error}).`);
          acceptAttemptRef.current = null;
        }
      }),

      // Tray's "End Session" menu item (App Flow B4: duplicated in the
      // tray right-click menu) relays here since the peer connection only
      // exists in this renderer, not in main.
      window.electronAPI.onEndSessionRequested(() => {
        handleEndSession();
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      if (declineTimerRef.current) clearTimeout(declineTimerRef.current);
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearDeclineTimer() {
    if (declineTimerRef.current) {
      clearTimeout(declineTimerRef.current);
      declineTimerRef.current = null;
    }
  }

  function clearDisconnectTimer() {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }

  /** Local teardown only — does not tell the server. Used both when we're
   * reacting to a session:end we already received, and as the shared
   * cleanup step before any session-ending action tells the server. */
  function closeSession() {
    clearDisconnectTimer();
    pcRef.current?.close();
    pcRef.current = null;
    inputReliableRef.current = null;
    inputPointerRef.current = null;
    setConnectionState(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCapturing(false);
    setActiveViewerMeta(undefined);
    // Safety net so the tray always reverts even in edge cases where no
    // session:end round-trip with the server happens (e.g. a local-only
    // peer-connection failure we choose not to also notify the server of).
    void window.electronAPI.notifySessionEnded();
  }

  /** Host-initiated end — window button, tray menu, or the disconnect
   * grace-period timeout below. Tells the server, which is also what lets
   * main process mint a fresh code and revert the tray (see main/index.js
   * endActiveSession()). */
  function handleEndSession(reason: "host_ended" | "error" = "host_ended") {
    closeSession();
    window.electronAPI.sendSessionEnd({ reason });
  }

  async function createOfferAndSend(turnCredentials: TurnCredentials) {
    const stream = streamRef.current;
    if (!stream) return;

    try {
      const pc = new RTCPeerConnection(buildRtcConfig(turnCredentials));
      pcRef.current = pc;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      // Step 3.6 opened these channels; step 3.10 wires the receive side —
      // each incoming message is relayed via IPC to main, where nut.js
      // actually moves the mouse / types the key (this renderer has no
      // OS-level input access of its own).
      const inputReliable = pc.createDataChannel("input-reliable", { ordered: true });
      const inputPointer = pc.createDataChannel("input-pointer", {
        ordered: false,
        maxRetransmits: 0,
      });
      inputReliableRef.current = inputReliable;
      inputPointerRef.current = inputPointer;
      inputReliable.onopen = () => console.log("[host] input-reliable channel open");
      inputReliable.onclose = () => console.log("[host] input-reliable channel closed");
      inputReliable.onmessage = (event) => {
        try {
          window.electronAPI.forwardReliableInput(JSON.parse(event.data));
        } catch (err) {
          console.error("[host] failed to parse input-reliable message:", err);
        }
      };
      inputPointer.onopen = () => console.log("[host] input-pointer channel open");
      inputPointer.onclose = () => console.log("[host] input-pointer channel closed");
      inputPointer.onmessage = (event) => {
        try {
          window.electronAPI.forwardPointerInput(JSON.parse(event.data));
        } catch (err) {
          console.error("[host] failed to parse input-pointer message:", err);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          window.electronAPI.sendSignalIceCandidate({ candidate: event.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        if (pc.connectionState === "failed") {
          setErrorMsg("Couldn't establish a connection to the viewer.");
        }
        if (pc.connectionState === "disconnected") {
          // App Flow B4/A4: sustained disconnect (>5s), not instant —
          // brief blips shouldn't tear down the session immediately.
          clearDisconnectTimer();
          disconnectTimerRef.current = setTimeout(() => {
            if (pcRef.current?.connectionState === "disconnected") {
              handleEndSession("error");
            }
          }, DISCONNECT_GRACE_MS);
        } else {
          clearDisconnectTimer();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      window.electronAPI.sendSignalOffer({ sdp: { type: offer.type, sdp: offer.sdp ?? "" } });
    } catch (err) {
      setErrorMsg(`Couldn't set up the connection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleAccept() {
    if (!pending) return;
    clearDeclineTimer();
    setErrorMsg(null);
    try {
      // Same call as the browser-based Phase 2 sender — Electron's main
      // process intercepts this via setDisplayMediaRequestHandler (see
      // src/main/index.js) and answers it with a real screen source, so
      // no separate desktopCapturer picker flow is needed here.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      streamRef.current = stream;

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        // The OS's own "Stop sharing" control was used.
        handleEndSession("host_ended");
      });

      acceptAttemptRef.current = pending.viewerSocketId;
      await window.electronAPI.acceptRequest(pending.viewerSocketId);
      setCapturing(true);
      setActiveViewerMeta(pending.viewerMeta);
      void window.electronAPI.notifySessionStarted();
      setPending(null);
    } catch {
      setErrorMsg("Screen share was cancelled or blocked — can't accept without it.");
    }
  }

  function handleDecline(viewerSocketId?: string) {
    clearDeclineTimer();
    const id = viewerSocketId ?? pending?.viewerSocketId;
    if (!id) return;
    window.electronAPI.rejectRequest(id);
    setPending(null);
  }

  async function handleCopy() {
    if (!room) return;
    await navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "40px 24px" }}>
      <p style={{ color: "#8b95a1", fontSize: 13, marginBottom: 4 }}>rap-host · Phase 3</p>
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: "0 0 28px" }}>Host session</h1>

      {errorMsg && <p style={{ color: "#e2725b", fontSize: 13, marginBottom: 16 }}>{errorMsg}</p>}

      {!capturing && (
        <>
          {!room && <p>Requesting a code…</p>}
          {room && (
            <div>
              <p style={{ color: "#8b95a1", marginBottom: 8 }}>Share this code with the viewer:</p>
              <div style={{ fontSize: 36, letterSpacing: 3, color: "#4fd8c4", marginBottom: 8 }}>
                {room.code}
              </div>
              <Countdown expiresAt={room.expiresAt} />
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button onClick={handleCopy} style={buttonStyle("#4fd8c4")}>
                  {copied ? "Copied" : "Copy Code"}
                </button>
                <button onClick={() => window.electronAPI.requestNewCode()} style={buttonStyle("#8b95a1")}>
                  Refresh Code
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {capturing && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 20,
              color: "#4fd8c4",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#4fd8c4",
                display: "inline-block",
              }}
            />
            Session active — {activeViewerMeta?.ip ?? "unknown viewer"}
            {connectionState ? ` (${connectionState})` : ""}
          </div>
          <button onClick={() => handleEndSession("host_ended")} style={buttonStyle("#e2725b")}>
            End Session
          </button>
        </div>
      )}

      {pending && (
        <B3AcceptModal
          viewerMeta={pending.viewerMeta}
          onAccept={handleAccept}
          onDecline={() => handleDecline()}
        />
      )}
    </main>
  );
}

function buttonStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}`,
    color,
    padding: "10px 18px",
    fontSize: 13,
  };
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
  return <p style={{ color: "#8b95a1", fontSize: 13 }}>Expires in {secondsLeft}s</p>;
}
