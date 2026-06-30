import { describe, it, expect } from "vitest";
// RED (Task 2, plan 03-00): failing tests for NasaReplaySource before impl.
//
// Constructor signature committed to (inferred from 03-RESEARCH Pattern 1):
//   new NasaReplaySource(rows: FeatureRow[], metricCol: string)
// where FeatureRow = { snapshot_index: number; recorded_at: string;
//                      rms: number; kurtosis: number; crest: number }.
// The source depends ONLY on an injected row array + a target metric column
// name — csv loading happens later in fleet/index, keeping this test file-free.
// GREEN must follow this signature.
import { NasaReplaySource } from "./NasaReplaySource.js";

interface FeatureRow {
  snapshot_index: number;
  recorded_at: string;
  rms: number;
  kurtosis: number;
  crest: number;
}

const rows: FeatureRow[] = [
  { snapshot_index: 0, recorded_at: "2004-02-12T10:32:39Z", rms: 0.1, kurtosis: 3.0, crest: 1.4 },
  { snapshot_index: 1, recorded_at: "2004-02-12T10:42:39Z", rms: 0.2, kurtosis: 3.1, crest: 1.5 },
  { snapshot_index: 2, recorded_at: "2004-02-12T10:52:39Z", rms: 0.5, kurtosis: 4.0, crest: 2.0 },
];

describe("NasaReplaySource", () => {
  it("emits rows in order, each Sample.value = that row's metric column", () => {
    const src = new NasaReplaySource(rows, "rms");
    expect(src.next("device-001", "rms").value).toBe(0.1);
    expect(src.next("device-001", "rms").value).toBe(0.2);
    expect(src.next("device-001", "rms").value).toBe(0.5);
  });

  it("clamps to the last row after the end (no wrap, no throw)", () => {
    const src = new NasaReplaySource(rows, "rms");
    src.next("device-001", "rms"); // 0.1
    src.next("device-001", "rms"); // 0.2
    src.next("device-001", "rms"); // 0.5 (last)
    expect(src.next("device-001", "rms").value).toBe(0.5);
    expect(src.next("device-001", "rms").value).toBe(0.5);
  });

  it("carries the full feature vector [rms, kurtosis, crest] per row", () => {
    const src = new NasaReplaySource(rows, "rms");
    expect(src.next("device-001", "rms").features).toEqual([0.1, 3.0, 1.4]);
    expect(src.next("device-001", "rms").features).toEqual([0.2, 3.1, 1.5]);
    expect(src.next("device-001", "rms").features).toEqual([0.5, 4.0, 2.0]);
  });

  it("clamps the feature vector to the last row after the end", () => {
    const src = new NasaReplaySource(rows, "rms");
    src.next("device-001", "rms"); // row 0
    src.next("device-001", "rms"); // row 1
    src.next("device-001", "rms"); // row 2 (last)
    expect(src.next("device-001", "rms").features).toEqual([0.5, 4.0, 2.0]);
    expect(src.next("device-001", "rms").features).toEqual([0.5, 4.0, 2.0]);
  });

  it("maps Sample.recordedAt to the row's original recorded_at timestamp", () => {
    const src = new NasaReplaySource(rows, "rms");
    expect(src.next("device-001", "rms").recordedAt).toBe("2004-02-12T10:32:39Z");
    expect(src.next("device-001", "rms").recordedAt).toBe("2004-02-12T10:42:39Z");
    expect(src.next("device-001", "rms").recordedAt).toBe("2004-02-12T10:52:39Z");
  });
});
