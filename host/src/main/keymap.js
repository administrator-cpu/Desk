const { Key } = require("@nut-tree-fork/nut-js");

// Maps browser KeyboardEvent.code (physical key identity, layout-independent)
// to nut.js's Key enum, which is itself defined against "a standard 105 key
// US layout keyboard" — i.e. also physical-position-based. This is why we
// map from `.code` rather than `.key`: `.key` reflects the character
// produced (locale/layout/shift-state dependent), which would drift from
// nut.js's physical-key model. TRD §3.4 flags this exact mapping as "a
// common source of subtle cross-platform bugs (e.g. Meta vs Cmd on macOS)".
//
// Only physical key press/release is handled here — modifier combinations
// (e.g. Ctrl+C) aren't bundled into a single call. Each modifier key (Shift,
// Control, Alt, Meta) generates its own keydown/keyup from the browser with
// its own `code`, and those go through this same table like any other key.
// Bundling would risk double-pressing a modifier that's *also* being
// reported via its own discrete event.
const CODE_TO_KEY = {
  Escape: Key.Escape,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  F13: Key.F13, F14: Key.F14, F15: Key.F15, F16: Key.F16, F17: Key.F17,
  F18: Key.F18, F19: Key.F19, F20: Key.F20, F21: Key.F21, F22: Key.F22,
  F23: Key.F23, F24: Key.F24,
  PrintScreen: Key.Print,
  ScrollLock: Key.ScrollLock,
  Pause: Key.Pause,
  Backquote: Key.Grave,
  Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3, Digit4: Key.Num4,
  Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7, Digit8: Key.Num8,
  Digit9: Key.Num9, Digit0: Key.Num0,
  Minus: Key.Minus,
  Equal: Key.Equal,
  Backspace: Key.Backspace,
  Insert: Key.Insert,
  Home: Key.Home,
  PageUp: Key.PageUp,
  NumLock: Key.NumLock,
  NumpadEqual: Key.NumPadEqual,
  NumpadDivide: Key.Divide,
  NumpadMultiply: Key.Multiply,
  NumpadSubtract: Key.Subtract,
  Tab: Key.Tab,
  KeyQ: Key.Q, KeyW: Key.W, KeyE: Key.E, KeyR: Key.R, KeyT: Key.T, KeyY: Key.Y,
  KeyU: Key.U, KeyI: Key.I, KeyO: Key.O, KeyP: Key.P,
  BracketLeft: Key.LeftBracket,
  BracketRight: Key.RightBracket,
  Backslash: Key.Backslash,
  Delete: Key.Delete,
  End: Key.End,
  PageDown: Key.PageDown,
  Numpad7: Key.NumPad7, Numpad8: Key.NumPad8, Numpad9: Key.NumPad9,
  NumpadAdd: Key.Add,
  CapsLock: Key.CapsLock,
  KeyA: Key.A, KeyS: Key.S, KeyD: Key.D, KeyF: Key.F, KeyG: Key.G, KeyH: Key.H,
  KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L,
  Semicolon: Key.Semicolon,
  Quote: Key.Quote,
  Enter: Key.Return, // the main Enter/Return key — nut.js's `Enter` is the numpad one
  NumpadEnter: Key.Enter,
  Numpad4: Key.NumPad4, Numpad5: Key.NumPad5, Numpad6: Key.NumPad6,
  ShiftLeft: Key.LeftShift,
  KeyZ: Key.Z, KeyX: Key.X, KeyC: Key.C, KeyV: Key.V, KeyB: Key.B, KeyN: Key.N,
  KeyM: Key.M,
  Comma: Key.Comma,
  Period: Key.Period,
  Slash: Key.Slash,
  ShiftRight: Key.RightShift,
  ArrowUp: Key.Up,
  Numpad1: Key.NumPad1, Numpad2: Key.NumPad2, Numpad3: Key.NumPad3,
  ControlLeft: Key.LeftControl,
  AltLeft: Key.LeftAlt,
  ControlRight: Key.RightControl,
  AltRight: Key.RightAlt,
  Space: Key.Space,
  ContextMenu: Key.Menu,
  ArrowLeft: Key.Left,
  ArrowDown: Key.Down,
  ArrowRight: Key.Right,
  Numpad0: Key.NumPad0,
  NumpadDecimal: Key.Decimal,
  AudioVolumeMute: Key.AudioMute,
  AudioVolumeDown: Key.AudioVolDown,
  AudioVolumeUp: Key.AudioVolUp,
  MediaPlayPause: Key.AudioPlay,
  MediaTrackPrevious: Key.AudioPrev,
  MediaTrackNext: Key.AudioNext,
};

/**
 * The Meta/Windows/Cmd key isn't a single aliased value in nut.js — LeftSuper,
 * LeftWin, and LeftCmd are distinct enum members, presumably because the
 * native binding expects the OS-appropriate variant. Resolved from
 * `process.platform` rather than hardcoded, so this doesn't silently send
 * the wrong one depending on which OS the host app is actually running on.
 */
function metaKeyForPlatform(side) {
  const isLeft = side === "left";
  if (process.platform === "darwin") return isLeft ? Key.LeftCmd : Key.RightCmd;
  if (process.platform === "win32") return isLeft ? Key.LeftWin : Key.RightWin;
  return isLeft ? Key.LeftSuper : Key.RightSuper;
}

/**
 * Looks up the nut.js Key for a browser KeyboardEvent.code. Returns
 * undefined for anything unmapped — callers must check for this rather
 * than assuming every possible code has a mapping.
 */
function codeToKey(code) {
  if (code === "MetaLeft") return metaKeyForPlatform("left");
  if (code === "MetaRight") return metaKeyForPlatform("right");
  return CODE_TO_KEY[code];
}

module.exports = { codeToKey, CODE_TO_KEY, metaKeyForPlatform };
