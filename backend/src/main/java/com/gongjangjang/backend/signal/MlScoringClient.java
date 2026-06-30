package com.gongjangjang.backend.signal;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Online per-reading ML scoring client (RESEARCH Pattern 3 / D-12). Calls the
 * FastAPI service {@code POST /score} OFF the ingestion hot path — invoked only
 * from the single signal-evaluation-consumer worker thread, never on the
 * BatchFlushWorker INSERT path (Pitfall 4 / throughput preservation).
 *
 * <p><b>Graceful skip (Pitfall 4 / T-03-03-03):</b> the FastAPI service is an
 * optional dependency. SHORT connect+read timeouts bound the worker's exposure;
 * on ANY failure (connection refused / timeout / non-2xx / parse error) this
 * returns {@link Optional#empty()} and logs at debug — it NEVER throws into the
 * worker, so threshold/SPC/ingestion are unaffected when the ML service is down.
 * The {@link RestClient} is built once at construction (no network I/O at boot),
 * so a missing FastAPI service does not block Spring startup.
 */
@Component
public class MlScoringClient {

    private static final Logger log = LoggerFactory.getLogger(MlScoringClient.class);

    private final RestClient restClient;

    public MlScoringClient(
            @Value("${ml.service.url:http://localhost:8000}") String baseUrl,
            @Value("${ml.service.connect-timeout-ms:500}") int connectTimeoutMs,
            @Value("${ml.service.read-timeout-ms:500}") int readTimeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(connectTimeoutMs));
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    /**
     * Scores one feature vector {@code [rms, kurtosis, crest]}. Returns the parsed
     * {@link MlScore} on success, or an empty Optional on any error (service down,
     * timeout, bad response) — the caller skips ML only and never fails.
     */
    public Optional<MlScore> score(double[] features) {
        try {
            MlScore score = restClient.post()
                    .uri("/score")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new ScoreRequest(features))
                    .retrieve()
                    .body(MlScore.class);
            return Optional.ofNullable(score);
        } catch (Exception e) {
            // Graceful skip: FastAPI unreachable / slow / malformed -> no ML this reading.
            log.debug("ML scoring skipped (service unavailable or error): {}", e.toString());
            return Optional.empty();
        }
    }

    /** Request body matching the FastAPI {@code ScoreRequest} contract. */
    public record ScoreRequest(double[] features) {}

    /** Parsed {@code POST /score} response. */
    public record MlScore(
            @JsonProperty("anomaly_score") double anomalyScore,
            @JsonProperty("is_anomaly") boolean isAnomaly) {}
}
