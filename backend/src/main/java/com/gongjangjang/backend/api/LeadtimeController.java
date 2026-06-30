package com.gongjangjang.backend.api;

import com.gongjangjang.backend.signal.AlarmRepository;
import com.gongjangjang.backend.signal.AlarmRepository.DetectorFirst;
import com.gongjangjang.backend.signal.FrozenBaseline;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * D-04 headline: per-detector lead time before the frozen end-of-life anchor.
 *
 * <p>Read-only. The data source is a DB aggregate ({@code MIN(first_occurred_at)}
 * per detector over the full alarm history) — NOT the live 120-point WS overlay
 * (RESEARCH Pitfall 5). {@code lead_time = failureTime − first_occurred_at}, where
 * {@code failureTime} is the frozen end-of-life anchor. NASA timestamps are zoneless
 * and interpreted as UTC (see {@link FrozenBaseline}); that offset cancels in
 * detector-vs-detector ranking, so the comparative headline is robust. The ABSOLUTE
 * lead-time also depends on the ingest path's clock handling, not verified here.
 *
 * <p>{@code device}/{@code metric} are bound as query parameters and passed
 * straight to the parameterized repository query — never concatenated
 * (threat T-03-04-01).
 */
@RestController
public class LeadtimeController {

    private final AlarmRepository alarms;
    private final FrozenBaseline baseline;

    public LeadtimeController(AlarmRepository alarms, FrozenBaseline baseline) {
        this.alarms = alarms;
        this.baseline = baseline;
    }

    /** One detector's lead-time row. {@code leadTimeSeconds} = failureTime − first. */
    public record LeadtimeRow(String detector, Instant firstOccurredAt, long leadTimeSeconds) {}

    /** Full response: the reference anchor plus one row per detector (earliest first). */
    public record LeadtimeResponse(String device, String metric, Instant failureTime, List<LeadtimeRow> rows) {}

    /**
     * @param device required-with-default (NASA bearing replay device).
     * @param metric required-with-default (the run-to-failure RMS channel).
     * @return 200 with the anchor and per-detector rows; an empty {@code rows}
     *     list when no alarms exist yet for the pair (needs a pipeline run) —
     *     never a 500.
     */
    @GetMapping("/api/leadtime")
    public LeadtimeResponse leadtime(
            @RequestParam(defaultValue = "device-001") String device,
            @RequestParam(defaultValue = "rms") String metric) {

        Instant failureTime = baseline.failureTime();
        List<DetectorFirst> firsts = alarms.firstOccurrenceByDetector(device, metric);

        List<LeadtimeRow> rows = firsts.stream()
                .map(f -> new LeadtimeRow(
                        f.detector(),
                        f.first(),
                        Duration.between(f.first(), failureTime).getSeconds()))
                .toList();

        return new LeadtimeResponse(device, metric, failureTime, rows);
    }
}
