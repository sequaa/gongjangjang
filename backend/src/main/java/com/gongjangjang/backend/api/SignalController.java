package com.gongjangjang.backend.api;

import com.gongjangjang.backend.persistence.SignalEvent;
import com.gongjangjang.backend.persistence.SignalEventRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only signal-trajectory surface (03-02 Task 3 / 03-04 overlay). Returns the
 * {@code signal_events} time series for one detector.
 *
 * <p>{@code detector} is whitelisted (only the known detectors are accepted;
 * anything else is a 400) and {@code from}/{@code to} are bound as parameterized
 * timestamps by the repository — never concatenated (threat T-03-02-01).
 */
@RestController
public class SignalController {

    /** Only detectors the system actually writes — reject anything else. */
    private static final Set<String> ALLOWED_DETECTORS = Set.of("spc", "threshold", "ml");

    private final SignalEventRepository signals;

    public SignalController(SignalEventRepository signals) {
        this.signals = signals;
    }

    /**
     * @param detector required; must be one of {@code spc|threshold|ml} (else 400).
     * @param metric   optional; when absent all metrics for the detector return.
     * @param from     optional ISO-8601 instant; defaults to 24h ago.
     * @param to       optional ISO-8601 instant; defaults to now.
     */
    @GetMapping("/api/signals")
    public ResponseEntity<?> byDetector(
            @RequestParam String detector,
            @RequestParam(required = false) String metric,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {

        if (!ALLOWED_DETECTORS.contains(detector)) {
            return ResponseEntity.badRequest().body(Map.of("error", "unknown detector: " + detector));
        }

        final Instant fromTs;
        final Instant toTs;
        try {
            toTs = (to == null) ? Instant.now() : Instant.parse(to);
            fromTs = (from == null) ? toTs.minus(24, ChronoUnit.HOURS) : Instant.parse(from);
        } catch (java.time.format.DateTimeParseException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "malformed timestamp"));
        }

        List<SignalEvent> series = signals.findByDetector(detector, metric, fromTs, toTs);
        return ResponseEntity.ok(series);
    }
}
