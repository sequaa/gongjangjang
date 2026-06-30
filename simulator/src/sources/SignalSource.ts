// Data-source abstraction (D-02). The synthetic generator implements this now;
// a future NASA Bearing/Turbofan *replay* adapter implements the same interface
// and is swapped in without touching the publish loop. Keeping ingestion behind
// this seam is the whole point of the abstraction this phase asks for.

/** One sensor sample: the value and when it was recorded by the source. */
export interface Sample {
  value: number;
  recordedAt: string; // ISO-8601
  features?: number[]; // optional full feature vector [rms, kurtosis, crest] (nasa replay); absent for synthetic
}

/** Pluggable signal source. `next` yields the next sample for a device/metric. */
export interface SignalSource {
  next(deviceId: string, metric: string): Sample;
}

/**
 * The MQTT payload shape (D-04), shared contract across simulator, Spring, and
 * the WebSocket frame. `publishedAtMs` is stamped at publish time (not by the
 * source) and must travel unchanged to the WS frame for 01-03 latency.
 */
export interface SensorReading extends Sample {
  deviceId: string;
  metric: string;
  publishedAtMs: number; // epoch millis, set immediately before publishing
  features?: number[]; // optional [rms, kurtosis, crest]; present in nasa mode, omitted for synthetic
}
