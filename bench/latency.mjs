// Naive-baseline END-TO-END LATENCY probe (PERF-02).
//
// Measures publish -> server WebSocket-broadcast latency in a SINGLE process so
// there is no cross-host/cross-language clock to synchronise (RESEARCH pitfall
// #2): the same process stamps `publishedAtMs` on the MQTT message and reads it
// back off the WebSocket frame, computing `Date.now() - publishedAtMs` against
// one clock. This is the controllable, reproducible portion of "screen" latency
// (browser paint time is out of scope and not measurable here).
//
// LIGHT, SEQUENTIAL probes (one in flight at a time) so the baseline reflects
// the unloaded path, not saturation queueing -- run this SEPARATELY from the
// throughput load (never mix; RESEARCH pitfall #1). Each probe is matched back
// to its frame by the unique `publishedAtMs` it carried.
import mqtt from "mqtt";
import WebSocket from "ws";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const WS_URL = process.env.WS_URL ?? "ws://localhost:18080/ws/sensors";
const PROBES = Number(process.env.PROBES ?? 50);
const GAP_MS = Number(process.env.GAP_MS ?? 200);
const PER_PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 5_000);
const DEVICE_ID = "latency-probe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const ws = new WebSocket(WS_URL);
await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
});

const client = mqtt.connect(MQTT_URL);
await new Promise((resolve, reject) => {
  client.on("connect", resolve);
  client.on("error", reject);
});

// pending[publishedAtMs] -> resolver
const pending = new Map();
ws.on("message", (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (frame.deviceId !== DEVICE_ID) return;
  const r = pending.get(frame.publishedAtMs);
  if (r) {
    pending.delete(frame.publishedAtMs);
    r(Date.now());
  }
});

const samples = []; // { seq, publishedAtMs, latencyMs }
let timeouts = 0;

for (let seq = 1; seq <= PROBES; seq++) {
  const publishedAtMs = Date.now();
  const recvAt = await new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(publishedAtMs);
      resolve(null);
    }, PER_PROBE_TIMEOUT_MS);
    pending.set(publishedAtMs, (now) => {
      clearTimeout(t);
      resolve(now);
    });
    client.publish(
      `sensors/${DEVICE_ID}`,
      JSON.stringify({
        deviceId: DEVICE_ID,
        metric: "temperature",
        value: 60 + Math.random() * 20,
        recordedAt: new Date(publishedAtMs).toISOString(),
        publishedAtMs,
      }),
      { qos: 1 },
    );
  });
  if (recvAt === null) timeouts++;
  else samples.push({ seq, publishedAtMs, latencyMs: recvAt - publishedAtMs });
  await sleep(GAP_MS);
}

await new Promise((r) => client.end(false, {}, r));
ws.close();

const lat = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : NaN;
const summary = {
  kind: "e2e-latency",
  mqttUrl: MQTT_URL,
  wsUrl: WS_URL,
  metric: "publish_to_ws_broadcast_ms",
  probesRequested: PROBES,
  probesMeasured: lat.length,
  probesTimedOut: timeouts,
  gapMs: GAP_MS,
  min: lat[0],
  mean: Math.round(mean * 100) / 100,
  p50: pct(lat, 50),
  p90: pct(lat, 90),
  p95: pct(lat, 95),
  p99: pct(lat, 99),
  max: lat[lat.length - 1],
};

// raw per-probe lines first (uncommitted-shape raw), then the summary block
for (const s of samples) {
  console.log(`probe seq=${s.seq} publishedAtMs=${s.publishedAtMs} latencyMs=${s.latencyMs}`);
}
console.log("SUMMARY " + JSON.stringify(summary, null, 2));
