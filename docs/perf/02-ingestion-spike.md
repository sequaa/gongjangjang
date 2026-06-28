# 적재 스파이크 트러블슈팅: naive 단건 INSERT → 배치 적재

> 모든 수치는 `bench/results/` 의 측정 결과 파일을 인용한다. before/after 는 **같은 세션에서
> 2-pass 로 동시 측정**(`bench/rerun.sh`)했으므로 PC 사양 편차가 양쪽에 동일하게 상쇄된다(D-10).
> 헤드라인은 절대값이 아니라 **배수**다.

---

## 1. 문제

MQTT 로 들어오는 센서 적재 경로(naive)가 **처리량 천장**에 막혔다. 병목은 지연이 아니라
**처리량/손실**이다 — knee 이하에서는 e2e 지연이 이미 한 자릿수 ms 였다.

- **Saturation persist rate(naive):** **6,074 rows/s** — 더 밀어넣어도 적재율이 오르지 않는 천장
  (`bench/results/before/knee_summary.json` → `saturationPersistRatePerSec`).
- **Knee(naive, 1:1 무손실 offered rate):** **5,064/s** — 이 지점까지는 offered = persisted, drop 0%
  (`bench/results/before/knee_summary.json` → `kneeOfferedRatePerSec`).
- **천장 초과 시 거동:** offered 8,103/s 에서 drop 25%, 12,968/s 에서 56.3%, 20,742/s 에서 72.1%
  — 즉 knee 를 넘기면 **지연이 늘어나는 게 아니라 메시지가 버려진다**
  (`bench/results/before/knee_summary.json` → `curve[].dropPct`).
- knee 이하 구간 지연은 p50 1~11ms / p99 8~60ms 로 SLA 500ms 와 거리가 멀다 — **지연은 병목이 아니다**
  (같은 파일 `curve[].latP99`).

극단적 over-offer 시나리오(`throughput_summary.json`)에서는 acked 대비 drop 이 **98.5%** 까지 갔다
(`bench/results/before/throughput_summary.json` → `dropPctOfAcked`).

---

## 2. naive 동작

`NaiveIngestService` 는 **단일 Paho 콜백 스레드** 위에서 메시지 한 건마다 동기적으로

1. 단건 `INSERT` (single-row) 을 실행하고,
2. 그 직후 WebSocket broadcast 한다.

콜백 스레드가 DB 왕복마다 블로킹되므로, 적재율 = 단건 INSERT 처리율로 고정된다. MQTT 는
`cleanSession=true` + auto-ack(Paho 가 delivery 시점에 즉시 ack) 이라, 백엔드가 끊기면
broker 가 미처리 QoS1 메시지를 **세션과 함께 폐기**한다 → 재시작 손실의 원인
(`backend/.../ingest/NaiveIngestService.java`, `MqttIngestConfig.java`).

---

## 3. 시도한 방법 (순서가 중요하다)

각 레버는 **앞 레버가 없으면 무효**가 되도록 맞물려 있다.

1. **`max_inflight_messages 0` (Pitfall 1).**
   broker 기본값은 inflight 20 이다. manual-ack 배치는 commit 후에야 ack 하므로, 기본값이면
   ack 안 된 메시지 20건이 inflight window 를 채우는 즉시 broker 가 **전송을 멈춰** 배치 자체가
   무력화된다. 이 한 줄이 나머지 모든 레버의 전제다
   (`infra/mosquitto/mosquitto.conf`).

2. **MQTT QoS1 manual ack + `cleanSession=false` (ack-after-commit).**
   broker 를 내구 버퍼로 쓴다. `manualAcks=true` + 고정 `clientId="backend-ingest"` +
   `cleanSession=false` 조합으로, ack 를 **DB commit 성공 이후**에만 보낸다. commit 전에 죽으면
   broker 가 durable session 에서 미-ack 메시지를 재전송한다(D-01)
   (`backend/.../ingest/MqttIngestConfig.java`, `MqttPayloadHandler.java`).

3. **인메모리 bounded 버퍼(50,000) + 전용 flush 워커(N=500 / T=100ms).**
   콜백 스레드는 버퍼에 offer 만 하고 즉시 반환한다. 별도 워커가 **N=500건 또는 T=100ms** 중
   먼저 도달하는 조건으로 모아서 flush 한다 (`BatchIngestService.java` 의
   `LinkedBlockingDeque<>(50000)`, `BatchFlushWorker.java` 의 `N=500`, `T_MS=100`).

4. **JDBC 배치(`rewriteBatchedStatements=true`, multi-row INSERT).**
   드라이버가 배치를 단일 multi-row INSERT 로 재작성해 DB 왕복 횟수를 N분의 1로 줄인다
   (`infra/docker-compose.yml`, `backend/.../resources/application.properties`).

5. **broadcast-on-receive (지연을 flush 에서 분리).**
   WebSocket broadcast 는 버퍼 offer **이전**에 수행한다 — broadcast 가 flush 의 T(100ms)에
   묶이지 않으므로, 적재 배치가 커져도 실시간 화면 지연은 늘지 않는다
   (`BatchIngestService.java`: "broadcast() MUST precede buffer.offer()").

---

## 4. before → after 비교

같은 세션 2-pass 측정, 동일 knee/throughput 스크립트 재사용.

| 지표 | before (naive) | after (batch) | 배수 / 변화 | 출처 |
|---|---|---|---|---|
| Saturation persist rate | 6,074 rows/s | 53,116 rows/s | **8.7x** | `*/knee_summary.json` → `saturationPersistRatePerSec` |
| Knee (offered, 1:1 무손실) | 5,064/s | 20,746/s | **4.1x** | `*/knee_summary.json` → `kneeOfferedRatePerSec` |
| Steady-window throughput | 4,065 rows/s | 71,053 rows/s | 17.5x | `*/throughput_summary.json` → `throughputRowsPerSec` |
| drop % (over-offer, acked 대비) | 98.5% | 0% | 손실 제거 | `*/throughput_summary.json` → `dropPctOfAcked` |

**헤드라인은 보수적으로 saturation 8.7x / knee 4.1x 를 쓴다.** steady-window 17.5x 는
naive 가 천장에 막혀 적재가 거의 멈춘 구간을 포함해 배수가 부풀려지므로, 단독 헤드라인으로
쓰지 않고 보조 지표로 둔다.

---

## 5. 핵심 서사 — 3축 trade-off

적재 최적화는 단일 지표 게임이 아니라 **세 축을 동시에 만족**시키는 문제다.

- **축 1 — 처리량 ↑:** 배치 + multi-row INSERT 로 DB 왕복을 줄여 적재율을 올린다.
- **축 2 — 지연 SLA 500ms 유지(D-02):** idle e2e 지연은 after 에서도 p50 3ms / **p99 9ms**
  로 SLA 500ms 대비 충분한 여유다(`bench/results/after/latency.txt`). broadcast-on-receive
  덕분에 화면 지연이 flush T 에 묶이지 않는다.
- **축 3 — 재시작 손실 0(D-01/D-08):** ack-after-commit 으로 commit 전 손실을 broker
  재전송으로 복구한다.

**왜 버퍼만 키우면 안 되는가** — 버퍼를 무한정 키우는 건 처리량을 올리는 게 아니라
손실을 **무한 지연으로 바꾸는 것**뿐이다. 지속 과부하(offered > 적재 천장)에서는 버퍼가
결국 가득 차고, 그때 손실(drop) 또는 무한 지연 중 하나로 전환된다. 그래서 두 가드레일을 둔다:

- **flush 의 T 상한(100ms)** 이 지연 가드레일이다 — 한 배치의 대기 시간이 100ms + DB write
  로 상한되며, 이는 SLA 500ms 보다 훨씬 작다.
- **ack-after-commit** 이 손실 0 의 근거다 — 버퍼에 있던(=아직 commit 안 된) 메시지는
  ack 되지 않았으므로 죽어도 broker 가 다시 보낸다.

즉 버퍼 크기와 flush T 가 세 축을 하나로 묶는 손잡이다.

---

## 6. 재시작 손실 0 (kill -9)

`bench/kill9-test.sh` 로 백엔드 컨테이너만 SIGKILL 후 재시작하고, `device_id='bench'` 로
격리해 정확히 센다(`bench/results/kill9.txt`).

| mode | published | persisted | delta | verdict |
|---|---|---|---|---|
| batch (after) | 29,988 | 29,988 | **0** | ZERO_LOSS |
| naive (before) | 29,964 | 24,694 | **-5,270** | LOSS |

batch 는 over-count(재전송으로 인한 중복) 없이 정확히 일치했고, naive 는 5,270건을 잃었다.

**운영 함정 노트.** SIGKILL 당한 컨테이너를 `docker start` 로 재사용하면 Paho 의
`MqttDefaultFilePersistence` 파일이 손상된 상태로 남아 측정이 오염된다. 그래서 재시작은
`--force-recreate`(새 컨테이너 = 새 프로세스 = 실제 JVM 재시작 모델)로 한다.
**손실 0 의 보장원은 컨테이너 파일시스템이 아니라 broker 의 durable session**(`cleanSession=false`
+ 고정 `clientId`)이라는 점이 핵심이다 — 컨테이너 FS 는 버려도 broker 가 미-ack 메시지를
다시 보내므로 손실이 0 이다. 이 구분이 면접 방어 포인트다.

---

## 7. 측정 환경 & 재현

**환경**(`bench/results/env.txt`): Apple M4 (10 logical cores), 32GB RAM, NVMe SSD,
Docker 28.3.0, Java 17 (OpenJDK 17.0.17), PostgreSQL 16.

**재현 (한 줄씩):**

```bash
# before (naive baseline) — 천장/knee/throughput 곡선
git checkout perf/01-naive-baseline && bench/rerun.sh

# after (batch) — 동일 스크립트로 같은 곡선 재측정
git checkout main && bench/rerun.sh

# 재시작 손실 0 vs 손실 (kill -9)
bash bench/kill9-test.sh
```

결과는 각각 `bench/results/before/`, `bench/results/after/`, `bench/results/kill9.txt`
에 떨어진다. 위 표의 모든 수치는 이 파일들에서 그대로 인용한 값이다.

---

**면접 한 문장 방어:** "naive 대비 적재 saturation 8.7x / knee 4.1x, 지연 SLA 500ms 유지(p99 9ms),
강제 kill -9 재시작 손실 0 — `bench/rerun.sh` 한 줄로 직접 재현 가능."
