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
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputReliableRef = useRef<RTCDataChannel | null>(null);
  const inputPointerRef = useRef<RTCDataChannel | null>(null);
  const lastMoveSentRef = useRef(0);

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
        // Stored in a ref and attached via an effect (below), not directly
        // here — the video element only mounts once hasRemoteStream is
        // true (it's now a full-screen takeover, not always in the DOM),
        // so videoRef.current would still be null at this exact moment.
        remoteStreamRef.current = event.streams[0];
        setHasRemoteStream(true);
      };
      // Step 3.6: the host creates these as part of its offer; receive
      // them here rather than creating our own. Not wired to real mouse/
      // keyboard capture yet (3.7/3.8) — this step just proves both
      // channels negotiate and open successfully from this side too.
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label === "input-reliable") {
          inputReliableRef.current = channel;
        } else if (channel.label === "input-pointer") {
          inputPointerRef.current = channel;
        }
        channel.onopen = () => console.log(`[viewer] ${channel.label} channel open`);
        channel.onclose = () => console.log(`[viewer] ${channel.label} channel closed`);
      };
    }

    function closePeerConnection() {
      pcRef.current?.close();
      pcRef.current = null;
      inputReliableRef.current = null;
      inputPointerRef.current = null;
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

  // Attach the stream once the video element actually exists — it only
  // mounts once hasRemoteStream is true (see ontrack above for why), and
  // auto-focuses at the same time so keyboard input works immediately
  // without an extra click first.
  useEffect(() => {
    if (hasRemoteStream && videoRef.current && remoteStreamRef.current) {
      videoRef.current.srcObject = remoteStreamRef.current;
      videoRef.current.focus();
    }
  }, [hasRemoteStream]);

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

  // Step 3.7: mouse capture on the video element. Coordinates are
  // normalized 0.0–1.0 (TRD §3.3) so the host can map them to its own
  // screen resolution regardless of what resolution this viewer runs at.
  function sendPointerMessage(msg: Record<string, unknown>) {
    const channel = inputPointerRef.current;
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(msg));
    }
  }

  function normalizedCoords(e: React.MouseEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function buttonName(button: number): "left" | "middle" | "right" {
    if (button === 1) return "middle";
    if (button === 2) return "right";
    return "left";
  }

  function handleMouseMove(e: React.MouseEvent<HTMLVideoElement>) {
    // Cap to ~60fps — input-pointer is unordered/unreliable by design
    // (TRD §3.3), but that doesn't mean flooding it with every native
    // mousemove event (which can fire far more often) is a good idea.
    const now = performance.now();
    if (now - lastMoveSentRef.current < 16) return;
    lastMoveSentRef.current = now;
    const { x, y } = normalizedCoords(e);
    sendPointerMessage({ type: "mousemove", x, y, ts: Date.now() });
  }

  function handleMouseDown(e: React.MouseEvent<HTMLVideoElement>) {
    const { x, y } = normalizedCoords(e);
    sendPointerMessage({ type: "mousedown", button: buttonName(e.button), x, y });
  }

  function handleMouseUp(e: React.MouseEvent<HTMLVideoElement>) {
    const { x, y } = normalizedCoords(e);
    sendPointerMessage({ type: "mouseup", button: buttonName(e.button), x, y });
  }

  function handleWheel(e: React.WheelEvent<HTMLVideoElement>) {
    sendPointerMessage({ type: "scroll", deltaY: e.deltaY });
  }

  // Step 3.8: keyboard capture "while video focused" (App Flow A4) — the
  // video element needs tabIndex to actually receive focus/key events.
  // Sent on input-reliable (ordered/reliable — dropping a keystroke
  // corrupts what gets typed, unlike a dropped mouse-position update).
  function sendReliableMessage(msg: Record<string, unknown>) {
    const channel = inputReliableRef.current;
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(msg));
    }
  }

  function activeModifiers(e: React.KeyboardEvent<HTMLVideoElement>): string[] {
    const mods: string[] = [];
    if (e.shiftKey) mods.push("Shift");
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Meta");
    return mods;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLVideoElement>) {
    // Prevent the browser's own handling (scrolling on Space/arrows,
    // triggering local shortcuts, etc.) — every keystroke here is meant
    // for the remote host, not this page. Some browser-reserved keys
    // (F5, F11, Ctrl+W) can't be intercepted regardless; that's a known
    // limitation of any browser-based remote control tool, not a bug here.
    e.preventDefault();
    sendReliableMessage({ type: "keydown", key: e.key, code: e.code, modifiers: activeModifiers(e) });
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLVideoElement>) {
    e.preventDefault();
    sendReliableMessage({ type: "keyup", key: e.key, code: e.code, modifiers: activeModifiers(e) });
  }

  const live = screen !== "A1";

  // Full-screen takeover once video is live — the two-column pairing
  // layout only makes sense before you're actually looking at the host's
  // screen; once connected, the remote screen should fill the viewport.
  if (hasRemoteStream) {
    return (
      <div className="fixed inset-0 bg-canvas">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          tabIndex={0}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={(e) => e.preventDefault()}
          className="h-full w-full cursor-crosshair object-contain outline-none"
        />
      </div>
    );
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 md:grid-cols-[1.1fr_1px_1fr]">
      <section className="flex flex-col justify-center gap-10 px-6 py-16 md:px-12">
        <div className="max-w-[42ch]">
          <h1 className="font-display text-4xl font-medium leading-tight text-ink">
            Connect to a host
          </h1>
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
          // A3 (Connecting) — once hasRemoteStream flips true above, this
          // branch is bypassed entirely by the early return.
          <div className="flex items-center gap-3 text-[15px] text-ink">
            <span className="signal-pulse h-2 w-2 rounded-full bg-signal" />
            {connectionState ? `Establishing the connection… (${connectionState})` : "Accepted — establishing the connection…"}
          </div>
        )}
      </section>
    </main>
  );
}

/** Evenly-spaced dots between two x-coordinates at a fixed y — used instead
 * of SVG strokeDasharray, which can pixel-snap inconsistently between two
 * otherwise-identical lines depending on final rendered scale factor,
 * producing visibly uneven dot spacing on close inspection even when the
 * underlying math (line length, dash pattern) is symmetric. Explicit dots
 * guarantee both sides render identically regardless of scaling. */
function connectorDots(x1: number, x2: number, y: number, spacing: number) {
  const length = x2 - x1;
  const count = Math.max(2, Math.round(length / spacing) + 1);
  const step = length / (count - 1);
  return Array.from({ length: count }, (_, i) => ({ cx: x1 + step * i, cy: y }));
}

function PairingDiagram({ live }: { live: boolean }) {
  const leftDots = connectorDots(16, 150, 45, 8);
  const rightDots = connectorDots(190, 324, 45, 8);

  return (
    <svg viewBox="0 0 340 90" className="w-full max-w-[360px]" aria-hidden>
      <text x="0" y="20" className="fill-ink-muted font-mono text-[11px]">this browser</text>
      <circle cx="8" cy="45" r="5" className="fill-ink-muted" />
      {leftDots.map((d, i) => (
        <circle key={`left-${i}`} cx={d.cx} cy={d.cy} r="1.3" className="fill-hairline" />
      ))}

      <circle cx="170" cy="45" r="9" className={live ? "fill-signal signal-pulse" : "fill-ink-muted"} />
      <text x="145" y="70" className="fill-ink-muted font-mono text-[11px]">code</text>

      {rightDots.map((d, i) => (
        <circle key={`right-${i}`} cx={d.cx} cy={d.cy} r="1.3" className="fill-hairline" />
      ))}
      <circle cx="332" cy="45" r="5" className="fill-ink-muted" />
      <text x="230" y="20" className="fill-ink-muted font-mono text-[11px]">their computer</text>
    </svg>
  );
}
