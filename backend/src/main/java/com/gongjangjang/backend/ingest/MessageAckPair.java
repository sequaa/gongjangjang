package com.gongjangjang.backend.ingest;

public record MessageAckPair(SensorReading reading, Runnable ack) {}
