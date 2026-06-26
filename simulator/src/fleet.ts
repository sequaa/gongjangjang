import { SyntheticSource } from "./sources/SyntheticSource.js";
import type { SignalSource, SensorReading } from "./sources/SignalSource.js";
import { buildReading, topicFor } from "./publisher.js";

/** A single virtual device in the fleet (PIPE-02). */
export interface Device {
  deviceId: string;
  metric: string;
  anomaly: boolean;
  source: SignalSource;
}

export interface FleetOptions {
  count: number;
  metric: string;
  /** Inject anomaly into the first N devices (default 0). */
  anomalyCount?: number;
}

/** Zero-padded device id, matching the 01-01 `device-001` convention. */
export function deviceIdFor(n: number): string {
  return `device-${String(n).padStart(3, "0")}`;
}

/**
 * Builds N virtual devices, each with its OWN SyntheticSource so anomaly state
 * and signal phase are independent per device (the topology 01-RESEARCH
 * recommends for realistic N-device load).
 */
export function createFleet(opts: FleetOptions): Device[] {
  const anomalyCount = opts.anomalyCount ?? 0;
  const fleet: Device[] = [];
  for (let n = 1; n <= opts.count; n++) {
    const anomaly = n <= anomalyCount;
    fleet.push({
      deviceId: deviceIdFor(n),
      metric: opts.metric,
      anomaly,
      source: new SyntheticSource({ anomaly }),
    });
  }
  return fleet;
}

export interface FleetPublish {
  topic: string;
  reading: SensorReading;
}

/** One publish round over the whole fleet: one reading per device. */
export function buildFleetRound(fleet: Device[]): FleetPublish[] {
  return fleet.map((d) => ({
    topic: topicFor(d.deviceId),
    reading: buildReading(d.source, d.deviceId, d.metric),
  }));
}
