package com.gongjangjang.backend.ingest;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;

import com.gongjangjang.backend.persistence.NaiveSensorReadingRepository;
import com.gongjangjang.backend.websocket.SensorWebSocketHandler;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.mockito.Mockito;

class NaiveIngestServiceTest {

    @Test
    void persistsThenBroadcastsEachReading() {
        NaiveSensorReadingRepository repo = Mockito.mock(NaiveSensorReadingRepository.class);
        SensorWebSocketHandler ws = Mockito.mock(SensorWebSocketHandler.class);
        NaiveIngestService service = new NaiveIngestService(repo, ws);

        SensorReading reading =
                new SensorReading("device-001", "temperature", 42.5, Instant.now(), 1_781_000_000_000L);

        service.onReading(reading);

        // The naive path persists, then broadcasts, the SAME in-memory reading.
        InOrder order = inOrder(repo, ws);
        order.verify(repo).insert(reading);
        order.verify(ws).broadcast(reading);
    }
}
