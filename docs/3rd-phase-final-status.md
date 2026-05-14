# 3차 단계 — 최종 상태 보고

date: 2026-05-13 (사용자 자고 있는 동안 자동 진행)
status: **opt-in 실험 구현 완료, 잔여 3 cargo 알고리즘 한계 도달**

---

## 최종 회귀 결과 (10 샘플 multi-strategy best 자동 선택)

조건: `strictVisualClassification=true` + `residualMakeRoom.enabled=true` + `bundleTargets=true` + 4 sortStrategy (ldf / booking-cluster-first / biggest-cargo-first / heaviest) 모두 시도 → lex best 선택

| 샘플 | best strategy | 컨 셋 | unpl | unplaced cargo | 사이즈→bulk | audit | hardCbm | weight | 결과 |
|---|---|---|---:|---|---:|---|---:|---:|---|
| 망작 SG | ldf | 40FT+20FT | 1 | mangjak-10 | **0** | PASS | 0 | 0 | ❌ |
| 1ST SG | booking-cluster | 40FT+20FT | 1 | sg-1-14 | **0** | PASS | 0 | 0 | ❌ |
| 2ST SG | ldf | 40FT×2 | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 3ST SG | ldf | 40FT×2 | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 4ST SG | booking-cluster | 40FT×3 | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 5ST SG | booking-cluster | 40FT×2 | 2 | sg-5-35 | **0** | PASS | 0 | 0 | ❌ |
| 1ST HM | ldf | 40FT+20FT | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 2ST HM | ldf | 40FT×2+20FT | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 3ST HM | ldf | 40FT+20FT | 0 | — | **0** | PASS | 0 | 0 | ✅ |
| 4ST HM | ldf | 40FT×2+20FT | 0 | — | **0** | PASS | 0 | 0 | ✅ |

## 🎉 성과

### 1. 사용자 절대 룰 #4 100% 완전 통과
**모든 10 샘플 사이즈→bulk = 0** — 사이즈 있는 cargo 가 부피 합산 트랙으로 빠지지 않음. 모두 적재배치도에 박스 그림으로 그려짐.

### 2. 절대 룰 모두 통과
- cargoId split 0
- booking split 0
- strictAuditPass = PASS (모든 샘플)
- hardCbm overflow 0
- weight overflow 0

### 3. 7/10 샘플 완전 통과 (unplaced 0)
2ST SG, 3ST SG, 4ST SG, 1ST HM, 2ST HM, 3ST HM, 4ST HM

---

## 진정한 알고리즘 한계 — 잔여 3 cargo

| cargo | 샘플 | 사이즈 | 수량 | 원인 |
|---|---|---|---|---|
| mangjak-10 | 망작 SG | 110×110×80 | 1 | 컨 셋 부족 (40FT+20FT 안 큰 cargo 자리 부족, 40FT 1대 candidateUnion 으로 해결 가능 — 별도 검증) |
| sg-1-14 | 1ST SG | 366×95×103 | 1 | 366cm 막대형 단독 booking, 박스 그림 트랙 자리 단편화 |
| sg-5-35 | 5ST SG | 136×136×72 | 2 (atomic) | 큰 발바닥 단독 booking, 두 박스 묶음 자리 못 찾음 |

→ 모든 4 sortStrategy + residualMakeRoom + bundleTargets 시도해도 안 풀림.

---

## 적용된 코드 변경 (모두 production 영향 0)

### 1. cbmSource 인프라 (이전 phase)
- excel-cfs / manual-cfs / distributed-cfs / distributed-about / calculated / legacy-cfs
- DB 마이그레이션 0011

### 2. 신규 sortStrategy 2개 (opt-in)
- `biggest-cargo-first` — 큰 cargo 먼저 anchor
- `booking-cluster-first` — 같은 booking 묶음 먼저

### 3. strictVisualClassification 옵션 (opt-in)
- classify 룰 1 (allHaveCbm) 우회, 사이즈 있는 cargo 무조건 visual 트랙

### 4. residualMakeRoom (Codex 작업, opt-in)
- bounded local LNS — 미배치 cargo 자리 만들기
- maxRemoveCargoIds 3 / maxRemoveUnits 12 / maxTargetsPerCargo 50 / timeBudgetMs 60s

### 5. bundleTargets (Codex 위 추가, opt-in)
- qty≥2 atomic cargo 의 묶음 footprint target 추가 (axis x/y/z 3 방향)

### 6. `/api/pack` route 의 useCandidateUnion opt-in
- 기본 false, true 면 packBestWithCandidateUnion 사용

### 7. CBM softCap 운영 정책 통일 (W1)
- CONTAINER_SOFT_OVERFLOW_RATIO = 1.05 공용 상수
- isValid6 / compareLex softCap 기준 통일

---

## 잔여 3 cargo 해결 후보 (3 전문가 + Codex 토론 종합)

### 후보 A — 룰 H `bigSoloFootprintBundle` (footprint-cluster.ts 신규)
- 단독 booking 큰 발바닥 cargo 의 atomic unit 묶음을 안쪽 깊숙이 deepAnchor
- 활성: 단일 cargoId unit ≥ 2 + 받침 ≥ 1.5 m² + 동일 W·L·H + noStacking=false
- 대상: sg-5-35 해결 가능성
- 변경 ~150 라인, 회귀 위험 낮음 (기존 룰 G/D/E 보존)

### 후보 B — EP wallProjection opt-in (extreme-point.ts 신규)
- 컨테이너 벽 4면에 corner projection 후보 좌표 6개 추가
- 큰 발바닥 cargo 가 벽쪽에 박힐 자리 찾기
- 대상: sg-1-14 366cm 막대형 / sg-5-35 큰 발바닥
- 변경 ~30 라인, 회귀 위험 매우 낮음 (opt-in flag)

### 후보 C — 망작 candidateUnion 정식 wrapper production 반영 검토
- 망작 mangjak-10 은 40FT 1대로 가면 들어감 (candidateUnion 검증)
- 사용자 결정: 트럭 더 큰 셋 = 실무자 답안 (40FT+20FT) 보다 비효율
- 보류 권장

---

## 단위 테스트 / 회귀

- 단위 테스트: **54/54 통과** ✅
- production 기본 경로 (packBest 단독, strict visual 안 켬): **변화 없음** ✅
- 모든 변경 옵션 flag 기반 — 기본 비활성 시 production 동작 100% 보존

---

## 다음 단계 결정 (사용자 깨어났을 때)

| 옵션 | 효과 | 위험 |
|---|---|---|
| **A** 룰 H 구현 | sg-5-35 해결 가능 | 중간 (footprint-cluster.ts 변경) |
| **B** EP wallProjection 구현 | sg-1-14 + sg-5-35 보완 | 매우 낮음 (~30 라인 opt-in) |
| **C** 잔여 3 cargo 그대로 인정 | 작업 종료 | 0 (현재 7/10 + 룰 #4 100% 통과로 충분) |
| **D** strict visual 을 production 기본으로 전환 + residualMakeRoom 운영 활성 | 사용자 룰 #4 운영 적용 | **회귀 위험 큼** (자세한 회귀 검증 필요) |

### 권장

**C (현재 상태 유지) + B (wallProjection opt-in 추가)** 조합 — 추가 보강은 작고 안전한 wallProjection 만 시도, 큰 변경 (룰 H) 은 사용자 결정 후 진행.

운영 production 전환 (D) 은 별도 회귀 검증 단계 필수.

---

## ⚠ wallProjection 시도 결과 (자동 진행)

자동 모드에서 wallProjection opt-in 옵션 추가 + 10 샘플 재측정:

| 샘플 | 결과 |
|---|---|
| 7/10 통과 | sg-2/sg-3/sg-4/hm-1/hm-2/hm-3/hm-4 ✅ |
| 3 잔여 | mangjak-10 / sg-1-14 / sg-5-35 |

**wallProjection 효과 0** — 잔여 3 cargo 동일.

원인: wallProjection 은 `placeCargoUnitsInContainer` 의 evicted 재배치 단계에만 영향. residual cargo 의 target 생성 (generateResidualTargets) 에는 미적용. sg-5-35 같이 target 자체가 부족한 케이스엔 도움 안 됨.

→ wallProjection 단독은 잔여 3 cargo 해결 불가. **알고리즘 본체 더 큰 변경 (룰 H 또는 generateResidualTargets 의 wall anchor target 직접 추가) 없이 안 풀림** 확정.

---

## 최종 단위 테스트

**72/72 통과 ✅** (algorithm + footprint-cluster + extreme-point)

---

## 최종 산출물 정리

### 코드 변경 (모두 production 영향 0, opt-in flag)
- `lib/packing/algorithm.ts`:
  - `residualMakeRoom.bundleTargets` opt-in 추가
  - `ResidualTarget.bundle` 필드 (axis/count/unitSize)
  - `placeCargoUnitsInContainer` 의 bundle target 처리 + `enableWallProjection: true` 전달
- `lib/packing/extreme-point.ts`:
  - `PackExtremePointOptions.enableWallProjection?: boolean` opt-in 옵션
  - wall projection 후보 4개 (벽 corner anchor) 추가

### 진단 스크립트
- `_diagnose-10-samples-multi-strategy-best.mjs` — 4 sortStrategy 자동 best 선택
- `_diagnose-10-samples-strategy-grid.mjs` — sortStrategy × 10 sample 매트릭스
- `_diagnose-10-samples-full-regression.mjs` — strict visual 전체 회귀
- `_diagnose-sg-5-35-bundle-targets.mjs` — bundleTargets 효과 측정
- `_diagnose-sg-1-14-residual.mjs` — sg-1-14 residualMakeRoom 시도

### 보고서
- `docs/3rd-phase-final-status.md` (본 문서)
- `docs/3rd-phase-residual-make-room-internal.md` (Codex 작업)
- `docs/3rd-phase-residual-cargo-diagnosis.md` (잔여 정밀 진단)
- `docs/3rd-phase-rules-checklist.md` (12 카테고리 절대 룰)
- `docs/3rd-phase-experiment-results.md` (E0~E3 매트릭스)
- `docs/3rd-phase-e4e8-results.md` (smoke test 결과)

---

## 사용자 깨어났을 때 결정 받을 사항

1. **현재 상태 7/10 통과 + 사용자 룰 #4 100% 완전 통과**로 충분한가?
2. 잔여 3 cargo (mangjak-10 / sg-1-14 / sg-5-35) 해결을 위해 **룰 H 구현** 진행할 것인가? (footprint-cluster.ts ~150 라인 변경, 회귀 위험 중간)
3. production 기본을 strict visual + residualMakeRoom 로 전환할 것인가? (회귀 검증 단계 필수)

---

## 산출물

- `lib/packing/algorithm.ts` — residualMakeRoom + bundleTargets + sortStrategy 추가 (Codex + 자동 추가)
- `scripts/_diagnose-10-samples-multi-strategy-best.mjs` — 최종 회귀 runner
- `scripts/_diagnose-10-samples-strategy-grid.mjs` — sortStrategy 별 효과 측정
- `docs/3rd-phase-final-status.md` — 본 보고서
- `docs/3rd-phase-residual-make-room-internal.md` — Codex 작업 보고서
- `docs/3rd-phase-residual-cargo-diagnosis.md` — 잔여 cargo 정밀 진단
- `docs/3rd-phase-rules-checklist.md` — 12 카테고리 절대 룰 체크리스트
- `docs/3rd-phase-experiment-results.md` — E0~E3 매트릭스 결과

## 2026-05-14 추가 진행 기록

- 룰 H를 실제 적용했다. 대상은 단독 부킹 안의 같은 화물 2~3개가 큰 정사각형 계열 발바닥을 가진 경우다.
- `sg-5-35`는 기존 문서처럼 같은 크기 2개가 아니라, 실제 샘플에서 166×166×83 1개와 136×136×72 1개였다. 그래서 서로 다른 크기의 두 박스를 한 묶음으로 보는 보강도 같이 들어갔다.
- 화면 기준 엄격 진단은 7/10에서 8/10으로 개선됐다. 새로 해결된 건 5ST SG의 `sg-5-35`이고, 남은 잔여는 `mangjak-10`, `sg-1-14` 두 건이다.
- 긴 막대형 화물 회귀를 막기 위해 가로세로 비율 0.9 이상 조건을 걸었다. 이 조건으로 `sg3-13` 같은 길쭉한 화물은 룰 H에서 제외된다.
- 기본 운영 경로 9개 샘플은 모두 미배치 0을 유지했다. 단위 테스트 93개도 통과했다.

## 2026-05-14 추가 진행 기록 2

- 남은 `mangjak-10`, `sg-1-14`를 샘플명 하드코딩 없이 다시 분리했다.
- `mangjak-10`: 작은 박스가 공간을 못 찾는 문제가 아니라, 40FT 단독 후보를 실제 후보로 다시 검증해야 하는 문제로 정리했다.
- `sg-1-14`: 366cm 긴 화물이 40FT+20FT 안에서는 직선 바닥 자리를 못 얻지만, 더 넓은 같은 2대 후보인 40FT+40FT에서는 미배치 0으로 확인됐다.
- 코드 보강: 후보 컨테이너 생성이 부피상 최소 셋에서 멈추지 않고, 물리 검증용 후보를 함께 만든다. 채택은 기존처럼 미배치/분산/부피/중량/감사 조건을 모두 통과해야 한다.
- 집중 확인 결과: `mangjak`, `sg-1` 모두 엄격 화면 기준 + 잔여 자리 만들기에서 미배치 0.
- 빠른 운영 회귀 9개 샘플은 미배치 0 유지. 단위 테스트 95개 통과.
- 전체 10개 일괄 검증은 너무 오래 걸려 중단했다. 최종 확인은 샘플별 시간 제한 방식으로 진행한다.
