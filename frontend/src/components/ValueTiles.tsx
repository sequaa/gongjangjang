import type { DeviceSnapshot } from "../deviceState";

/** Current-value tiles (RT-02): compact live value readout per device. */
export function ValueTiles({ devices }: { devices: DeviceSnapshot[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {devices.map((d) => (
        <div
          key={d.deviceId}
          style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>{d.deviceId}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{d.value.toFixed(2)}</div>
        </div>
      ))}
    </div>
  );
}
