package com.gongjangjang.backend.ingest;

import java.time.Instant;

/**
 * Shared payload contract (D-04) across simulator -> MQTT -> Spring -> WS frame.
 *
 * <p>{@code publishedAtMs} is the publisher's send-time epoch millis and MUST be
 * carried through to the WebSocket frame unchanged (it is NOT persisted) — it is
 * the premise for the 01-03 end-to-end latency measurement.
 */
public record SensorReading(
        String deviceId,
        String metric,
        double value,
        Instant recordedAt,
        long publishedAtMs,
        double[] features) {

    /**
     * Backward-compatible 5-arg constructor for call sites that carry no feature
     * vector (DB row mapper, WS-only readings, existing tests). Delegates to the
     * canonical 6-arg constructor with {@code features = null}.
     *
     * <p>The optional {@code features} array {@code [rms, kurtosis, crest]} is present
     * only in nasa-mode payloads and is null otherwise; {@code value} stays = rms.
     */
    public SensorReading(String deviceId, String metric, double value, Instant recordedAt, long publishedAtMs) {
        this(deviceId, metric, value, recordedAt, publishedAtMs, null);
    }
}
