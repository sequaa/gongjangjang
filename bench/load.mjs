// Rate-PACED MQTT publisher for the adaptive knee sweep (load.mjs).
//
// Unlike throughput.mjs (which floods at max to find saturation), this holds a
// TARGET offered rate (msg/s) for a window, so the knee controller (knee.mjs)
// can step the offered load up deterministically and watch where the naive
// backend tips over. Runs as a SEPARATE process from the latency probe so the
// firehose never sits on the probe's event loop.
//
// Prints a one-line JSON summary including the ACHIEVED rate (acked/sec) — past
// the knee the generator may not hit target, and a wrong x-axis fakes the curve.
import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const RATE = Number(process.env.RATE ?? 1000); // target msg/s
const DURATION_MS = Number(process.env.DURATION_MS ?? 15_000);
const CLIENTS = Number(process.env.CLIENTS ?? 8);
const TOPIC = process.env.TOPIC ?? "sensors/bench";
const TICK_MS = 20;

let attempted = 0;
let acked = 0;
let errored = 0;

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

function connect() {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(MQTT_URL);
    c.on("connect", () => resolve(c));
    c.on("error", reject);
  });
}

const clients = await Promise.all(
  Array.from({ length: CLIENTS }, () => connect()),
);

const start = Date.now();
const deadline = start + DURATION_MS;
let rr = 0;

await new Promise((resolve) => {
  function tick() {
    const now = Date.now();
    if (now >= deadline) return resolve();
    // drift-correcting pacing: catch up to where the target rate says we
    // should be by now, then yield.
    const should = Math.floor((RATE * (now - start)) / 1000);
    while (attempted < should) {
      const c = clients[rr++ % CLIENTS];
      attempted++;
      c.publish(TOPIC, payload(), { qos: 1 }, (err) => {
        if (err) errored++;
        else acked++;
      });
    }
    setTimeout(tick, TICK_MS);
  }
  tick();
});

await new Promise((r) => setTimeout(r, 500)); // grace for trailing PUBACKs
await Promise.all(clients.map((c) => new Promise((r) => c.end(false, {}, r))));

const durationSec = (Date.now() - start) / 1000;
console.log(
  JSON.stringify({
    kind: "paced-load",
    targetRate: RATE,
    durationMs: Math.round(durationSec * 1000),
    attempted,
    acked,
    errored,
    achievedRatePerSec: Math.round(acked / durationSec),
  }),
);
