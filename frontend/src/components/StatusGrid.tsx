import type { DeviceSnapshot } from "../deviceState";

const STALE_MS = 5000;

/** Per-device status grid (RT-02): one card per device, live value + freshness. */
export function StatusGrid({ devices }: { devices: DeviceSnapshot[] }) {
  const now = Date.now();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 12,
      }}
    >
      {devices.map((d) => {
        const stale = now - d.lastUpdateMs > STALE_MS;
        return (
          <div
            key={d.deviceId}
            style={{
              border: "1px solid #eee",
              borderLeft: `4px solid ${stale ? "#a00" : "#0a0"}`,
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>{d.deviceId}</div>
            <div style={{ fontSize: 12, color: "#666" }}>{d.metric}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{d.value.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: stale ? "#a00" : "#0a0" }}>
              {stale ? "stale" : "online"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
