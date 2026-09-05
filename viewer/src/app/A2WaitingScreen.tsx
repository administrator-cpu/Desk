"use client";

/**
 * A2 — Waiting for Host (interstitial). Purely presentational: navigation
 * off this screen is driven by socket events owned by the parent flow
 * controller (ViewerFlow), per App Flow A2's "passive events" table.
 */
export default function A2WaitingScreen({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 text-[15px] text-ink">
        <Spinner />
        Waiting for the other device to accept…
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-11 w-fit items-center justify-center border border-hairline px-5 text-sm text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin text-signal" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
