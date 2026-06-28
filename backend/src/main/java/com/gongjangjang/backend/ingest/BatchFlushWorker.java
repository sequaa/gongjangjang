package com.gongjangjang.backend.ingest;

import com.gongjangjang.backend.persistence.BatchSensorReadingRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "ingest.mode", havingValue = "batch", matchIfMissing = true)
public class BatchFlushWorker implements SmartLifecycle {

    static final int N = 500;
    static final long T_MS = 100;

    private final LinkedBlockingDeque<MessageAckPair> buffer;
    private final BatchSensorReadingRepository repo;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public BatchFlushWorker(LinkedBlockingDeque<MessageAckPair> buffer, BatchSensorReadingRepository repo) {
        this.buffer = buffer;
        this.repo = repo;
    }

    void flushOnce() {
        MessageAckPair head;
        try {
            head = buffer.poll(T_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (head == null) {
            return;
        }
        List<MessageAckPair> batch = new ArrayList<>();
        batch.add(head);
        buffer.drainTo(batch, N - 1);

        List<SensorReading> readings = new ArrayList<>(batch.size());
        for (MessageAckPair pair : batch) {
            readings.add(pair.reading());
        }

        repo.batchInsert(readings); // propagates on failure — no ack
        batch.forEach(p -> p.ack().run());
    }

    @Override
    public void start() {
        running.set(true);
        Thread t = new Thread(() -> {
            while (running.get()) {
                try {
                    flushOnce();
                } catch (Exception e) {
                    // swallow so the loop keeps running
                }
            }
        }, "batch-flush-worker");
        t.setDaemon(true);
        t.start();
    }

    @Override
    public void stop() {
        running.set(false);
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }
}
