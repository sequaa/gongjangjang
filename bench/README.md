# bench — naive baseline measurement harness (Phase 1)

This directory freezes the **naive** (pre-optimization) performance of the
ingest pipeline so Phase 2's optimizations can be proven as a reproducible
`before → after`. The naive tree is pinned at the git tag
**`perf/01-naive-baseline`**.

## Reproduce in one command

```bash
git checkout perf/01-naive-baseline
bench/rerun.sh
```

Requirements: Docker + Docker Compose, Node.js, `curl`, a `.env` file at the
repo root (`cp .env.example .env`). No local `k6`, `psql`, Go, or Maven needed.

`rerun.sh` brings up **only the path under test** (mosquitto + postgres +
backend — the simulator and frontend are intentionally excluded so their
traffic does not pollute the measured numbers), runs the two measurements as
**separate** runs, and writes raw + derived output to `bench/results/`.

## What is measured (and why it is measured this way)

### 1. Throughput = rows persisted per second (NOT publishes per second)

The naive backend is a single-threaded path: one MQTT message → one blocking
`INSERT` → one WebSocket broadcast, on Paho's single callback thread. The
optimizations Phase 2 will apply (batching / `COPY` / partitioning / indexing)
all move the **write** path — none of them change MQTT publish speed. So the
honest baseline number is **rows actually persisted per second**, not how fast
a load generator can publish (publish rate ≫ persist rate by design, because a
QoS-1 `PUBACK` comes from the broker, not from Spring).

Method (`throughput.mjs` + `sample-count.mjs` + `analyze-throughput.mjs`):

- Drive **sustained** publish load at the broker for a fixed window
  (`DURATION_MS`, default 60s) at `CONCURRENCY` parallel publishers — enough to
  keep the broker queue ahead of the backend so the single INSERT path stays
  continuously saturated.
- Sample `SELECT count(*)` every 500ms into `results/throughput_series.csv`
  (`epoch_ms,count`) — this CSV is the raw artifact.
- Throughput = **average sustained persist rate** = secant of the cumulative
  `count(*)` over the steady middle of the window (ramp-up and post-load tail
  discarded). Because `count(*)` is cumulative and monotonic, this secant is the
  exact mean rows/sec over the interval — periodic write stalls inside the window
  are absorbed into the average (a regression/OLS slope would be *wrong* here).
  The number equals the backend's persist rate regardless of how fast we publish
  or how much the broker drops.
- **Validity check:** `count(*)` must keep rising across the whole window with no
  early plateau (backend never idle). If it flattens early, the backlog drained —
  raise `CONCURRENCY`/`DURATION_MS`. Note: the naive baseline shows periodic write
  stalls (~5s every ~15s ≈ postgres checkpoint/WAL); these are real and a Phase 2
  lever, and the average deliberately includes them rather than cherry-picking the
  clean region.

A **fixed-N "publish N then wait for count==N"** design was rejected: the slow
naive subscriber overflows mosquitto's QoS-1 queue (`max_queued_messages`,
default 1000) under a burst, so the broker **drops** the excess and `count(*)`
plateaus below N — the poll would hang forever. The slope-of-count method needs
no broker tuning and measures the true persist rate.

**Bonus naive metric — drop%:** broker-acked publishes that never persisted
(QoS-1 queue overflow toward the slow subscriber). Reported as `dropPctOfAcked`.
Phase 2 should raise throughput *and* cut this loss.

### 2. End-to-end latency = publish → WS broadcast (single clock)

`latency.mjs` runs in a **single process** that both publishes the MQTT message
(stamping `publishedAtMs`) and subscribes to the WebSocket, computing
`Date.now() - publishedAtMs` against **one clock** — no cross-host/cross-language
clock skew (RESEARCH pitfall #2). It measures publish → server-broadcast, the
controllable, reproducible portion of "screen" latency (browser paint is out of
scope). Probes are **light and sequential** (one in flight, `GAP_MS` apart) so
the baseline reflects the unloaded path, not saturation queueing.

Throughput and latency are **never measured in the same run** (RESEARCH pitfall
#1): WebSocket-subscribe load competing with the INSERT hot path would
contaminate both numbers.

## Load tool: mqtt.js fallback (not xk6-mqtt)

The plan's primary tool was **k6 + xk6-mqtt**. The custom k6 binary
*built cleanly* via the official `grafana/xk6` Docker image, but the
`xk6-mqtt` `Client` API **panicked (nil-pointer) at runtime** on first use.
Per the plan's in-scope fallback, the harness uses **`mqtt.js` + `ws`** on
Node instead — the exact stack the repo's `e2e/` test already proves works
end-to-end against this pipeline. This closes RESEARCH Open Question #2:
**fallback adopted.** k6's value (percentile math, structured output) is
reproduced directly in `latency.mjs` / `analyze-throughput.mjs`. The harness
remains fully reproducible from the tag with no Go toolchain.

## Files

| File | Role |
|------|------|
| `throughput.mjs` | Sustained MQTT publish load for a fixed window (load only). |
| `sample-count.mjs` | Samples `count(*)` → `results/throughput_series.csv` (raw). |
| `analyze-throughput.mjs` | Slope + drop% → `results/throughput_summary.json` (derived). |
| `latency.mjs` | Single-process e2e latency probes → `results/latency.txt`. |
| `publish-one.mjs` | One-shot publish; used as the subscriber-readiness sentinel. |
| `rerun.sh` | One-command orchestration of everything above. |
| `results/` | Committed raw + derived output (the frozen naive numbers). |

## Results

See `results/` (committed). `throughput_series.csv` is the raw series;
`throughput_summary.json` and `latency.txt` carry the headline numbers. These
are the **naive baseline** — Phase 2 re-runs this same harness to produce the
`after` and the delta.
