import { useEffect, useRef, useState } from "react";
import B3AcceptModal from "./B3AcceptModal";
import { buildRtcConfig, type TurnCredentials } from "./webrtc";
import { brandEdge, button, card, color, font, gradient, monoLabel } from "./brand";

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
    <main
      style={{
        minHeight: "100vh",
        background: color.canvas,
        color: color.ink,
        fontFamily: font.sans,
        display: "flex",
        flexDirection: "column",
        padding: "28px 24px 20px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>

        {errorMsg && (
          <div
            role="alert"
            style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 13px", background: color.criticalBg, border: `1px solid ${color.criticalBorder}`, borderRadius: 10 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.critical, marginTop: 6, flex: "none" }} />
            <span style={{ fontSize: 13, lineHeight: 1.45, color: color.criticalInk }}>{errorMsg}</span>
          </div>
        )}

        {!capturing && (
          <section style={{ ...card, display: "flex", flexDirection: "column" }}>
            <div style={brandEdge} />
            {!room && (
              <div style={{ padding: "48px 24px", textAlign: "center", ...monoLabel, color: color.secondary }}>Requesting a code…</div>
            )}
            {room && (
              <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
                  <span style={monoLabel}>Read this out</span>
                  <div style={{ display: "flex", gap: 12, fontFamily: font.mono, fontSize: 30, fontWeight: 500, letterSpacing: "0.1em" }}>
                    <span>{room.code.slice(0, 3)}</span>
                    <span>{room.code.slice(3, 6)}</span>
                    <span>{room.code.slice(6, 9)}</span>
                  </div>
                  <Countdown expiresAt={room.expiresAt} />
                </div>

                <div style={{ height: 1, background: color.border }} />

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    onClick={handleCopy}
                    style={button("primary", true)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = color.inkHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = color.ink)}
                  >
                    {copied ? "Copied" : "Copy code"}
                  </button>
                  <button
                    onClick={() => window.electronAPI.requestNewCode()}
                    style={button("secondary", true)}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = color.placeholder)}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = color.border)}
                  >
                    Refresh code
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", background: color.surfaceQuiet, border: `1px solid ${color.border}`, borderRadius: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: color.magenta, flex: "none" }} />
                  <span style={{ fontSize: 12, lineHeight: 1.45, color: color.secondary }}>
                    Running in the tray. Closing this window keeps it alive.
                  </span>
                </div>
              </div>
            )}
          </section>
        )}

        {capturing && (
          <section style={{ ...card, display: "flex", flexDirection: "column" }}>
            <div style={brandEdge} />
            <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
                <span
                  style={{ width: 10, height: 10, borderRadius: "50%", background: color.success, display: "inline-block" }}
                  aria-hidden
                />
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>Session active</div>
                <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: "0.08em", color: color.secondary }}>
                  {activeViewerMeta?.ip ?? "unknown viewer"}
                  {connectionState ? ` · ${connectionState}` : ""}
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  border: `1px solid ${color.border}`,
                  borderRadius: 10,
                  background: `repeating-linear-gradient(135deg, ${color.surfaceQuiet} 0 8px, ${color.surface} 8px 16px)`,
                  textAlign: "center",
                  ...monoLabel,
                  letterSpacing: "0.14em",
                }}
              >
                Your screen is being shared
              </div>

              <button
                onClick={() => handleEndSession("host_ended")}
                style={button("destructive", true)}
                onMouseEnter={(e) => (e.currentTarget.style.background = color.criticalBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = color.surface)}
              >
                End session
              </button>
            </div>
          </section>
        )}

        <footer style={{ marginTop: "auto", paddingTop: 5, borderTop: ``, ...monoLabel, letterSpacing: "0.14em", textAlign: "center" }}>
          Powered by DIV &lt;/&gt;
        </footer>
      </div>

      {pending && (
        <B3AcceptModal
          viewerMeta={pending.viewerMeta}
          timeoutMs={B3_TIMEOUT_MS}
          onAccept={handleAccept}
          onDecline={() => handleDecline()}
        />
      )}
    </main>
  );
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
  const urgent = secondsLeft <= 30;
  const label = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 999,
        // State colour never travels alone — the word "Expires" carries it.
        color: urgent ? color.warningInk : color.secondary,
        background: urgent ? color.warningBg : color.surfaceQuiet,
        border: `1px solid ${urgent ? color.warning : color.border}`,
      }}
    >
      Expires in {label}
    </span>
  );
}
