# 3차 — 잔여 미배치 cargo 정밀 진단 (read-only)

date: 2026-05-13
status: read-only 진단 완료 + singleStrategy/time-budget 실험 추가
대상: sg-4-4 / sg-5 잔여 cargo / sg-1 E8 성공 케이스 비교

production 코드 / algorithm / packer 로직 수정 없음. 기존 결과 분석만.

---

## **정정 — 이전 보고 오차 수정**

| 항목 | 이전 표기 | 정정 |
|---|---|---|
| sg-5 잔여 cargo 개수 | "3 cargo" | **cargoId 2개 (sg-5-17, sg-5-35), unit 3개** (sg-5-35 quantity=2 라 3 unit). "3 cargo" 는 "3 unit" 의 잘못된 표현. |
| "물리적 fits" 표현 | "✅ 물리적 가능" | **"잔여 CBM 기준 수용 여지는 있으나, 실제 EP/잔여 직육면체/충돌/지지 조건에서 reject"** |
| sg-4 E8 stall 원인 | 추정만 | **분리 확정** — pack() 단일 전략 (단일 booking-cluster) 도 85.4s 길지만 stall 아님. inline candidateUnion + 단일 전략은 5.6s. **stall 원인 = packBest 의 8 strategy × cargo brute-force 누적 폭증**. |

---

## 1. sg-1 E8 성공 패턴 (비교 기준)

- engine: `packBestWithCandidateUnion` + `sortStrategy='booking-cluster-first'`
- 컨 셋: 40FT + 20FT
- **미배치 0** ✅
- 컨1 40FT: 사용 50.40 / 60 (남은 9.60 m³, soft 추가 3.00) · 무게 남은 4.4 t
- 컨2 20FT: 사용 23.37 / 28 (남은 4.63 m³, soft 추가 1.40) · 무게 남은 16.0 t
- pack 시간: 41.7s

**성공 요인**: candidateUnion 이 declared / physical 양쪽 후보로 컨 셋 시도 + booking-cluster-first 정렬이 큰 booking 부터 깔아 자리 잡음 → 모든 cargo 배치 가능한 조합 찾음.

---

## 2. sg-4 잔여 — sg-4-4 1 cargo

### cargo 속성
| 항목 | 값 |
|---|---|
| 사이즈 W×L×H | 167 × 117 × 134 cm |
| 수량 | 1 |
| 단위 무게 | 1510 kg |
| 총중량 | 1510 kg |
| CBM | 2.618 m³ |
| booking | FBSIN260440 (수일) |
| 같은 booking 다른 cargo | **없음 (단독 booking)** |
| 플래그 | noStacking ❌, topOnly ❌, orientation 'free' |

### 컨테이너 잔여 공간
| 컨 | 사용 / max | 남은 CBM | 남은 무게 | sg-4-4 fits? |
|---|---|---|---|---|
| 컨1 40FT | 58.28 / 60 | 1.72 m³ (soft 추가 3.00 → 4.72) | 4.3 t | ✅ soft 안 가능, dim OK |
| 컨2 40FT | 53.71 / 60 | 6.29 m³ | 5.3 t | ✅ |
| 컨3 40FT | 38.22 / 60 | **21.78 m³** | 6.6 t | ✅ 여유 매우 큼 |

### 실패 원인 분류
- **bounds**: ❌ 모든 컨에 회전 후 fits
- **CBM**: ❌ 모든 컨 잔여 CBM > cargo 2.618 m³
- **weight**: ❌ 모든 컨 무게 여유 > 1.5 t
- **booking atomic**: ❌ 단독 cargo
- **cargo atomic**: ❌ 1 unit
- **noStacking / orientation**: ❌ 자유
- **support / collision**: 진단 한계 — pack() 내부 검사
- → **실패 원인: 시각 배치 엔진의 자리 fragmented**

특히 **컨3 21.78 m³ 비어있는데 못 들어감** = bookingAnchor 또는 시각 트랙의 컨 선택 룰 의심.

---

## 3. sg-5 잔여 — sg-5-17 / sg-5-35 2 cargo

### sg-5-17

| 항목 | 값 |
|---|---|
| 사이즈 W×L×H | 114 × 99 × 128 cm |
| 수량 | 1 |
| 단위 무게 | 455 kg |
| CBM | 1.445 m³ |
| booking | FBSIN260562 (삼성전자) |
| 같은 booking 다른 cargo | 없음 (단독 booking) |
| 플래그 | 모두 free |

### sg-5-35

| 항목 | 값 |
|---|---|
| 사이즈 W×L×H | 136 × 136 × 72 cm |
| 수량 | 2 |
| 단위 무게 | 7500 kg (⚠ 총 0 reported) |
| CBM | 3.619 m³ |
| booking | FBSIN260539 (KJF) |
| 같은 booking 다른 cargo | 없음 (단독 booking) |
| 플래그 | 모두 free |

**⚠ 데이터 이상**: weightPerUnit 7500 인데 총중량 reported 0 — 단위 weight 누락 가능 (UnitSize 안 weight=0). 알고리즘이 weight 0 으로 본다면 weight 제약 없음.

### 컨테이너 잔여 공간
| 컨 | 사용 / max | 남은 CBM | 남은 무게 | sg-5-17 fits | sg-5-35 fits |
|---|---|---|---|---|---|
| 컨1 40FT | 44.11 / 60 | **15.89 m³** | 11.6 t | ✅ | ✅ |
| 컨2 40FT | 52.19 / 60 | 7.81 m³ | 6.9 t | ✅ | ✅ |

### 실패 원인
- 두 cargo 모두 **단독 booking**, 작은~중간 사이즈, 모든 컨 fits
- 잔여 공간 풍부 (15.89 + 7.81 = 23.7 m³)
- → **시각 배치 엔진의 자리 못 찾기**

---

## 4. sg-4 E8 stall 의 정확한 병목

### 추정 (시간 측정만으로)

- `packBestWithCandidateUnion` 흐름:
  1. initial packBest (multi-strategy 8~9 전략) → 4ST SG 54행 visual 시각 적재 → 각 전략 ~20-60s × 9 = 3~9분
  2. declared/physical 후보 union 산출
  3. 작은 셋 후보부터 다시 packBest 호출 → 또 8~9 전략 × N candidate sets
  
- 4ST SG 의 49 visual cargo 가 visual 트랙 + multi-strategy 매트릭스 + multi-candidate-set 조합으로 **5~10분 stall**.

### 결론
- **strategy matrix 폭증** (sg-4 49 visual cargo × 8 strategy) 이 1차 원인
- candidate-set 다중 시도 (declared + physical + initial) 가 2차 증폭

sg-1 (22 cargo, ~14 visual) 은 동일 흐름이지만 visual cargo 적어서 41.7s 안에 끝남.

---

## 5. sg-1 성공 패턴 vs sg-4/sg-5 실패 패턴 비교

| 항목 | sg-1 (성공) | sg-4 / sg-5 (실패) |
|---|---|---|
| visual cargo 수 | ~14 | 49 / 34 |
| candidateUnion 시간 | 41.7s | 10분+ stall / 미측정 |
| 잔여 미배치 cargo 특성 | sg-1-14 (E8 에서 해결) | 단독 booking, 중간 사이즈, 모든 컨 fits |
| bookingAnchor 영향 | 미배치 cargo 가 큰 booking 의 일부 → 자리 잡힘 | 단독 booking → 다른 cargo 와 묶음 효과 X |
| 시각 배치 엔진 한계 | candidateUnion 으로 회피 | candidateUnion 시간 폭증 → 회피 불가 |

**핵심 차이**: sg-1 잔여 cargo 는 큰 booking 의 일부 → cluster 정렬 + candidateUnion 효과. sg-4/sg-5 잔여 cargo 는 **단독 booking** → 클러스터 효과 안 받음, 시각 배치 엔진이 자리 못 찾으면 끝.

---

## 6. 다음 구현 후보 (3 개 이하)

### 후보 1: candidateUnion 시간 budget + 단일 sortStrategy 강제 모드

**문제 해결**: sg-4/sg-5 E8 stall 회피하면서 candidateUnion 효과 보존

**구현 안**:
- `packBestWithCandidateUnion` 에 `singleStrategy: SortStrategy` 옵션 추가
- 옵션 있으면 candidateUnion 내부 packBest 매트릭스 우회, pack() 단일 전략으로 candidate set 시도
- 시간 budget (예: 90s 전체) 가드 추가
- 효과: sg-4/sg-5 도 candidateUnion + booking-cluster 시도 가능 (시간 안전)

**코드 변경**: `packBestWithCandidateUnion` 함수 내부 옵션 분기 ≤ 20 라인. production 영향 0 (기본 동작 보존).

### 후보 2: 단독 booking cargo 의 컨 선택 룰 검토

**문제 해결**: 단독 booking cargo (sg-4-4 / sg-5-17 / sg-5-35) 가 빈 컨 으로 못 가는 케이스

**진단 필요**:
- 단독 booking cargo 가 처음 시도하는 컨 인덱스 추적 (현재 코드 동작 분석 필요)
- visual 트랙의 컨 우선순위 룰 (containerOrder / balanceSortSameType) 가 단독 cargo 를 어떻게 다루는지

**구현 안 (검토 후)**:
- 단독 booking cargo 의 컨 시도 순서를 "가장 잔여 공간 많은 컨 우선" 으로 변경 가능 검토
- 위험: 회귀 발생 가능성 — sg-1/2/3 의 단독 booking cargo 도 영향

**코드 변경**: 적용 전 read-only 추가 진단 필요.

### 후보 3: 다중 cargo LNS 확장

**문제 해결**: 단독 booking cargo 가 fragmented 잔여 공간에 못 들어가는 케이스

**구현 안**:
- 기존 `repositionUnplaced` (단일 cargo 제거 + 미배치 시도) 를 확장
- 미배치 cargo 가 시도하는 컨 의 잔여 공간 안 작은 cargo 2~3 개 묶음 제거 → 잔여 공간 통합 → 미배치 cargo 배치 → 제거 cargo 재배치 (순서대로)
- cargoId atomic 보존, 다중 cargo 제거 시 booking split 검사
- 효과 가능성: sg-4-4 (2.618 m³) 가 컨1 의 작은 cargo 2-3개 잠시 빼면 들어갈 자리 만들 수 있음

**코드 변경**: `repositionUnplaced` 또는 신규 함수 ~50 라인. 회귀 위험 중간 (다중 제거 → 다른 자리 가는 cargo 효과 확인 필요).

---

## 7. 우선순위 권장

1. **후보 1 (candidateUnion + singleStrategy + time budget)** — 코드 변경 작음, sg-4/sg-5 검증 가능. **최우선 권장**.
2. **후보 2 (단독 booking 컨 선택 룰 진단)** — read-only 진단 추가 후 결정.
3. **후보 3 (다중 cargo LNS)** — 후보 1, 2 후에도 미배치 남으면 검토. 회귀 위험 있어 마지막.

---

## 8. **singleStrategy + time budget 실험 결과 (E9~E12 추가)**

### 실험 (각 60s timeout, multi-strategy matrix 우회)

| sample | exp | 컨 셋 | unpl unit | unpl cargo | cargoIds | cargoSpl | bookSpl | audit | softCbm | hardCbm | pack(s) | timeout |
|---|---|---|---:|---:|---|---:|---:|---|---:|---:|---:|:---:|
| sg-1 | E9 pack-bookCluster | 40FT+20FT | 1 | 1 | sg-1-14×1 | 0 | 0 | P | 0 | 0 | 6.6 | |
| sg-1 | E10 pack-bigCargo | 40FT+20FT | 1 | 1 | sg-1-14×1 | 0 | 0 | P | 0 | 0 | 0.1 | |
| sg-1 | E11 cu+bookCluster (inline) | 40FT+20FT | 1 | 1 | sg-1-14×1 | 0 | 0 | P | 0 | 0 | 0.2 | |
| sg-1 | E12 cu+bigCargo (inline) | 40FT+20FT | 1 | 1 | sg-1-14×1 | 0 | 0 | P | 0 | 0 | 0.1 | |
| sg-4 | E9 pack-bookCluster | 40FT×3 | 1 | 1 | sg-4-4×1 | 0 | 0 | P | 0 | 0 | **85.4** | **TIME** |
| sg-4 | E10 pack-bigCargo | 40FT×3 | 1 | 1 | sg-4-4×1 | 0 | 0 | P | 0 | 0 | 34.6 | |
| sg-4 | **E11 cu+bookCluster (inline)** | 40FT×3 | 1 | 1 | sg-4-4×1 | 0 | 0 | P | 0 | 0 | **5.6** | |
| sg-4 | **E12 cu+bigCargo (inline)** | 40FT×3 | 1 | 1 | sg-4-4×1 | 0 | 0 | P | 0 | 0 | **5.0** | |
| sg-5 | E9 pack-bookCluster | 40FT×2 | 3 | 2 | sg-5-17×1, sg-5-35×2 | 0 | 0 | P | 0 | 0 | 27.9 | |
| sg-5 | E10 pack-bigCargo | 40FT×2 | 6 | 6 | sg-5-17×1, sg-5-22×1, sg-5-25×1, sg-5-28×1, sg-5-30×1, sg-5-32×1 | 0 | 0 | P | 0 | 0 | 55.7 | |
| sg-5 | **E11 cu+bookCluster (inline)** | 40FT×2 | 3 | 2 | sg-5-17×1, sg-5-35×2 | 0 | 0 | P | 0 | 0 | **5.6** | |
| sg-5 | E12 cu+bigCargo (inline) | 40FT×2 | 6 | 6 | sg-5-17~32 | 0 | 0 | P | 0 | 0 | 28.1 | |

## 9. **sg-4 E8 stall 원인 분리 — 결론**

| 시나리오 | 시간 |
|---|---|
| sg-4 pack() 단일 booking-cluster (E9) | 85.4s (TIME 초과) |
| sg-4 pack() 단일 bigCargo (E10) | 34.6s |
| sg-4 inline candidateUnion + 단일 booking-cluster (E11) | **5.6s** |
| sg-4 inline candidateUnion + 단일 bigCargo (E12) | **5.0s** |
| sg-4 `packBestWithCandidateUnion` (multi-strategy × multi-candidate) | **10분+ stall** |

**결론**: stall 원인 = **packBest 의 8 strategy matrix 와 cargo brute-force 누적 폭증**.
- pack() 단일 (85.4s) × packBest 8 strategy = ~11분 → 정확히 stall 시간과 일치
- inline candidateUnion 은 multi-strategy matrix 우회 + 단일 전략 → 5.6s 로 빠름

**candidateUnion 자체는 폭증 원인 아님** (단순 후보 시도 비용 ~10s 안). multi-strategy matrix 가 진정한 병목.

## 10. **per-cargo reject reason 표 (read-only 한계)**

알고리즘 본체 instrumentation 없이는 per-EP reject 사유 (bounds / collision / support / orientation) 추출 불가. 현재 read-only 진단 가능한 reject 항목:

| cargoId | bounds | weight | hardCbm | booking split | cargo split | audit | EP/coll/support |
|---|---|---|---|---|---|---|---|
| sg-1-14 (1ST SG) | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ❌ **알 수 없음 (engine 내부)** |
| sg-4-4 (4ST SG) | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ❌ **알 수 없음 (engine 내부)** |
| sg-5-17 (5ST SG) | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ❌ **알 수 없음 (engine 내부)** |
| sg-5-35 (5ST SG) | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ✅ pass | ❌ **알 수 없음 (engine 내부)** |

**bounds (회전 후 컨 dim 안 들어감)** / **weight** / **hardCbm** / **split** / **audit** 은 모두 통과 (engine 외부에서 확인 가능).
**EP/collision/support/orientation reject** 는 engine 내부 — instrumentation 코드 없이 추출 불가.

→ 잔여 cargo 실패 원인 정확히 분리하려면 알고리즘 본체 `tryPlaceUnit` / `tryPlaceUnitBruteForce` 에 reject 사유 카운터 추가 필요. **이 작업은 production 코드 수정이라 별도 승인 필요**.

## 11. inline candidateUnion 한계

inline candidateUnion (E11/E12) 는 packBest 의 multi-strategy 우회로 시간은 빠르지만, **sg-1 의 E8 효과 (unplaced 0) 를 재현 못 함** — 단순 후보 set 휴리스틱 (initial + 40FT 1대 + 20FT 1대) 만 시도.

진짜 `packBestWithCandidateUnion` 의 효과를 얻으면서 시간 폭증 회피하려면:
- multi-strategy matrix 자체를 우회 (단일 booking-cluster-first 만 사용)
- candidate set 생성 로직은 진짜 `decideContainers` 활용 (인라인 구현은 부족)
- 시간 budget (전체 90s 등) 가드

이는 새 코드 (≤ 30 라인) 필요. **production 반영 아닌 실험용 opt-in 함수 형태로 진행 시 위험 0**.

## 12. 결론 (정정 반영)

- 잔여 미배치 cargo 4 건 (sg-1-14 / sg-4-4 / sg-5-17 / sg-5-35) 모두 **잔여 CBM 기준 수용 여지는 있으나 실제 EP/충돌/지지 조건에서 reject**
- 정확한 reject 사유 (bounds / collision / support / orientation) 분리는 engine instrumentation 필요 (production 코드 수정)
- sg-4 E8 stall 원인 = **packBest 의 multi-strategy matrix × cargo brute-force 폭증**
- inline candidateUnion + 단일 전략 = 5~6s 매우 빠름. 다만 sg-1 처럼 잔여 0 효과 재현 못 함 (후보 set 생성 부족)
- 다음 권장 단계 (둘 중 하나):
  - **(A)** instrumentation 추가해 per-EP reject 사유 분리 → 정확한 진단
  - **(B)** packBestWithCandidateUnion 에 `singleStrategy + time-budget` 옵션 추가 → sg-1 효과 재현 시도 + sg-4/sg-5 시간 안전

## 2026-05-14 정정 및 후속 결과

- `sg-5-35`의 실제 unitSize는 동일 박스 2개가 아니었다. 샘플 기준 166×166×83 1개와 136×136×72 1개다.
- 이 차이 때문에 기존의 같은 크기 묶음 목표만으로는 자리를 찾지 못했다.
- 룰 H와 서로 다른 크기 묶음 목표 보강 후 `sg-5-35`는 화면 기준 엄격 진단에서 미배치 0으로 해결됐다.
- 현재 남은 잔여는 `mangjak-10`, `sg-1-14` 두 건이다.

## 2026-05-14 추가 후속 결과 2

- `mangjak-10`과 `sg-1-14`는 잔여 자리 만들기만 키운다고 풀리는 문제가 아니었다.
- `mangjak-10`은 빈 20FT를 화면 대안으로만 남기지 않고, 40FT 단독 후보를 실제 후보로 다시 검증하는 쪽이 맞다.
- `sg-1-14`는 40FT+20FT에서 긴 직선 바닥 자리가 부족해 실패하지만, 40FT+40FT 후보에서는 미배치 0으로 확인됐다.
- 따라서 후속 보강은 "샘플 이름별 예외"가 아니라 컨테이너 후보를 실제 적재로 다시 검증하는 일반 규칙으로 정리했다.
- 집중 확인 기준으로 기존 잔여 2건은 모두 미배치 0을 확인했다.
