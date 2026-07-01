import { describe, it, expect } from "vitest";
// `windowMarkers` does not exist yet (RED): this import must fail to resolve so
// every test below fails until the helper is exported from SignalOverlay.tsx.
import { windowMarkers } from "./SignalOverlay";
import type { Alarm } from "../types";

const FOCUS = "device-001";
// Window: [1000, 3000] ms epoch.
const WINDOW_START = 1000;
const WINDOW_END = 3000;

function alarm(overrides: Partial<Alarm>): Alarm {
  return {
    id: 1,
    deviceId: FOCUS,
    metric: "rms",
    detector: "spc",
    rule: "we-rule",
    severity: "warning",
    value: 1.23,
    state: "created",
    firstOccurredAt: new Date(2000).toISOString(),
    ...overrides,
  };
}

// Predicate mirroring how the chart selects a detector's alarms (e.g. SPC).
const isSpc = (a: Alarm) => a.detector === "spc";

describe("windowMarkers (D-06)", () => {
  it("returns only alarms within [windowStart, windowEnd] with epoch-ms number x", () => {
    const inside = alarm({ id: 1, firstOccurredAt: new Date(2000).toISOString() });
    const alarms = [inside];

    const markers = windowMarkers(alarms, FOCUS, isSpc, WINDOW_START, WINDOW_END);

    expect(markers).toHaveLength(1);
    expect(markers[0].x).toBe(2000);
  });

  it("excludes alarms whose firstOccurredAt falls outside the window", () => {
    const before = alarm({ id: 1, firstOccurredAt: new Date(500).toISOString() });
    const after = alarm({ id: 2, firstOccurredAt: new Date(5000).toISOString() });

    const markers = windowMarkers([before, after], FOCUS, isSpc, WINDOW_START, WINDOW_END);

    expect(markers).toEqual([]);
  });

  it("returns x as number (epoch ms), never a string — no -1e17 breakage", () => {
    const inside = alarm({ id: 1, firstOccurredAt: new Date(2500).toISOString() });

    const markers = windowMarkers([inside], FOCUS, isSpc, WINDOW_START, WINDOW_END);

    expect(markers).toHaveLength(1);
    expect(typeof markers[0].x).toBe("number");
  });

  it("returns an empty array (no throw) for empty alarms", () => {
    expect(() => windowMarkers([], FOCUS, isSpc, WINDOW_START, WINDOW_END)).not.toThrow();
    expect(windowMarkers([], FOCUS, isSpc, WINDOW_START, WINDOW_END)).toEqual([]);
  });
});
