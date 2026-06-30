# 탐지 사다리: 임계치 → SPC → ML (Phase 3 — 이상탐지 분석)

**데이터:** NASA IMS Bearing Set 2, bearing-1 outer-race run-to-failure (984 스냅샷, 10분 간격, 2004-02-12T10:32:39 → 2004-02-19T06:22:39, run ≈163.83h)
**아티팩트:** `ml/eval/results/leadtime_fpr_f1.json`, `ml/eval/results/ml_threshold.frozen.json`, `ml/eval/results/score_latency.json`, `data/nasa/baseline.frozen.json`, `data/nasa/README.md`
**모든 수치는 위 results/ 파일의 실측이다 — 추정치·희망 수치 없음.**

---

## 핵심 헤드라인 (정직판)

> **이 RMS-지배 베어링 신호에선 다변량 ML이 robust한 조기탐지를 사지 못하며, 측정 전 동결한 RMS 임계가 가장 방어 가능한 탐지기다.**

"ML이 가장 일찍 잡는다"가 아니다. 이 분석의 산출물은 **trade-off**다:

- **first-touch(K=1)** 에선 ML(97.50h@398)·SPC(96.67h@403)가 임계치(74.17h@538)보다 빨라 **보인다**.
- 그러나 **지속성(K≥3)** 을 요구하는 순간 ML은 **1위→꼴찌로 무너진다** (398 → 617 → 633).
- SPC는 빠르지만 **healthy 구간 FPR 9.67%** 로 시끄럽다.
- **측정 전에 동결한 RMS 임계만** healthy FPR **0%** 로, K를 올려도 거의 흔들리지 않는다 (538 → 550 → 557).

---

## 1. 측정 결과 — K-consecutive 리드타임 (lead-time)

탐지 규칙: idx≥300(동결된 healthy/degradation 경계)부터, **K개 연속 스냅샷이 한계를 넘는 첫 run** 의 K번째(run-END) 인덱스에서 알람. 세 탐지기 모두 **동일한 K** 로 비교. K=1은 단발 first-occurrence를 재현한다. 리드타임은 고장 시각(2004-02-19T06:22:39)까지 남은 시간.

| 탐지기 | healthy FPR | K=1 | K=3 | K=5 |
|---|---|---|---|---|
| **threshold** (RMS, 동결 min/max) | **0.0%** | 74.17h @538 | 72.17h @550 | 71.00h @557 |
| **SPC** (±3σ + Western Electric rules) | 9.67% | 96.67h @403 | 95.50h @410 | 78.50h @512 |
| **ML** (IsolationForest, 동결 healthy_p99) | 1.0% | 97.50h @398 | 61.00h @617 | 58.33h @633 |

K별 순위(리드타임 시간, `ranking_by_k_lead_time_hours`):

- **K=1:** ml(97.50) > spc(96.67) > threshold(74.17)
- **K=3:** spc(95.50) > threshold(72.17) > **ml(61.00)** ← ML 꼴찌
- **K=5:** spc(78.50) > threshold(71.00) > **ml(58.33)** ← ML 꼴찌

threshold는 K=1 기준 가장 늦게(74.17h) 잡지만 **0% FPR이고 K에 안정**하다 — RMS는 한 번 넘으면 계속 넘으므로, 지속성을 걸어도 538→550→557로 살짝 밀릴 뿐이다. ML은 K=1에서만 "가장 이르고", 그것마저 idx 398의 **단발 스파이크** 덕분이다(아래 §3).

---

## 2. 정교화 사다리 서사 — 각 칸은 무엇을 더 보는가

| 칸 | 본질 | 무엇을 더 보는가 | 동결 출처 |
|---|---|---|---|
| **임계치** | 고정 상/하한선 (μ±8σ) | RMS 절대 레벨 하나. 가장 거친(latest) 칸 — 규칙으로 정의되고 측정 전 동결, 튜닝 없음 | `threshold.min=0.0686 / max=0.0859` (m=8) |
| **SPC** | ±3σ 관리한계 + Western Electric rules + Cpk 하강 | 변동성·추세(연속 점의 패턴)·규격 대비 공정능력 | `control_limits` (μ=0.07726, σ=0.001076, k=3) / `spec_limits` (USL/LSL, k=6) |
| **ML** | 다변량 IsolationForest | rms·kurtosis·crest **3특징 결합** 의 이상 점수 | `ml_threshold=0.07723` (healthy_p99) |

서사상 위로 갈수록 "더 많이 본다." 그러나 **이 신호의 측정 결론**: 깨끗하게 단조 증가하는 신호는 RMS 하나뿐이라(README: baseline RMS≈0.077 → 후반≈0.42, 피크 0.725 @idx 979), 정교화(추세·다변량)가 **robust한 이득을 주지 못했다.** kurtosis·crest를 더해도 분리 가능한 신호가 늘지 않았다 — §3의 분포 겹침이 그 증거다.

---

## 3. "398은 진짜 탐지인가?" — 핵심 방어 섹션

ML의 K=1 리드타임 97.50h(idx 398)는 매력적이지만, **단발 노이즈**다.

- idx 398에서 anomaly score가 healthy_p99 임계(0.07723)를 넘는 단발 **스파이크**가 발생한다.
- **바로 다음 스냅샷 idx 400에서 점수가 임계 아래로 급락한다** — 지속이 아니다.
- 그래서 지속성 K=3을 걸면 첫 "3연속 초과"는 **idx 617** 까지 밀린다(61.00h). ML의 조기성은 K=1에서만 존재한다.

**근본 원인 — 분포 겹침** (`root_cause_score_overlap`):

- healthy 구간 anomaly-score **최댓값 = 0.2112**.
- 이 값이 **전체 열화 구간 점수의 99.12%를 초과**한다 (684개 중 678개가 그 아래).
- 열화 점수가 healthy 최댓값에 도달하는 건 **단 6/684**, 그 첫 지점이 **idx 761**.
- 즉 healthy 점수 분포와 열화 점수 분포가 **겹친다**.

결론: ML의 "조기 탐지"는 **분리 가능한 신호의 능력이 아니라, 임계선을 어디 두느냐의 운(luck on noise)** 이다. 낮은 p99 선이 우연히 단발 스파이크를 clip했을 뿐이다.

이는 **임계 규칙 자체의 민감도** 로도 드러난다 (`ml_threshold_rule_sensitivity`, **같은 모델**):

| ML 임계 규칙 | healthy FPR | K=1 | K=3 | K=5 | 임계값 |
|---|---|---|---|---|---|
| **healthy_p99** (동결 PRIMARY) | 1.0% | 97.50h @398 | 61.00h @617 | 58.33h @633 | 0.07723 |
| healthy_max (비교용) | 0.0% | 37.00h @761 | **미발화** | **미발화** | 0.21116 |

같은 IsolationForest 모델인데, 임계 규칙 하나로 평결이 **정반대로 뒤집힌다** — p99는 "가장 이른 탐지", max는 "가장 늦고 K≥3에선 아예 못 잡음." threshold/SPC에는 이런 규칙 민감도가 없다. 이 민감도 자체를 숨기지 않고 공개한다.

---

## 4. 방어 섹션 — 회의적 면접관을 위한 사전 답변

**① 반순환(anti-circularity) — 모든 한계는 측정 전 동결·커밋.**
임계치(μ±8σ)·SPC ±3σ·USL/LSL(±6σ)는 **healthy baseline(idx 0..299)에서 계산해 `baseline.frozen.json`에 provenance와 함께 동결**했다. 리드타임을 보고 나서 고른 게 아니다. ML 임계도 **healthy_p99 규칙으로 측정 전 동결**(`ml_threshold.frozen.json`: "Frozen BEFORE measuring lead-time … NOT chosen to maximize ML lead-time, D-05 parallel"). healthy_p99는 사전 약정된 PRIMARY, healthy_max는 비교용일 뿐 교체가 아니다.

**② Cpk 규격 출처 (D-06).**
이 진동 신호엔 **제조사 엔지니어링 spec이 없다.** 그래서 운영 한계를 healthy baseline에서 **μ±kσ, k=6 (six-sigma operating spec)** 로 명시 유도해 USL=0.08371 / LSL=0.07080으로 동결했다(이 RMS에선 LSL이 양수라 0으로 floor하지 않음). Cpk는 이 동결 USL/LSL 대비 rolling μ/σ로 별도(03-02) 계산한다 — 동결 baseline 자체에 Cpk를 계산하면 상수로 붕괴하므로(RESEARCH Pitfall 2) 피했다.

**③ 누수 차단(leakage).**
ML은 **healthy 구간(idx≤299)만으로 학습**, 임계도 healthy 점수에서 산출. 시간 경계(idx 299 = 2004-02-14T12:22:39)를 넘는 데이터가 학습/임계 결정에 들어가지 않는다. 첫 μ+6σ 초과는 idx 533, 지속 열화(>0.1)는 idx 647 — 둘 다 경계 한참 뒤라 healthy 창이 열화로 오염되지 않았다.

**④ F1 라벨은 보조 지표.**
F1 라벨은 **수명종료 시간앵커**(고장 시각 기준 마지막 P시간)이지 임계 알람·change-point가 아니다. 후보 P = `f1_anchor_candidates_hours` = [8.19, 16.38, 32.77]h (run 163.83h의 마지막 5/10/20%). **그러나 F1은 보조다** — 시간앵커는 명백히 열화 중인 구간(idx ~538+)이 마지막 P시간 밖이면 "negative"로 라벨하므로, **정확한 조기 임계 탐지를 false positive로 센다.** 이것이 F1을 탐지기 랭킹의 약한 기준으로 만든다. PRIMARY는 리드타임 + healthy-FPR이고, F1은 완전성을 위해서만 둔다.

참고로 P=32.77h에서 F1(`secondary_f1_time_anchor`): ml 0.682 / threshold 0.623 / spc 0.563. ML이 약간 높지만 위 라벨 편향 때문에 이걸로 순위를 매기지 않는다.

**⑤ 임계 규칙 민감도 공개.**
§3의 p99 vs max가 ML 평결을 뒤집는다는 사실 자체를 정직히 드러낸다. 이것은 ML 조기성이 "운"임을 보여주는 가장 강한 자기 반증이다.

---

## 5. 정직 보고 (D-09) — 튜닝 반복, 패자 포함

ML이 "robust한 조기 탐지"를 사는지 검증하려 **세 다변량 후보** 를 같은 절차로 튜닝했다 (`ml_tuning_candidates`, 모두 healthy_p99 규칙, healthy_fpr=0.01). K=1에선 셋 다 빨라 보이지만 지속성 하에 무너진다 — 패자도 그대로 인용한다:

| 후보 | K=1 | K=3 | K=5 | 지속성 하 거동 |
|---|---|---|---|---|
| IsolationForest (배포) | 97.50h @398 | 61.00h @617 | 58.33h @633 | 1위→꼴찌로 붕괴 |
| One-Class SVM | 105.0h @353 | 46.50h @704 | 46.17h @706 | **최늦** 으로 붕괴 |
| Elliptic Envelope (Mahalanobis) | 105.0h @353 | 74.83h @534 | 74.50h @536 | threshold의 538 근방으로 **수렴** (더 이르지 않음) |

세 다변량 후보 **누구도 지속성 하에서 더 이른 탐지를 사지 못한다.** OCSVM은 가장 늦어지고, Mahalanobis는 그저 threshold 자신의 탐지 영역(idx~538)으로 수렴할 뿐이다. **primary_finding** (results 원문): *"On this RMS-dominated bearing signal, multivariate ML buys no robust earlier detection; the pre-frozen RMS threshold is the most defensible detector."*

**D-12 추론 지연** (`score_latency.json`, n=1000, warmup 20): **p50 = 2.688ms / p95 = 2.814ms / p99 = 2.907ms** (mean 2.697, max 3.169). FastAPI inference + 로컬 HTTP 왕복 포함. 이건 ML이 "이긴" 축이 **아니라** D-12 운영 질문의 답이다 — 다변량 ML 추론이 스트리밍 부하에서 지연을 감당할 만큼 가볍다는 것(per-call ~2.7ms).

---

## 6. 재현 (한 줄 명령)

```bash
python data/nasa/preprocess.py        # raw Set 2 → features.csv (결정적)
python data/nasa/freeze_baseline.py   # healthy baseline → baseline.frozen.json (동결)
python ml/train.py                    # healthy-only 학습 → model.joblib + ml_threshold.frozen.json
python ml/eval/run_eval.py            # 리드타임/FPR/F1/튜닝 → results/leadtime_fpr_f1.json
python ml/eval/score_latency.py       # 추론 지연 → results/score_latency.json
```

모든 수치는 `ml/eval/results/`·`data/nasa/`의 **실측 커밋 산출물** 이다.

---

## 7. Phase 4 연결

이 문서는 **Phase 4 README의 4번째 헤드라인(분석)** — "정교화 사다리가 이 신호에선 robust한 이득을 못 줬다, 동결한 RMS 임계가 가장 방어 가능하다" — 의 입력이다.
