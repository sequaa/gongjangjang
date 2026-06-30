package com.gongjangjang.backend.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * JdbcTemplate-backed persistence for {@code signal_events} (D-10). Mirrors the
 * Phase-2/3 repo style (statement-level autocommit, fully parameterized — no
 * string concatenation of caller input, threat T-03-02-01).
 *
 * <p>Write path: the SPC trajectory (Cpk + control-limit position) tapped off the
 * signal consumer. Read path: {@link #findByDetector} feeds the 03-04 overlay.
 */
@Repository
public class SignalEventRepository {

    private static final RowMapper<SignalEvent> ROW_MAPPER = (rs, n) -> new SignalEvent(
            rs.getLong("id"),
            rs.getString("device_id"),
            rs.getString("metric"),
            rs.getString("detector"),
            rs.getString("signal_type"),
            rs.getDouble("value"),
            rs.getTimestamp("occurred_at").toInstant());

    private final JdbcTemplate jdbcTemplate;

    public SignalEventRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** Appends a single signal-trajectory point. All inputs bound as parameters. */
    public void insert(
            String deviceId,
            String metric,
            String detector,
            String signalType,
            double value,
            Instant occurredAt) {
        jdbcTemplate.update(
                "INSERT INTO signal_events (device_id, metric, detector, signal_type, value, occurred_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                deviceId,
                metric,
                detector,
                signalType,
                value,
                Timestamp.from(occurredAt));
    }

    /**
     * Time series for one detector, ordered by {@code occurred_at} (overlay replay,
     * 03-04). {@code metric} is optional: when {@code null} all metrics for the
     * detector are returned. The metric filter, when present, is a bound parameter
     * (no concatenation — T-03-02-01).
     */
    public List<SignalEvent> findByDetector(
            String detector, String metric, Instant from, Instant to) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM signal_events WHERE detector = ? "
                        + "AND occurred_at >= ? AND occurred_at <= ?");
        List<Object> args = new ArrayList<>();
        args.add(detector);
        args.add(Timestamp.from(from));
        args.add(Timestamp.from(to));
        if (metric != null) {
            sql.append(" AND metric = ?");
            args.add(metric);
        }
        sql.append(" ORDER BY occurred_at ASC");
        return jdbcTemplate.query(sql.toString(), ROW_MAPPER, args.toArray());
    }
}
