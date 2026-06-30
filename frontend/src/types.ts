// Shared payload contract (D-04), mirrored from the backend SensorReading.
export interface SensorReading {
  deviceId: string;
  metric: string;
  value: number;
  recordedAt: string;
  publishedAtMs: number;
}

// Alarm lifecycle state, normalized to lowercase tokens in the hook (D-10).
// REST `Alarm` serializes the enum NAME (uppercase); the WS `AlarmFrame` uses
// the lowercase token — the hook lowercases both to this union.
export type AlarmState = "created" | "acknowledged" | "resolved";

// Tolerant of both alarm shapes: the WS AlarmFrame (no timestamps beyond
// firstOccurredAt) and the richer REST `Alarm` record. Keyed on `id`.
export interface Alarm {
  id: number;
  deviceId: string;
  metric: string;
  detector: string;
  rule: string;
  severity: string;
  value: number;
  state: AlarmState;
  firstOccurredAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
}

// Frozen baseline limits from GET /api/baseline (single source of truth, D-11).
export interface Baseline {
  thresholdMin: number;
  thresholdMax: number;
  ucl: number;
  lcl: number;
  usl: number;
  lsl: number;
  mu: number;
  sigma: number;
}
