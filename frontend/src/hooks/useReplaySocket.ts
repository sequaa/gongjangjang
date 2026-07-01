import { useEffect, useRef, useState } from "react";
import type { Alarm, DemoSnapshot, MlSignal, SensorReading, SpcSignal } from "../types";
import { upsertDevice, deviceList, type DeviceSnapshot } from "../deviceState";
import type { SocketState } from "./useSensorSocket";

const MAX_POINTS = 120;

const epoch = (iso: string) => new Date(iso).getTime();

/**
 * Client-side replay hook — drives chart state from a bundled snapshot.json
 * without any fetch or WebSocket (D-04). Returns the same SocketState shape
 * as useSensorSocket so App.tsx can switch between them with one ternary.
 *
 * Seeding uses time-based filtering (occurredAt ≤ newest seeded reading's
 * recordedAt) rather than raw index slicing, because spcCpk omits the initial
 * NaN point and is one element shorter than readings — index-based seeding
 * would expose a cpk point whose occurredAt is one tick AFTER the newest
 * seeded reading, violating the time-invariant checked by behavior 3b.
 */
export function useReplaySocket(snapshot: DemoSnapshot): SocketState {
  const seedCount = Math.min(MAX_POINTS, snapshot.readings.length);
  const seedReadings = snapshot.readings.slice(0, seedCount);
  const seedNewestEpoch =
    seedCount > 0 ? epoch(seedReadings[seedCount - 1].recordedAt) : -Infinity;

  const [readings, setReadings] = useState<SensorReading[]>(seedReadings);
  const [deviceMap, setDeviceMap] = useState<Record<string, DeviceSnapshot>>(
    () =>
      seedReadings.reduce(
        upsertDevice,
        {} as Record<string, DeviceSnapshot>,
      ),
  );
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [spcCpk, setSpcCpk] = useState<SpcSignal[]>(() =>
    snapshot.spcCpk
      .filter((s) => epoch(s.occurredAt) <= seedNewestEpoch)
      .slice(-MAX_POINTS),
  );
  const [mlScore, setMlScore] = useState<MlSignal[]>(() =>
    snapshot.mlScore
      .filter((s) => epoch(s.occurredAt) <= seedNewestEpoch)
      .slice(-MAX_POINTS),
  );

  const cursorRef = useRef(seedCount);

  useEffect(() => {
    const allReadings = snapshot.readings;

    const id = setInterval(() => {
      const cursor = cursorRef.current;
      if (cursor >= allReadings.length) {
        clearInterval(id);
        return;
      }

      const next = allReadings[cursor];
      cursorRef.current = cursor + 1;
      const currentEpoch = epoch(next.recordedAt);

      setReadings((prev) => [...prev, next].slice(-MAX_POINTS));
      setDeviceMap((prev) => upsertDevice(prev, next));
      setSpcCpk(
        snapshot.spcCpk
          .filter((s) => epoch(s.occurredAt) <= currentEpoch)
          .slice(-MAX_POINTS),
      );
      setMlScore(
        snapshot.mlScore
          .filter((s) => epoch(s.occurredAt) <= currentEpoch)
          .slice(-MAX_POINTS),
      );
      setAlarms(
        snapshot.alarms.filter(
          (a) => epoch(a.firstOccurredAt) <= currentEpoch,
        ),
      );

      if (cursorRef.current >= allReadings.length) {
        clearInterval(id);
      }
    }, 100);

    return () => clearInterval(id);
  }, [snapshot]);

  return {
    readings,
    devices: deviceList(deviceMap),
    alarms,
    spcCpk,
    mlScore,
    baseline: snapshot.baseline,
    connected: true,
    // No-op: demo has no backend to PATCH (D-04).
    ackResolve: async () => {},
  };
}
