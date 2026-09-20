"use client";

/**
 * A2 — Waiting for Host (interstitial). Purely presentational: navigation
 * off this screen is driven by socket events owned by the parent flow
 * controller (ViewerFlow), per App Flow A2's "passive events" table.
 */
export default function A2WaitingScreen({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3.5">
          <span className="signal-pulse block h-3 w-3 shrink-0 rounded-full bg-signal" aria-hidden />
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
            Waiting for the other device to accept…
          </span>
        </div>
        <p className="pl-[26px] text-[13px] leading-relaxed text-ink-muted">
          The host owner has 30 seconds to respond. Nothing is shared until they do.
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-11 w-fit items-center justify-center rounded-[10px] border border-hairline bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
      >
        Cancel
      </button>
    </div>
  );
}
