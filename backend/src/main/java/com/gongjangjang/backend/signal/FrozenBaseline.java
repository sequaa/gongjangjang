package com.gongjangjang.backend.signal;

import java.nio.file.Path;
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

    // ── JSON deserialization helpers ──────────────────────────────────────────

    private static class Payload {
        public ThresholdNode threshold;
        public ControlLimitsNode control_limits;
        public SpecLimitsNode spec_limits;
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
