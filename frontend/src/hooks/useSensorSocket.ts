import { useEffect, useRef, useState } from "react";
import { BACKEND_HTTP, WS_URL } from "../config";
import type { Alarm, AlarmState, Baseline, MlSignal, SensorReading, SpcSignal } from "../types";
import { upsertDevice, deviceList, type DeviceSnapshot } from "../deviceState";
import { authFetch } from "../auth";

const MAX_POINTS = 120;
const ALARM_LIMIT = 50;

export interface SocketState {
  readings: SensorReading[];
  devices: DeviceSnapshot[];
  alarms: Alarm[];
  /** Rolling SPC Cpk trajectory (oldest→newest) — descends as quality degrades. */
  spcCpk: SpcSignal[];
  /** Rolling ML anomaly_score trajectory (oldest→newest) — rises as readings drift. */
  mlScore: MlSignal[];
  baseline: Baseline | null;
  connected: boolean;
  /** PATCH an alarm's state then sync the local list. */
  ackResolve: (id: number, state: AlarmState) => Promise<void>;
}

/** Lowercase the alarm `state` so REST (enum NAME) and WS (token) agree. */
function normalizeAlarm(raw: Alarm): Alarm {
  return { ...raw, state: String(raw.state).toLowerCase() as AlarmState };
}

/** Prepend a freshly-pushed alarm, replacing any existing row with the same id. */
function mergeAlarm(prev: Alarm[], incoming: Alarm): Alarm[] {
  const without = prev.filter((a) => a.id !== incoming.id);
  return [incoming, ...without];
}

/**
 * Connects to the native WebSocket (RT-01), keeps a rolling window of readings,
 * and reconnects on drop. Seeds the window with one initial DB read on mount.
 *
 * <p>Alarms ride the SAME socket: frames with {@code type === "alarm"} are routed
 * to a separate {@code alarms[]} (newest-first), seeded once from GET /api/alarms.
 * No polling (D-11②) — push-arrival plus the one-time seed only.
 */
export function useSensorSocket(): SocketState {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [deviceMap, setDeviceMap] = useState<Record<string, DeviceSnapshot>>({});
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [spcCpk, setSpcCpk] = useState<SpcSignal[]>([]);
  const [mlScore, setMlScore] = useState<MlSignal[]>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUs = useRef(false);

  // Initial load: one DB read (RT-01), seeds both the chart and per-device state.
  useEffect(() => {
    authFetch(`${BACKEND_HTTP}/api/readings?limit=${MAX_POINTS}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SensorReading[]) => {
        const ordered = rows.slice().reverse();
        setReadings(ordered);
        setDeviceMap((prev) => ordered.reduce(upsertDevice, prev));
      })
      .catch(() => {
        /* backend not ready yet — the live socket will fill in */
      });
  }, []);

  // One-time alarm seed (newest-first already from findRecent — do NOT reverse).
  useEffect(() => {
    authFetch(`${BACKEND_HTTP}/api/alarms?limit=${ALARM_LIMIT}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Alarm[]) => setAlarms(rows.map(normalizeAlarm)))
      .catch(() => {
        /* seed is best-effort; live alarm frames will fill in */
      });
  }, []);

  // One-time SPC Cpk seed so the trajectory has history before the first WS push.
  // The endpoint has no signalType filter — pull the spc series and keep the cpk
  // points (ASC from findByDetector). Live cpk points then arrive via WS push.
  useEffect(() => {
    authFetch(`${BACKEND_HTTP}/api/signals?detector=spc`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SpcSignal[]) => {
        const cpk = rows.filter((s) => s.signalType === "cpk").slice(-MAX_POINTS);
        setSpcCpk(cpk);
      })
      .catch(() => {
        /* seed is best-effort; live signal frames will fill in */
      });
  }, []);

  // One-time ML anomaly_score seed so the trajectory has history before the first
  // WS push. Mirror the SPC seed: pull the ml series and keep the anomaly_score
  // points. Live anomaly_score points then arrive via WS push (no polling).
  useEffect(() => {
    authFetch(`${BACKEND_HTTP}/api/signals?detector=ml`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: MlSignal[]) => {
        const scores = rows
          .filter((s) => s.signalType === "anomaly_score")
          .slice(-MAX_POINTS);
        setMlScore(scores);
      })
      .catch(() => {
        /* seed is best-effort; live signal frames will fill in */
      });
  }, []);

  // One-time baseline fetch: the chart's frozen limits (single source of truth).
  useEffect(() => {
    authFetch(`${BACKEND_HTTP}/api/baseline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Baseline | null) => setBaseline(b))
      .catch(() => {
        /* no baseline → chart simply omits the threshold lines */
      });
  }, []);

  useEffect(() => {
    closedByUs.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data);
          if (frame?.type === "alarm") {
            const alarm = normalizeAlarm(frame as Alarm);
            setAlarms((prev) => mergeAlarm(prev, alarm).slice(0, ALARM_LIMIT));
          } else if (frame?.type === "signal") {
            // Signal trajectory push (D-11② — live, no polling). Two detectors
            // ride this branch: SPC cpk (descending curve) and ML anomaly_score
            // (rising curve). control_limit frames are ignored because UCL/LCL are
            // frozen from GET /api/baseline, not the stream.
            if (frame.detector === "ml" && frame.signalType === "anomaly_score") {
              const sig = frame as MlSignal;
              setMlScore((prev) => [...prev, sig].slice(-MAX_POINTS));
            } else if (frame.signalType === "cpk") {
              const sig = frame as SpcSignal;
              setSpcCpk((prev) => [...prev, sig].slice(-MAX_POINTS));
            }
          } else {
            const reading = frame as SensorReading;
            setReadings((prev) => [...prev, reading].slice(-MAX_POINTS));
            setDeviceMap((prev) => upsertDevice(prev, reading));
          }
        } catch {
          /* ignore non-JSON frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUs.current) reconnectTimer = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByUs.current = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const ackResolve = async (id: number, state: AlarmState): Promise<void> => {
    const res = await authFetch(`${BACKEND_HTTP}/api/alarms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) return;
    const updated = normalizeAlarm((await res.json()) as Alarm);
    setAlarms((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return {
    readings,
    devices: deviceList(deviceMap),
    alarms,
    spcCpk,
    mlScore,
    baseline,
    connected,
    ackResolve,
  };
}
