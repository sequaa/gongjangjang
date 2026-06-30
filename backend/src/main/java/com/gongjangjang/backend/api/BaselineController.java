package com.gongjangjang.backend.api;

import com.gongjangjang.backend.signal.FrozenBaseline;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only frozen-baseline endpoint (D-11). The chart overlays must use these
 * limits as a SINGLE SOURCE OF TRUTH — the frontend never computes limits itself.
 *
 * <p>Exposes threshold min/max now (Task 03-01); ucl/lcl/usl/lsl/mu/sigma are
 * included so the 03-02 (control limits) and 03-03 (anomaly) overlays reuse the
 * same endpoint without a backend change.
 */
@RestController
public class BaselineController {

    private final FrozenBaseline baseline;

    public BaselineController(FrozenBaseline baseline) {
        this.baseline = baseline;
    }

    @GetMapping("/api/baseline")
    public Map<String, Double> baseline() {
        return Map.of(
                "thresholdMin", baseline.thresholdMin(),
                "thresholdMax", baseline.thresholdMax(),
                "ucl", baseline.ucl(),
                "lcl", baseline.lcl(),
                "usl", baseline.usl(),
                "lsl", baseline.lsl(),
                "mu", baseline.mu(),
                "sigma", baseline.sigma());
    }
}
