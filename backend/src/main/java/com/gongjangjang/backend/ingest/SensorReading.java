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
        long publishedAtMs) {
}
