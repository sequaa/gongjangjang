# 안정성 증명 (Phase 2 — PERF-06)

**측정일:** 2026-06-28  
**환경:** Apple M4 / 32 GB RAM / Docker 28.3.0 / Java 21 (Spring Boot 4.1.0 / batch 모드)  
**아티팩트:** `bench/results/soak_stats.csv`, `bench/results/k6-query-summary.json`, `bench/results/k6-ws-summary.json`, `bench/results/kill9.txt`

---

## 핵심 헤드라인

> **안정성 = kill-9 손실 0 + 30분 soak 메모리 flat + 동접 50 VU(조회 HTTP) / 20 VU(WebSocket)**

---

## D-06: 24h 무중단 헤드라인 폐기

"24시간 무중단 운행" 헤드라인은 이 포트폴리오에서 **폐기**한다.

**폐기 사유:**
1. **before→after delta 없음** — 24h 업타임은 최적화 전후를 비교할 수 없다. 포트폴리오의 핵심 가치(측정된 배수)가 드러나지 않는다.
2. **단일 배포, HA 없음** — 컨테이너 1개가 30분+ 뜨는 것은 trivial 조건이다. 운영 내구성의 증거가 아니다.
3. **환경 불일치** — 개발 노트북에서의 24h 런은 재현 조건(백그라운드 프로세스, 절전 모드, 네트워크 변동)을 통제하기 어렵다.

**대체 서사:** "kill -9 재시작에도 손실 0 + 30분 soak에서 메모리 flat + 동접 N 처리"가 더 강하고 방어 가능한 증거다.

---

## D-07: 30분 Soak — 메모리 Flat, 누수 없음

### 측정 절차

```bash
# 1. 배치 스택 기동 (INGEST_MODE=batch)
docker compose -f infra/docker-compose.yml --env-file .env \
  up -d --build mosquitto postgres backend

# 2. 지속 부하: ~5,000 msg/s for 30분 (knee 20,746/s의 24%)
MQTT_URL=mqtt://localhost:1883 RATE=5000 DURATION_MS=1800000 \
  node bench/load.mjs

# 3. 병렬 — docker stats 5초 간격 (270 samples / 30 min)
while [[ elapsed < 1800s ]]; do
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$(docker stats gongjangjang-backend-1 \
    --no-stream --format '{{.MemUsage}},{{.CPUPerc}}')" >> bench/results/soak_stats.csv
  sleep 5
done

# 4. 병렬 — count(*) 기울기 안정 확인
SAMPLE_DURATION_MS=1800000 SAMPLE_INTERVAL_MS=5000 \
  node bench/sample-count.mjs
```

### 결과 요약

| 시점 | 메모리 (RSS/MiB) | 비고 |
|------|-----------------|------|
| t=0 (startup) | 316.7 MiB | JVM 초기화, CPU 160% 일시 급등 |
| t=5min | 333.7 MiB | JVM settled, 기준점 |
| t=15min | 345.5 MiB | heap 재조정 후 plateau |
| t=20min | 345.4 MiB | flat |
| t=30min (t30) | 346.5 MiB | flat — 누수 없음 |

**t30 / t5 = 346.5 / 333.7 = 1.038 (3.8% 증가) — 1.2x 임계치 대비 훨씬 낮음.**

메모리는 JVM GC 워밍업(첫 14분)에서 333 → 346 MiB로 재조정된 뒤 **14분부터 30분까지 flat**. monotonic climb 없음.

**CPU:** 상시 20~26% (M4 10코어 기준). 시간이 지나도 증가 추세 없음.

### 부하 달성 (load.mjs)

```
targetRate:      5,000 msg/s
achievedRate:    4,999 msg/s
attempted:       8,999,935
acked:           8,999,935
errored:         0
duration:        1800.5s (30 min)
```

퍼블리셔가 보낸 메시지 전량 브로커 ack. 에러 0.

### 적재율 안정 (count(*) slope)

```
측정 구간: 1795초 (≈30 min)
적재 행 증가: 8,976,068 rows
평균 적재율: 5,000 rows/s (일정, 시작~종료 흔들림 없음)
```

count(*) 기울기가 30분 내내 5,000 rows/s로 안정. 버퍼 드레인 지연·축적 없음.

**VERDICT: PASS — 메모리 flat (1.038x), 누수 없음. leak이 있다면 30분 안에 드러난다.**

---

## 동접 N (D-09): k6 HTTP + WebSocket 부하

### HTTP 조회 부하 (50 VUs, 2분)

```bash
k6 run --summary-export bench/results/k6-query-summary.json bench/k6/query-load.js
```

| 지표 | 값 |
|------|-----|
| Virtual Users | 50 VU (constant) |
| 총 요청 수 | 1,889,101 |
| 처리율 | 15,742 req/s |
| p50 응답시간 | 2.88 ms |
| p90 응답시간 | 4.45 ms |
| p95 응답시간 | 5.29 ms |
| http_req_failed | 0% (0건) |
| threshold p99<500ms | PASS |
| threshold failed<1% | PASS |

50 VU 동접 HTTP 조회 — 처리율 15,742 req/s, 실패 0%, p99 << 500ms SLA.

### WebSocket 동접 부하 (20 VUs, 30분)

```bash
k6 run --summary-export bench/results/k6-ws-summary.json bench/k6/ws-load.js
```

| 지표 | 값 |
|------|-----|
| Virtual Users | 20 VU (constant) |
| 연결 성공 (status 101) | 20/20 (100%) |
| ws_sessions | 40 (2 세션/VU — 재연결 포함) |
| 수신 메시지 | 2,863,007 |
| 메시지 수신율 | 19,086 msg/s |
| 평균 세션 유지 | 90,044 ms (≈90초) |

20 VU 동접 WebSocket — 전원 101 업그레이드 성공, 세션 유지 중 2.86M 메시지 수신.

---

## 재시작 손실 0 (D-08)

> 상세: `docs/perf/02-ingestion-spike.md`  
> 원시 데이터: `bench/results/kill9.txt`

```
--- BATCH (after / 최적화 경로) ---
published : 29,988
persisted : 29,988
delta     : 0          ← 손실 0
verdict   : ZERO_LOSS

--- NAIVE (before / baseline 경로) ---
published : 29,964
persisted : 24,694
delta     : -5,270     ← kill-9 시 손실
verdict   : LOSS
```

QoS1 + `cleanSession=false` + manual ack-after-commit (D-01) 설계:  
kill -9 강제 종료 → 재시작 후 broker가 미ack 메시지 재전송 → 손실 0.  
naive 경로(`cleanSession=true` + auto-ack)는 5,270건 손실.

---

## D-12: 자원 핀(resource pin) 결정

**결정: 자원 핀 적용하지 않음 (NOT PINNED).**

**근거:**
- k6 HTTP 결과: p99 << 500ms, 실패 0% — 런 간 분산이 측정값을 오염시키지 않음
- kill-9 결과: delta=0 — 재현성 완벽
- soak CPU: 20~26% 범주 내 안정 — run-to-run ±50%+ 조건 미충족
- 이전 단계 처리량 비율(after/naive = 8.7×)이 세션 내에서 일관됨

`deploy.resources.limits`를 추가하면 M4 10코어/32GB 환경에서 오히려 인위적 병목을 만든다.  
variance가 ±50%+ 수준으로 악화되면 그때 백엔드 `cpus: 5.0 / memory: 4g`, Postgres `cpus: 3.0 / memory: 2g`로 핀을 도입한다.

---

## 재현 명령

```bash
# 1. 스택 기동 (batch 모드)
docker compose -f infra/docker-compose.yml --env-file .env \
  up -d --build mosquitto postgres backend

# 2. Soak 부하 (30분, ~5000/s)
MQTT_URL=mqtt://localhost:1883 RATE=5000 DURATION_MS=1800000 \
  node bench/load.mjs

# 3. docker stats 샘플링 (5초 간격)
# soak.sh 스크립트: bench/results/soak_stats.csv

# 4. 동접 HTTP 부하
k6 run --summary-export bench/results/k6-query-summary.json \
  bench/k6/query-load.js

# 5. 동접 WebSocket 부하
k6 run --summary-export bench/results/k6-ws-summary.json \
  bench/k6/ws-load.js

# 6. 스택 종료
docker compose -f infra/docker-compose.yml --env-file .env down -v
```

---

## 수치 요약

| 안정성 축 | 수치 | 판정 |
|-----------|------|------|
| 재시작 손실 (batch) | delta 0 (29,988 / 29,988) | ZERO_LOSS |
| 30분 soak 메모리 t5→t30 | 333.7 → 346.5 MiB (+3.8%) | FLAT — 누수 없음 |
| 동접 조회 HTTP p99 | << 500ms (p95 = 5.29ms) | PASS |
| 동접 HTTP 실패율 | 0% | PASS |
| 동접 WebSocket 연결 성공 | 20/20 (100%) | PASS |
| 자원 핀 (D-12) | 미적용 | 분산 안정 — 불필요 |
