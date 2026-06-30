package com.gongjangjang.backend.signal;

import com.gongjangjang.backend.ingest.SensorReading;
import com.gongjangjang.backend.websocket.SensorWebSocketHandler;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Ingestion-decoupled threshold signal consumer (RESEARCH Pattern 2 / Pitfall 4).
 *
 * <p>Owns a bounded queue and a SINGLE daemon worker thread (mirrors
 * {@code BatchFlushWorker}). {@code BatchIngestService.accept()} taps readings
 * into this queue with a non-blocking {@code offer} AFTER the ingestion
 * broadcast + buffer.offer; if the queue is full the SIGNAL is dropped and the
 * INSERT/broadcast hot path is unaffected (no inline DB work on the ingest
 * thread — Pitfall 4 / DoS mitigation T-03-01-02).
 *
 * <p><b>Dedup (deliberate design, within D-10 discretion):</b> on a threshold
 * violation a new alarm is inserted ONLY when there is no open (unresolved)
 * alarm for that {@code (device_id, metric, detector='threshold')}. The first
 * violation's {@code first_occurred_at = reading.recordedAt()} is the lead-time
 * anchor (D-04); subsequent consecutive violations while the alarm stays open do
 * NOT create new rows. This prevents an alarm-flood on rising degradation and
 * keeps both the panel and the DB first-occurrence query clean.
 *
 * <p>Because all check-then-insert runs on this one thread with statement-level
 * autocommit, dedup is race-free — a just-inserted alarm is visible to the next
 * {@code findOpenAlarm}, even within the same drained batch.
 */
@Component
public class SignalEvaluationConsumer implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(SignalEvaluationConsumer.class);

    static final String DETECTOR = "threshold";
    static final String SEVERITY = "high";
    static final int CAPACITY = 50000;
    static final int DRAIN = 500;
    static final long POLL_MS = 100;

    private final LinkedBlockingDeque<SensorReading> queue = new LinkedBlockingDeque<>(CAPACITY);
    private final ThresholdEvaluator evaluator;
    private final AlarmRepository alarms;
    private final SensorWebSocketHandler broadcaster;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public SignalEvaluationConsumer(
            FrozenBaseline baseline,
            AlarmRepository alarms,
            SensorWebSocketHandler broadcaster) {
        this.evaluator = new ThresholdEvaluator(baseline);
        this.alarms = alarms;
        this.broadcaster = broadcaster;
    }

    /**
     * Non-blocking tap from the ingestion path. Returns {@code false} if the
     * queue is full — the caller drops only the signal, never the ingest INSERT.
     */
    public boolean offer(SensorReading reading) {
        return queue.offer(reading);
    }

    void drainOnce() {
        SensorReading head;
        try {
            head = queue.poll(POLL_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (head == null) {
            return;
        }
        List<SensorReading> batch = new ArrayList<>();
        batch.add(head);
        queue.drainTo(batch, DRAIN - 1);
        for (SensorReading reading : batch) {
            try {
                evaluate(reading);
            } catch (Exception e) {
                log.warn("signal evaluation failed for reading {}", reading, e);
            }
        }
    }

    private void evaluate(SensorReading reading) {
        ThresholdResult result = evaluator.evaluate(reading.value());
        if (!result.violation()) {
            return;
        }
        // Dedup: skip insert while an unresolved alarm already exists for this key.
        if (alarms.findOpenAlarm(reading.deviceId(), reading.metric(), DETECTOR) != null) {
            return;
        }
        Alarm alarm = alarms.insert(
                reading.deviceId(),
                reading.metric(),
                DETECTOR,
                result.rule(),
                SEVERITY,
                result.value(),
                reading.recordedAt()); // first_occurred_at = lead-time anchor (D-04)
        broadcaster.broadcastAlarm(AlarmFrame.of(alarm));
    }

    @Override
    public void start() {
        running.set(true);
        Thread t = new Thread(() -> {
            while (running.get()) {
                try {
                    drainOnce();
                } catch (Exception e) {
                    // swallow so the loop keeps running
                }
            }
        }, "signal-evaluation-consumer");
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
