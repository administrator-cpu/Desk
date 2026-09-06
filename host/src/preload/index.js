const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electronAPI", {
  // B2 — code display
  onRoomState(callback) {
    return subscribe("room-state", callback);
  },
  getRoomState() {
    return ipcRenderer.invoke("get-room-state");
  },
  requestNewCode() {
    return ipcRenderer.invoke("request-new-code");
  },

  // B3 — incoming pairing request
  onViewerRequestJoin(callback) {
    return subscribe("viewer-request-join", callback);
  },
  acceptRequest(viewerSocketId) {
    return ipcRenderer.invoke("accept-request", { viewerSocketId });
  },
  rejectRequest(viewerSocketId) {
    return ipcRenderer.invoke("reject-request", { viewerSocketId });
  },

  // WebRTC signaling relay — the socket lives in main, but
  // RTCPeerConnection only exists in this renderer, so every signaling
  // message crosses the IPC boundary in one direction or the other.
  onHostAcceptAck(callback) {
    return subscribe("host-accept-ack", callback);
  },
  onSignalAnswer(callback) {
    return subscribe("signal-answer", callback);
  },
  onSignalIceCandidate(callback) {
    return subscribe("signal-ice-candidate", callback);
  },
  onSessionEnd(callback) {
    return subscribe("session-end", callback);
  },
  onSocketError(callback) {
    return subscribe("socket-error", callback);
  },
  onEndSessionRequested(callback) {
    return subscribe("end-session-requested", callback);
  },
  sendSignalOffer(payload) {
    return ipcRenderer.invoke("signal-offer", payload);
  },
  sendSignalIceCandidate(payload) {
    return ipcRenderer.invoke("signal-ice-candidate", payload);
  },
  sendSessionEnd(payload) {
    return ipcRenderer.invoke("session-end", payload);
  },
  notifySessionStarted() {
    return ipcRenderer.invoke("notify-session-started");
  },
  notifySessionEnded() {
    return ipcRenderer.invoke("notify-session-ended");
  },

  // Step 3.10: fire-and-forget relay of incoming data-channel messages to
  // main, where nut.js actually executes them. `send` (not `invoke`) since
  // these fire at high frequency and don't need a response.
  forwardPointerInput(msg) {
    ipcRenderer.send("input-pointer-message", msg);
  },
  forwardReliableInput(msg) {
    ipcRenderer.send("input-reliable-message", msg);
  },
});
