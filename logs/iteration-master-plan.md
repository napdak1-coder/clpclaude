# sg3-11 풀이 자동 반복 마스터 플랜

> 작성: 2026-05-08 (Planner)
> 목적: 3ST SG TOTAL 의 sg3-11 (성안기계 750kg, 150×80×68 cm) 1박스 미배치를 자동 반복 시도로 풀거나 수학적 불가능을 증명할 때까지 도달.
> 절대 룰: CLAUDE.md (1)~(10) 모두 유지. 위반 layout 절대 채택 X.
> 형제 산출물: `logs/sg3-11-feasibility-analysis.md` (수학자), `logs/clp-milp-formulation.md` (구조설계자), `logs/clp-search-algorithm-enhancement.md` (탐색강화) — 작성 시 본 plan 단계 1 에서 흡수.

---

## 한 줄 요약 (비개발자용)

> "지금 1개 박스(150×80×68 cm, 750kg)가 두 컨테이너 어디에도 자리 못 찾음. 자동으로 여러 강화 룰을 한 번씩 시도해서 자리 찾으면 채택, 회귀 생기면 즉시 원복, 다 실패하면 '현재 탐색 범위에서 미발견' 보고."

---

## 0. 절대 통과 기준 (모든 trial 공통)

자동 채택은 다음 모두 만족 시에만:

| # | 기준 | 측정 |
|---|---|---|
| ① | 모든 5 샘플 미배치 = 0 | `verify-1st-sg-total / verify-2st-sg-total / verify-2st-hm-total / verify-3st-sg-total / 1ST HM` 전부 unplaced=0 |
| ② | B1 (CBM 쪼개기) = 0 | 한 cargoId 가 두 컨에 분산 0건 |
| ③ | B2 (부킹 분산) = 0 | 한 booking 이 두 컨에 분산 0건 |
| ④ | 글로벌 무게 룰 위반 = 0 | 위 박스 무게 ≤ 아래 박스 × 1.5 (모든 적층) |
| ⑤ | noStacking / floorOnly / topOnly 위반 = 0 | 다단금지·바닥전용·상단전용 플래그 모두 준수 |
| ⑥ | 충돌·boundary·height·받침70% 위반 = 0 | 물리 검증 PASS |
| ⑦ | 1ST SG 성능 < 30 초 | 회귀 제한선 (현재 70초 회귀 상태) |

**하나라도 실패하면 trial 탈락 + 즉시 원복 (commit X).**

---

## 1. 단계별 흐름

### 단계 1 — 형제 에이전트 결과 흡수 (자동 검사)

| 동작 | 산출 |
|---|---|
| `logs/sg3-11-feasibility-analysis.md` 존재 검사 | 수학적 가능 / 불가능 / 미결 분류 |
| `logs/clp-milp-formulation.md` 존재 검사 | MILP 가 제시한 lower-bound layout 후보 |
| `logs/clp-search-algorithm-enhancement.md` 존재 검사 | 탐색 알고리즘 강화 후보 list |

**파일 미생성 시**: 단계 2 의 후보 list (아래 §2) 그대로 사용. 형제 결과가 도착하면 이후 iteration 부터 우선순위 재정렬.

**불가능 증명 발견 시 (수학자가 infeasible 증명)**: 즉시 종료 → "수학적으로 풀이 없음 — 컨테이너 추가 또는 화물 조정 필요" 사용자 보고.

---

### 단계 2 — 우선순위 결정 (lex 비교, 점수 합산 X)

각 강화안을 다음 lex 키로 비교해서 다음 trial 선택:

1. **회귀 위험 적은 것** (기존 통과 4 샘플 영향 작은 변경)
2. **구현 변경량 적은 것** (작은 변경부터)
3. **이론 근거 강한 것** (수학자 / MILP 가 권한 후보 우선)
4. **사용자 승인 가능성 높은 것** (절대 룰과 정렬)

#### 후보 list (형제 결과 도착 전 기본 set, 우선순위 순)

| # | 후보 | 변경 영역 | 회귀 위험 | 비고 |
|---|---|---|---|---|
| A | **컨테이너 2 정착 자리 후보 확대** | `extreme-point.ts:tryPlaceUnitBruteForce` grid step 1cm 정밀 모드 (sg3-11 전용 trigger: unplaced 후 마지막 1박스만) | 낮음 | 마지막 fallback 단계만 깊게 — 일반 흐름 영향 X |
| B | **rescue repack 의 회전 6면 전수 시도** | `algorithm.ts:rescue repack` 블록 — 미배치 unit 재배치 시 6 회전 모두 brute-force 시도 (현재는 일부 face) | 낮음 | rescue 는 미배치 발생 시만 동작 → 다른 샘플 영향 X |
| C | **conflict-swap 다중 라운드 ↑** | `algorithm.ts:repositionUnplaced` 라운드 5 → 8 + cargoId 2개 동시 빼기 시도 (현재는 1개씩) | 중간 | cascading swap, 시간 ↑ 가능 — lightMode 우회 |
| D | **footprint-cluster 룰 B 받침 임계 75 → 70%** | `footprint-cluster.ts` 룰 B 흡수 임계 | 중간 | 절대 룰 #6 (받침 ≥70%) 경계라 OK, 다만 다른 샘플 흡수 변경 위험 |
| E | **packBest 정렬 전략에 weight-volume 혼합 추가** | `algorithm.ts:packBest` 매트릭스 — 무게×부피 desc 정렬 1개 추가 | 중간 | generic 정렬, 1ST SG 성능 영향 측정 필요 |
| F | **Stage 6 행 잔여공간 fitting 천장 여유 6면 회전** | `row-residual.ts` — ceilClearance 검사 시 6면 회전 모두 시도 | 낮음 | unplaced 발생 시만 |
| G | **sg3-11 만 통하는 hardcoded 해법** | (해당 없음) | — | **절대 룰 #6 위배 → 채택 X. 후보에서 제외.** |

**G 는 명시적으로 차단.** "조건 기반 generic" 외에는 채택 X.

---

### 단계 3 — 구현 + 회귀 검증 (한 trial)

#### 3.1 구현 (알고리즘 코어 전문가 dispatch)

- 후보 1 개만 구현 (한 번에 여러 변경 X — 회귀 추적 어려움)
- 변경 파일 + 변경 라인 trial 메타에 기록
- 변경 후 `docs/algorithm-pipeline.md` 동시 갱신 (절대 룰 #7)

#### 3.2 회귀 매트릭스 (검증·회귀 전문가 dispatch — 병렬)

```
node --test --experimental-strip-types lib/packing/*.test.ts
node --experimental-strip-types scripts/verify-1st-sg-total.mjs
node --experimental-strip-types scripts/verify-2st-sg-total.mjs
node --experimental-strip-types scripts/verify-2st-hm-total.mjs
node --experimental-strip-types scripts/verify-3st-sg-total.mjs
# 1ST HM TOTAL 스크립트 (해당 시)
```

**모든 출력 logs/iteration-trials.json 으로 수집.**

---

### 단계 4 — sg3-11 풀이 시도 (3ST SG TOTAL 결과 평가)

#### 통과 판정

- 위 §0 ① ~ ⑦ 모두 PASS
- **즉시 commit + 사용자 보고 + 종료**

#### 실패 판정 분기

| 실패 종류 | 다음 동작 |
|---|---|
| 회귀 발생 (다른 샘플 unplaced 증가 또는 B1/B2/물리 위반) | **즉시 원복** + trial 탈락 사유 기록 → 단계 5 |
| 1ST SG > 30 초 | **즉시 원복** + 성능 회귀 기록 → 단계 5 |
| sg3-11 여전히 미배치 + 다른 샘플 영향 0 | trial 보존 (선택), 단계 5 진행 |

---

### 단계 5 — 다음 강화 시도 (iteration loop)

- 단계 2 의 후보 list 에서 다음 우선순위 후보 채택
- 형제 에이전트가 새 결과 작성 시 우선순위 재정렬
- 단계 3 ~ 4 반복

---

### 단계 6 — 종료 + 보고

#### 6.A 성공 종료

- sg3-11 풀이 + 회귀 0 → 최종 trial 정보, 변경 파일, 채택 룰 한국어 요약 보고
- `docs/algorithm-pipeline.md` 갱신 + `docs/PROGRESS.md` 라인 추가

#### 6.B 모든 옵션 소진 종료

- "현재 탐색 범위에서 미발견" 보고
- 수학자가 infeasible 증명 안 한 경우 — **단정 X** ("물리적 불가능" 표현 금지)
- 사용자 옵션 제시:
  ① 컨테이너 추가 (40FT 1대 더)
  ② 화물 조정 (성안기계 분리 출고)
  ③ 추가 강화 후보 발굴 의뢰

#### 6.C 사용자 중단

- "stop" / "그만" / "잠깐" / "중단" 입력 시 즉시 멈춤 + 현재 trial 상태 보고

---

## 2. trial 결과 저장 형식

**파일**: `logs/iteration-trials.json`

JSON 배열, 각 trial:

```json
{
  "trialId": 1,
  "startedAt": "2026-05-08T15:00:00Z",
  "candidate": "A — bruteForce grid 1cm 정밀 모드",
  "changedFiles": ["lib/packing/extreme-point.ts:tryPlaceUnitBruteForce"],
  "changedLines": 42,
  "rationale": "마지막 fallback 자리 후보 확대. unplaced 발생 trigger 만 동작.",
  "regressionMatrix": {
    "1ST_SG_TOTAL": { "unplaced": 0, "B1": 0, "B2": 0, "runtime_sec": 28.4, "physicsViolations": 0 },
    "2ST_SG_TOTAL": { "unplaced": 0, "B1": 0, "B2": 0, "runtime_sec": 12.1, "physicsViolations": 0 },
    "2ST_HM_TOTAL": { "unplaced": 0, "B1": 0, "B2": 0, "runtime_sec": 5.6, "physicsViolations": 0 },
    "3ST_SG_TOTAL": { "unplaced": 1, "B1": 0, "B2": 0, "runtime_sec": 105.3, "physicsViolations": 0 },
    "unitTests": { "pass": 40, "fail": 0 }
  },
  "sg311_solved": false,
  "accepted": false,
  "rejectionReason": "sg3-11 여전히 미배치, 다른 샘플 회귀 0 — 보존만 하고 다음 후보로",
  "rolledBack": true,
  "endedAt": "2026-05-08T15:08:14Z"
}
```

**모든 trial 누적 기록 (성공·실패 모두).**

---

## 3. 종료 조건 (명시적)

| 종료 사유 | 트리거 | 보고 |
|---|---|---|
| 성공 | sg3-11 풀이 + 회귀 0 + 1ST SG < 30초 | "trial #N 채택, sg3-11 풀음" + 변경 파일 |
| 수학적 불가능 (수학자) | `sg3-11-feasibility-analysis.md` 결론 = "infeasible" | "수학적으로 풀이 없음 — 사용자 옵션 ①②③ 제시" |
| 후보 소진 | 단계 2 의 후보 list + 형제 추가안 모두 trial 후 미발견 | "현재 탐색 범위 미발견 — 추가 강화 후보 발굴 또는 컨 추가 필요" |
| 사용자 중단 | "stop / 그만 / 중단" | "trial #N 진행 중 멈춤. 현재 상태: ..." |
| 시간 한계 | 1 trial 당 8 분 환경 한계 초과 | trial 강제 종료 + 다음 후보 |

---

## 4. 각 trial 의 가드레일 체크리스트 (Must Have / Must NOT Have)

### Must Have

- [ ] 변경 후보가 generic (조건 기반) — sg3-11 만 통하는 hardcoded 분기 없음
- [ ] lex comparator 만 사용 — 점수 합산 도입 없음
- [ ] CBM 쪼개기 분기 추가 없음
- [ ] 회귀 매트릭스 5 샘플 + 단위 테스트 모두 PASS
- [ ] 1ST SG 성능 < 30초
- [ ] `docs/algorithm-pipeline.md` 갱신 동시 진행
- [ ] trial 결과 `logs/iteration-trials.json` 에 기록

### Must NOT Have

- [ ] sg3-11 의 cargoId / shipper / size 를 코드에 명시 (하드코딩 X)
- [ ] 점수 합산 (가중치 × 메트릭 합) 도입
- [ ] 한 trial 에 여러 후보 동시 변경
- [ ] 회귀 발생 시 commit (즉시 원복)
- [ ] "물리적 불가능" 단정 (수학 증명 없으면 "탐색 범위 미발견")
- [ ] 절대 룰 위반 layout 채택

---

## 5. iteration loop 실행 명령 (오케스트레이터 — 코디용)

각 iteration 마다 코디는 병렬 dispatch:

| 팀원 | 임무 |
|---|---|
| 1 알고리즘 코어 전문가 | 후보 구현 (1 개만) |
| 5 검증·회귀 전문가 | 회귀 매트릭스 5 샘플 병렬 실행 + `logs/iteration-trials.json` 기록 |
| 12 문서·기록 전문가 | `docs/algorithm-pipeline.md` 동시 갱신 |
| (조건부) 2 공간 배치 전문가 | extreme-point 변경 후보일 때 |
| (조건부) 4 묶음·클러스터링 전문가 | footprint-cluster 변경 후보일 때 |

**이번 plan 자체는 구현 X — Planner 산출물.**

---

## 6. Open Questions (사용자 확인 필요)

| 질문 | 옵션 | 영향 |
|---|---|---|
| Q1. 1 trial 당 8 분 환경 한계 초과 시 어떻게? | (a) 강제 종료 + 다음 후보 (b) lightMode 모드로 재시도 (c) 사용자에게 묻기 | 시간 효율 vs 정확도 |
| Q2. 수학자가 infeasible 증명 했을 때 단계 6.B 보다 먼저 종료? | (a) 즉시 종료 (b) trial 1~2개 더 시도 후 종료 | 시간 절약 vs 확신 |
| Q3. 후보 list 모두 소진 후 추가 후보 발굴? | (a) 자동 종료 (b) Architect/Scientist 재dispatch | 깊이 vs 시간 |
| Q4. trial 채택 commit 즉시 vs 사용자 승인 후? | (a) 자동 commit (b) 사용자 승인 대기 | 자동성 vs 안전 |

> 위 4 개 질문은 `logs/open-questions-iteration.md` 에 별도 기록. 사용자 답변 시 본 plan 갱신.

---

## 7. 비개발자용 한국어 요약 (사용자 보고 시)

> 자동으로 여러 강화 룰을 한 번씩 시도합니다.
> ① 자리 후보를 더 정밀하게 검색 (1cm 단위)
> ② 자리 못 찾은 박스의 회전을 6면 모두 시도
> ③ 박스 빼기·다시 끼우기를 더 많이 반복
> ④ 컬럼 위에 작은 박스 흡수 임계를 살짝 완화
> ⑤ 무게+부피 혼합 정렬 전략 추가
> ⑥ 행 잔여공간 끼우기 천장 회전 시도
> 각 시도마다 5 샘플 모두 검사. 회귀 생기면 바로 원복. 1개라도 풀면 채택, 다 실패하면 "지금 탐색 범위에선 못 찾음" 으로 보고합니다.

---

## 8. 마지막 갱신 자국

| 항목 | 값 |
|---|---|
| 작성 | Planner |
| 작성일 | 2026-05-08 |
| 형제 산출물 흡수 | 단계 1 자동 검사 (대기 중) |
| 다음 동작 | 코디가 단계 1 발동 — 형제 결과 검사 + 단계 2 후보 list 채택 |
