package com.gongjangjang.backend.persistence;

import com.gongjangjang.backend.ingest.SensorReading;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BatchSensorReadingRepository {

    private final JdbcTemplate jdbcTemplate;

    public BatchSensorReadingRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void batchInsert(List<SensorReading> readings) {
        jdbcTemplate.batchUpdate(
                "INSERT INTO sensor_readings (device_id, metric, value, recorded_at, received_at) VALUES (?, ?, ?, ?, ?)",
                readings,
                readings.size(),
                (ps, r) -> {
                    ps.setString(1, r.deviceId());
                    ps.setString(2, r.metric());
                    ps.setDouble(3, r.value());
                    ps.setTimestamp(4, Timestamp.from(r.recordedAt()));
                    ps.setTimestamp(5, Timestamp.from(Instant.now()));
                });
    }
}
