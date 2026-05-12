# 작업 이어가기 노트 (2026-05-12 17:30)

## 현재 상태

### 완료된 작업 (이 commit 까지)
1. **박스 무게 정확화** — `lib/excel.ts` `correctInflatedUnitWeights`, 6 cargo 보정 + ANC LOGISTICS 부피 비율 분배 (3ST SG 등)
2. **UI 라벨 강화** — CargoTable "총 중량 (kg)", UnitSizesModal "박스 1개 무게 (kg)" / "그룹 총 무게 (kg)"
3. **row-lane bundle** (long-axis-anchor.ts SLENDERNESS 0.40) — FLOWBUS 326cm 막대 폭 나란히 해결 ✅
4. **Rule E** exactCrossCargoBundle (footprint-cluster.ts) — VPHI 화주 같은 사이즈 cross-cargo 묶음 ✅
5. **Rule F** nearFootprintStackBundle (footprint-cluster.ts) — 적층 가능 화물 fallback
6. **Rule G** nearFootprintRowLane (footprint-cluster.ts) — 다단금지 화물 옆 나란히 ⚠️ 미완

### 회귀 매트릭스 baseline
| 샘플 | 미배치 | mismatch |
|---|---|---|
| 1ST SG | 0 | 8 |
| 2ST SG | 0 | PASS |
| 3ST SG | **1 (SK GEO CENTRIC)** | 29 |
| 1ST HM | 0 | PASS |
| 2ST HM | 0 | 30 |

### 단위 테스트: 54/54 통과 ✅

---

## 남은 문제 — SK GEO CENTRIC 1 미배치

### 데이터
- booking FBSIN260431, cargoId sg3-35, noStacking=true, PL
- unitSizes: 135×115×129 ×2 + 137×115×85 ×1 (총 3 unit, 875kg/박스)

### 진단 결과 (debug 로그 RULE_G_DEBUG=1 확인)
```
[ruleG-DEBUG] bundle cargoId=sg3-35 units=3 faceIdx=4 laneW=115
```

→ Rule G 호출됨, bundle 만들어짐 (face 4 회전, lane 폭 115cm)
→ **하지만 `tryPlaceRowLaneBundle` 의 실제 배치 단계에서 실패** (자리 못 찾거나 atomic 검증 실패)

### 다음 단계 (재부팅 후 진행)

1. **격리 진단 스크립트 작성** (`scripts/_isolate-skgeo-rule-g.mjs`):
   - 빈 40FT 컨테이너 만들기
   - SK GEO 3 unit 만 직접 expandToUnits 패턴으로 생성
   - `preClusterRowLane(containerLike, units)` 직접 호출
   - `placed.size`, `containerLike.packState.placements`, `__testables.lastRowLaneDecision` 출력
   - 어느 단계에서 실패하는지 추적

2. **`tryPlaceRowLaneBundle` 안 추가 임시 디버그**:
   - 첫 박스 `tryPlaceUnit` 결과
   - 옆 컬럼 base 자리 잡기 결과
   - z 동일성 검사 통과 여부
   - atomic 검증 단계 결과

3. **고친 후 verify-3st-sg-total.mjs 재실행** (7-10분 소요)

4. **회귀 매트릭스 9 샘플**:
   - 1·2·3·4 SG, 1·2·3·4 HM, 망작
   - 각 샘플별 미배치 / booking split / cargoId split / audit / pack 시간 / placement 변경 수
   - Rule G 발동 = 1 (SK GEO) 확인
   - FLOWBUS row-lane + VPHI Rule E 안 깨짐 확인

5. **docs/algorithm-pipeline.md 마무리 갱신** (Rule G 단계 + SK GEO 사례)

6. **디버그 로그 제거** (RULE_G_DEBUG env console.warn) — footprint-cluster.ts:1714~1722

### 핵심 파일·라인
- `lib/packing/footprint-cluster.ts:1301~1730` — Rule G 본체
- `lib/packing/footprint-cluster.ts:1714~1722` — RULE_G_DEBUG 임시 로그 (제거 필요)
- `lib/packing/algorithm.ts:1851~1932` — Rule G 호출부 (fixedMap fallback 적용됨)
- `data/samples/singapore-total-3.json:1072~1108` — SK GEO 데이터
- `lib/packing/footprint-cluster.test.ts` — Rule G 단위 테스트 8개

### 사용자 절대 룰 (유지 필수)
1. STACK_WEIGHT_TOLERANCE = 1.0
2. fixedAssignment 금지 (절대 룰 #8)
3. 점수 합산 X (lex comparator 만)
4. CBM 쪼개기 X
5. 회귀 1건이라도 발생 시 즉시 원복
6. console.log 금지 (production)
7. algorithm.ts 수정 시 docs/algorithm-pipeline.md 동시 갱신

### 다른 개발자 가이드 (이전 메시지)
- Rule G 1차 범위: same cargoId 내부 variable unitSizes 만 (booking 확장 X)
- pickLaneFace 신규 (long-axis-anchor 의 pickLongAlongLengthFace 재사용 X)
- column ≤2, 회전 face 선택, orientation=fixed 면 회전 금지
- 발동 로그 (cargoId, bookingNo, face, lane W/L/H)
- 전역 brute-force 금지, unplaced 주변 제한적 실행
