"use client";

import { CodeInput } from "./CodeInput";

export type ErrorCode = "invalid_code" | "rate_limited" | "code_expired" | null;

export const ERROR_COPY: Record<Exclude<ErrorCode, null>, string> = {
  invalid_code: "That code doesn't match an active session. Check it and try again.",
  rate_limited: "Too many attempts. Wait a minute, then try again.",
  code_expired: "This code is no longer valid.",
};

export default function A1PairingScreen({
  code,
  onChange,
  onConnect,
  submitting,
  error,
  notice,
}: {
  code: string;
  onChange: (next: string) => void;
  onConnect: () => void;
  submitting: boolean;
  error: ErrorCode;
  notice: string | null;
}) {
  const isComplete = code.replace(/\s/g, "").length === 9;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <label className="mb-4 block text-sm text-ink-muted">Pairing code</label>
        <CodeInput value={code} onChange={onChange} disabled={submitting} autoFocus />

        <div className="mt-4 min-h-[1.5rem] text-sm">
          {error && <p className="text-error">{ERROR_COPY[error]}</p>}
          {!error && notice && <p className="text-ink-muted">{notice}</p>}
        </div>
      </div>

      <button
        type="button"
        onClick={onConnect}
        disabled={!isComplete || submitting}
        className="inline-flex h-12 items-center justify-center gap-2 border border-signal bg-signal/10 px-6 font-display text-base font-medium text-signal transition-colors enabled:hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-ink-muted"
      >
        {submitting ? <Spinner /> : null}
        {submitting ? "Connecting…" : "Connect"}
      </button>
    </div>
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
