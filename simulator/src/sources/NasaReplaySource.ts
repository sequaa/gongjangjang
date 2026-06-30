import type { SignalSource, Sample } from "./SignalSource.js";

export interface FeatureRow {
  snapshot_index: number;
  recorded_at: string;
  rms: number;
  kurtosis: number;
  crest: number;
}

export class NasaReplaySource implements SignalSource {
  private index = 0;

  constructor(
    private readonly rows: FeatureRow[],
    private readonly metricCol: keyof FeatureRow,
  ) {}

  next(_deviceId: string, _metric: string): Sample {
    const row = this.rows[this.index];
    if (this.index < this.rows.length - 1) {
      this.index += 1;
    }
    return {
      value: row[this.metricCol] as number,
      recordedAt: row.recorded_at,
      features: [row.rms, row.kurtosis, row.crest],
    };
  }
}
