"use client";

import { useRef } from "react";

const GROUPS = [3, 3, 3] as const;

export function CodeInput({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string; // exactly 9 chars, digits or "" for empty slots
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const digits = value.padEnd(9, " ").split("");

  function setDigitAt(index: number, char: string) {
    const next = digits.slice();
    next[index] = char;
    // Only strip trailing blanks so an interior clear (e.g. mid-code
    // backspace) doesn't collapse the whole value.
    onChange(next.join("").replace(/ +$/, ""));
  }

  function focusIndex(index: number) {
    const el = inputsRef.current[index];
    if (el) el.focus();
  }

  function handleChange(index: number, raw: string) {
    const char = raw.replace(/\D/g, "").slice(-1);
    if (!char) {
      setDigitAt(index, " ");
      return;
    }
    setDigitAt(index, char);
    if (index < 8) focusIndex(index + 1);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index].trim() === "" && index > 0) {
        focusIndex(index - 1);
        setDigitAt(index - 1, " ");
        e.preventDefault();
      } else {
        setDigitAt(index, " ");
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      focusIndex(index - 1);
    } else if (e.key === "ArrowRight" && index < 8) {
      focusIndex(index + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 9);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    focusIndex(Math.min(text.length, 8));
  }

  let flatIndex = -1;

  return (
    <div className="flex items-center gap-3" role="group" aria-label="9-digit pairing code">
      {GROUPS.map((groupSize, groupIdx) => (
        <div key={groupIdx} className="flex gap-1.5">
          {Array.from({ length: groupSize }).map(() => {
            flatIndex += 1;
            const i = flatIndex;
            const char = digits[i].trim();
            return (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                autoFocus={autoFocus && i === 0}
                disabled={disabled}
                value={char}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={(e) => e.target.select()}
                aria-label={`Digit ${i + 1} of 9`}
                className="h-14 w-9 rounded-none border-b-2 border-hairline bg-transparent text-center font-mono text-2xl text-ink outline-none transition-colors focus:border-signal disabled:opacity-40 sm:w-10"
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
