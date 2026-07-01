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

// One persisted SPC trajectory point (03-02). Shared shape between the
// GET /api/signals seed rows and the live WS `type:"signal"` frames — both carry
// signalType ∈ {cpk|control_limit|we_rule}, a value, and its occurrence instant.
export interface SpcSignal {
  deviceId: string;
  metric: string;
  signalType: string;
  value: number;
  occurredAt: string;
}

// One ML anomaly-score point (03-03). Same wire shape as SpcSignal but carries
// detector === "ml" and signalType === "anomaly_score"; shared between the
// GET /api/signals?detector=ml seed rows and the live WS `type:"signal"` frames.
export interface MlSignal {
  deviceId: string;
  metric: string;
  detector: string;
  signalType: string;
  value: number;
  occurredAt: string;
}

// Bundle snapshot passed to useReplaySocket for client-side demo replay (D-01).
export interface DemoSnapshot {
  baseline: Baseline;
  readings: SensorReading[];
  alarms: Alarm[];
  spcCpk: SpcSignal[];
  mlScore: MlSignal[];
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
