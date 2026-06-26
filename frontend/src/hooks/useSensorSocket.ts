import { useEffect, useRef, useState } from "react";
import { BACKEND_HTTP, WS_URL } from "../config";
import type { SensorReading } from "../types";
import { upsertDevice, deviceList, type DeviceSnapshot } from "../deviceState";

const MAX_POINTS = 120;

export interface SocketState {
  readings: SensorReading[];
  devices: DeviceSnapshot[];
  connected: boolean;
}

/**
 * Connects to the native WebSocket (RT-01), keeps a rolling window of readings,
 * and reconnects on drop. Seeds the window with one initial DB read on mount.
 */
export function useSensorSocket(): SocketState {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [deviceMap, setDeviceMap] = useState<Record<string, DeviceSnapshot>>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUs = useRef(false);

  // Initial load: one DB read (RT-01), seeds both the chart and per-device state.
  useEffect(() => {
    fetch(`${BACKEND_HTTP}/api/readings?limit=${MAX_POINTS}`)
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

  useEffect(() => {
    closedByUs.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const reading: SensorReading = JSON.parse(ev.data);
          setReadings((prev) => [...prev, reading].slice(-MAX_POINTS));
          setDeviceMap((prev) => upsertDevice(prev, reading));
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

  return { readings, devices: deviceList(deviceMap), connected };
}
