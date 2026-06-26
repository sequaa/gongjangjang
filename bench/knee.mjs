// Adaptive KNEE sweep controller (knee.mjs).
//
// Steps the OFFERED load up deterministically (R0 x FACTOR^n) and, at each step,
// measures the naive backend's response. Levels are NOT pre-guessed: the ramp
// keeps climbing and the sweep STOPS only when the system breaks an SLO and then
// runs STEPS_AFTER_BREAK more steps past it. The offered-rate sequence is
// deterministic, so every run produces the same x-axis -> reproducible baseline
// AND directly comparable to Phase 2 at matching loads (a bisect would not be).
//
// Per step it records three curves at once: persisted throughput (rows/s),
// end-to-end latency under load (p50/p99), and broker drop%. The "break" SLO is
// the project's own targets: p99 >= 500ms OR drop >= 1%, whichever trips first.
//
// Integrity guards:
//  - QUIESCE between steps: stop load, wait until count(*) stops growing (broker
//    backlog drained), THEN truncate -> next step's count isn't polluted by the
//    previous step's drained overflow.
//  - Probe validity: if too many probes time out, p99-over-survivors is biased
//    low -> latency marked invalid for that step; drop% is the authority there.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const exec = promisify(execFile);

const COMPOSE = process.env.COMPOSE;
const ENVFILE = process.env.ENVFILE;
const PGUSER = process.env.PGUSER;
const PGDB = process.env.PGDB;
const BENCH_DIR = process.env.BENCH_DIR;
const RESULTS = process.env.RESULTS;
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const WS_URL = process.env.WS_URL ?? "ws://localhost:18080/ws/sensors";

const R0 = Number(process.env.R0 ?? 500); // starting offered rate (msg/s)
const FACTOR = Number(process.env.FACTOR ?? 1.6); // ramp multiplier
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 15_000);
const STEPS_AFTER_BREAK = Number(process.env.STEPS_AFTER_BREAK ?? 2);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 12); // safety cap
const SLO_P99_MS = Number(process.env.SLO_P99_MS ?? 500);
const SLO_DROP_PCT = Number(process.env.SLO_DROP_PCT ?? 1);
const PROBE_GAP_MS = Number(process.env.PROBE_GAP_MS ?? 200);
const PROBE_INVALID_TIMEOUT_PCT = 20; // >this% probes timed out -> latency invalid

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// total=true counts every row (used for quiesce-drain detection); otherwise
// counts only the load topic's rows (device_id='bench') so the probe and
// sentinel rows never pollute the persisted-rate / drop% of the load.
async function countRows(total = false) {
  const where = total ? "" : " WHERE device_id='bench'";
  const { stdout } = await exec("docker", [
    "compose", "-f", COMPOSE, "--env-file", ENVFILE, "exec", "-T", "postgres",
    "psql", "-U", PGUSER, "-d", PGDB, "-t", "-A",
    "-c", `SELECT count(*) FROM sensor_readings${where};`,
  ]);
  return Number(stdout.trim());
}

async function truncate() {
  await exec("docker", [
    "compose", "-f", COMPOSE, "--env-file", ENVFILE, "exec", "-T", "postgres",
    "psql", "-U", PGUSER, "-d", PGDB, "-c", "TRUNCATE sensor_readings;",
  ]);
}

// Wait until count(*) stops growing (broker backlog fully drained), then truncate.
async function quiesceAndReset() {
  let prev = -1;
  for (let i = 0; i < 40; i++) {
    const c = await countRows(true); // total: wait for the whole backlog to drain
    if (c === prev) break;
    prev = c;
    await sleep(500);
  }
  await truncate();
}

function runChild(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [`${BENCH_DIR}/${script}`], {
      env: { ...process.env, ...env },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${script} exit ${code}: ${err}`)),
    );
  });
}

const rows = [];
let rate = R0;
let stepsPastBreak = 0;
let broken = false;

for (let step = 0; step < MAX_STEPS; step++) {
  await quiesceAndReset();
  const c0 = await countRows(); // ~0 after truncate

  const probes = Math.max(10, Math.floor(WINDOW_MS / PROBE_GAP_MS));
  // load + probe run concurrently, separate processes (firehose off the probe loop)
  const [loadOut, probeOut] = await Promise.all([
    runChild("load.mjs", { MQTT_URL, RATE: String(rate), DURATION_MS: String(WINDOW_MS) }),
    runChild("latency.mjs", {
      MQTT_URL, WS_URL,
      PROBES: String(probes), GAP_MS: String(PROBE_GAP_MS),
    }),
  ]);

  const load = JSON.parse(loadOut.trim().split("\n").pop());
  const probe = JSON.parse(probeOut.split("SUMMARY ")[1]);

  const c1 = await countRows();
  // persisted rate over the LOAD's actual duration (post-window drain is bounded
  // by the broker queue and negligible at these rates); count is load-topic only.
  const persistedRows = c1 - c0;
  const persisted = Math.round(persistedRows / (load.durationMs / 1000));
  const achieved = load.achievedRatePerSec;
  const dropPct = load.acked > 0
    ? Math.max(0, Math.round(((load.acked - persistedRows) / load.acked) * 1000) / 10)
    : 0;

  const timeoutPct = (probe.probesTimedOut / probe.probesRequested) * 100;
  const latencyValid = timeoutPct <= PROBE_INVALID_TIMEOUT_PCT;

  const brokeP99 = latencyValid && probe.p99 >= SLO_P99_MS;
  const brokeDrop = dropPct >= SLO_DROP_PCT;
  const verdict = brokeP99 || brokeDrop ? "broken" : "healthy";

  rows.push({
    targetRate: rate,
    achievedRate: achieved,
    persistedRowsPerSec: persisted,
    dropPct,
    latP50: probe.p50,
    latP99: probe.p99,
    probesOk: probe.probesMeasured,
    probesTimeout: probe.probesTimedOut,
    latencyValid,
    verdict,
    breakReason: verdict === "broken" ? (brokeDrop ? "drop" : "p99") : "",
  });

  console.log(
    `step ${step}: offered~${achieved}/s persisted=${persisted}/s drop=${dropPct}% ` +
      `p99=${probe.p99}ms${latencyValid ? "" : "(invalid)"} -> ${verdict}`,
  );

  if (verdict === "broken") {
    broken = true;
    if (++stepsPastBreak > STEPS_AFTER_BREAK) break;
  }
  rate = Math.round(rate * FACTOR);
}

await quiesceAndReset();

// CSV (raw trajectory artifact)
const header =
  "target_rate,achieved_rate,persisted_rows_per_sec,drop_pct,lat_p50_ms,lat_p99_ms,probes_ok,probes_timeout,latency_valid,verdict,break_reason";
const csv = [header]
  .concat(
    rows.map((r) =>
      [r.targetRate, r.achievedRate, r.persistedRowsPerSec, r.dropPct, r.latP50,
       r.latP99, r.probesOk, r.probesTimeout, r.latencyValid, r.verdict, r.breakReason].join(","),
    ),
  )
  .join("\n");
writeFileSync(`${RESULTS}/knee_trajectory.csv`, csv + "\n");

const healthy = rows.filter((r) => r.verdict === "healthy");
const firstBroken = rows.find((r) => r.verdict === "broken");
const summary = {
  kind: "knee-sweep",
  slo: { p99Ms: SLO_P99_MS, dropPct: SLO_DROP_PCT },
  ramp: { startRate: R0, factor: FACTOR, windowSec: WINDOW_MS / 1000, stepsAfterBreak: STEPS_AFTER_BREAK },
  steps: rows.length,
  kneeOfferedRatePerSec: healthy.length ? healthy[healthy.length - 1].achievedRate : null,
  saturationPersistRatePerSec: Math.max(...rows.map((r) => r.persistedRowsPerSec)),
  brokeAtOfferedRatePerSec: firstBroken ? firstBroken.achievedRate : null,
  brokeReason: firstBroken ? firstBroken.breakReason : null,
  curve: rows,
};
writeFileSync(`${RESULTS}/knee_summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
