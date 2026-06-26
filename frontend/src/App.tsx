import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { useSensorSocket } from "./hooks/useSensorSocket";
import { StatusGrid } from "./components/StatusGrid";
import { ValueTiles } from "./components/ValueTiles";

export default function App() {
  const { readings, devices, connected } = useSensorSocket();

  // Chart a single device's series so the line stays coherent across N devices.
  const focusId = devices[0]?.deviceId;
  const data = readings
    .filter((r) => r.deviceId === focusId)
    .map((r) => ({ t: new Date(r.recordedAt).toLocaleTimeString(), value: r.value }));

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>설비 센서 실시간 모니터링</h1>
      <p style={{ color: connected ? "#0a0" : "#a00", margin: "4px 0 20px" }}>
        ● WebSocket {connected ? "connected" : "disconnected"} · {devices.length} device(s)
      </p>

      <Section title="현재값 타일">
        <ValueTiles devices={devices} />
      </Section>

      <Section title="설비 상태 그리드">
        <StatusGrid devices={devices} />
      </Section>

      <Section title={`실시간 차트${focusId ? ` — ${focusId}` : ""}`}>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" minTickGap={40} />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, color: "#444", margin: "0 0 8px" }}>{title}</h2>
      {children}
    </section>
  );
}
