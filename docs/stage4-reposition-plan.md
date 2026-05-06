# 4단계 — 자리 바꾸기 (reposition) 구현 계획

작성: 2026-05-06
근거: 1단계 적용 후에도 1ST SG 6 units 미배치. 자리 바꾸기로 추가 배치 가능성.

---

## 1. 무엇을 만드는가

이미 컨테이너에 실은 화물을 일부 빼서 다른 자리로 옮기고, 빈 자리에 못 넣었던 화물을 끼워 넣는 알고리즘 추가.

비유: "이삿짐 트럭 다 실은 후 어떤 박스 옮기면 빈 자리 만들 수 있겠다" 라고 깨달은 사람의 행동을 시스템이 흉내내는 것.

---

## 2. 핵심 기술 과제

### 과제 A — 엔진에 placement 제거 기능 추가

현재 `lib/packing/extreme-point.ts` 의 `ContainerPackState` 는 placement 만 추가 가능. 제거 기능 없음.

**구현 안:**
- `removePlacement(state, cargoId): Placement3D[]` — 같은 cargoId 의 모든 placement 제거 후 반환
- 제거 후 `state.placements`, `state.totalWeight`, `state.visualCbm` 갱신
- `state.candidates` 는 제거된 placement 가 만든 corner 들도 함께 제거 → **rebuild from scratch** 가 안전:
  ```
  새 candidates = {(0,0,0)} + 모든 남은 placement 의 6 corner
  ```

**비용:** O(N²) 에 가까움 (각 candidate 가 모든 placement 와 비교). N=50 가정 시 2500 비교. 미배치 발생 시만 호출 → 받아들일 만함.

### 과제 B — reposition 시도 안전 가드

각 시도가 실패해도 컨테이너 원상복구 보장.

**구현 안:**
- `structuredClone(packState)` 로 스냅샷
- 시도 → 실패 시 `restoreState(state, snap)` 으로 복원
- 이 패턴은 이미 1단계 cargo-atomic 가드와 동일

### 과제 C — reposition 효과 평가 (lex)

옮기고 끼우면 정말 좋아지는지 비교. 점수 합산 X, lex:
- 1순위: 미배치 수 줄어듦
- 2순위: 충전률 동일 또는 ↑
- 3순위: 동종 컨 균형 동일 또는 ↑

개선 없으면 원복.

---

## 3. 알고리즘 흐름

```
repositionPass():
  if unplaced 없음: return

  for each unplaced cargo u (작은 것부터 = 끼우기 쉬운 것부터):
    for each container c:
      for each placed cargo e in c (작은 것부터 = 옮기기 쉬운 것부터):
        if e.cargoId == u.cargoId: skip (자기 자신)

        snapshot = clone(c.packState)
        evictedPlacements = removePlacement(c.packState, e.cargoId)

        # u 끼우기 시도 (cargo-atomic 가드 적용)
        u_ok = tryPlaceCargoAtomic(u, c)

        if not u_ok:
          restore(c.packState, snapshot)
          continue

        # e 다른 자리에 다시 끼우기 (다른 컨도 시도)
        e_ok = tryPlaceCargoAtomic(e, all_containers_except_c, c)

        if e_ok:
          # 성공 — commit
          unplaced 에서 u 제거
          break
        else:
          # e 갈 곳 없음 — 원복
          restore(c.packState, snapshot)
          if e가 다른 컨에 갔다면 그 컨도 원복
```

---

## 4. 수정 대상 파일

| # | 경로 | 작업 |
|---|---|---|
| 1 | `lib/packing/extreme-point.ts` | `removePlacement()` 함수 신규 export |
| 2 | `lib/packing/algorithm.ts` | `repositionPass()` 신규 추가, `pack()` 끝부분 호출 |
| 3 | `docs/algorithm-pipeline.md` | 7단계 알고리즘 흐름에 reposition 패스 추가 (자동 갱신 룰) |

---

## 5. 회귀 안전 가드

- repositionPass 는 **unplaced > 0 일 때만 발동** → 기존 PASS 샘플(미배치 0) 영향 없음
- 효과 평가 lex 에서 개선 없으면 원복 → 분배 흔들림 없음
- 시간 비용: O(미배치 × 컨 × 배치 화물) 최악. N=22 화물 + 6 미배치 = 132 시도 가능. 5초~30초 추가 가능.

---

## 6. 검증 방법 (단계별)

### A. 단위 테스트 (구현 후)
- `removePlacement` 가 placements 배열 + visualCbm + totalWeight 정확히 갱신하는지
- `removePlacement` 후 다시 `tryPlaceUnit` 으로 같은 cargo 넣을 수 있는지
- candidates 재계산 후 새 cargo 끼우는지

### B. 회귀 테스트 (모든 샘플)
```
node scripts/verify-2st-sg-total.mjs       # 회귀 0 기대
node scripts/verify-2st-sg-physics.mjs     # 23/23 유지
node scripts/verify-hm-total.mjs           # 회귀 0 기대
node scripts/verify-2st-hm-physics.mjs     # 33/33 유지
node scripts/verify-2st-hm-practitioner.mjs # 20/20 유지
```

### C. 효과 측정 (1ST SG 중심)
```
node scripts/verify-1st-sg-total.mjs       # 미배치 < 1 기대 (목표 0)
node scripts/verify-1st-sg-practitioner.mjs # 미배치 < 6 기대 (목표 0)
```

---

## 7. 단계별 진행

1. **Step 1**: `removePlacement` 함수 작성 + 단위 테스트
2. **Step 2**: `repositionPass` 함수 작성 + 1ST SG 테스트
3. **Step 3**: 회귀 검증 (4 샘플 PASS 유지)
4. **Step 4**: 효과 평가 → PASS 시 커밋, FAIL 시 원복
5. **Step 5**: `docs/algorithm-pipeline.md` 갱신

각 step 끝마다 사용자 보고. 회귀 발생 시 즉시 원복 (룰: practitioner-list-always-fits).

---

## 8. 비스코프

- placement 부분 제거 (cargo 의 일부 unit 만) X — 항상 cargoId 단위 통째 제거
- 새 컨테이너 추가 X — 기존 컨 사이만 옮김
- 점수 합산 X (lex 비교만)
- 성능 최적화 X (이번엔 정확성 우선)

---

## 9. 성공 기준

| 항목 | 현재 | 목표 |
|---|---|---|
| 1ST SG TOTAL AUTO 미배치 | 1 (데코론) | 0 |
| 1ST SG 실무자 강제 미배치 | 6 (YKMC, HD) | 0 |
| 다른 샘플 회귀 | 0 | 0 (유지) |
| pack 시간 | ~7초/샘플 | < 30초/샘플 (허용) |

---

## 10. 다음 단계

이 계획에 따라 **Step 1 (removePlacement 구현)** 부터 시작 — 사용자 확인 후 진행.
