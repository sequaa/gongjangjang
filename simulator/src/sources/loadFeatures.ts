import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FeatureRow } from "./NasaReplaySource.js";

/**
 * Loads the NASA bearing feature replay CSV (snapshot_index,recorded_at,rms,
 * kurtosis,crest) into parsed FeatureRow[] ONCE at startup. Numeric columns are
 * Number()-parsed; recorded_at stays the source ISO string. Path is resolved
 * relative to this module (repo-root `data/nasa/`), so it is cwd-independent —
 * works run from repo root or from simulator/.
 */
export function loadFeatures(csvPath?: string): FeatureRow[] {
  const here = dirname(fileURLToPath(import.meta.url)); // simulator/src/sources
  const path = csvPath ?? resolve(here, "../../../data/nasa/features.csv");
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [, ...dataLines] = lines; // drop header
  return dataLines.map((line) => {
    const [snapshot_index, recorded_at, rms, kurtosis, crest] = line.split(",");
    return {
      snapshot_index: Number(snapshot_index),
      recorded_at,
      rms: Number(rms),
      kurtosis: Number(kurtosis),
      crest: Number(crest),
    };
  });
}
