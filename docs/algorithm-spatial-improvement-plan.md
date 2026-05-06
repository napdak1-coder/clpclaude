# 알고리즘 공간 활용 보강 계획

작성: 2026-05-06
계기: 1ST SG TOTAL 실무자 분배 강제 검증 시 YKMC(6개, 4.76m³) + HD현대건설기계(3개, 2.33m³) 가 시스템에서 미배치. 컨테이너에 CBM·무게 여유(40FT 39%, 20FT 37% 빈 공간)가 충분한데도 끼워넣지 못함.

---

## 1. 보강 대상 4 영역

### A. 공간 활용 효율 부족 → Gap-fill 패스

**현재 한계:**
- extreme-point + LDF 알고리즘이 큰 화물부터 자리 잡으면, 그 사이 빈 공간(gap)은 후순위 화물이 시도하다 회전·각도 한정으로 못 채움.
- 실무자는 손으로 빈 자리에 박스를 회전·기울임 등 자유롭게 끼워넣음.

**보강 방안:**

1. **빈 공간(gap) 탐지 후 작은 화물부터 매칭**
   - `tryPlaceUnit` 실패 시, 컨테이너의 unfilled 공간 좌표(extreme points + 사이 공간) 를 grid 로 스캔
   - 미배치 화물의 모든 회전 조합 × grid 위치 조합 탐색
   - 첫 적합 위치 찾으면 즉시 commit

2. **작은 화물 우선 gap-fill**
   - 큰 화물 placement 끝난 후, 미배치 작은 화물(부피 ≤ 1m³ 등) 만 gap-fill 패스 활성화
   - 이렇게 하면 빈 모서리 / 박스 위 공간 등 비정형 gap 활용

**적용 위치:** `lib/packing/algorithm.ts` 의 `placeQueueWrapper` / `placeQueuePure` fallback 다음에 새 `gapFillPass()` 추가

**위험:** 기존 분배 흔들림 가능 → 미배치가 있을 때만 발동 (조건부)

---

### B. 회전 탐색 강화

**현재 한계:**
- `tryPlaceUnit` 은 6면 회전 시도하지만, 매번 첫 적합 회전만 채택 → 비효율
- `tryPlaceUnitBruteForce` 는 더 광범위 시도지만 모든 좌표 × 회전 조합 탐색 X (시간 한계)

**보강 방안:**

1. **회전 우선순위 lex 정렬**
   - 회전 조합 6 가지 평가 (점수 합산 X, lex 비교):
     1순위 — 박스 base footprint 작은 회전 (gap 활용도 ↑)
     2순위 — 컨테이너 길이축에 longest side 정렬 (안정성 ↑)
     3순위 — 가장 안정적인 base (heavy 면 아래)
   - 6 회전 모두 시도해 가장 좋은 fit 채택

2. **부분 회전 허용** — 예: 위 박스만 회전, 아래 박스 회전 없이 stack
   - 현재는 같은 cargoId bundle 내 모든 박스 동일 회전 — 제약 완화

**적용 위치:** `lib/packing/extreme-point.ts` 의 `tryPlaceUnit` / `tryPlaceUnitBruteForce` 회전 루프

**위험:** 기존 PASS 샘플 회전 결과 변경 가능 → 동률(같은 fit 점수) 일 때만 새 우선순위 적용

---

### C. 묶음 룰 완화 (사용자 명시: 인접 행 허용)

**현재 한계:**
- `tryBundleStack` 이 같은 cargoId 박스 N 개를 한 column 에 통째로 쌓으려 함 → 자리 없으면 분산
- 너무 strict 함

**사용자 의도 (2026-05-06):**
> 묶음은 같은 화주 박스가 **인접 행** (예: 1~2~3 행) 안에 모여 있기만 하면 됨. 굳이 한 column 에 stack 안 해도 됨.

**보강 방안:**

1. **인접 lane bundling**
   - 같은 cargoId 박스를 한 행이 아닌 **인접 lane(연속된 row index)** 에 분산 가능
   - 예: 6개 박스 중 column 4개 + 옆 lane 2개 OK
   - 인접성 정의: row index 차이 ≤ 1 (즉 연속 행)

2. **Bundle 실패 후 fallback 변경**
   - 현재: bundle 실패 시 솔로 fallback (각 박스 독립 자리)
   - 변경: bundle 일부만 column → 나머지 박스를 그 column 의 인접 lane 에 우선 배치 시도

**적용 위치:** `lib/packing/algorithm.ts` 의 `tryBundleStack` 결과 처리 + fallback 루프

**위험:** 거의 없음 (제약 완화는 회귀 위험 작음). 인접 룰을 어기면서 더 좋은 자리 있을 때 어느 쪽 우선할지만 결정 필요.

---

### D. Swap / Reposition 후처리 패스

**현재 한계:**
- `packBest` 의 swap 패스는 컨테이너 **간** swap 만 수행 (40FT-A → 40FT-B cargo 이동)
- 컨테이너 **내부** 재배치는 없음 — 한 번 자리 잡으면 그대로

**보강 방안:**

1. **컨테이너 내부 reposition 패스**
   - 미배치 화물이 있을 때 발동
   - 큰 화물 1 개를 빼서 다른 빈 자리로 옮긴 후 미배치 화물 끼워넣기 시도
   - 효과 평가 (lex): ① 미배치 줄어듦 → ② 충전률 → ③ 균형
   - 개선 시 commit, 아니면 원복

2. **lane 재정렬**
   - 같은 행 안에서 박스 순서 재배치 (작은 박스 끝으로 몰아 넣어 빈 column 만들기)
   - 그 빈 column 에 미배치 화물 끼우기

**적용 위치:** `lib/packing/algorithm.ts` `packBest` 의 swap 패스 다음 새 `repositionPass()`

**위험:** 시간 복잡도 ↑ (모든 cargo 빼서 재배치 시도). N=22~34 개 cargo 면 N² 시도 가능, 기존 7초 → 30초 이상 가능. 미배치 발생 시만 발동해 회귀 영향 최소화.

---

## 2. 적용 순서 (의존성 고려)

1. **C (묶음 룰 완화)** 먼저 — 가장 안전, 회귀 위험 최저
2. **B (회전 탐색 강화)** — 기존 PASS 샘플 영향 검증 필수
3. **A (gap-fill)** — 미배치 발생 시만 활성, 안전한 추가
4. **D (reposition)** — 가장 무거운 변경, 마지막

각 단계마다 4 샘플(1ST SG, 2ST SG, 1ST HM, 2ST HM) 회귀 검증.

---

## 3. 회귀 안전 가드

각 룰 추가 후 다음 모두 PASS 필수:
- `node scripts/verify-2st-sg-total.mjs` — 2ST SG 분배 일치
- `node scripts/verify-2st-sg-physics.mjs` — 23 pass / 0 fail
- `node scripts/verify-hm-total.mjs` — 1ST HM 분배 일치
- `node scripts/verify-2st-hm-physics.mjs` — 33 pass / 0 fail
- `node scripts/verify-1st-sg-total.mjs` — **신규: YKMC + HD 미배치 0 목표**
- `node scripts/verify-1st-sg-practitioner.mjs` — **신규: 실무자 강제 미배치 0 목표**
- `node scripts/verify-2st-hm-practitioner.mjs` — 20 pass / 0 fail

회귀 발생 시 즉시 원복 (`docs/practitioner-list-always-fits.md` 원칙).

---

## 4. 검증 목표 (성공 기준)

| 검증 | 현재 | 목표 |
|---|---|---|
| 1ST SG TOTAL AUTO | ❌ 21 mismatch + 1 unplaced | ✅ 0 mismatch + 0 unplaced |
| 1ST SG 실무자 강제 | ❌ 9 units unplaced | ✅ 0 unplaced |
| 2ST SG TOTAL | ✅ PASS | ✅ PASS (회귀 0) |
| 1ST HM TOTAL | ✅ PASS | ✅ PASS (회귀 0) |
| 2ST HM PHYSICS | ✅ 33/33 | ✅ 33/33 (회귀 0) |
| 2ST HM 실무자 강제 | ✅ 20/20 | ✅ 20/20 (회귀 0) |

---

## 5. 비스코프

- 단순 분류 룰("CT 만 20FT") 같은 거친 룰은 추가하지 않음 (이전 회귀 발생).
- 실무자 분배 100% 일치는 목표로 하지 않음 — **물리적으로 모두 들어가게** 만 보장.
- 부킹 시점 / 엑셀 sub-table 신호 사용 X (사용자 명시 제외 룰).

---

## 6. 다음 단계

1. C (묶음 룰 완화) 코드 작성 + 회귀 검증
2. PASS 시 B (회전 탐색)
3. PASS 시 A (gap-fill)
4. PASS 시 D (reposition)

각 단계마다 사용자 보고 + 진행 승인.
