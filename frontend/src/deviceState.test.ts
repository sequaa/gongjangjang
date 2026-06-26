import { describe, it, expect } from "vitest";
import { upsertDevice, type DeviceSnapshot } from "./deviceState";
import type { SensorReading } from "./types";

function reading(deviceId: string, value: number, ms: number): SensorReading {
  return {
    deviceId,
    metric: "temperature",
    value,
    recordedAt: new Date(ms).toISOString(),
    publishedAtMs: ms,
  };
}

describe("upsertDevice (RT-02 per-device state)", () => {
  it("keeps the latest reading per device", () => {
    let map: Record<string, DeviceSnapshot> = {};
    map = upsertDevice(map, reading("device-001", 10, 1000));
    map = upsertDevice(map, reading("device-002", 20, 1000));
    map = upsertDevice(map, reading("device-001", 11, 2000)); // newer for 001

    expect(Object.keys(map).sort()).toEqual(["device-001", "device-002"]);
    expect(map["device-001"].value).toBe(11);
    expect(map["device-002"].value).toBe(20);
  });

  it("returns a new map (immutable update)", () => {
    const before: Record<string, DeviceSnapshot> = {};
    const after = upsertDevice(before, reading("device-001", 10, 1000));
    expect(after).not.toBe(before);
    expect(before).toEqual({});
  });

  it("records a lastUpdateMs so staleness can be derived", () => {
    const map = upsertDevice({}, reading("device-001", 10, 1000));
    expect(typeof map["device-001"].lastUpdateMs).toBe("number");
    expect(map["device-001"].deviceId).toBe("device-001");
  });
});
