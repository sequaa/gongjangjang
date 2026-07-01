import type { Alarm, MlSignal, SensorReading, SpcSignal } from "../types";

/**
 * Pure data helpers for the real-time chart. The dashboard renders three
 * vertically-stacked small-multiple panels (RMS 원값 / SPC Cpk / ML 이상점수)
 * that share ONE numeric time axis (D-11①), so a first-time viewer can read
 * "what signal + which direction is healthy" per panel and compare "누가 먼저
 * 잡나" by the vertical fire-marker x positions. Reference lines and fire
 * markers are built inline per panel in App.tsx; this module keeps only the two
 * pure, unit-tested helpers those panels depend on.
 */

export interface SpcChartRow {
  t: string;
  /** ms epoch — the shared numeric XAxis dataKey across all three panels. */
  ts: number;
  value?: number;
  cpk?: number;
  ml?: number;
}

/**
 * Merge the focused device's readings, Cpk trajectory and ML anomaly scores onto
 * ONE shared time axis (D-11①). All three timelines are keyed by epoch-ms so a
 * reading, a Cpk point and an ML point at the same instant collapse into a single
 * row; every panel then plots its own dataKey against the same {@code ts} XAxis
 * domain, keeping the three small multiples time-aligned.
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
 * Pure helper — filter alarms by focusId + detector predicate, keep only those
 * whose firstOccurredAt falls within [windowStart, windowEnd] (epoch ms), and
 * return each as { x: epochMs, key } so callers can build ReferenceLine elements
 * with a numeric x coordinate (D-06: avoids -1e17 breakage from string mismatches).
 * Each panel calls this with its own detector predicate to draw its fire markers.
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
