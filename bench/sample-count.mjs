// Samples `SELECT count(*) FROM sensor_readings` at a fixed cadence and appends
// `epoch_ms,count` rows to a CSV. This CSV is the RAW throughput artifact: the
// committed throughput number is the SLOPE of count over the steady middle of
// the load window (= rows persisted per second by the naive backend), computed
// by analyze-throughput.mjs. One long-lived process (no per-tick startup);
// queries run via `docker compose exec postgres psql` since no host psql exists.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync } from "node:fs";

const exec = promisify(execFile);
const COMPOSE = process.env.COMPOSE;
const ENVFILE = process.env.ENVFILE;
const PGUSER = process.env.PGUSER;
const PGDB = process.env.PGDB;
const OUT = process.env.OUT;
const DURATION_MS = Number(process.env.SAMPLE_DURATION_MS ?? 70_000);
const INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS ?? 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + DURATION_MS;

while (Date.now() < deadline) {
  const tickStart = Date.now();
  try {
    const { stdout } = await exec("docker", [
      "compose", "-f", COMPOSE, "--env-file", ENVFILE,
      "exec", "-T", "postgres",
      "psql", "-U", PGUSER, "-d", PGDB, "-t", "-A",
      "-c", "SELECT count(*) FROM sensor_readings;",
    ]);
    appendFileSync(OUT, `${tickStart},${stdout.trim()}\n`);
  } catch (e) {
    appendFileSync(OUT, `${tickStart},ERR\n`);
  }
  const rest = INTERVAL_MS - (Date.now() - tickStart);
  if (rest > 0) await sleep(rest);
}
