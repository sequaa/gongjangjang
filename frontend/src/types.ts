// Shared payload contract (D-04), mirrored from the backend SensorReading.
export interface SensorReading {
  deviceId: string;
  metric: string;
  value: number;
  recordedAt: string;
  publishedAtMs: number;
}
