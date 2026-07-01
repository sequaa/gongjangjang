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
import { useState, type ReactNode } from "react";
import { useSensorSocket } from "./hooks/useSensorSocket";
import { useReplaySocket } from "./hooks/useReplaySocket";
import type { DemoSnapshot } from "./types";
import snapshot from "./demo/snapshot.json";
import { StatusGrid } from "./components/StatusGrid";
import { ValueTiles } from "./components/ValueTiles";
import { AlarmPanel } from "./components/AlarmPanel";
import { LeadtimeTable } from "./components/LeadtimeTable";
import { mergeSpcChartData, windowMarkers } from "./components/SignalOverlay";
import { LoginPage } from "./components/LoginPage";
import { getToken, clearToken } from "./auth";

// VITE_DEMO_MODE is a build-time constant: Vite statically replaces it and
// dead-code-eliminates the unused branch, so exactly one hook is compiled into
// each bundle. The condition is therefore identical across every render, which
// preserves the rules-of-hooks invariant (same hook call order every render).
const DEMO = import.meta.env.VITE_DEMO_MODE === "true";

// Frozen ML anomaly threshold (healthy_p99) from ml/eval/results/ml_threshold.frozen.json
const ML_ANOMALY_THRESHOLD = 0.07723;

export default function App() {
  // Auth gate: persists across refresh via localStorage. Demo mode bypasses gate (D-09).
  const [loggedIn, setLoggedIn] = useState(DEMO || getToken() !== null);

  const { readings, devices, alarms, spcCpk, mlScore, baseline, connected, ackResolve } =
    // eslint-disable-next-line react-hooks/rules-of-hooks
    DEMO ? useReplaySocket(snapshot as unknown as DemoSnapshot) : useSensorSocket();

  // Chart a single device's series so the line stays coherent across N devices.
  const focusId = devices[0]?.deviceId;
  // ONE shared time axis (D-11①): readings + Cpk + ML score merged on time, so
  // all three detectors are directly comparable on a single XAxis.
  const data = mergeSpcChartData(readings, spcCpk, focusId, mlScore);

  // Chart window bounds (epoch ms) — used to clip alarm/WE/ML markers so
  // out-of-window markers cannot push the numeric XAxis domain to -1e17 (D-06).
  const windowStart = data.length > 0 ? data[0].ts : -Infinity;
  const windowEnd = data.length > 0 ? data[data.length - 1].ts : Infinity;

  // Each panel owns its detector's fire markers so the three verticals stay
  // visually separable (D-11①: compare "who fires first" by x position).
  // Epoch-ms numbers clipped to the data window (D-06).
  const thresholdMarkers = windowMarkers(
    alarms,
    focusId,
    (a) => a.detector !== "spc" && a.detector !== "ml",
    windowStart,
    windowEnd,
  );
  const spcMarkers = windowMarkers(alarms, focusId, (a) => a.detector === "spc", windowStart, windowEnd);
  const mlMarkers = windowMarkers(alarms, focusId, (a) => a.detector === "ml", windowStart, windowEnd);

  // Shared numeric time domain + identical plot geometry across all three panels
  // so their plot rectangles line up vertically (small multiples). Falls back to
  // data-driven bounds when empty to avoid an ±Infinity XAxis domain.
  const xDomain: [number | string, number | string] =
    data.length > 0 ? [windowStart, windowEnd] : ["dataMin", "dataMax"];
  const CHART_MARGIN = { top: 8, right: 24, bottom: 0, left: 0 };
  const Y_WIDTH = 52;
  const PANEL_H = 140;
  const captionStyle = { fontSize: 11, color: "#777", margin: "2px 0 0" } as const;

  // Auth gate (live mode only). All hooks are called above unconditionally;
  // this early return is safe and does not violate rules-of-hooks.
  if (!DEMO && !loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>설비 센서 실시간 모니터링</h1>
        {!DEMO && (
          <button
            onClick={() => { clearToken(); setLoggedIn(false); }}
            style={{ fontSize: 13, padding: "4px 10px" }}
          >
            로그아웃
          </button>
        )}
      </div>
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
        <p style={{ fontSize: 12, color: "#444", margin: "0 0 8px" }}>
          세 패널 같은 시간축 — 세로 발화선 x위치로 &apos;누가 먼저 잡나&apos; 비교, 정량 리드타임은 아래 표.
        </p>

        {/* ① RMS 원값 — frozen threshold band; healthy = inside band (low). */}
        <div style={{ width: "100%", height: PANEL_H }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="ts" domain={xDomain} tick={false} height={22} />
              <YAxis width={Y_WIDTH} domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(v) => Number(v).toFixed(3)} />
              <Tooltip labelFormatter={(v) => new Date(v as number).toLocaleTimeString()} />
              {baseline && (
                <ReferenceLine
                  y={baseline.thresholdMax}
                  stroke="#a00"
                  strokeDasharray="4 4"
                  label={{ value: "max", position: "insideTopLeft", fontSize: 11, fill: "#a00" }}
                  ifOverflow="extendDomain"
                />
              )}
              {baseline && (
                <ReferenceLine
                  y={baseline.thresholdMin}
                  stroke="#a00"
                  strokeDasharray="4 4"
                  label={{ value: "min", position: "insideBottomLeft", fontSize: 11, fill: "#a00" }}
                  ifOverflow="extendDomain"
                />
              )}
              {thresholdMarkers.map((m) => (
                <ReferenceLine key={`thr-${m.key}`} x={m.x} stroke="#a00" strokeWidth={1.5} ifOverflow="hidden" />
              ))}
              <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p style={captionStyle}>
          ① RMS 원값 · 정상: 임계 밴드 안(낮음) · 이상: 상한 돌파 — 동결 RMS 임계(가장 방어가능)
        </p>

        {/* ② SPC Cpk — process capability; healthy = high & flat (≥1.33). */}
        <div style={{ width: "100%", height: PANEL_H }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="ts" domain={xDomain} tick={false} height={22} />
              <YAxis
                width={Y_WIDTH}
                domain={[-2, 3]}
                allowDataOverflow={true}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toFixed(1)}
              />
              <Tooltip labelFormatter={(v) => new Date(v as number).toLocaleTimeString()} />
              {/* Universal Cpk capability conventions (labeled constants). */}
              <ReferenceLine
                y={1.33}
                stroke="#7c3aed"
                strokeDasharray="6 3"
                label={{ value: "capable 1.33", position: "insideTopLeft", fontSize: 11, fill: "#7c3aed" }}
              />
              <ReferenceLine
                y={1.0}
                stroke="#7c3aed"
                strokeDasharray="6 3"
                label={{ value: "marginal 1.0", position: "insideBottomLeft", fontSize: 11, fill: "#7c3aed" }}
              />
              {spcMarkers.map((m) => (
                <ReferenceLine key={`spc-${m.key}`} x={m.x} stroke="#7c3aed" strokeWidth={1.5} ifOverflow="hidden" />
              ))}
              <Line type="monotone" dataKey="cpk" stroke="#7c3aed" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p style={captionStyle}>
          ② SPC Cpk · 정상: 높고 평평(≥1.33) · 이상: 하락 — 규격 대비 공정능력 저하
        </p>

        {/* ③ ML 이상점수 — bottom panel carries the shared time labels. */}
        <div style={{ width: "100%", height: PANEL_H }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="ts"
                domain={xDomain}
                height={22}
                minTickGap={40}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => new Date(v as number).toLocaleTimeString()}
              />
              <YAxis
                width={Y_WIDTH}
                domain={[-0.2, 0.3]}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toFixed(2)}
              />
              <Tooltip labelFormatter={(v) => new Date(v as number).toLocaleTimeString()} />
              {/* Frozen ML anomaly threshold (healthy_p99) — provenance in the
                  ML_ANOMALY_THRESHOLD constant. Crossing it = if_anomaly fires. */}
              <ReferenceLine
                y={ML_ANOMALY_THRESHOLD}
                stroke="#ea580c"
                strokeDasharray="4 4"
                label={{ value: "임계 0.077", position: "insideTopLeft", fontSize: 11, fill: "#ea580c" }}
              />
              {mlMarkers.map((m) => (
                <ReferenceLine
                  key={`ml-${m.key}`}
                  x={m.x}
                  stroke="#ea580c"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  ifOverflow="hidden"
                />
              ))}
              <Line type="monotone" dataKey="ml" stroke="#ea580c" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p style={captionStyle}>
          ③ ML 이상점수 · 정상: 낮게 깔림 · 이상: 급등해 임계 돌파(주황 세로선=if_anomaly 발화). ※ 이
          신호선 healthy/열화 분포가 겹쳐 K≥3에선 약함(정직 보고)
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "#555", marginTop: 8 }}>
          <span style={{ color: "#2563eb" }}>━ RMS value · <span style={{ color: "#a00" }}>┅ threshold min/max · │ fire</span></span>
          <span style={{ color: "#7c3aed" }}>━ Cpk · ┅ capable/marginal · │ WE fire</span>
          <span style={{ color: "#ea580c" }}>━ ML score · ┊ if_anomaly fire</span>
        </div>
      </Section>

      <Section title="탐지기별 리드타임 (고장 전 — DB 쿼리, D-04)">
        <LeadtimeTable />
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
