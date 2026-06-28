# 조회 스파이크 트러블슈팅: 인덱스/파티션 없는 풀스캔 → 파티션 + B-tree + BRIN

> 모든 수치는 `bench/results/query_before.txt` / `bench/results/query_after.txt` 의
> EXPLAIN ANALYZE 원문에서 그대로 인용한다. before/after 는 **같은 DB·같은 5,000,000 행
> 위에서 인덱스 toggle(DROP→측정→CREATE→측정)** 로 측정했으므로 PC 사양 편차가 양쪽에
> 동일하게 상쇄된다(D-04/D-10). 헤드라인은 절대값이 아니라 **배수**다.
>
> 측정법: `EXPLAIN (ANALYZE, BUFFERS)`, 패턴별 3회 실행 후 1회차(cold) 폐기, warm=min(2,3).
> `SET jit=off` 을 before/after 양쪽에 대칭으로 적용. 데이터셋은 10 device × 3초 간격 ×
> ~6개월 span = 5,000,000 행이며, 파티션 테이블(`sensor_readings_part`)과 flat 비교
> 테이블(`sensor_readings_flat`)에 **동일 데이터**를 seed 했다(D-04/D-05 공정성).

---

## 1. 문제

인덱스도 파티션도 없는 단일 테이블에서 설비 관제의 3대표 read 패턴을 조회하면 모두
**풀스캔(Seq Scan)** 으로 떨어진다. 특히 정렬을 동반하는 패턴은 5M 행 정렬이 work_mem 을
넘겨 **디스크로 spill** 된다.

- **P1 시간범위 스캔** (`device_id=? AND recorded_at BETWEEN`): Parallel Seq Scan, 1.6M
  행을 필터로 버리고 80,641 행만 반환 — **69.757ms**
  (`query_before.txt` PATTERN 1, `Rows Removed by Filter: 1639786`).
- **P2 device별 최신값** (`DISTINCT ON (device_id) ORDER BY device_id, recorded_at DESC`):
  Seq Scan 으로 5M 행 전부 읽은 뒤 `Sort Method: external merge Disk: 244696kB` —
  **약 240MB 온디스크 정렬**, **4121.566ms**
  (`query_before.txt` PATTERN 2).
- **P3 집계/다운샘플** (`date_trunc('hour')` + avg/min/max, recorded_at 3개월 범위 ≈
  테이블 절반): Parallel Seq Scan + 부분 집계 — **455.927ms**
  (`query_before.txt` PATTERN 3).

가장 아픈 곳은 P2 다. 최신값 10건을 보려고 5M 행을 디스크에 정렬하는 4.1초짜리 쿼리다.

---

## 2. naive 동작

`schema.sql` 의 baseline 테이블은 **PK(`BIGSERIAL`) 외 인덱스 0개, 파티션 0개** 다(D-06,
"do not tune"). 그래서:

- `recorded_at` / `device_id` 조건을 받쳐줄 인덱스가 없어 옵티마이저가 선택할 수 있는
  접근 경로는 **(Parallel) Seq Scan 뿐**이다.
- `DISTINCT ON ... ORDER BY` 의 정렬을 인덱스 정순으로 대체할 수 없으므로, 5M 행을
  메모리에 못 담고 **external merge(디스크 정렬)** 로 흘린다(P2 240MB, P3 워커별 ~35MB).

즉 naive 의 한계는 "느린 쿼리"가 아니라 **구조적으로 풀스캔과 디스크 정렬밖에 못 하는
스키마** 다.

---

## 3. 시도한 방법 — 순수 PostgreSQL native 만

제약상 **TimescaleDB 같은 확장은 금지**(REQUIREMENTS.md)다. 따라서 별도 집계 테이블이나
커스텀 파티션 로직을 손으로 짜지 않고(`02-RESEARCH.md` §"Don't Hand-Roll"), PostgreSQL
기본 기능 세 개만 쌓았다. 이게 면접 방어 포인트다 — "확장 없이 native 만으로 어디까지
가능한가"를 EXPLAIN 으로 증명한다.

1. **RANGE 월 파티셔닝** — `PARTITION BY RANGE (recorded_at)`, 월 파티션
   `sensor_readings_2025_01 .. _07` + DEFAULT. 시간 조건이 있는 쿼리에서 관련 없는
   파티션을 plan-time 에 제거(partition pruning)하고, 운영상으로는 오래된 월 파티션을
   `DROP` 하나로 retention 처리할 수 있다.
2. **복합 B-tree** `idx_sr_device_time = (device_id, recorded_at DESC)` — P1 의 복합 lookup
   과 P2 의 `DISTINCT ON` 정렬을 동시에 커버한다. recorded_at 을 DESC 로 둬서 최신값 정렬을
   인덱스 정순으로 처리(정렬 노드 제거)하게 한다.
3. **BRIN** `idx_sr_brin_time = BRIN (recorded_at)` — 데이터가 시간 순서로 삽입되어 물리
   정렬 상관이 강할 때 효과적인, 크기가 매우 작은 시계열 인덱스(`02-RESEARCH.md`
   §"인덱스 전략 요약").

> **Pitfall 3 (파티션 PK):** 파티션 테이블의 PK 는 **파티션 키를 포함**해야 한다 →
> `PRIMARY KEY (id, recorded_at)`. 단순 `PRIMARY KEY (id)` 는 DDL 에러가 난다
> (`schema-optimized.sql` 참고).

---

## 4. before → after 비교 (헤드라인)

**true naive(flat, secondary index 0) → optimized(`sensor_readings_part` + B-tree + BRIN).**
세 숫자 모두 **동일한 after 설정(part + index) 하나**에서 측정한 값이다 — 패턴마다 유리한
구성을 골라 쓰는 lever-shopping 을 하지 않았다.

| 패턴 | before (flat, no index) | after (part + idx) | 배수 | 플랜 변화 |
|---|---|---|---|---|
| P1 시간범위 | 69.757ms | 20.702ms | **3.4x** | Parallel Seq Scan → Bitmap Index Scan (partition pruned) |
| P2 device-latest | 4121.566ms | 1525.614ms | **2.7x** | Seq Scan + external merge(disk) → Merge Append over index scans |
| P3 집계 | 455.927ms | 624.825ms | **0.7x (REVERSAL)** | Parallel Seq Scan → Parallel Seq Scan (그대로) |

출처: `query_before.txt` / `query_after.txt` 각 PATTERN 섹션 및 HEADLINE 블록.

**P1.** after 는 `Bitmap Index Scan on sensor_readings_2025_02_device_id_recorded_at_idx`
로 바뀐다. partition pruning 으로 Append 가 **2025_02 / 2025_03 두 파티션만** 건드린다(8개
중 6개 제거 — 플래너가 별도 "excluded" 줄을 찍지 않고 plan 에서 조용히 빼므로, 등장한
파티션 이름으로 확인한다). `query_after.txt` PATTERN 1.

**P2.** disk-spill 정렬이 사라졌다. after 는 `Merge Append` 가 파티션별 인덱스 정순 스캔을
병합하고 `Unique` 가 device 당 첫 행만 취한다 — 240MB 온디스크 정렬 → 정렬 없는 ordered
index scan. 이게 가장 강한 서사다. `query_after.txt` PATTERN 2.

**P3 — 정직한 reversal.** P3 는 after 가 **오히려 느리다(0.7x)**. 숨기지 않고 그대로
보고한다. 3개월 범위 = 테이블 절반(~2.6M 행)을 집계하는 쿼리라, 어떤 인덱스도 parallel
seq scan 을 못 이긴다. after 플랜도 before 와 똑같이 Parallel Seq Scan 이며, 이것이
**버그가 아니라 옵티마이저의 올바른 선택**이다. partition pruning 자체는 동작했다 — P3
after 의 Parallel Append 는 `2025_01 / 2025_02 / 2025_03` 세 파티션만 스캔한다
(`query_after.txt` PATTERN 3). 다만 절반-테이블 집계에서는 그 이득이 seq scan 비용에
묻힌다. **나쁜 숫자를 그대로 보이는 것이 이 프로젝트의 신뢰 근거(Core Value)다.**

---

## 5. lever attribution — 어떤 레버가 일을 했나 (정직한 분해)

헤드라인 배수가 "파티션 덕분"인지 "인덱스 덕분"인지를 한 변수씩 고정해 분해했다
(`query_after.txt` LEVER ATTRIBUTION 섹션). 이 분해용 숫자(flat+idx 등)는 **헤드라인이
아니라 분해 전용**이며 위 4절 헤드라인에 섞지 않는다.

**INDEX 효과** (part no-index → part with-index, 파티션 고정):

| 패턴 | part, no index | part + index | 인덱스 기여 |
|---|---|---|---|
| P1 | 33.291ms | 20.702ms | **1.6x** |
| P2 | 4371.500ms | 1525.614ms | **2.9x** |
| P3 | 623.403ms | 624.825ms | 1.0x (효과 없음) |

→ 쿼리 지연을 줄인 주 레버는 **인덱스**다(P1 1.6x, P2 2.9x). P1 의 헤드라인 3.4x 도
대부분 인덱스가 만든 것이며, partition pruning 단독 기여는 작다.

**PARTITION 효과** (flat+index → part+index, 인덱스 고정):

| 패턴 | flat + index | part + index | 파티션 기여 |
|---|---|---|---|
| P1 | 17.485ms | 20.702ms | 0.8x |
| P2 | 1069.489ms | 1525.614ms | 0.7x |
| P3 | 438.953ms | 624.825ms | 0.7x |

→ 이 규모(5M 행 / 월 파티션 / 좋은 B-tree 가 이미 존재)에서는 파티셔닝이 **쿼리 지연
관점에서 중립~약간 손해**다. Append/Merge Append 오버헤드가 pruning 이득을 상쇄하기
때문이다.

> **프레이밍 (중요):** 이 숫자를 "파티셔닝 무용"으로 읽으면 안 된다. 파티셔닝의 가치는
> point-query 지연 최적화가 **아니라**:
> - **운영(retention):** 오래된 월 파티션을 `DROP TABLE` 하나로 즉시 회수 — flat 테이블의
>   대량 `DELETE` + VACUUM 과 비교 불가.
> - **유지보수:** 인덱스 재구성·VACUUM·통계 갱신을 파티션 단위로 국소화.
> - **확장 시 pruning 이득 증가:** 데이터가 커지고 파티션 수가 늘수록, 좁은 시간창 쿼리가
>   제거하는 파티션 비율이 커져 이득이 확대된다.
>
> 즉 "5M/월 규모의 이 패턴들에서는 지연 이득이 없다"는 측정 사실과, "그래도 파티셔닝을
> 둔 이유는 운영·확장성"이라는 설계 판단을 **동시에** 말하는 것이 핵심이다.

**BRIN 솔직 노트.** P3 after 플랜에서 BRIN 은 테이블에 존재하지만 **플래너가 쓰지 않았다**
— 절반-테이블 스캔에서는 seq scan 이 더 싸기 때문이다(`query_after.txt` 노트). 비교군인
flat BRIN 도 438.953ms 로 naive 455.927ms 와 사실상 동률이다. **BRIN 의 가치는 절반-테이블
집계가 아니라 좁은 최근-시간창 스캔**에 있으며, 이 벤치 범위에서는 과장하지 않는다.

---

## 6. 측정 환경 & 재현

**한 줄 재현:**

```bash
bash bench/query_benchmark.sh
```

이 스크립트가 `schema-optimized.sql` 의 DDL 을 psql 로 적용하고, **같은 5M 행 위에서**
인덱스를 DROP → before 측정 → CREATE → after 측정하는 toggle(D-04)을 돌린다. 결과는
`bench/results/query_before.txt` 와 `bench/results/query_after.txt` 에 EXPLAIN ANALYZE
원문 그대로 떨어진다 — 위 모든 표의 수치는 이 두 파일에서 인용한 값이다.

공정성 근거: before/after 가 **동일 테이블·동일 행**에서 인덱스 toggle 로만 갈리고, 파티션
효과 분해는 동일 5M 데이터를 seed 한 `sensor_readings_flat` vs `sensor_readings_part`
비교로 측정한다(D-04/D-05).

---

**면접 한 문장 방어:** "순수 PostgreSQL 만으로 시간범위 3.4x / 최신값 2.7x(240MB 디스크
정렬 → ordered index scan), 집계는 절반-테이블이라 0.7x 로 오히려 느려지는 것까지 그대로
보고. lever 분해로 지연 이득의 주역은 인덱스이고 파티셔닝은 운영·확장성 자산임을 측정으로
구분 — `bash bench/query_benchmark.sh` 한 줄로 같은 5M 행 위에서 재현 가능."
