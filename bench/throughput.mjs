// Naive-baseline THROUGHPUT load generator (PERF-02).
//
// This script does ONE thing: drive sustained MQTT publish load at the broker
// for a fixed DURATION so Spring's single-threaded naive INSERT path stays
// continuously saturated. It deliberately does NOT measure throughput by
// counting its own publishes -- publish rate >> persist rate by design (QoS-1
// PUBACK comes from the broker, not from Spring), so the publisher counter is
// the WRONG number. The committed throughput figure is the SLOPE of
// `SELECT count(*)` on sensor_readings sampled by rerun.sh during this window
// (= rows actually persisted per second = the bottleneck Phase 2 will move).
//
// What this script reports back (raw): publishes ATTEMPTED and ACKed by the
// broker, plus errors. rerun.sh combines `acked` with the persisted-row delta
// to derive the naive backpressure DROP% (broker QoS-1 queue overflow toward a
// slow subscriber -- itself a naive-baseline metric Phase 2 improves).
//
// Run separately from latency.mjs -- never mix the two (RESEARCH pitfall #1).
import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const DURATION_MS = Number(process.env.DURATION_MS ?? 60_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 24);
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 1000);
const TOPIC = process.env.TOPIC ?? "sensors/bench";

let attempted = 0;
let acked = 0;
let errored = 0;
let inflight = 0; // shared across all publisher clients

function payload() {
  const now = Date.now();
  return JSON.stringify({
    deviceId: "bench",
    metric: "temperature",
    value: 60 + Math.random() * 20,
    recordedAt: new Date(now).toISOString(),
    publishedAtMs: now,
  });
}

function pump(client, deadline) {
  return new Promise((resolve) => {
    function tick() {
      if (Date.now() >= deadline) return resolve();
      while (inflight < MAX_INFLIGHT && Date.now() < deadline) {
        inflight++;
        attempted++;
        client.publish(TOPIC, payload(), { qos: 1 }, (err) => {
          inflight--;
          if (err) errored++;
          else acked++;
        });
      }
      setImmediate(tick);
    }
    tick();
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(MQTT_URL);
    c.on("connect", () => resolve(c));
    c.on("error", reject);
  });
}

const startedAt = Date.now();
const deadline = startedAt + DURATION_MS;
const clients = await Promise.all(
  Array.from({ length: CONCURRENCY }, () => connect()),
);
await Promise.all(clients.map((c) => pump(c, deadline)));
const elapsedMs = Date.now() - startedAt;
// give a brief grace for the last in-flight PUBACKs to settle
await new Promise((r) => setTimeout(r, 500));
await Promise.all(clients.map((c) => new Promise((r) => c.end(false, {}, r))));

const summary = {
  kind: "throughput-load",
  mqttUrl: MQTT_URL,
  durationMs: elapsedMs,
  concurrency: CONCURRENCY,
  maxInflight: MAX_INFLIGHT,
  topic: TOPIC,
  publishesAttempted: attempted,
  publishesAcked: acked,
  publishErrors: errored,
  publishAttemptRatePerSec: Math.round((attempted / elapsedMs) * 1000),
};
console.log(JSON.stringify(summary, null, 2));
