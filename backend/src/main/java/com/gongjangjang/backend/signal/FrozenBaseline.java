package com.gongjangjang.backend.signal;

import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import tools.jackson.databind.ObjectMapper;

/**
 * Loads and exposes the frozen statistical baseline from a JSON asset exactly once.
 *
 * <p>Constructed POJO-style for tests ({@code new FrozenBaseline(path)}) and exposed
 * as a Spring bean via {@link SignalConfig} for runtime use.
 *
 * <p>JSON structure consumed:
 * <pre>
 * {
 *   "threshold":      { "min": …, "max": … },
 *   "control_limits": { "ucl": …, "lcl": …, "mu": …, "sigma": … },
 *   "spec_limits":    { "usl": …, "lsl": … }
 * }
 * </pre>
 */
public class FrozenBaseline {

    private final double thresholdMin;
    private final double thresholdMax;
    private final double ucl;
    private final double lcl;
    private final double usl;
    private final double lsl;
    private final double mu;
    private final double sigma;
    private final Instant failureTime;

    public FrozenBaseline(Path path) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            Payload payload = mapper.readValue(path.toFile(), Payload.class);
            this.thresholdMin = payload.threshold.min;
            this.thresholdMax = payload.threshold.max;
            this.ucl = payload.control_limits.ucl;
            this.lcl = payload.control_limits.lcl;
            this.usl = payload.spec_limits.usl;
            this.lsl = payload.spec_limits.lsl;
            this.mu = payload.control_limits.mu;
            this.sigma = payload.control_limits.sigma;
            // failure_time is the NASA run-to-failure end-of-life anchor (D-07) and the
            // D-04 lead-time reference. The NASA timestamps are ZONELESS ISO strings
            // (features.csv: "2004-02-19T06:22:39", no offset). We INTERPRET them as UTC
            // and parse failure_time identically (LocalDateTime -> Instant at UTC), so
            // lead_time = failureTime - first_occurred_at is computed on one clock.
            // NOTE: this choice cancels in detector-vs-detector ranking (every detector's
            // first_occurred_at shares the same offset), so the comparative headline is
            // invariant. The ABSOLUTE lead-time additionally depends on how the ingest
            // path puts recordedAt onto the clock when persisting first_occurred_at —
            // NOT verified here (the raw replay string is zoneless; only a simulator test
            // fixture carries a Z). Treat the absolute number as assumption-bound.
            this.failureTime = LocalDateTime.parse(payload.failure_time).toInstant(ZoneOffset.UTC);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load frozen baseline from: " + path, e);
        }
    }

    public double thresholdMin() { return thresholdMin; }
    public double thresholdMax() { return thresholdMax; }
    public double ucl()          { return ucl; }
    public double lcl()          { return lcl; }
    public double usl()          { return usl; }
    public double lsl()          { return lsl; }
    public double mu()           { return mu; }
    public double sigma()        { return sigma; }

    /** End-of-life anchor (D-07), UTC. Reference point for D-04 lead-time. */
    public Instant failureTime() { return failureTime; }

    // ── JSON deserialization helpers ──────────────────────────────────────────

    private static class Payload {
        public ThresholdNode threshold;
        public ControlLimitsNode control_limits;
        public SpecLimitsNode spec_limits;
        public String failure_time;
    }

    private static class ThresholdNode {
        public double min;
        public double max;
    }

    private static class ControlLimitsNode {
        public double ucl;
        public double lcl;
        public double mu;
        public double sigma;
    }

    private static class SpecLimitsNode {
        public double usl;
        public double lsl;
    }
}
