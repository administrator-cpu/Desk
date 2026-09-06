type ViewerMeta = { ip?: string; userAgent?: string };

export default function B3AcceptModal({
  viewerMeta,
  onAccept,
  onDecline,
}: {
  viewerMeta?: ViewerMeta;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#161c22",
          border: "1px solid #2a333b",
          padding: 24,
          maxWidth: 340,
          width: "90%",
        }}
      >
        <p style={{ margin: "0 0 6px", fontSize: 15 }}>A device wants to connect.</p>
        <p style={{ margin: "0 0 20px", color: "#8b95a1", fontSize: 13 }}>
          {viewerMeta?.ip ?? "unknown IP"} · {viewerMeta?.userAgent ?? "unknown browser"}
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onAccept}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid #4fd8c4",
              color: "#4fd8c4",
              padding: "10px 0",
              fontSize: 14,
            }}
          >
            Accept
          </button>
          <button
            onClick={onDecline}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid #8b95a1",
              color: "#8b95a1",
              padding: "10px 0",
              fontSize: 14,
            }}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
