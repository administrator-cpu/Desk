/**
 * DIV brand tokens — Brand Guide v1.0 (September 2026).
 *
 * Rules encoded here, so they can't drift:
 *  - The gradient is an identity device, not a UI colour. It appears on the
 *    3px card edge and on ONE action per screen. Never behind body text.
 *  - White cards on the quiet canvas ground. One border weight (1px #E8E8E0).
 *    Restrained elevation — shadow only on things that genuinely float.
 *  - Sentence case everywhere except mono labels (uppercase, tracked).
 *  - Codes, IPs, timers, connection states and the <Div/> signature are mono.
 *  - A state colour never travels alone — every state also carries a word.
 *
 * Fonts: add this to index.html <head> (self-host for the packaged app so the
 * window renders correctly offline):
 * <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
 * <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
 */

export const color = {
  magenta: "#FF0055",
  amber: "#FFA400",
  coral: "#FF7F57",
  ink: "#0B0E14",
  inkHover: "#1A1F2B",
  canvas: "#F4F4F2",
  surface: "#FFFFFF",
  surfaceQuiet: "#FAFAF8",
  border: "#E8E8E0",
  body: "#4A4A52",
  secondary: "#62626A",
  placeholder: "#A5A5AD",
  success: "#12B76A",
  successInk: "#027A48",
  successBg: "#ECFDF3",
  warning: "#F79009",
  warningInk: "#B54708",
  warningBg: "#FFFAEB",
  critical: "#D92D20",
  criticalInk: "#B42318",
  criticalBg: "#FEF3F2",
  criticalBorder: "#FDA29B",
} as const;

export const gradient = `linear-gradient(90deg, ${color.magenta}, ${color.amber})`;

export const font = {
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** Uppercase, tracked mono label — section headers, field labels, meta. */
export const monoLabel: React.CSSProperties = {
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: color.placeholder,
};

export const card: React.CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: 14,
  overflow: "hidden",
};

/** The 3px identity edge that tops every card. */
export const brandEdge: React.CSSProperties = {
  height: 3,
  background: gradient,
};

type ButtonKind = "brand" | "primary" | "secondary" | "destructive";

/** One `brand` button per screen, maximum. Everything else is ink or outline. */
export function button(kind: ButtonKind, full = false): React.CSSProperties {
  const base: React.CSSProperties = {
    cursor: "pointer",
    padding: "13px 22px",
    borderRadius: 10,
    fontFamily: font.sans,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    width: full ? "100%" : undefined,
    transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease",
  };
  switch (kind) {
    case "brand":
      return { ...base, border: "none", background: gradient, color: color.surface, fontWeight: 700, boxShadow: "0 6px 16px rgba(255,0,85,.22)" };
    case "primary":
      return { ...base, background: color.ink, border: `1px solid ${color.ink}`, color: color.surface };
    case "destructive":
      return { ...base, background: color.surface, border: `1px solid ${color.criticalBorder}`, color: color.criticalInk, fontWeight: 700 };
    default:
      return { ...base, background: color.surface, border: `1px solid ${color.border}`, color: color.ink };
  }
}
