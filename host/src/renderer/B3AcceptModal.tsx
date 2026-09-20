import { useEffect, useState } from "react";
import { brandEdge, button, card, color, font, monoLabel } from "./brand";

type ViewerMeta = { ip?: string; userAgent?: string };

/**
 * The consent gate (App Flow B3). This is the one screen in the product that
 * must be explicit, so it gets the screen's single brand action — Accept —
 * and nothing else competes with it.
 */
export default function B3AcceptModal({
  viewerMeta,
  timeoutMs = 30_000,
  onAccept,
  onDecline,
}: {
  viewerMeta?: ViewerMeta;
  timeoutMs?: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // Display-only mirror of the parent's auto-decline timer, so the user can
  // see the deadline they're being held to. The parent still owns the decline.
  const [secondsLeft, setSecondsLeft] = useState(Math.round(timeoutMs / 1000));
  useEffect(() => {
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="A device wants to connect"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11,14,20,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        fontFamily: font.sans,
        color: color.ink,
      }}
    >
      <div style={{ ...card, width: "100%", maxWidth: 340, boxShadow: "0 18px 40px rgba(11,14,20,.18)" }}>
        <div style={brandEdge} />
        <div style={{ padding: "24px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ ...monoLabel, color: color.magenta }}>Consent required</span>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>A device wants to connect</p>
            <p style={{ margin: 0, fontFamily: font.mono, fontSize: 11, lineHeight: 1.7, color: color.secondary }}>
              {viewerMeta?.ip ?? "unknown IP"}
              <br />
              {viewerMeta?.userAgent ?? "unknown browser"}
            </p>
          </div>

          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: color.secondary }}>
            They will see your screen and control this machine until you end the session. Declines automatically in{" "}
            {secondsLeft}s.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onAccept}
              style={{ ...button("brand"), flex: 1, padding: "12px 0" }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 10px 22px rgba(255,0,85,.28)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 6px 16px rgba(255,0,85,.22)")}
            >
              Accept
            </button>
            <button
              onClick={onDecline}
              style={{ ...button("secondary"), flex: 1, padding: "12px 0" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = color.placeholder)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = color.border)}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
