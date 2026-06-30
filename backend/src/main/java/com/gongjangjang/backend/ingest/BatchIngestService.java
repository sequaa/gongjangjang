package com.gongjangjang.backend.ingest;

import com.gongjangjang.backend.signal.SignalEvaluationConsumer;
import com.gongjangjang.backend.websocket.SensorWebSocketHandler;
import java.util.concurrent.LinkedBlockingDeque;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Service;

/**
 * Batch ingestion path (PIPE-04). On each received reading:
 * 1. Broadcasts immediately (WebSocket latency decoupled from flush T).
 * 2. Offers to the bounded buffer; if full, skips ack so the broker re-delivers
 *    (natural backpressure — D-01).
 *
 * <p>Does NOT implement SensorIngestPort — ack cannot be carried through that
 * interface. The ack is captured at the MQTT handler layer (Task 3).
 */
@Service
@ConditionalOnProperty(name = "ingest.mode", havingValue = "batch", matchIfMissing = true)
public class BatchIngestService {

    /**
     * Shared bounded buffer bean. Both BatchIngestService (producer) and
     * BatchFlushWorker (consumer) receive this same instance by type.
     */
    @Configuration
    static class BufferConfig {
        @Bean
        @ConditionalOnProperty(name = "ingest.mode", havingValue = "batch", matchIfMissing = true)
        public LinkedBlockingDeque<MessageAckPair> messageBuffer() {
            return new LinkedBlockingDeque<>(50000);
        }
    }

    private final SensorWebSocketHandler broadcaster;
    private final LinkedBlockingDeque<MessageAckPair> buffer;
    private final SignalEvaluationConsumer signalConsumer;

    public BatchIngestService(SensorWebSocketHandler broadcaster,
                               LinkedBlockingDeque<MessageAckPair> buffer,
                               SignalEvaluationConsumer signalConsumer) {
        this.broadcaster = broadcaster;
        this.buffer = buffer;
        this.signalConsumer = signalConsumer;
    }

    /**
     * Called from MqttPayloadHandler (Task 3) with the MQTT ack callback.
     * broadcast() MUST precede buffer.offer() — WS latency is independent of flush.
     * If offer() returns false (buffer full), ack is not run → broker re-delivers.
     */
    public void accept(SensorReading reading, Runnable ack) {
        broadcaster.broadcast(reading);
        buffer.offer(new MessageAckPair(reading, ack));
        // Ingestion-decoupled signal tap (RESEARCH Pattern 2 / Pitfall 4): AFTER the
        // broadcast + buffer.offer, hand the reading to the signal consumer with a
        // non-blocking offer. If its queue is full, only the SIGNAL is dropped — the
        // INSERT/broadcast hot path above is byte-for-byte unaffected (no inline DB).
        signalConsumer.offer(reading);
    }
}
