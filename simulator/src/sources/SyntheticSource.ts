import type { SignalSource, Sample } from "./SignalSource.js";

export interface SyntheticOptions {
  base?: number; // baseline value
  amplitude?: number; // sine swing
  noise?: number; // +/- uniform noise band
  anomaly?: boolean; // inject an offset to simulate a fault (D-01)
  anomalyMagnitude?: number;
  periodSamples?: number; // samples per sine period
}

/**
 * Synthetic normal/anomaly signal (D-01): a slow sine plus uniform noise, with
 * an optional anomaly offset injected by parameter. Deterministic enough to be
 * a believable sensor trace, cheap enough to scale to N devices later (PIPE-02).
 */
export class SyntheticSource implements SignalSource {
  private t = 0;
  private readonly opts: Required<SyntheticOptions>;

  constructor(opts: SyntheticOptions = {}) {
    this.opts = {
      base: opts.base ?? 60,
      amplitude: opts.amplitude ?? 10,
      noise: opts.noise ?? 1,
      anomaly: opts.anomaly ?? false,
      anomalyMagnitude: opts.anomalyMagnitude ?? 30,
      periodSamples: opts.periodSamples ?? 60,
    };
  }

  next(_deviceId: string, _metric: string): Sample {
    const { base, amplitude, noise, anomaly, anomalyMagnitude, periodSamples } =
      this.opts;
    this.t += 1;
    const phase = (this.t / periodSamples) * 2 * Math.PI;
    let value = base + amplitude * Math.sin(phase) + (Math.random() * 2 - 1) * noise;
    if (anomaly) value += anomalyMagnitude;
    return {
      value: Math.round(value * 1000) / 1000,
      recordedAt: new Date().toISOString(),
    };
  }
}
