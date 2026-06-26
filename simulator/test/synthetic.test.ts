import { describe, it, expect } from "vitest";
import { SyntheticSource } from "../src/sources/SyntheticSource.js";
import { buildReading, topicFor } from "../src/publisher.js";
import type { SignalSource, Sample } from "../src/sources/SignalSource.js";

describe("SyntheticSource", () => {
  it("produces finite numeric samples with an ISO recordedAt", () => {
    const s = new SyntheticSource();
    const sample = s.next("device-001", "temperature");
    expect(Number.isFinite(sample.value)).toBe(true);
    expect(() => new Date(sample.recordedAt).toISOString()).not.toThrow();
    expect(new Date(sample.recordedAt).toISOString()).toBe(sample.recordedAt);
  });

  it("shifts the signal up when anomaly is injected", () => {
    const normal = new SyntheticSource({ noise: 0, anomaly: false });
    const faulty = new SyntheticSource({ noise: 0, anomaly: true, anomalyMagnitude: 30 });
    // same t progression, anomaly adds a constant offset
    expect(faulty.next("d", "m").value).toBeGreaterThan(normal.next("d", "m").value);
  });
});

describe("buildReading (payload contract D-04)", () => {
  it("emits a valid full payload and stamps publishedAtMs at send time", () => {
    const before = Date.now();
    const r = buildReading(new SyntheticSource(), "device-001", "temperature");
    const after = Date.now();

    expect(r.deviceId).toBe("device-001");
    expect(r.metric).toBe("temperature");
    expect(typeof r.value).toBe("number");
    expect(typeof r.recordedAt).toBe("string");
    expect(r.publishedAtMs).toBeGreaterThanOrEqual(before);
    expect(r.publishedAtMs).toBeLessThanOrEqual(after);
  });

  it("works with any SignalSource impl — proves the swappable seam (D-02)", () => {
    // Stand-in for a future NASA replay adapter: a different SignalSource.
    class ReplayStub implements SignalSource {
      next(): Sample {
        return { value: 1.234, recordedAt: "2026-01-01T00:00:00.000Z" };
      }
    }
    const r = buildReading(new ReplayStub(), "device-007", "vibration");
    expect(r.value).toBe(1.234);
    expect(r.recordedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(r.deviceId).toBe("device-007");
  });
});

describe("topicFor", () => {
  it("builds sensors/{deviceId}", () => {
    expect(topicFor("device-001")).toBe("sensors/device-001");
  });
});
