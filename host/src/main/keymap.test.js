const { Key } = require("@nut-tree-fork/nut-js");
const { codeToKey } = require("./keymap.js");

let failures = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    failures += 1;
  }
}

// Letters, in physical QWERTY order — the thing most likely to silently
// drift out of alignment if the table were ever hand-edited carelessly.
check("KeyQ -> Q", codeToKey("KeyQ"), Key.Q);
check("KeyA -> A", codeToKey("KeyA"), Key.A);
check("KeyZ -> Z", codeToKey("KeyZ"), Key.Z);
check("KeyM -> M", codeToKey("KeyM"), Key.M);

// Digits — top row (Num*), distinct from numpad (NumPad*).
check("Digit1 -> Num1", codeToKey("Digit1"), Key.Num1);
check("Digit0 -> Num0", codeToKey("Digit0"), Key.Num0);
check("Numpad1 -> NumPad1", codeToKey("Numpad1"), Key.NumPad1);
check("Numpad0 -> NumPad0", codeToKey("Numpad0"), Key.NumPad0);

// The Enter/Return distinction that's easy to get backwards.
check("Enter -> Return (main key, not numpad)", codeToKey("Enter"), Key.Return);
check("NumpadEnter -> Enter (numpad-specific)", codeToKey("NumpadEnter"), Key.Enter);

// Modifiers.
check("ShiftLeft -> LeftShift", codeToKey("ShiftLeft"), Key.LeftShift);
check("ShiftRight -> RightShift", codeToKey("ShiftRight"), Key.RightShift);
check("ControlLeft -> LeftControl", codeToKey("ControlLeft"), Key.LeftControl);
check("AltLeft -> LeftAlt", codeToKey("AltLeft"), Key.LeftAlt);

// Arrows — note these map to Up/Down/Left/Right, NOT ArrowUp etc; nut.js's
// own naming drops the "Arrow" prefix, an easy copy-paste mistake to make.
check("ArrowUp -> Up", codeToKey("ArrowUp"), Key.Up);
check("ArrowLeft -> Left", codeToKey("ArrowLeft"), Key.Left);

// Function keys, spot-checking the boundaries of the range.
check("F1 -> F1", codeToKey("F1"), Key.F1);
check("F24 -> F24", codeToKey("F24"), Key.F24);

// Punctuation.
check("Backquote -> Grave", codeToKey("Backquote"), Key.Grave);
check("Slash -> Slash", codeToKey("Slash"), Key.Slash);

// Platform-dependent Meta key resolution.
const originalPlatform = process.platform;
Object.defineProperty(process, "platform", { value: "darwin" });
check("MetaLeft on darwin -> LeftCmd", codeToKey("MetaLeft"), Key.LeftCmd);
Object.defineProperty(process, "platform", { value: "win32" });
check("MetaLeft on win32 -> LeftWin", codeToKey("MetaLeft"), Key.LeftWin);
Object.defineProperty(process, "platform", { value: "linux" });
check("MetaLeft on linux -> LeftSuper", codeToKey("MetaLeft"), Key.LeftSuper);
Object.defineProperty(process, "platform", { value: originalPlatform });

// Unmapped codes must return undefined, not throw or silently coerce.
check("totally unknown code -> undefined", codeToKey("NotARealCode"), undefined);

if (failures === 0) {
  console.log("\nALL KEYMAP TESTS PASSED");
} else {
  console.error(`\n${failures} KEYMAP TEST(S) FAILED`);
  process.exitCode = 1;
}
