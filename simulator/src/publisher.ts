import type { SignalSource, SensorReading } from "./sources/SignalSource.js";

/**
 * Builds one MQTT payload from any SignalSource. `publishedAtMs` is stamped HERE,
 * at send time, so it measures publish->screen latency honestly (01-03 premise).
 */
export function buildReading(
  source: SignalSource,
  deviceId: string,
  metric: string,
): SensorReading {
  const sample = source.next(deviceId, metric);
  return {
    deviceId,
    metric,
    value: sample.value,
    recordedAt: sample.recordedAt,
    publishedAtMs: Date.now(),
  };
}

/** Topic per D-04: `sensors/{deviceId}`. */
export function topicFor(deviceId: string): string {
  return `sensors/${deviceId}`;
}
