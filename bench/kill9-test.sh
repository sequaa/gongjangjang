#!/usr/bin/env bash
#
# kill-9 restart zero-loss proof: batch (after) vs naive (before).
#
# Brings up mosquitto + postgres + backend ONLY — no simulator, no frontend.
# Counts are isolated to device_id='bench' so simulator/residual rows
# cannot inflate the count and mask naive loss.
#
# Kill target: BACKEND ONLY.
# mosquitto and postgres are NEVER killed — persistence=false means killing
# the broker discards the in-memory inflight queue, invalidating the proof.
#
# Two modes, same built image, toggled via INGEST_MODE env var (D-08):
#   batch: INGEST_MODE=batch  → cleanSession=false + manual ack-after-commit
#          expect N_persisted >= N_published (zero-loss; over-count via re-delivery OK)
#   naive: INGEST_MODE=naive  → cleanSession=true  + auto-ack
#          expect N_persisted < N_published  (loss — unacked msgs purged on disconnect)
#
# Restart mechanism: --force-recreate (not dc start) to avoid stale
# MqttDefaultFilePersistence files from the killed container.  The Paho client
# uses file persistence by default; a SIGKILL leaves those files in an
# inconsistent state.  A fresh container filesystem sidesteps the issue while
# keeping the same clientId + cleanSession=false → Mosquitto re-attaches the
# durable session and delivers the queued offline messages.
#
# Results: bench/results/kill9.txt
#
# Re-runnable: `bash bench/kill9-test.sh`
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
COMPOSE="$ROOT_DIR/infra/docker-compose.yml"
ENVFILE="$ROOT_DIR/.env"
RESULTS="$BENCH_DIR/results"
mkdir -p "$RESULTS"

if [[ ! -f "$ENVFILE" ]]; then
  echo "ERROR: $ENVFILE missing — copy .env.example -> .env" >&2
  exit 1
fi
PGUSER="$(grep -E '^POSTGRES_USER=' "$ENVFILE" | cut -d= -f2)"
PGDB="$(grep -E '^POSTGRES_DB='   "$ENVFILE" | cut -d= -f2)"

# Same helper pattern as rerun.sh
dc()     { docker compose -f "$COMPOSE" --env-file "$ENVFILE" "$@"; }
psql_q() { dc exec -T postgres psql -U "$PGUSER" -d "$PGDB" -t -A -c "$1"; }

# Tunables — RATE is below naive knee (~5 k/s) so the test is about kill-9,
# not throughput saturation. Duration long enough for kill to land mid-stream.
RATE="${RATE:-2000}"
DURATION_MS="${DURATION_MS:-15000}"
KILL_AFTER_SEC="${KILL_AFTER_SEC:-4}"
MIN_PUBLISHED=500   # sanity guard: abort if broker acked < this many messages

echo "==> [0/N] Fresh stack (mosquitto + postgres + backend — no simulator)"
dc down -v --remove-orphans >/dev/null 2>&1 || true
dc up -d --build mosquitto postgres backend

echo "==> Installing bench deps"
( cd "$BENCH_DIR" && npm ci --silent 2>/dev/null || npm install --silent )

# ─── helpers ────────────────────────────────────────────────────────────────

wait_http() {
  local LABEL="${1:-backend}"
  echo "    waiting for $LABEL HTTP readiness (:18080/api/readings)..."
  local I
  for I in $(seq 1 60); do
    if curl -fsS "http://localhost:18080/api/readings?limit=1" >/dev/null 2>&1; then
      echo "    $LABEL HTTP ready"
      return 0
    fi
    sleep 2
    [[ $I -eq 60 ]] && { echo "ERROR: $LABEL never became HTTP-ready" >&2; exit 1; }
  done
}

wait_mqtt_sentinel() {
  # HTTP up does NOT mean MQTT subscriber is connected (rerun.sh pitfall).
  # Publish a sentinel row and wait for it to land in the DB.
  #
  # BUG-FIX: pre-kill sentinel rows already in DB would cause count>0 to pass
  # immediately even if the subscriber is dead.  Delete all ready-sentinel rows
  # first so a fresh insertion is the only way count can reach >0.
  psql_q "DELETE FROM sensor_readings WHERE device_id='ready-sentinel';" >/dev/null
  echo "    waiting for MQTT subscriber sentinel (pre-existing rows cleared)..."
  local OK=0 CNT I
  for I in $(seq 1 30); do
    DEVICE_ID=ready-sentinel MQTT_URL=mqtt://localhost:1883 \
      node "$BENCH_DIR/publish-one.mjs" 2>/dev/null || true
    sleep 1
    CNT="$(psql_q "SELECT count(*) FROM sensor_readings WHERE device_id='ready-sentinel';" \
           | tr -d '[:space:]')"
    if [[ "${CNT:-0}" -gt 0 ]]; then
      echo "    MQTT subscriber live (sentinel persisted, attempt=$I)"
      OK=1
      break
    fi
  done
  [[ $OK -eq 1 ]] || { echo "ERROR: MQTT subscriber never confirmed" >&2; exit 1; }
}

# Poll count(*) WHERE device_id='bench' until stable across 3 consecutive 2-s polls.
# Sets global DRAIN_COUNT.
DRAIN_COUNT=0
wait_drain() {
  echo "    waiting for broker backlog to drain (polling device_id='bench')..."
  local PREV=-1 STABLE=0 CNT I
  for I in $(seq 1 120); do
    sleep 2
    CNT="$(psql_q "SELECT count(*) FROM sensor_readings WHERE device_id='bench';" \
           | tr -d '[:space:]')"
    echo "    drain poll $I: count=$CNT"
    if [[ "$CNT" == "$PREV" ]]; then
      STABLE=$((STABLE + 1))
      if [[ $STABLE -ge 3 ]]; then
        echo "    count stable at $CNT"
        DRAIN_COUNT="$CNT"
        return 0
      fi
    else
      STABLE=0
    fi
    PREV="$CNT"
  done
  echo "    WARNING: drain did not fully stabilize; using last count $CNT" >&2
  DRAIN_COUNT="$CNT"
}

# Result holders (set by run_mode)
R_batch_published=0; R_batch_persisted=0; R_batch_delta=0; R_batch_verdict=UNKNOWN
R_naive_published=0; R_naive_persisted=0; R_naive_delta=0; R_naive_verdict=UNKNOWN

# ─── main test procedure per mode ───────────────────────────────────────────

run_mode() {
  local MODE="$1"
  echo
  echo "============================================================"
  echo "  MODE: $MODE"
  echo "============================================================"

  # Recreate backend with the target INGEST_MODE.
  # --force-recreate ensures a fresh container filesystem: no stale Paho
  # MqttDefaultFilePersistence files from a previous killed run.
  echo "    bringing up backend (INGEST_MODE=$MODE, force-recreate)..."
  INGEST_MODE="$MODE" dc up -d --force-recreate backend

  wait_http "$MODE-backend"
  wait_mqtt_sentinel

  # Clear only bench rows — sentinel rows cleared inside wait_mqtt_sentinel.
  psql_q "DELETE FROM sensor_readings WHERE device_id='bench';" >/dev/null
  echo "    bench rows cleared (device_id='bench')"

  # Launch rate-paced publisher in background.
  # load.mjs prints a one-line JSON with `acked` = messages broker PUBACK'd.
  # `acked` is independent of backend state — it reflects broker receipt.
  local LOAD_OUT
  LOAD_OUT="$(mktemp)"
  MQTT_URL=mqtt://localhost:1883 \
  RATE="$RATE" \
  DURATION_MS="$DURATION_MS" \
    node "$BENCH_DIR/load.mjs" > "$LOAD_OUT" 2>&1 &
  local LOAD_PID=$!
  echo "    load.mjs started (PID=$LOAD_PID, RATE=${RATE}/s, ${DURATION_MS}ms)"

  # Kill backend mid-publish (SIGKILL via docker compose kill).
  sleep "$KILL_AFTER_SEC"
  echo "    killing backend only — mosquitto and postgres untouched"
  dc kill backend
  echo "    backend container killed (SIGKILL)"

  # Restart via force-recreate to get a fresh container filesystem.
  # Same clientId "backend-ingest" + cleanSession=false → Mosquitto re-attaches
  # the durable session and delivers messages published while backend was down.
  echo "    restarting backend (force-recreate, INGEST_MODE=$MODE)..."
  INGEST_MODE="$MODE" dc up -d --force-recreate backend

  # Wait for load.mjs to finish and capture acked count.
  echo "    waiting for load.mjs to complete..."
  wait "$LOAD_PID" || true
  local RAW_JSON
  RAW_JSON="$(cat "$LOAD_OUT")"
  rm -f "$LOAD_OUT"
  echo "    load.mjs output: $RAW_JSON"

  local N_PUBLISHED
  N_PUBLISHED="$(printf '%s' "$RAW_JSON" | grep -o '"acked":[0-9]*' | grep -o '[0-9]*' || echo 0)"
  echo "    N_published (acked by broker) = $N_PUBLISHED"

  # Sanity guard — if broker acked fewer than MIN_PUBLISHED messages the measurement
  # is empty (e.g. broker connection failed) and any delta would be meaningless.
  if [[ "${N_PUBLISHED:-0}" -lt "$MIN_PUBLISHED" ]]; then
    echo "ERROR: N_published=$N_PUBLISHED < MIN_PUBLISHED=$MIN_PUBLISHED" \
         "— broker connection likely failed. Aborting." >&2
    dc down -v >/dev/null 2>&1 || true
    exit 1
  fi

  # Wait for backend to be HTTP-ready after restart.
  wait_http "${MODE}-backend-restart"

  # Confirm MQTT subscriber is reconnected before starting the drain poll.
  # This ensures the broker can start delivering its backlog.
  wait_mqtt_sentinel

  # Poll until count stabilizes — captures full backlog drain.
  wait_drain
  local N_PERSISTED="$DRAIN_COUNT"

  local DELTA=$((N_PERSISTED - N_PUBLISHED))
  local VERDICT
  if [[ "$N_PERSISTED" -ge "$N_PUBLISHED" ]]; then
    VERDICT="ZERO_LOSS"
  else
    VERDICT="LOSS"
  fi

  echo
  echo "    RESULT [$MODE]: published=$N_PUBLISHED persisted=$N_PERSISTED delta=$DELTA verdict=$VERDICT"

  # Store in globals for the result file
  eval "R_${MODE}_published=$N_PUBLISHED"
  eval "R_${MODE}_persisted=$N_PERSISTED"
  eval "R_${MODE}_delta=$DELTA"
  eval "R_${MODE}_verdict=$VERDICT"
}

# ─── run both modes ─────────────────────────────────────────────────────────

# after = batch (zero-loss expected) — run first while image is already built
run_mode batch

# before = naive (loss expected) — same image, INGEST_MODE=naive
run_mode naive

# ─── write result file ──────────────────────────────────────────────────────

cat > "$RESULTS/kill9.txt" << EOF
kill-9 restart loss measurement
generated : $(date -u +"%Y-%m-%dT%H:%M:%SZ")
rate      : ${RATE} msg/s
kill_after: ${KILL_AFTER_SEC}s
duration  : ${DURATION_MS}ms
isolation : device_id='bench'  (no simulator; simulator rows never counted)
kill_target: backend only  (mosquitto and postgres never killed)
restart   : force-recreate (fresh container fs; avoids stale Paho persistence)

--- BATCH (after / optimized path) ---
mode      : batch
design    : QoS1 + cleanSession=false + manual ack-after-commit (D-01)
published : $R_batch_published
persisted : $R_batch_persisted
delta     : $R_batch_delta
verdict   : $R_batch_verdict
expected  : ZERO_LOSS (persisted >= published; over-count via re-delivery is OK)

--- NAIVE (before / baseline path) ---
mode      : naive
design    : QoS1 + cleanSession=true + auto-ack (session purged on disconnect)
published : $R_naive_published
persisted : $R_naive_persisted
delta     : $R_naive_delta
verdict   : $R_naive_verdict
expected  : LOSS (persisted < published)
EOF

echo
echo "==> kill9.txt written:"
cat "$RESULTS/kill9.txt"

# ─── teardown ───────────────────────────────────────────────────────────────

echo
echo "==> Bringing stack down..."
dc down -v >/dev/null 2>&1 || true
echo "==> DONE"
