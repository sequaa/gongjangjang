package com.gongjangjang.backend.persistence;

import java.time.Instant;

/**
 * Persisted raw signal-overlay row (D-10) from {@code signal_events}. Kept
 * separate from {@code alarms}: this is the per-point trajectory (Cpk / control
 * state) the dashboard overlay (03-04) replays, not a state-machine alarm.
 *
 * <p>{@code signalType} ∈ {@code control_limit | we_rule | cpk | anomaly_score}
 * (03-RESEARCH §"알람/신호 영속화 스키마").
 */
public record SignalEvent(
        long id,
        String deviceId,
        String metric,
        String detector,
        String signalType,
        double value,
        Instant occurredAt) {
}
