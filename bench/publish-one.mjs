// Publishes a SINGLE sensor reading and exits. Used by rerun.sh as a readiness
// sentinel: HTTP 200 on the backend does NOT imply the MQTT subscriber is
// connected, and there is no retained/persistent session, so a message sent
// before the subscription is live is silently dropped. rerun.sh publishes this
// sentinel and polls the DB until the row lands, proving the subscriber is live
// BEFORE starting a timed run.
import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const DEVICE_ID = process.env.DEVICE_ID ?? "ready-sentinel";

const client = mqtt.connect(MQTT_URL);
await new Promise((resolve, reject) => {
  client.on("connect", resolve);
  client.on("error", reject);
});
const now = Date.now();
await new Promise((resolve, reject) =>
  client.publish(
    `sensors/${DEVICE_ID}`,
    JSON.stringify({
      deviceId: DEVICE_ID,
      metric: "temperature",
      value: 1,
      recordedAt: new Date(now).toISOString(),
      publishedAtMs: now,
    }),
    { qos: 1 },
    (err) => (err ? reject(err) : resolve()),
  ),
);
await new Promise((r) => client.end(false, {}, r));
