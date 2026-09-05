"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { CodeInput } from "./CodeInput";

type Phase =
  | "idle" // entering a code
  | "submitting" // socket.emit fired, waiting on server ack/errors
  | "pending" // server confirmed the room, waiting on host to accept/reject
  | "accepted"; // host:accepted received (A3/A4 land here in a later phase)

type ErrorCode = "invalid_code" | "rate_limited" | "code_expired" | null;

const ERROR_COPY: Record<Exclude<ErrorCode, null>, string> = {
  invalid_code: "That code doesn't match an active session. Check it and try again.",
  rate_limited: "Too many attempts. Wait a minute, then try again.",
  code_expired: "This code is no longer valid.",
};

export default function PairingScreen() {
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ErrorCode>(null);
  const [rejectedNotice, setRejectedNotice] = useState(false);
  const generatedCodeRef = useRef<string>("");

  const digitsOnly = code.replace(/\s/g, "");
  const isComplete = digitsOnly.length === 9;

  useEffect(() => {
    const socket = getSocket();

    function onError(payload: { error: string }) {
      if (payload.error === "invalid_code" || payload.error === "rate_limited" || payload.error === "code_expired") {
        setError(payload.error);
      }
      setPhase("idle");
    }

    function onHostAccepted() {
      setPhase("accepted");
    }

    function onHostReject() {
      setPhase("idle");
      setCode("");
      setRejectedNotice(true);
    }

    function onCodeExpired() {
      setError("code_expired");
      setPhase("idle");
    }

    socket.on("error", onError);
    socket.on("host:accepted", onHostAccepted);
    socket.on("host:reject", onHostReject);
    socket.on("room:code-expired", onCodeExpired);

    return () => {
      socket.off("error", onError);
      socket.off("host:accepted", onHostAccepted);
      socket.off("host:reject", onHostReject);
      socket.off("room:code-expired", onCodeExpired);
    };
  }, []);

  function handleConnect() {
    if (!isComplete) {
      setError("invalid_code");
      return;
    }
    setError(null);
    setRejectedNotice(false);
    setPhase("submitting");
    generatedCodeRef.current = digitsOnly;
    // Loading state shown immediately; don't wait on a server ack to give
    // feedback (App Flow A1: "Button enters a loading state ... immediately").
    getSocket().emit("viewer:join-room", { code: digitsOnly });
    // The server has no explicit "room found, pending host approval" ack in
    // the current event contract beyond silence-then-wait — treat the
    // absence of an immediate error as success and move to "pending".
    // A real A2 screen (step 2.3) will own this state properly; for now we
    // reflect it inline so this step's wiring is testable end-to-end.
    window.setTimeout(() => {
      setPhase((p) => (p === "submitting" ? "pending" : p));
    }, 250);
  }

  function handleCancel() {
    getSocket().emit("viewer:cancel-request", {});
    setPhase("idle");
    setCode("");
  }

  const disabled = phase === "submitting" || phase === "pending" || phase === "accepted";

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 md:grid-cols-[1.1fr_1px_1fr]">
      {/* Left: context + diagram */}
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
        <PairingDiagram phase={phase} />
      </section>

      <div className="hidden bg-hairline md:block" aria-hidden />

      {/* Right: code entry */}
      <section className="flex flex-col justify-center gap-8 px-6 py-16 md:px-12">
        <div>
          <label className="mb-4 block text-sm text-ink-muted">
            Pairing code
          </label>
          <CodeInput value={code} onChange={setCode} disabled={disabled} autoFocus />

          <div className="mt-4 min-h-[1.5rem] text-sm">
            {error && <p className="text-error">{ERROR_COPY[error]}</p>}
            {!error && rejectedNotice && (
              <p className="text-ink-muted">The other device declined the request.</p>
            )}
          </div>
        </div>

        {phase === "idle" || phase === "submitting" ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={!isComplete || phase === "submitting"}
            className="inline-flex h-12 items-center justify-center gap-2 border border-signal bg-signal/10 px-6 font-display text-base font-medium text-signal transition-colors enabled:hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-ink-muted"
          >
            {phase === "submitting" ? <Spinner /> : null}
            {phase === "submitting" ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <span className="signal-pulse h-2 w-2 rounded-full bg-signal" />
              {phase === "pending" && "Waiting for the other device to accept…"}
              {phase === "accepted" && "Accepted — establishing the connection…"}
            </div>
            {phase === "pending" && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex h-11 w-fit items-center justify-center border border-hairline px-5 text-sm text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function PairingDiagram({ phase }: { phase: Phase }) {
  const live = phase !== "idle";
  return (
    <svg viewBox="0 0 340 90" className="w-full max-w-[360px]" aria-hidden>
      <text x="0" y="20" className="fill-ink-muted font-mono text-[11px]">this browser</text>
      <circle cx="8" cy="45" r="5" className="fill-ink-muted" />
      <line x1="16" y1="45" x2="150" y2="45" stroke="var(--color-hairline)" strokeWidth="1.5" strokeDasharray="4 4" />

      <circle
        cx="170"
        cy="45"
        r="9"
        className={live ? "fill-signal signal-pulse" : "fill-ink-muted"}
      />
      <text x="145" y="70" className="fill-ink-muted font-mono text-[11px]">code</text>

      <line x1="190" y1="45" x2="324" y2="45" stroke="var(--color-hairline)" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="332" cy="45" r="5" className="fill-ink-muted" />
      <text x="230" y="20" className="fill-ink-muted font-mono text-[11px]">their computer</text>
    </svg>
  );
}
