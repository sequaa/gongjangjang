// Derives the committed naive-baseline throughput number from the raw artifacts:
//  - throughput_series.csv  (epoch_ms,count sampled during the load window)
//  - throughput_load.json   (publisher's attempted/acked counters)
//
// Throughput = SLOPE of count(*) over the STEADY middle of the window (ramp-up
// and tail discarded) = rows actually persisted per second by the single-threaded
// naive INSERT path. Also derives DROP% = broker-acked publishes that never
// persisted (QoS-1 queue overflow toward the slow subscriber) -- a naive-baseline
// backpressure metric Phase 2 is expected to improve alongside throughput.
import { readFileSync, writeFileSync } from "node:fs";

const CSV = process.env.CSV;
const LOAD_JSON = process.env.LOAD_JSON;
const OUT = process.env.OUT;
const START_DISCARD_MS = Number(process.env.START_DISCARD_MS ?? 15_000);
const END_DISCARD_MS = Number(process.env.END_DISCARD_MS ?? 5_000);

const rows = readFileSync(CSV, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split(","))
  .filter(([, c]) => c !== "ERR")
  .map(([t, c]) => ({ t: Number(t), c: Number(c) }));

if (rows.length < 2) {
  throw new Error(`not enough samples in ${CSV} (${rows.length})`);
}

const t0 = rows[0].t;
const tEnd = rows[rows.length - 1].t;
// Clip the post-load PLATEAU: once the backlog has drained, count(*) stops
// growing and stays flat. Including those flat samples would dilute the slope
// (artificially lowering the persist rate), so the steady window must end at
// the plateau start = the first sample that reaches the final max count.
const maxCount = rows[rows.length - 1].c;
const plateauStartT = rows.find((r) => r.c >= maxCount)?.t ?? tEnd;
const lo = t0 + START_DISCARD_MS;
const hi = Math.min(tEnd - END_DISCARD_MS, plateauStartT);
let window = rows.filter((r) => r.t >= lo && r.t <= hi);
let windowNote = `steady window [+${START_DISCARD_MS}ms .. min(-${END_DISCARD_MS}ms, plateau)]`;
if (window.length < 2) {
  window = rows; // fallback: too short a run, use the whole series
  windowNote = "FALLBACK: full series (steady window had <2 samples)";
}

const a = window[0];
const b = window[window.length - 1];
const slope = (b.c - a.c) / ((b.t - a.t) / 1000); // rows per second

// linearity sanity: overall slope vs window slope (flat tail => backlog drained)
const overallSlope = (rows[rows.length - 1].c - rows[0].c) / ((tEnd - t0) / 1000);

const load = JSON.parse(readFileSync(LOAD_JSON, "utf8"));
const persistedTotal = rows[rows.length - 1].c; // table was truncated to 0 at window start
const acked = load.publishesAcked;
const unpersisted = Math.max(0, acked - persistedTotal);
const dropPct = acked > 0 ? (unpersisted / acked) * 100 : 0;

const out = {
  kind: "throughput-derived",
  metric: "rows_persisted_per_second (naive single-row INSERT)",
  throughputRowsPerSec: Math.round(slope),
  windowNote,
  windowSamples: window.length,
  windowSpanSec: Math.round(((b.t - a.t) / 1000) * 10) / 10,
  overallSlopeRowsPerSec: Math.round(overallSlope),
  persistedRowsTotal: persistedTotal,
  publishesAttempted: load.publishesAttempted,
  publishesAcked: acked,
  unpersistedAcked: unpersisted,
  dropPctOfAcked: Math.round(dropPct * 10) / 10,
  loadDurationMs: load.durationMs,
  concurrency: load.concurrency,
};

const text = JSON.stringify(out, null, 2);
writeFileSync(OUT, text + "\n");
console.log(text);
