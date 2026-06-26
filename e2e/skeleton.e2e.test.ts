// Walking-skeleton end-to-end test (Phase 1, plan 01-01).
//
// Proves the whole pipe is wired: a single message published to Mosquitto on
// `sensors/{deviceId}` is ingested by Spring and pushed back out over the
// native WebSocket to a connected client, with `publishedAtMs` preserved
// unchanged (the premise 01-03 latency measurement depends on).
//
// This test drives the *running* stack itself rather than the browser: it opens
// the same WebSocket the React app uses, publishes one MQTT message, and asserts
// the broadcast frame arrives intact. With the stack down (RED) the WS connect
// is refused and the test fails; once `docker compose up` is green it passes.
import { describe, it, expect } from "vitest";
import mqtt from "mqtt";
import WebSocket from "ws";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const WS_URL = process.env.WS_URL ?? "ws://localhost:18080/ws/sensors";
const TIMEOUT_MS = 20_000;

describe("skeleton end-to-end pipe", () => {
  it(
    "delivers a published sensor reading to the WebSocket with publishedAtMs intact",
    async () => {
      const deviceId = "e2e-probe";
      const metric = "temperature";
      const value = 42.5;
      const publishedAtMs = Date.now();
      const payload = JSON.stringify({
        deviceId,
        metric,
        value,
        recordedAt: new Date(publishedAtMs).toISOString(),
        publishedAtMs,
      });

      const received = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no matching WS frame within ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        );

        const ws = new WebSocket(WS_URL);
        ws.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        ws.on("message", (data) => {
          let frame: any;
          try {
            frame = JSON.parse(data.toString());
          } catch {
            return; // ignore non-JSON / unrelated frames
          }
          if (frame.deviceId === deviceId) {
            clearTimeout(timer);
            ws.close();
            resolve(frame);
          }
        });

        ws.on("open", () => {
          const client = mqtt.connect(MQTT_URL);
          client.on("connect", () => {
            client.publish(`sensors/${deviceId}`, payload, { qos: 1 }, () => {
              client.end();
            });
          });
          client.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      });

      expect(received.deviceId).toBe(deviceId);
      expect(received.metric).toBe(metric);
      expect(received.value).toBe(value);
      // publishedAtMs must survive sim -> MQTT -> Spring -> WS frame unchanged.
      expect(received.publishedAtMs).toBe(publishedAtMs);
    },
    TIMEOUT_MS + 5_000,
  );
});
