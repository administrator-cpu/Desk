"use client";

import { useEffect, useRef } from "react";

/**
 * Nine boxes in 3-3-3. Same API as before (value is the raw digit string,
 * onChange emits digits only) — only the presentation is brand-side.
 * Paste fills all nine, arrows walk, Backspace on an empty box steps back.
 *
 * The three groups are a fixed 3-column grid and the boxes inside flex to
 * the available width, so the row can never wrap into a ragged 6+3 no
 * matter how narrow the card gets.
 */
export function CodeInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.replace(/\D/g, "").slice(0, 9).padEnd(9, " ").split("");

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function commit(next: string[]) {
    onChange(next.join("").replace(/\s/g, ""));
  }

  function focusAt(i: number) {
    const el = inputs.current[Math.min(8, Math.max(0, i))];
    el?.focus();
    el?.select();
  }

  function handleChange(i: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = digit || " ";
    commit(next);
    if (digit && i < 8) window.setTimeout(() => focusAt(i + 1), 0);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && digits[i].trim() === "" && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = " ";
      commit(next);
      window.setTimeout(() => focusAt(i - 1), 0);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 9);
    if (!pasted) return;
    e.preventDefault();
    const next = pasted.padEnd(9, " ").split("");
    commit(next);
    window.setTimeout(() => focusAt(pasted.length), 0);
  }

  return (
    <div className="grid w-full grid-cols-3 gap-3">
      {[0, 1, 2].map((group) => (
        <div key={group} className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((slot) => {
            const i = group * 3 + slot;
            return (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                aria-label={`Code digit ${i + 1}`}
                disabled={disabled}
                value={digits[i].trim()}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={(e) => e.currentTarget.select()}
                className="h-13 min-w-0 rounded-[10px] border border-hairline bg-surface p-0 text-center font-mono text-[20px] text-ink caret-signal outline-none transition-[border-color,box-shadow] hover:border-ink-faint focus:border-signal focus:shadow-[0_0_0_3px_rgba(255,0,85,.12)] disabled:bg-canvas disabled:text-ink-faint"
                style={{ height: 52 }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
