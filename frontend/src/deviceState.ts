import type { SensorReading } from "./types";

/** Latest known state for one device (RT-02 grid/tiles). */
export interface DeviceSnapshot extends SensorReading {
  /** Wall-clock ms when this snapshot was applied — used to derive staleness. */
  lastUpdateMs: number;
}

/**
 * Immutably upserts the latest reading for a device. Returns a NEW map so React
 * state updates trigger a re-render.
 */
export function upsertDevice(
  map: Record<string, DeviceSnapshot>,
  reading: SensorReading,
): Record<string, DeviceSnapshot> {
  return {
    ...map,
    [reading.deviceId]: { ...reading, lastUpdateMs: Date.now() },
  };
}

/** Stable, id-sorted list for rendering. */
export function deviceList(map: Record<string, DeviceSnapshot>): DeviceSnapshot[] {
  return Object.values(map).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}
