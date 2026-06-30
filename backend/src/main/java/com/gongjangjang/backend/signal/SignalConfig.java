package com.gongjangjang.backend.signal;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Exposes {@link FrozenBaseline} as a singleton Spring bean.
 *
 * <p>The baseline path defaults to {@code ../data/nasa/baseline.frozen.json},
 * which resolves correctly when the working directory is {@code backend/}
 * (both Maven surefire and normal runtime).
 */
@Configuration
public class SignalConfig {

    @Bean
    public FrozenBaseline frozenBaseline(
            @Value("${signal.baseline.path:../data/nasa/baseline.frozen.json}") String path) {
        return new FrozenBaseline(Path.of(path));
    }
}
