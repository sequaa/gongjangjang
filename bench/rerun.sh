#!/usr/bin/env bash
#
# One-command reproduction of the naive (Phase 1) performance baseline.
#
#   git checkout perf/01-naive-baseline && bench/rerun.sh
#
# Brings up ONLY the path under test (mosquitto + postgres + backend; simulator
# and frontend are excluded so their traffic does not pollute the measured row
# count), runs two SEPARATE measurements -- never mixed (RESEARCH pitfall #1) --
# and writes raw output to bench/results/:
#
#   1. THROUGHPUT: sustained MQTT publish load for a fixed window; the committed
#      number is the SLOPE of `count(*)` over the steady middle (= rows persisted
#      per second by the naive single-row INSERT path), NOT the publish rate.
#   2. LATENCY: single-process publish->WS-broadcast end-to-end latency, light
#      sequential probes, matched by publishedAtMs (one clock, no skew).
#
# Fresh DB every run (`down -v`) -- the data is synthetic and has no value.
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
COMPOSE="$ROOT_DIR/infra/docker-compose.yml"
ENVFILE="$ROOT_DIR/.env"
RESULTS="$BENCH_DIR/results"
mkdir -p "$RESULTS"

# Tunables (defaults give a 60s throughput window + 50 latency probes).
DURATION_MS="${DURATION_MS:-60000}"
CONCURRENCY="${CONCURRENCY:-24}"
PROBES="${PROBES:-50}"

if [[ ! -f "$ENVFILE" ]]; then
  echo "ERROR: $ENVFILE missing (copy .env.example -> .env)" >&2
  exit 1
fi
PGUSER="$(grep -E '^POSTGRES_USER=' "$ENVFILE" | cut -d= -f2)"
PGDB="$(grep -E '^POSTGRES_DB=' "$ENVFILE" | cut -d= -f2)"

dc() { docker compose -f "$COMPOSE" --env-file "$ENVFILE" "$@"; }
psql_q() { dc exec -T postgres psql -U "$PGUSER" -d "$PGDB" -t -A -c "$1"; }

echo "==> [1/6] Fresh stack (path under test only: mosquitto + postgres + backend)"
dc down -v --remove-orphans >/dev/null 2>&1 || true
dc up -d --build mosquitto postgres backend

echo "==> [2/6] Waiting for backend HTTP readiness (:18080/api/readings)"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:18080/api/readings?limit=1" >/dev/null 2>&1; then
    echo "    backend HTTP up"
    break
  fi
  sleep 2
  [[ $i -eq 60 ]] && { echo "ERROR: backend never became ready" >&2; exit 1; }
done

echo "==> [3/6] Installing bench deps"
( cd "$BENCH_DIR" && npm ci --silent 2>/dev/null || npm install --silent )

echo "==> [4/6] MQTT subscriber readiness sentinel (HTTP up != subscriber connected)"
SENTINEL_OK=0
for i in $(seq 1 30); do
  DEVICE_ID=ready-sentinel MQTT_URL=mqtt://localhost:1883 node "$BENCH_DIR/publish-one.mjs" || true
  sleep 1
  CNT="$(psql_q "SELECT count(*) FROM sensor_readings WHERE device_id='ready-sentinel';" | tr -d '[:space:]')"
  if [[ "${CNT:-0}" -gt 0 ]]; then echo "    subscriber live (sentinel persisted)"; SENTINEL_OK=1; break; fi
done
[[ $SENTINEL_OK -eq 1 ]] || { echo "ERROR: MQTT subscriber never confirmed" >&2; exit 1; }

echo "==> [5/6] THROUGHPUT run (${DURATION_MS}ms sustained load, concurrency=${CONCURRENCY})"
psql_q "TRUNCATE sensor_readings;" >/dev/null   # zero baseline for the slope
SERIES="$RESULTS/throughput_series.csv"
: > "$SERIES"
# sampler runs slightly longer than the load to capture the tail
COMPOSE="$COMPOSE" ENVFILE="$ENVFILE" PGUSER="$PGUSER" PGDB="$PGDB" OUT="$SERIES" \
  SAMPLE_DURATION_MS=$((DURATION_MS + 8000)) SAMPLE_INTERVAL_MS=500 \
  node "$BENCH_DIR/sample-count.mjs" &
SAMPLER_PID=$!
MQTT_URL=mqtt://localhost:1883 DURATION_MS="$DURATION_MS" CONCURRENCY="$CONCURRENCY" \
  node "$BENCH_DIR/throughput.mjs" | tee "$RESULTS/throughput_load.json"
wait "$SAMPLER_PID"
CSV="$SERIES" LOAD_JSON="$RESULTS/throughput_load.json" OUT="$RESULTS/throughput_summary.json" \
  node "$BENCH_DIR/analyze-throughput.mjs"

echo "==> [6/6] LATENCY run (${PROBES} sequential probes)"
# re-confirm subscriber still live before the second measurement
DEVICE_ID=ready-sentinel MQTT_URL=mqtt://localhost:1883 node "$BENCH_DIR/publish-one.mjs" || true
MQTT_URL=mqtt://localhost:1883 WS_URL=ws://localhost:18080/ws/sensors PROBES="$PROBES" \
  node "$BENCH_DIR/latency.mjs" | tee "$RESULTS/latency.txt" >/dev/null
tail -n 12 "$RESULTS/latency.txt"

echo
echo "==> DONE. Raw + derived results in bench/results/"
ls -1 "$RESULTS"
