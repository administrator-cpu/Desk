"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { buildRtcConfig, type TurnCredentials } from "@/lib/webrtc";
import A1PairingScreen, { type ErrorCode } from "./A1PairingScreen";
import A2WaitingScreen from "./A2WaitingScreen";

type Screen =
  | "A1" // entering a code
  | "A1-submitting" // socket.emit fired, waiting briefly for an immediate error
  | "A2" // waiting for host accept/reject
  | "A3"; // host:accepted received (A3 Connecting screen itself is step 2.7)

type SdpPayload = { sdp: { type: RTCSdpType; sdp: string } };
type IceCandidatePayload = { candidate: RTCIceCandidateInit };

export default function ViewerFlow() {
  const [code, setCode] = useState("");
  const [screen, setScreen] = useState<Screen>("A1");
  const [error, setError] = useState<ErrorCode>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const socket = getSocket();

    function onError(payload: { error: string }) {
      if (payload.error === "invalid_code" || payload.error === "rate_limited" || payload.error === "code_expired") {
        setError(payload.error);
        setNotice(null);
      } else {
        setError(null);
        setNotice(
          payload.error === "turn_unavailable"
            ? "The connection service is temporarily unavailable — try again."
            : `Couldn't complete the connection (${payload.error}).`
        );
      }
      closePeerConnection();
      setScreen("A1");
    }

    function onHostAccepted(payload: { turnCredentials: TurnCredentials }) {
      console.log("[viewer] host:accepted received, setting up peer connection");
      setScreen("A3");
      createPeerConnection(payload.turnCredentials);
    }

    function onHostReject() {
      setScreen("A1");
      setCode("");
      setError(null);
      setNotice("The other device declined the request.");
    }

    function onCodeExpired() {
      // App Flow A2: code expiring mid-wait routes back to A1 with a toast —
      // reuses the same copy as an explicit code_expired error on A1.
      setError("code_expired");
      setNotice(null);
      closePeerConnection();
      setScreen("A1");
    }

    function onSessionEnd() {
      closePeerConnection();
      setNotice("The host ended the session.");
      setScreen("A1");
      setCode("");
    }

    async function onOffer(payload: SdpPayload) {
      try {
        const pc = pcRef.current;
        if (!pc) return;
        console.log("[viewer] received offer");
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("[viewer] sending answer");
        socket.emit("signal:answer", { sdp: { type: answer.type, sdp: answer.sdp ?? "" } });
      } catch (err) {
        console.error("[viewer] failed to handle offer:", err);
        setError(null);
        setNotice(`Couldn't complete the connection: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    function onRemoteIceCandidate(payload: IceCandidatePayload) {
      const pc = pcRef.current;
      if (!pc) return;
      void pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }

    function createPeerConnection(turnCredentials: TurnCredentials) {
      const forceRelay = process.env.NEXT_PUBLIC_FORCE_RELAY === "true";
      const pc = new RTCPeerConnection(buildRtcConfig(turnCredentials, { forceRelay }));
      pcRef.current = pc;
      console.log("[viewer] RTCPeerConnection created", forceRelay ? "(forced relay)" : "");

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[viewer] sending ICE candidate");
          socket.emit("signal:ice-candidate", { candidate: event.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        console.log("[viewer] connectionState ->", pc.connectionState);
        setConnectionState(pc.connectionState);
      };
      pc.oniceconnectionstatechange = () => {
        console.log("[viewer] iceConnectionState ->", pc.iceConnectionState);
      };
      pc.ontrack = (event) => {
        console.log("[viewer] track received");
        if (videoRef.current) videoRef.current.srcObject = event.streams[0];
        setHasRemoteStream(true);
      };
    }

    function closePeerConnection() {
      pcRef.current?.close();
      pcRef.current = null;
      setConnectionState(null);
      setHasRemoteStream(false);
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    socket.on("error", onError);
    socket.on("host:accepted", onHostAccepted);
    socket.on("host:reject", onHostReject);
    socket.on("room:code-expired", onCodeExpired);
    socket.on("session:end", onSessionEnd);
    socket.on("signal:offer", onOffer);
    socket.on("signal:ice-candidate", onRemoteIceCandidate);

    return () => {
      socket.off("error", onError);
      socket.off("host:accepted", onHostAccepted);
      socket.off("host:reject", onHostReject);
      socket.off("room:code-expired", onCodeExpired);
      socket.off("session:end", onSessionEnd);
      socket.off("signal:offer", onOffer);
      socket.off("signal:ice-candidate", onRemoteIceCandidate);
      closePeerConnection();
    };
  }, []);

  function handleConnect() {
    const digitsOnly = code.replace(/\s/g, "");
    if (digitsOnly.length !== 9) {
      setError("invalid_code");
      return;
    }
    setError(null);
    setNotice(null);
    setScreen("A1-submitting");
    // Immediate loading feedback, per App Flow A1 — don't wait on a server
    // ack before showing it.
    getSocket().emit("viewer:join-room", { code: digitsOnly });
    // The event contract has no explicit "room found, pending host approval"
    // ack — only errors are pushed back. Treat silence within a short window
    // as success and move to A2.
    window.setTimeout(() => {
      setScreen((s) => (s === "A1-submitting" ? "A2" : s));
    }, 250);
  }

  function handleCancel() {
    getSocket().emit("viewer:cancel-request", {});
    setScreen("A1");
    setCode("");
  }

  const live = screen !== "A1";

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 md:grid-cols-[1.1fr_1px_1fr]">
      <section className="flex flex-col justify-center gap-10 px-6 py-16 md:px-12">
        <div className="max-w-[42ch]">
          <h1 className="font-display text-4xl font-medium leading-tight text-ink">
            Connect to a host
          </h1>
          {process.env.NEXT_PUBLIC_FORCE_RELAY === "true" && (
            <p className="mt-3 text-sm text-error">
              Forced TURN relay is ON — direct P2P is disabled for this test (step 2.10).
            </p>
          )}
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
            Enter the 9-digit code shown on the machine you want to reach.
            Nothing installs on this side — the code opens a direct,
            encrypted connection once the host owner accepts.
          </p>
        </div>
        <PairingDiagram live={live} />
      </section>

      <div className="hidden bg-hairline md:block" aria-hidden />

      <section className="flex flex-col justify-center px-6 py-16 md:px-12">
        {screen === "A1" || screen === "A1-submitting" ? (
          <A1PairingScreen
            code={code}
            onChange={setCode}
            onConnect={handleConnect}
            submitting={screen === "A1-submitting"}
            error={error}
            notice={notice}
          />
        ) : screen === "A2" ? (
          <A2WaitingScreen onCancel={handleCancel} />
        ) : (
          // A3 (Connecting) proper — with a screen transition to A4 on
          // "connected" — is step 2.7/2.8. This is the minimal version:
          // status text until a track arrives, then the raw video.
          <div className="flex flex-col gap-4">
            {!hasRemoteStream && (
              <div className="flex items-center gap-3 text-[15px] text-ink">
                <span className="signal-pulse h-2 w-2 rounded-full bg-signal" />
                {connectionState ? `Establishing the connection… (${connectionState})` : "Accepted — establishing the connection…"}
              </div>
            )}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={hasRemoteStream ? "w-full border border-hairline" : "hidden"}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function PairingDiagram({ live }: { live: boolean }) {
  return (
    <svg viewBox="0 0 340 90" className="w-full max-w-[360px]" aria-hidden>
      <text x="0" y="20" className="fill-ink-muted font-mono text-[11px]">this browser</text>
      <circle cx="8" cy="45" r="5" className="fill-ink-muted" />
      <line x1="16" y1="45" x2="150" y2="45" stroke="var(--color-hairline)" strokeWidth="1.5" strokeDasharray="4 4" />

      <circle cx="170" cy="45" r="9" className={live ? "fill-signal signal-pulse" : "fill-ink-muted"} />
      <text x="145" y="70" className="fill-ink-muted font-mono text-[11px]">code</text>

      <line x1="190" y1="45" x2="324" y2="45" stroke="var(--color-hairline)" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="332" cy="45" r="5" className="fill-ink-muted" />
      <text x="230" y="20" className="fill-ink-muted font-mono text-[11px]">their computer</text>
    </svg>
  );
}
