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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <label className="mono-label">Session code</label>
        <CodeInput value={code} onChange={onChange} disabled={submitting} autoFocus />
      </div>

      {/* Errors land under the field — no screen change, no modal. The block
          only exists when there's something to say, so an empty state
          doesn't leave a hole above the button. */}
      {error && (
        <p className="flex items-start gap-2.5 rounded-[10px] border border-error-border bg-error-bg px-3.5 py-2.5 text-[13px] leading-snug text-error-ink">
          <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-error" aria-hidden />
          {ERROR_COPY[error]}
        </p>
      )}
      {!error && notice && (
        <p className="flex items-start gap-2.5 rounded-[10px] border border-hairline bg-surface-quiet px-3.5 py-2.5 text-[13px] leading-snug text-ink-muted">
          <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden />
          {notice}
        </p>
      )}

      {/* The screen's single brand action. Literal gradient (not a custom
          class) so Tailwind's enabled:/disabled: variants actually apply. */}
      <button
        type="button"
        onClick={onConnect}
        disabled={!isComplete || submitting}
        className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] font-display text-[15px] font-bold tracking-[-0.01em] transition-all enabled:bg-[linear-gradient(90deg,#FF0055,#FFA400)] enabled:text-white enabled:shadow-[0_6px_18px_rgba(255,0,85,.22)] enabled:hover:-translate-y-px enabled:hover:shadow-[0_10px_24px_rgba(255,0,85,.28)] disabled:cursor-not-allowed disabled:border disabled:border-hairline disabled:bg-canvas disabled:text-ink-faint"
      >
        {submitting ? <Spinner /> : null}
        {submitting ? "Connecting…" : "Connect"}
      </button>

      <p className="text-[12px] leading-relaxed text-ink-muted">
        Codes last two minutes and work once. The host owner has to accept before anything is shared.
      </p>
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
