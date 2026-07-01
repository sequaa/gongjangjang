import { Line, ReferenceLine, YAxis } from "recharts";
import type { ReactElement } from "react";
import type { Alarm, Baseline, MlSignal, SensorReading, SpcSignal } from "../types";

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
/** Distinct from threshold-red and SPC-purple — ML score/markers are orange. */
const ML_COLOR = "#ea580c";

export interface SpcChartRow {
  t: string;
  /** ms epoch — sort key only, not plotted. */
  ts: number;
  value?: number;
  cpk?: number;
  ml?: number;
}

/**
 * Merge the focused device's readings and the Cpk trajectory onto ONE shared
 * time axis (D-11①). Both timelines are keyed by epoch-ms so a reading and a
 * Cpk point at the same instant collapse into a single row; the categorical
 * label {@code t} matches App's existing {@code toLocaleTimeString()} format so
 * threshold lines, WE markers, the Cpk line and the ML score line all align on
 * the same XAxis (D-11① — every detector comparable on ONE time axis).
 */
export function mergeSpcChartData(
  readings: SensorReading[],
  cpkSeries: SpcSignal[],
  focusId: string | undefined,
  mlSeries: MlSignal[] = [],
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
  mlSeries
    .filter((s) => s.deviceId === focusId)
    .forEach((s) => put(s.occurredAt, { ml: s.value }));
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
 * Pure helper — filter alarms by focusId + detector predicate, keep only those
 * whose firstOccurredAt falls within [windowStart, windowEnd] (epoch ms), and
 * return each as { x: epochMs, key } so callers can build ReferenceLine elements
 * with a numeric x coordinate (D-06: avoids -1e17 breakage from string mismatches).
 */
export function windowMarkers(
  alarms: Alarm[],
  focusId: string | undefined,
  detectorPredicate: (a: Alarm) => boolean,
  windowStart: number,
  windowEnd: number,
): { x: number; key: string }[] {
  return alarms
    .filter((a) => a.deviceId === focusId && detectorPredicate(a))
    .flatMap((a) => {
      const ts = new Date(a.firstOccurredAt).getTime();
      if (ts >= windowStart && ts <= windowEnd) {
        return [{ x: ts, key: `${a.id ?? a.firstOccurredAt}` }];
      }
      return [];
    });
}

/**
 * Western-Electric fire markers — the SPC alarms already in {@code alarms[]}
 * (detector === "spc"), drawn as solid purple verticals so they read distinctly
 * from the dashed amber generic alarm ticks. The "SPC fires earlier/richer than
 * threshold" narrative (D-11①) is exactly this visual separation.
 *
 * windowStart/windowEnd clip to the chart's visible ts range (D-06).
 */
export function spcWeMarkers(
  alarms: Alarm[],
  focusId: string | undefined,
  windowStart: number = -Infinity,
  windowEnd: number = Infinity,
): ReactElement[] {
  return windowMarkers(alarms, focusId, (a) => a.detector === "spc", windowStart, windowEnd)
    .map((m) => (
      <ReferenceLine
        key={`spc-we-${m.key}`}
        x={m.x}
        stroke={SPC_COLOR}
        strokeWidth={1.5}
        ifOverflow="hidden"
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

/**
 * ML if_anomaly fire markers — the ML alarms already in {@code alarms[]}
 * (detector === "ml"), drawn as solid orange verticals so they read distinctly
 * from the purple SPC WE markers and the dashed amber generic ticks. Placing all
 * three detectors' verticals on the SAME XAxis is what makes "which detector
 * fires first" visually readable (D-11①).
 *
 * windowStart/windowEnd clip to the chart's visible ts range (D-06).
 */
export function mlAnomalyMarkers(
  alarms: Alarm[],
  focusId: string | undefined,
  windowStart: number = -Infinity,
  windowEnd: number = Infinity,
): ReactElement[] {
  return windowMarkers(alarms, focusId, (a) => a.detector === "ml", windowStart, windowEnd)
    .map((m) => (
      <ReferenceLine
        key={`ml-fire-${m.key}`}
        x={m.x}
        stroke={ML_COLOR}
        strokeWidth={1.5}
        strokeDasharray="1 2"
        ifOverflow="hidden"
      />
    ));
}

/**
 * A third Y-axis + ML anomaly_score line on the SAME chart/time axis. Score and
 * Cpk live on different scales, so the ML score gets its own right axis (orange)
 * pinned to [0, 1] — higher = more anomalous, the inverse of the descending Cpk.
 * Keeping it on the shared XAxis lets the three detectors be compared directly.
 * {@code connectNulls} bridges the rows that carry only readings/cpk.
 */
export function mlScoreAxisAndLine(): ReactElement[] {
  return [
    <YAxis
      key="ml-axis"
      yAxisId="ml"
      orientation="right"
      domain={[0, 1]}
      width={36}
      tick={{ fontSize: 11, fill: ML_COLOR }}
      label={{ value: "ML score", angle: -90, position: "insideRight", fontSize: 11, fill: ML_COLOR }}
    />,
    <Line
      key="ml-line"
      yAxisId="ml"
      type="monotone"
      dataKey="ml"
      stroke={ML_COLOR}
      strokeWidth={2}
      dot={false}
      connectNulls
      isAnimationActive={false}
    />,
  ];
}
