import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { createFleet, deviceIdFor } from "./fleet.js";
import { buildReading, topicFor } from "./publisher.js";

// Phase 1, plan 01-02: N virtual devices publishing concurrently to build the
// load stream Phase 2 measures (PIPE-02). Each device gets its own MQTT client
// (realistic broker connection count + independent anomaly state).
const BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const DEVICE_COUNT = Math.max(1, Number(process.env.DEVICE_COUNT ?? 1));
const METRIC = process.env.METRIC ?? "temperature";
const INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS ?? 1000);
const ANOMALY_DEVICES = Math.max(0, Number(process.env.ANOMALY_DEVICES ?? 0));

const fleet = createFleet({
  count: DEVICE_COUNT,
  metric: METRIC,
  anomalyCount: ANOMALY_DEVICES,
});

const clients: MqttClient[] = [];

console.log(
  `[simulator] starting ${DEVICE_COUNT} device(s) ${deviceIdFor(1)}..${deviceIdFor(DEVICE_COUNT)} ` +
    `(${ANOMALY_DEVICES} anomalous) -> ${BROKER_URL} every ${INTERVAL_MS}ms`,
);

for (const device of fleet) {
  const client = mqtt.connect(BROKER_URL, { clientId: `sim-${device.deviceId}` });
  clients.push(client);

  client.on("connect", () => {
    setInterval(() => {
      const reading = buildReading(device.source, device.deviceId, device.metric);
      client.publish(topicFor(device.deviceId), JSON.stringify(reading), { qos: 1 });
    }, INTERVAL_MS);
  });

  client.on("error", (err) =>
    console.error(`[simulator] ${device.deviceId} mqtt error:`, err.message),
  );
}

function shutdown() {
  clients.forEach((c) => c.end(true));
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
