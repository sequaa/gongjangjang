package com.gongjangjang.backend.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.gongjangjang.backend.persistence.BatchSensorReadingRepository;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.LinkedBlockingDeque;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

/**
 * RED-phase unit tests for the batch flush worker (D-01 ack-after-commit, D-02
 * size-trigger, T-02-01 bounded backpressure).
 *
 * <p>Testable-seam assumption baked in for GREEN: BatchFlushWorker exposes a
 * package-visible synchronous {@code flushOnce()} method that performs ONE
 * iteration of the flush loop ({@code buffer.poll(T_MS)} for the head →
 * {@code buffer.drainTo(batch, N-1)} → {@code repo.batchInsert(readings)} → on
 * commit success only {@code batch.forEach(p -> p.ack().run())}). This lets the
 * test drive flush deterministically without racing the background thread.
 * Constructor: {@code BatchFlushWorker(LinkedBlockingDeque<MessageAckPair> buffer,
 * BatchSensorReadingRepository repo)}. Constants N=500, T_MS=100.
 */
class BatchFlushWorkerTest {

    private static SensorReading reading(String id) {
        return new SensorReading(id, "temperature", 42.5, Instant.now(), 1_781_000_000_000L);
    }

    /** D-01: batchInsert (DB commit) MUST happen before any ack callback runs. */
    @Test
    void acksOnlyAfterBatchInsertCommits() {
        BatchSensorReadingRepository repo = mock(BatchSensorReadingRepository.class);
        LinkedBlockingDeque<MessageAckPair> buffer = new LinkedBlockingDeque<>();
        Runnable ack = mock(Runnable.class);
        buffer.add(new MessageAckPair(reading("device-001"), ack));

        BatchFlushWorker worker = new BatchFlushWorker(buffer, repo);
        worker.flushOnce();

        InOrder order = inOrder(repo, ack);
        order.verify(repo).batchInsert(anyList());
        order.verify(ack).run();
    }

    /** D-01: if the DB write fails, NO ack is sent so the broker re-delivers. */
    @Test
    void doesNotAckWhenBatchInsertThrows() {
        BatchSensorReadingRepository repo = mock(BatchSensorReadingRepository.class);
        doThrow(new RuntimeException("commit failed")).when(repo).batchInsert(anyList());
        LinkedBlockingDeque<MessageAckPair> buffer = new LinkedBlockingDeque<>();
        Runnable ack = mock(Runnable.class);
        buffer.add(new MessageAckPair(reading("device-001"), ack));

        BatchFlushWorker worker = new BatchFlushWorker(buffer, repo);
        try {
            worker.flushOnce();
        } catch (RuntimeException ignored) {
            // flushOnce may swallow or propagate; either way no ack must fire.
        }

        verify(ack, never()).run();
    }

    /** D-02: a single flush drains at most N=500 rows; remainder stays buffered. */
    @Test
    @SuppressWarnings("unchecked")
    void sizeTriggerDrainsAtMostN() {
        BatchSensorReadingRepository repo = mock(BatchSensorReadingRepository.class);
        LinkedBlockingDeque<MessageAckPair> buffer = new LinkedBlockingDeque<>();
        int total = 600;
        for (int i = 0; i < total; i++) {
            buffer.add(new MessageAckPair(reading("device-" + i), mock(Runnable.class)));
        }

        BatchFlushWorker worker = new BatchFlushWorker(buffer, repo);
        worker.flushOnce();

        ArgumentCaptor<List<SensorReading>> captor = ArgumentCaptor.forClass(List.class);
        verify(repo).batchInsert(captor.capture());
        assertThat(captor.getValue()).hasSizeLessThanOrEqualTo(500);
        // one flush drained exactly N=500, leaving the rest in the buffer
        assertThat(captor.getValue()).hasSize(500);
        assertThat(buffer).hasSize(total - 500);
    }

    /**
     * T-02-01 bounded backpressure: when the deque is full {@code offer()} returns
     * false and no MessageAckPair is enqueued for that message, so the worker never
     * acks it (broker re-delivers = natural backpressure). At worker-unit level this
     * is expressed as: a pair that was never put into the buffer is never acked —
     * the worker only acks pairs it actually drained.
     */
    @Test
    void neverAcksAPairThatWasNotEnqueued() {
        BatchSensorReadingRepository repo = mock(BatchSensorReadingRepository.class);
        LinkedBlockingDeque<MessageAckPair> buffer = new LinkedBlockingDeque<>();
        Runnable enqueuedAck = mock(Runnable.class);
        Runnable rejectedAck = mock(Runnable.class); // offer() returned false -> never enqueued
        buffer.add(new MessageAckPair(reading("device-enqueued"), enqueuedAck));
        // rejectedAck's pair is intentionally NOT added to the buffer.

        BatchFlushWorker worker = new BatchFlushWorker(buffer, repo);
        worker.flushOnce();

        verify(enqueuedAck).run();
        verify(rejectedAck, never()).run();
    }
}
