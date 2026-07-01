import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
// RED: this module does not exist yet — the import must fail to resolve so every
// test in this file reports RED for the correct reason (missing implementation).
import { useReplaySocket } from "./useReplaySocket";
import snapshotJson from "../demo/snapshot.json";
import type { Alarm, MlSignal, SensorReading, SpcSignal } from "../types";

// Mirror of useSensorSocket's rolling-window size (MAX_POINTS = 120). The replay
// hook must return the SAME SocketState shape with the SAME window cap.
const MAX_POINTS = 120;

// Loosely-typed snapshot: DemoSnapshot is added to types.ts by the GREEN impl, so
// the test must not couple to it. vitest transpiles without a typecheck, so `any`
// here never blocks the run.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshot = snapshotJson as any;

// ── epoch helpers ───────────────────────────────────────────────────────────
// CRITICAL: every comparison parses the SAME no-`Z` string form via new Date(),
// so the local-tz offset cancels and ordering is timezone-invariant. Never mix
// publishedAtMs (a baked absolute epoch) into these comparisons.
const epoch = (iso: string) => new Date(iso).getTime();

type Result = { current: ReturnType<typeof useReplaySocket> };

const newestReading = (r: Result): SensorReading =>
  r.current.readings[r.current.readings.length - 1];
const newestEpoch = (r: Result) => epoch(newestReading(r).recordedAt);

/** Max occurredAt epoch across the exposed cpk + ml series (−∞ when empty). */
function maxExposedSignalEpoch(r: Result): number {
  const eps = [...r.current.spcCpk, ...r.current.mlScore].map((s: SpcSignal | MlSignal) =>
    epoch(s.occurredAt),
  );
  return eps.length ? Math.max(...eps) : -Infinity;
}

const alarms: Alarm[] = snapshot.alarms;
const readings: SensorReading[] = snapshot.readings;
const lastRecordedAt = readings[readings.length - 1].recordedAt;

/**
 * Advance replay time until the newest reading reaches the final snapshot reading
 * (interval-length agnostic), invoking `onStep` after every chunk. Guarded so a
 * broken impl cannot spin forever.
 */
function advanceToEnd(r: Result, onStep: () => void): void {
  let guard = 0;
  while (newestReading(r).recordedAt !== lastRecordedAt && guard < 500) {
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    onStep();
    guard += 1;
  }
  expect(guard).toBeLessThan(500); // reached the end, did not hit the guard
}

beforeEach(() => {
  vi.useFakeTimers();
  // Reinforce D-04: any fetch/WebSocket touch on the replay path is a bug. Stub
  // both as spies so test 4 can assert 0 calls; the others benefit from isolation.
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("WebSocket", vi.fn());
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useReplaySocket", () => {
  // Behavior 1
  it("seeds readings up to MAX_POINTS and reports connected=true", () => {
    const { result } = renderHook(() => useReplaySocket(snapshot));

    expect(result.current.readings).toHaveLength(MAX_POINTS);
    expect(result.current.connected).toBe(true);
    expect(result.current.baseline).toEqual(snapshot.baseline);
    // Alarms start empty — they appear only as replay time passes them (behavior 3).
    expect(result.current.alarms).toHaveLength(0);
  });

  // Behavior 2 (D-03 time-progression)
  it("advances the rolling window and clamps at the end when the cursor runs out", () => {
    const { result } = renderHook(() => useReplaySocket(snapshot));

    const startNewest = newestReading(result).recordedAt;
    expect(result.current.readings).toHaveLength(MAX_POINTS);

    // Advance a little: the window holds at MAX_POINTS (never grows past it) and
    // the newest reading moves forward in time (the cursor is advancing).
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.readings.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(result.current.readings).toHaveLength(MAX_POINTS);
    expect(epoch(newestReading(result).recordedAt)).toBeGreaterThan(epoch(startNewest));

    // Drive to the very end; the window is still capped throughout.
    advanceToEnd(result, () => {
      expect(result.current.readings.length).toBeLessThanOrEqual(MAX_POINTS);
    });
    expect(newestReading(result).recordedAt).toBe(lastRecordedAt);

    // The interval stopped: extra time does not push past the last reading.
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(newestReading(result).recordedAt).toBe(lastRecordedAt);
    expect(result.current.readings).toHaveLength(MAX_POINTS);
  });

  // Behavior 3 (D-03 alarms appear in time order)
  it("surfaces each alarm only once replay time passes its firstOccurredAt", () => {
    const { result } = renderHook(() => useReplaySocket(snapshot));

    // Invariant: an alarm is present IFF its firstOccurredAt <= newest reading epoch.
    const checkInvariant = () => {
      const cur = newestEpoch(result);
      for (const a of alarms) {
        const present = result.current.alarms.some((x) => x.id === a.id);
        expect(present).toBe(epoch(a.firstOccurredAt) <= cur);
      }
    };

    expect(result.current.alarms).toHaveLength(0); // none at the seed
    checkInvariant();

    // Track that we observe a genuine intermediate state (earliest alarm present
    // while a later one is still absent) — proves NOT all-at-once exposure.
    const earliest = [...alarms].sort(
      (a, b) => epoch(a.firstOccurredAt) - epoch(b.firstOccurredAt),
    )[0];
    const latest = [...alarms].sort(
      (a, b) => epoch(b.firstOccurredAt) - epoch(a.firstOccurredAt),
    )[0];
    let sawStaggered = false;

    advanceToEnd(result, () => {
      checkInvariant();
      const hasEarliest = result.current.alarms.some((x) => x.id === earliest.id);
      const hasLatest = result.current.alarms.some((x) => x.id === latest.id);
      if (hasEarliest && !hasLatest) sawStaggered = true;
    });

    expect(sawStaggered).toBe(true);
    expect(result.current.alarms).toHaveLength(alarms.length); // all present at the end
  });

  // Behavior 3b (time-based, not index-based, signal advance)
  it("never exposes a cpk/ml point later than the current reading's recordedAt", () => {
    const { result } = renderHook(() => useReplaySocket(snapshot));

    // At the SEED, before any advance: this is the index-vs-time discriminator.
    // An index-based seed (cpk.slice(0, MAX_POINTS)) exposes cpk[119], whose
    // occurredAt is one tick LATER than reading[119].recordedAt (cpk drops the
    // first NaN point) — which would violate this and must fail.
    expect(maxExposedSignalEpoch(result)).toBeLessThanOrEqual(newestEpoch(result));

    advanceToEnd(result, () => {
      expect(maxExposedSignalEpoch(result)).toBeLessThanOrEqual(newestEpoch(result));
    });
  });

  // Behavior 4 (D-04 no backend)
  it("never calls fetch or opens a WebSocket on the replay path", () => {
    const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>;
    const wsSpy = WebSocket as unknown as ReturnType<typeof vi.fn>;

    const { result } = renderHook(() => useReplaySocket(snapshot));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // ackResolve must also stay offline (no PATCH).
    act(() => {
      void result.current.ackResolve(1, "acknowledged");
    });

    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(wsSpy).toHaveBeenCalledTimes(0);
  });
});
