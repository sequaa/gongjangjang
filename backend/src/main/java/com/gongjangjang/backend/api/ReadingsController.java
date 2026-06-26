package com.gongjangjang.backend.api;

import com.gongjangjang.backend.ingest.SensorReading;
import com.gongjangjang.backend.persistence.NaiveSensorReadingRepository;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Single read endpoint for the dashboard's initial load (RT-01). */
@RestController
public class ReadingsController {

    private final NaiveSensorReadingRepository repository;

    public ReadingsController(NaiveSensorReadingRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/api/readings")
    public List<SensorReading> recent(@RequestParam(defaultValue = "50") int limit) {
        return repository.findRecent(Math.min(Math.max(limit, 1), 500));
    }
}
