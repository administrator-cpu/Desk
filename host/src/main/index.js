const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  session,
  desktopCapturer,
  dialog,
  screen: electronScreen,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { io } = require("socket.io-client");
const { mouse, keyboard, Button, Point } = require("@nut-tree-fork/nut-js");
const { codeToKey } = require("./keymap.js");

const SIGNALING_URL = process.env.SIGNALING_URL || "http://localhost:4000";
const RENDERER_DEV_URL = process.env.RENDERER_DEV_URL || "http://localhost:5174";

// Debug log written to a file rather than relying on console output —
// some Windows + Electron setups don't reliably forward stdout/stderr to
// the launching terminal, which made earlier debugging sessions in this
// project impossible to diagnose from console output alone.
const LOG_PATH = path.join(__dirname, "../../host-debug.log");
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // ignore — logging must never crash the app
  }
  console.log(...args);
}

log("=== rap-host starting ===");
log("SIGNALING_URL:", SIGNALING_URL);
log("RENDERER_DEV_URL:", RENDERER_DEV_URL);
log("__dirname:", __dirname);
log("app.isPackaged:", app.isPackaged);

// The socket connection and current room state live here in the main
// process, not in the B2 renderer window — this is deliberate. App Flow B2
// says "Generate New Code" from the tray context menu works "without
// requiring the window to be open first", which means the code's lifecycle
// can't depend on a window existing. The renderer is just a view onto
// whatever state main process broadcasts to it.
let tray = null;
let mainWindow = null;
let socket = null;
/** @type {{ code: string, expiresAt: number } | null} */
let currentRoom = null;
let sessionActive = false;

function createRoom() {
  if (!socket || !socket.connected) return;
  socket.emit("host:create-room", {});
}

/** Called whenever a session ends, regardless of who ended it (host via
 * window/tray button, viewer ending it, or a relayed session:end) — always
 * reverts the tray to idle and mints a fresh code, per App Flow B4:
 * "Navigate to B2, generates a fresh code automatically (old one is
 * already invalidated per TRD §2.1)". */
function endActiveSession() {
  setSessionActive(false);
  createRoom();
}

function broadcastRoomState() {
  sendToRenderer("room-state", currentRoom);
}

/** Sends to the renderer, waiting for the page to finish loading first if
 * a window was just created — otherwise a message sent immediately after
 * createMainWindow() can arrive before the renderer's IPC listener is
 * even attached. */
function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.isLoading()) {
    wc.once("did-finish-load", () => wc.send(channel, payload));
  } else {
    wc.send(channel, payload);
  }
}

function connectSocket() {
  socket = io(SIGNALING_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    log("[host] connected to signaling server");
    createRoom();
  });

  socket.on("connect_error", (err) => {
    log("[host] socket connect_error:", err.message);
  });

  socket.on("room:created", (payload) => {
    log("[host] room:created", payload);
    currentRoom = payload;
    broadcastRoomState();
  });

  socket.on("room:code-expired", () => {
    // B2 spec: countdown reaching 0 auto-triggers a fresh host:create-room
    // call and updates the display without any user action.
    currentRoom = null;
    broadcastRoomState();
    createRoom();
  });

  // B3: an incoming pairing request. The socket lives here in main, but
  // the Accept/Decline decision and everything after it (capture, WebRTC)
  // has to happen in the renderer — RTCPeerConnection/getDisplayMedia only
  // exist in a browser/renderer context, not in Node's main process. Main
  // process's job past this point is just relaying between the socket and
  // whichever renderer IPC channel corresponds to it.
  socket.on("viewer:request-join", (payload) => {
    log("[host] viewer:request-join", payload);
    createMainWindow(); // ensure B3 is visible even if the window was closed
    sendToRenderer("viewer-request-join", payload);
  });

  socket.on("host:accept-ack", (payload) => {
    log("[host] host:accept-ack");
    sendToRenderer("host-accept-ack", payload);
  });

  socket.on("signal:answer", (payload) => {
    sendToRenderer("signal-answer", payload);
  });

  socket.on("signal:ice-candidate", (payload) => {
    sendToRenderer("signal-ice-candidate", payload);
  });

  socket.on("session:end", (payload) => {
    log("[host] session:end", payload);
    sendToRenderer("session-end", payload);
    endActiveSession();
  });

  socket.on("error", (payload) => {
    log("[host] socket error event:", payload);
    sendToRenderer("socket-error", payload);
  });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    title: "Host session",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(RENDERER_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => broadcastRoomState());

  mainWindow.on("close", (event) => {
    // While a session is active, the RTCPeerConnection/MediaStream live in
    // this window's JS context — destroying the window would silently kill
    // the session. Hide instead, matching B1's "tray is the persistent
    // state" philosophy, so "End Session" from the tray still has a
    // renderer to relay to even if the user closed the visible window.
    if (sessionActive) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../../assets/tray-icon.png");
  log("Loading tray icon from:", iconPath);
  log("Icon file exists:", fs.existsSync(iconPath));

  const icon = nativeImage.createFromPath(iconPath);
  log("Icon isEmpty:", icon.isEmpty(), "size:", icon.getSize());

  if (icon.isEmpty()) {
    log("ERROR: tray icon failed to load — Tray would be invisible. Check the path above.");
  }

  try {
    tray = new Tray(icon);
    log("Tray created successfully");
  } catch (err) {
    log("ERROR creating Tray:", err.message, err.stack);
    throw err;
  }

  tray.setToolTip("Remote Access Host");
  rebuildTrayMenu();

  // B1 spec: left-click or double-click opens B2.
  tray.on("click", () => createMainWindow());
  tray.on("double-click", () => createMainWindow());
}

/** Rebuilds the tray's icon + context menu to reflect current session
 * state. B4 spec: the tray icon changes to an "active" variant during a
 * session, and "End Session" appears in the tray menu (duplicating the
 * in-window button) in place of "Generate New Code". */
function rebuildTrayMenu() {
  if (!tray) return;

  const iconName = sessionActive ? "tray-icon-active.png" : "tray-icon.png";
  tray.setImage(path.join(__dirname, "../../assets", iconName));

  const middleItem = sessionActive
    ? {
        label: "End Session",
        click: () => {
          log("[host] End Session clicked from tray");
          sendToRenderer("end-session-requested");
        },
      }
    : { label: "Generate New Code", click: () => createRoom() };

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show", click: () => createMainWindow() },
    middleItem,
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        // App Flow B1: if a session is active, confirm before quitting.
        if (sessionActive) {
          const choice = dialog.showMessageBoxSync({
            type: "warning",
            buttons: ["Quit anyway", "Cancel"],
            defaultId: 1,
            cancelId: 1,
            message: "A session is in progress — quit anyway?",
          });
          if (choice !== 0) return;
          socket.emit("session:end", { reason: "host_ended" });
        }
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function setSessionActive(active) {
  sessionActive = active;
  rebuildTrayMenu();
}

ipcMain.handle("request-new-code", () => {
  createRoom();
});

ipcMain.handle("get-room-state", () => currentRoom);

ipcMain.handle("accept-request", (_event, { viewerSocketId }) => {
  log("[host] renderer accepted", viewerSocketId);
  socket.emit("host:accept", { viewerSocketId });
});

ipcMain.handle("reject-request", (_event, { viewerSocketId }) => {
  log("[host] renderer declined", viewerSocketId);
  socket.emit("host:reject", { viewerSocketId });
});

ipcMain.handle("signal-offer", (_event, payload) => {
  socket.emit("signal:offer", payload);
});

ipcMain.handle("signal-ice-candidate", (_event, payload) => {
  socket.emit("signal:ice-candidate", payload);
});

ipcMain.handle("session-end", (_event, payload) => {
  socket.emit("session:end", payload);
  endActiveSession();
});

ipcMain.handle("notify-session-started", () => {
  setSessionActive(true);
});

ipcMain.handle("notify-session-ended", () => {
  setSessionActive(false);
});

function buttonFromName(name) {
  if (name === "middle") return Button.MIDDLE;
  if (name === "right") return Button.RIGHT;
  return Button.LEFT;
}

// Step 3.10: incoming input from the viewer, relayed here by the renderer
// (which owns the RTCDataChannel — main process has no WebRTC access of
// its own). Uses ipcMain.on/ipcRenderer.send (fire-and-forget) rather than
// handle/invoke, since these fire at high frequency (mousemove) and don't
// need a response — awaiting a round-trip per pointer update would add
// latency for no benefit.
ipcMain.on("input-pointer-message", (_event, msg) => {
  const { width, height } = electronScreen.getPrimaryDisplay().size;
  switch (msg.type) {
    case "mousemove":
      mouse
        .setPosition(new Point(Math.round(msg.x * width), Math.round(msg.y * height)))
        .catch((err) => log("mouse move error:", err.message));
      break;
    case "mousedown":
      mouse
        .setPosition(new Point(Math.round(msg.x * width), Math.round(msg.y * height)))
        .then(() => mouse.pressButton(buttonFromName(msg.button)))
        .catch((err) => log("mouse down error:", err.message));
      break;
    case "mouseup":
      mouse.releaseButton(buttonFromName(msg.button)).catch((err) => log("mouse up error:", err.message));
      break;
    case "scroll": {
      // TRD §3.3: pixel-precise scroll isn't available — nut.js only
      // offers "steps", with the actual distance per step being OS
      // dependent. This is a reasonable approximation, not exact fidelity.
      const steps = Math.max(1, Math.round(Math.abs(msg.deltaY) / 100));
      const scrollPromise = msg.deltaY > 0 ? mouse.scrollDown(steps) : mouse.scrollUp(steps);
      scrollPromise.catch((err) => log("scroll error:", err.message));
      break;
    }
    default:
      log("unknown input-pointer message type:", msg.type);
  }
});

ipcMain.on("input-reliable-message", (_event, msg) => {
  const key = codeToKey(msg.code);
  if (key === undefined) {
    log("unmapped key code (no nut.js Key for this):", msg.code);
    return;
  }
  if (msg.type === "keydown") {
    keyboard.pressKey(key).catch((err) => log("keydown error:", err.message));
  } else if (msg.type === "keyup") {
    keyboard.releaseKey(key).catch((err) => log("keyup error:", err.message));
  }
});

app.whenReady().then(() => {
  log("app.whenReady fired");
  try {
    connectSocket();
    createTray();

    // Step 3.2: lets the renderer keep using the standard, browser-style
    // navigator.mediaDevices.getDisplayMedia() call — same code as the
    // Phase 2 throwaway sender — instead of a manual desktopCapturer
    // source-picker IPC round-trip. Electron intercepts the request here
    // and answers it with a real screen source directly. (TRD §3.2 flags
    // this API as having shifted across Electron versions — this is the
    // current approach for the Electron 31 pinned in package.json.)
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ["screen"] })
          .then((sources) => {
            // MVP: primary monitor only (TRD §3.3/§8) — just the first source.
            callback({ video: sources[0] });
          })
          .catch((err) => {
            log("ERROR getting desktop sources:", err.message);
            callback({});
          });
      },
      { useSystemPicker: false }
    );

    log("=== startup complete ===");
  } catch (err) {
    log("FATAL error during startup:", err.message, err.stack);
  }
  // Deliberately not auto-opening the window on launch — B1's spec is that
  // the app's resting state is the tray, with the window opened on demand.
});

// B1: the tray is the app's persistent idle state, not a window — closing
// the B2 window should not quit the app, only "Quit" from the tray menu does.
app.on("window-all-closed", (event) => {
  event.preventDefault();
});
