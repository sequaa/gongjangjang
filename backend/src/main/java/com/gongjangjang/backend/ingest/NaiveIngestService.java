package com.gongjangjang.backend.ingest;

import com.gongjangjang.backend.persistence.NaiveSensorReadingRepository;
import com.gongjangjang.backend.websocket.SensorWebSocketHandler;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * The single inbound consumer (D-05/D-06). For each reading it does two things
 * from the same in-memory message: persist it naively, then broadcast it.
 *
 * <p>This runs synchronously on the MQTT callback thread on purpose — the
 * single-threaded, single-INSERT path IS the naive baseline. Do NOT add
 * {@code @Async}/thread pools here; that is a Phase 2 lever, not a Phase 1 fix.
 *
 * <p>Active only when {@code ingest.mode=naive}; batch mode is the default.
 */
@Service
@ConditionalOnProperty(name = "ingest.mode", havingValue = "naive")
public class NaiveIngestService implements SensorIngestPort {

    private final NaiveSensorReadingRepository repository;
    private final SensorWebSocketHandler broadcaster;

    public NaiveIngestService(
            NaiveSensorReadingRepository repository, SensorWebSocketHandler broadcaster) {
        this.repository = repository;
        this.broadcaster = broadcaster;
    }

    @Override
    public void onReading(SensorReading reading) {
        repository.insert(reading);
        broadcaster.broadcast(reading);
    }
}
