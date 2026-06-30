import { Line, ReferenceLine, YAxis } from "recharts";
import type { ReactElement } from "react";
import type { Alarm, Baseline, SensorReading, SpcSignal } from "../types";

/**
 * SPC overlay (03-02 Task 3) for the main reading chart — shares ONE time axis
 * with the 03-01 threshold overlay (D-11①) and is fed live by WS push, never
 * polling (D-11②). Every limit value is supplied by props (the hook's baseline
 * + SPC state); nothing here is computed or hardcoded in the frontend.
 *
 * <p>Recharts only honours chart elements that are *direct* children of the
 * chart, so these are exported as helpers returning {@code ReferenceLine}/
 * {@code Line}/{@code YAxis} elements (mirroring App's existing inline
 * {@code alarmTicks.map(...)}) rather than a wrapper component, which the chart
 * would render to nothing.
 */

/** Distinct from the 03-01 threshold red — SPC limits/markers are purple. */
const SPC_COLOR = "#7c3aed";

export interface SpcChartRow {
  t: string;
  /** ms epoch — sort key only, not plotted. */
  ts: number;
  value?: number;
  cpk?: number;
}

/**
 * Merge the focused device's readings and the Cpk trajectory onto ONE shared
 * time axis (D-11①). Both timelines are keyed by epoch-ms so a reading and a
 * Cpk point at the same instant collapse into a single row; the categorical
 * label {@code t} matches App's existing {@code toLocaleTimeString()} format so
 * threshold lines, WE markers and the Cpk line all align on the same XAxis.
 */
export function mergeSpcChartData(
  readings: SensorReading[],
  cpkSeries: SpcSignal[],
  focusId: string | undefined,
): SpcChartRow[] {
  const rows = new Map<number, SpcChartRow>();
  const put = (iso: string, patch: Partial<SpcChartRow>) => {
    const ts = new Date(iso).getTime();
    const row = rows.get(ts) ?? { ts, t: new Date(iso).toLocaleTimeString() };
    rows.set(ts, { ...row, ...patch });
  };
  readings
    .filter((r) => r.deviceId === focusId)
    .forEach((r) => put(r.recordedAt, { value: r.value }));
  cpkSeries
    .filter((s) => s.deviceId === focusId)
    .forEach((s) => put(s.occurredAt, { cpk: s.value }));
  return [...rows.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Frozen UCL/LCL (±3σ) as ReferenceLines on the main Y-axis — styled distinctly
 * from the 03-01 threshold lines (purple, longer dash) with their own labels.
 * Values come straight from GET /api/baseline; rendered only once it loaded.
 */
export function spcReferenceLines(baseline: Baseline | null): ReactElement[] {
  if (!baseline) return [];
  return [
    <ReferenceLine
      key="spc-ucl"
      y={baseline.ucl}
      stroke={SPC_COLOR}
      strokeDasharray="8 3"
      label={{ value: "UCL +3σ", position: "left", fontSize: 11, fill: SPC_COLOR }}
      ifOverflow="extendDomain"
    />,
    <ReferenceLine
      key="spc-lcl"
      y={baseline.lcl}
      stroke={SPC_COLOR}
      strokeDasharray="8 3"
      label={{ value: "LCL −3σ", position: "left", fontSize: 11, fill: SPC_COLOR }}
      ifOverflow="extendDomain"
    />,
  ];
}

/**
 * Western-Electric fire markers — the SPC alarms already in {@code alarms[]}
 * (detector === "spc"), drawn as solid purple verticals so they read distinctly
 * from the dashed amber generic alarm ticks. The "SPC fires earlier/richer than
 * threshold" narrative (D-11①) is exactly this visual separation.
 */
export function spcWeMarkers(
  alarms: Alarm[],
  focusId: string | undefined,
): ReactElement[] {
  return alarms
    .filter((a) => a.detector === "spc" && a.deviceId === focusId)
    .map((a, i) => (
      <ReferenceLine
        key={`spc-we-${a.id ?? i}`}
        x={new Date(a.firstOccurredAt).toLocaleTimeString()}
        stroke={SPC_COLOR}
        strokeWidth={1.5}
        ifOverflow="extendDomain"
      />
    ));
}

/**
 * Secondary Y-axis + Cpk line on the SAME chart/time axis. The descent toward 0
 * (degradation) is the headline, so the axis is pinned to [0, 2] — a Cpk of 1.33
 * is the usual capable threshold, and the line sliding down through it is the
 * story. {@code connectNulls} bridges the sparse per-subgroup Cpk points.
 */
export function spcCpkAxisAndLine(): ReactElement[] {
  return [
    <YAxis
      key="cpk-axis"
      yAxisId="cpk"
      orientation="right"
      domain={[0, 2]}
      width={36}
      tick={{ fontSize: 11, fill: SPC_COLOR }}
      label={{ value: "Cpk", angle: -90, position: "insideRight", fontSize: 11, fill: SPC_COLOR }}
    />,
    <Line
      key="cpk-line"
      yAxisId="cpk"
      type="monotone"
      dataKey="cpk"
      stroke={SPC_COLOR}
      strokeWidth={2}
      dot={false}
      connectNulls
      isAnimationActive={false}
    />,
  ];
}
