import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { useSensorSocket } from "./hooks/useSensorSocket";
import { StatusGrid } from "./components/StatusGrid";
import { ValueTiles } from "./components/ValueTiles";
import { AlarmPanel } from "./components/AlarmPanel";
import {
  mergeSpcChartData,
  mlAnomalyMarkers,
  mlScoreAxisAndLine,
  spcCpkAxisAndLine,
  spcReferenceLines,
  spcWeMarkers,
} from "./components/SignalOverlay";

export default function App() {
  const { readings, devices, alarms, spcCpk, mlScore, baseline, connected, ackResolve } =
    useSensorSocket();

  // Chart a single device's series so the line stays coherent across N devices.
  const focusId = devices[0]?.deviceId;
  // ONE shared time axis (D-11①): readings + Cpk + ML score merged on time, so
  // all three detectors are directly comparable on a single XAxis.
  const data = mergeSpcChartData(readings, spcCpk, focusId, mlScore);

  // Generic (non-SPC, non-ML) alarm ticks only — SPC WE and ML if_anomaly alarms
  // get distinct markers (spcWeMarkers / mlAnomalyMarkers) so each detector stays
  // visually separable. Categorical x-axis: a non-matching time won't render.
  const alarmTicks = alarms
    .filter((a) => a.deviceId === focusId && a.detector !== "spc" && a.detector !== "ml")
    .map((a) => new Date(a.firstOccurredAt).toLocaleTimeString());

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
              {/* Frozen threshold limits (D-11①) — single source of truth from
                  GET /api/baseline; rendered only when the baseline loaded.
                  03-02 (ucl/lcl) and 03-03 add more ReferenceLines/series here. */}
              {baseline && (
                <ReferenceLine
                  y={baseline.thresholdMax}
                  stroke="#a00"
                  strokeDasharray="4 4"
                  label={{ value: "max", position: "right", fontSize: 11, fill: "#a00" }}
                  ifOverflow="extendDomain"
                />
              )}
              {baseline && (
                <ReferenceLine
                  y={baseline.thresholdMin}
                  stroke="#a00"
                  strokeDasharray="4 4"
                  label={{ value: "min", position: "right", fontSize: 11, fill: "#a00" }}
                  ifOverflow="extendDomain"
                />
              )}
              {alarmTicks.map((x, i) => (
                <ReferenceLine key={`alarm-${i}`} x={x} stroke="#c80" strokeDasharray="2 2" />
              ))}
              {/* 03-02 SPC overlay — frozen UCL/LCL (baseline), WE-rule fire
                  markers (spc alarms), and the descending Cpk curve on a shared
                  time axis. 03-03 adds the ML score series the same way. */}
              {spcReferenceLines(baseline)}
              {spcWeMarkers(alarms, focusId)}
              {spcCpkAxisAndLine()}
              {/* 03-03 ML overlay — anomaly_score line on its own right axis plus
                  if_anomaly fire markers, on the SAME time axis so threshold/SPC/
                  ML are directly comparable (which detector fires first). */}
              {mlScoreAxisAndLine()}
              {mlAnomalyMarkers(alarms, focusId)}
              {/* connectNulls: the merged axis injects cpk-only rows (value
                  undefined) between readings — bridge them so the sensor line
                  stays continuous. */}
              <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "#555", marginTop: 6 }}>
          <span style={{ color: "#a00" }}>━ threshold min/max</span>
          <span style={{ color: "#7c3aed" }}>┅ UCL/LCL ±3σ · │ WE-rule fire · Cpk (right axis)</span>
          <span style={{ color: "#ea580c" }}>━ ML anomaly score (right axis) · ┊ if_anomaly fire</span>
        </div>
      </Section>

      <Section title="알람">
        <AlarmPanel alarms={alarms} onAction={ackResolve} />
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
