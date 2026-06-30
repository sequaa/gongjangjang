package com.gongjangjang.backend.signal;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * JdbcTemplate-backed alarm persistence (mirrors the Phase-2 repo style). All
 * statements run with statement-level autocommit — no surrounding transaction —
 * so a freshly inserted alarm is immediately visible to a subsequent
 * {@link #findOpenAlarm} on the same single consumer thread (intra-batch dedup).
 */
@Repository
public class AlarmRepository {

    private static final RowMapper<Alarm> ROW_MAPPER = (rs, n) -> new Alarm(
            rs.getLong("id"),
            rs.getString("device_id"),
            rs.getString("metric"),
            rs.getString("detector"),
            rs.getString("rule"),
            rs.getString("severity"),
            rs.getDouble("value"),
            AlarmState.fromToken(rs.getString("state")),
            toInstant(rs.getTimestamp("first_occurred_at")),
            toInstant(rs.getTimestamp("acknowledged_at")),
            toInstant(rs.getTimestamp("resolved_at")),
            toInstant(rs.getTimestamp("created_at")));

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    private final JdbcTemplate jdbcTemplate;

    public AlarmRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Inserts a new alarm in state {@code created} and returns the full row
     * (RETURNING *) so the caller can push it over WebSocket without a re-read.
     * {@code firstOccurredAt} is the violation reading's recordedAt (D-04 anchor).
     */
    public Alarm insert(
            String deviceId,
            String metric,
            String detector,
            String rule,
            String severity,
            double value,
            Instant firstOccurredAt) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO alarms (device_id, metric, detector, rule, severity, value, state, first_occurred_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 'created', ?) RETURNING *",
                ROW_MAPPER,
                deviceId,
                metric,
                detector,
                rule,
                severity,
                value,
                Timestamp.from(firstOccurredAt));
    }

    /** Most recent alarms first (panel initial load). */
    public List<Alarm> findRecent(int limit) {
        return jdbcTemplate.query(
                "SELECT * FROM alarms ORDER BY id DESC LIMIT ?",
                ROW_MAPPER,
                limit);
    }

    /** Single alarm by id, or {@code null} when no such row (caller maps to 404). */
    public Alarm findById(long id) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT * FROM alarms WHERE id = ?",
                    ROW_MAPPER,
                    id);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    /**
     * Open = state != 'resolved'. Returns the open alarm for the
     * (device, metric, detector) triple if one exists, else {@code null}. Used for
     * dedup: suppress a new row while a prior violation is still unresolved.
     */
    public Alarm findOpenAlarm(String deviceId, String metric, String detector) {
        List<Alarm> open = jdbcTemplate.query(
                "SELECT * FROM alarms WHERE device_id = ? AND metric = ? AND detector = ? "
                        + "AND state <> 'resolved' ORDER BY id DESC LIMIT 1",
                ROW_MAPPER,
                deviceId,
                metric,
                detector);
        return open.isEmpty() ? null : open.get(0);
    }

    /**
     * Transitions an alarm to {@code newState}, stamping acknowledged_at /
     * resolved_at as appropriate. Returns the updated row.
     */
    public Alarm updateState(long id, AlarmState newState, Instant ts) {
        Timestamp stamp = Timestamp.from(ts);
        return jdbcTemplate.queryForObject(
                "UPDATE alarms SET state = ?, "
                        + "acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END, "
                        + "resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_at END "
                        + "WHERE id = ? RETURNING *",
                ROW_MAPPER,
                newState.token(),
                newState.token(),
                stamp,
                newState.token(),
                stamp,
                id);
    }
}
