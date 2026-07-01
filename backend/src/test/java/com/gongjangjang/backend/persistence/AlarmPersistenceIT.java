package com.gongjangjang.backend.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.gongjangjang.backend.signal.Alarm;
import com.gongjangjang.backend.signal.AlarmRepository;
import com.gongjangjang.backend.signal.MlScoringClient;
import com.gongjangjang.backend.websocket.SensorWebSocketHandler;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.integration.core.MessageProducer;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * D-16: real-Postgres integration coverage for the two JDBC persistence paths
 * (alarms + signal_events), repaying the STATE.md ephemeral-smoke coverage debt.
 *
 * <p>Boots the full Spring context ({@code webEnvironment = NONE}) against an
 * ephemeral {@code postgres:16} Testcontainer. The three external-touching beans
 * are neutralized so context start makes ZERO outbound connection attempts:
 * <ul>
 *   <li>{@code mqttInbound} (MQTT channel adapter, {@link MessageProducer}) mocked
 *       by name — the {@code @Configuration} class is left intact so its other
 *       harmless {@code @Bean}s (factory, channel) stay live.
 *   <li>{@link SensorWebSocketHandler} + {@link MlScoringClient} — dependencies of
 *       the SmartLifecycle signal consumer; mocked to block WS/HTTP calls.
 * </ul>
 * {@code spring.sql.init} (application.properties) applies schema.sql +
 * schema-signals.sql into the container at startup, so no DDL is declared here.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AlarmPersistenceIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        // @ServiceConnection has SB4 compatibility issues (RESEARCH Pitfall 3) — bind explicitly.
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    // MQTT adapter bean mocked by name → no broker connection at context start.
    @MockitoBean(name = "mqttInbound")
    MessageProducer mqttInbound;

    @MockitoBean
    SensorWebSocketHandler sensorWebSocketHandler;

    @MockitoBean
    MlScoringClient mlScoringClient;

    @Autowired
    AlarmRepository alarmRepository;

    @Autowired
    SignalEventRepository signalEventRepository;

    @Test
    void alarm_insert_and_first_occurrence_query() {
        Instant now = Instant.now();

        Alarm inserted = alarmRepository.insert(
                "device-001", "rms", "threshold", "max_violation", "high", 0.09, now);
        assertThat(inserted.id()).isPositive();

        List<AlarmRepository.DetectorFirst> firsts =
                alarmRepository.firstOccurrenceByDetector("device-001", "rms");
        assertThat(firsts).hasSize(1);
        assertThat(firsts.get(0).detector()).isEqualTo("threshold");
    }

    @Test
    void signal_event_insert_and_find_by_detector() {
        Instant now = Instant.now();

        signalEventRepository.insert("device-001", "rms", "spc", "cpk", 1.21, now);

        List<SignalEvent> events = signalEventRepository.findByDetector(
                "spc", "rms", now.minusSeconds(60), now.plusSeconds(60));
        assertThat(events).hasSize(1);
        assertThat(events.get(0).value()).isEqualTo(1.21);
    }
}
