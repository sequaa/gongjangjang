import { describe, it, expect } from "vitest";
import { createFleet, deviceIdFor, buildFleetRound } from "../src/fleet.js";
import { topicFor } from "../src/publisher.js";

describe("deviceIdFor", () => {
  it("zero-pads to 3 digits, matching the 01-01 device-001 convention", () => {
    expect(deviceIdFor(1)).toBe("device-001");
    expect(deviceIdFor(12)).toBe("device-012");
    expect(deviceIdFor(7)).toBe("device-007");
  });
});

describe("createFleet (PIPE-02)", () => {
  it("builds N devices with distinct ids and an independent source each", () => {
    const fleet = createFleet({ count: 3, metric: "temperature" });
    expect(fleet).toHaveLength(3);
    const ids = fleet.map((d) => d.deviceId);
    expect(ids).toEqual(["device-001", "device-002", "device-003"]);
    expect(new Set(ids).size).toBe(3);
    // each device carries its own source instance (independent anomaly state)
    expect(fleet[0].source).not.toBe(fleet[1].source);
    fleet.forEach((d) => expect(typeof d.source.next).toBe("function"));
  });

  it("injects anomaly into the first anomalyCount devices only", () => {
    const fleet = createFleet({ count: 4, metric: "temperature", anomalyCount: 1 });
    expect(fleet[0].anomaly).toBe(true);
    expect(fleet[1].anomaly).toBe(false);
    expect(fleet[3].anomaly).toBe(false);
  });
});

describe("buildFleetRound", () => {
  it("emits one valid publish per device to sensors/{deviceId}", () => {
    const fleet = createFleet({ count: 5, metric: "temperature" });
    const round = buildFleetRound(fleet);

    expect(round).toHaveLength(5);
    const topics = round.map((p) => p.topic);
    expect(topics).toEqual([1, 2, 3, 4, 5].map((n) => topicFor(deviceIdFor(n))));

    round.forEach((p, i) => {
      expect(p.reading.deviceId).toBe(deviceIdFor(i + 1));
      expect(p.reading.metric).toBe("temperature");
      expect(typeof p.reading.value).toBe("number");
      expect(typeof p.reading.publishedAtMs).toBe("number");
    });
  });
});
