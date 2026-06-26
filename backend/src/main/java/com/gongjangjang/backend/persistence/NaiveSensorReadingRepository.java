package com.gongjangjang.backend.persistence;

import com.gongjangjang.backend.ingest.SensorReading;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Intentionally naive persistence (D-06): one blocking single-row INSERT per
 * message, no batching, no buffering, no index beyond the PK. This IS the
 * Phase 2 "before" baseline — do NOT optimize it here.
 */
@Repository
public class NaiveSensorReadingRepository {

    private final JdbcTemplate jdbcTemplate;

    public NaiveSensorReadingRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void insert(SensorReading r) {
        jdbcTemplate.update(
                "INSERT INTO sensor_readings (device_id, metric, value, recorded_at, received_at) "
                        + "VALUES (?, ?, ?, ?, ?)",
                r.deviceId(),
                r.metric(),
                r.value(),
                Timestamp.from(r.recordedAt()),
                Timestamp.from(Instant.now()));
    }

    /** Initial dashboard load reads the most recent rows once (RT-01). */
    public List<SensorReading> findRecent(int limit) {
        return jdbcTemplate.query(
                "SELECT device_id, metric, value, recorded_at FROM sensor_readings "
                        + "ORDER BY id DESC LIMIT ?",
                (rs, n) -> new SensorReading(
                        rs.getString("device_id"),
                        rs.getString("metric"),
                        rs.getDouble("value"),
                        rs.getTimestamp("recorded_at").toInstant(),
                        0L), // publishedAtMs is not persisted; irrelevant for historical load
                limit);
    }
}
