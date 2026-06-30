package com.gongjangjang.backend.api;

import com.gongjangjang.backend.signal.Alarm;
import com.gongjangjang.backend.signal.AlarmRepository;
import com.gongjangjang.backend.signal.AlarmState;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Alarm panel REST surface (D-10). Input validation hardened per V5 /
 * threat T-03-01-01: malformed id and illegal/unknown state transitions are
 * rejected with HTTP 400 (never a 500), a missing alarm with 404.
 */
@RestController
public class AlarmController {

    private final AlarmRepository alarms;

    public AlarmController(AlarmRepository alarms) {
        this.alarms = alarms;
    }

    /** Recent alarms, newest first (panel initial load). */
    @GetMapping("/api/alarms")
    public List<Alarm> recent(@RequestParam(defaultValue = "50") int limit) {
        return alarms.findRecent(Math.min(Math.max(limit, 1), 500));
    }

    /** Target-state transition request body: {@code {"state":"acknowledged"}}. */
    public record StateUpdateRequest(String state) {}

    /**
     * Transition an alarm's state. Only legal transitions are accepted
     * (created->acknowledged, acknowledged->resolved, created->resolved). On
     * transition, acknowledged_at / resolved_at are stamped.
     *
     * @return 200 with the updated alarm; 400 for malformed id / unknown or
     *     illegal target state; 404 when the alarm does not exist.
     */
    @PatchMapping("/api/alarms/{id}")
    public ResponseEntity<?> updateState(
            @PathVariable String id,
            @RequestBody(required = false) StateUpdateRequest request) {

        final long alarmId;
        try {
            alarmId = Long.parseLong(id);
        } catch (NumberFormatException e) {
            return badRequest("malformed alarm id");
        }

        if (request == null || request.state() == null) {
            return badRequest("missing target state");
        }

        final AlarmState target;
        try {
            target = AlarmState.fromToken(request.state());
        } catch (IllegalArgumentException e) {
            return badRequest("unknown target state: " + request.state());
        }

        Alarm current = alarms.findById(alarmId);
        if (current == null) {
            return ResponseEntity.notFound().build();
        }

        if (!current.state().canTransitionTo(target)) {
            return badRequest(
                    "illegal transition: " + current.state().token() + " -> " + target.token());
        }

        Alarm updated = alarms.updateState(alarmId, target, Instant.now());
        return ResponseEntity.ok(updated);
    }

    private static ResponseEntity<Map<String, String>> badRequest(String message) {
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }
}
