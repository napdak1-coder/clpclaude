# clpclaude 분배 알고리즘 파이프라인

> **자동 갱신 룰**: `lib/packing/algorithm.ts` 수정 시 이 파일도 함께 보강할 것 (rule: `keep-algorithm-pipeline-updated`).
> 마지막 갱신: 2026-05-06 (column-stack 우선화 — 같은 cargoId 후속 unit 은 이전 박스 위에 stack 우선 시도)

---

## 1단계: 엑셀 데이터 정리

**파일**: `components/input/ExcelImport.tsx`

- 사용자가 엑셀 업로드 → 헤더 자동 인식 (House B/L / Booking No / 실화주 / Q'TY 등) → 화물 행 추출
- **Q'TY 컬럼 그대로 신뢰** (REMARK 사이즈 합계로 절대 덮어쓰지 않음)
- REMARK 텍스트의 "112X145X165" 같은 사이즈 패턴 자동 추출 → W/L/H 보충
- mm → cm 자동 정규화
- 다단금지/상단적재/회전금지/중량조건 플래그 키워드 추출
- 부킹 메타(P.O.D, M.BOOKING NO, CLP 번호, VESSEL, ETD/ETA, SIZE) 헤더 위쪽 영역에서 자동 추출

## 2단계: 트럭 종류 결정 (`decideContainers`)

**파일**: `lib/packing/algorithm.ts:decideContainers`

- 총 화물 부피·무게로 가능한 트럭 조합 후보 생성 (40FT × N + 20FT × M)
- **안전마진 룰**: 트럭 가득 채우면 위험 → 잉여 용량(slack) < 1.5 m³ 조합 제외
  - 모든 조합이 slack < 1.5 면 룰 미적용 (안전망)
- **lex 비교** (점수 합산 X):
  ① 미배치 적은 것 → ② 입고완료 마감된 것 → ③ 충전률 → ④ 동종 컨 균형(편차 작은 것)
- 최고 조합 선택

## 3단계: 입고완료 화물 자동 마감 (선택)

**파일**: `lib/packing/algorithm.ts` (`autoConsolidateCompleted` 옵션)

- CFS 입고완료 (cfs cbm 입력된) 화물 총합이 한 컨테이너 capacity 안에 들어가면:
  - 그 컨테이너에 입고완료 우선 배치
  - 비-입고완료 화물은 다른 컨테이너로 우선
- 사용자가 `fixedAssignment` 또는 `completedExclusiveContainerIndex` 명시 시 자동 모드 비활성

## 4단계: 화물을 두 갈래로 나눠 배치

### 통로 A — 박스 무더기 (CT/입고완료, 무차원)

**파일**: `lib/packing/algorithm.ts:allocateBulkGroup`

대상: 사이즈 없는 카톤·소포 (예: AMS, 유라, 제임스텍, 장안어패럴)

순서:
1. 같은 부킹 화물은 같은 컨 (`bookingAnchor` 강제)
2. softCap 안에 통째로 들어가는지 확인
3. **통째로 안 들어가면 다음 컨 시도** (계속)
4. 어느 컨도 통째 못 받으면 **미배치** 분류 (쪼개기 절대 금지 ✅)

### 통로 B — 사이즈 있는 박스 (PL/PK/WC, visual 트랙)

**파일**: `lib/packing/algorithm.ts:placeQueueWrapper` / `placeQueuePure`

대상: 사이즈 있는 팔레트·박스 (예: 일라, KIOSKIN, SD KOREA)

순서 (cargoId 단위 atomic):
1. 같은 cargoId 의 unit 들을 묶어서 처리
2. 후보 컨테이너 우선순위대로 한 컨씩 시도
3. 그 컨의 packState 스냅샷 → bundle stack + 솔로 fallback 으로 모든 unit 통째 시도
4. 다 들어가면 commit, **하나라도 실패하면 스냅샷 복원 → 다음 컨 시도**
5. 어느 컨도 통째 못 받으면 그 cargo 전체 **미배치** 분류 (쪼개기 절대 금지 ✅)

## 5.5단계: 자리 바꾸기 패스 (`repositionUnplaced`)

**파일**: `lib/packing/algorithm.ts:repositionUnplaced`

**발동 조건**: `unplaced.length > 0` (미배치 발생 시만)

- 미배치 cargo 마다 각 컨테이너에서 cargo 1개 빼기 시도
- 빼면 컨테이너 비우고 나머지 LDF 순으로 재배치
- 빈 자리에 미배치 cargo 끼우기 (bundle stack 우선)
- 빠진 cargo 도 다시 끼우기 (같은 컨)
- 다 들어가면 commit, 하나라도 실패하면 스냅샷 복원
- 다중 라운드 (최대 5회) — cascading 배치 시도
- 점수 합산 X — 단순 lex (성공 했나? 미배치 줄었나?)

## 5단계: 다중 strategy 비교 (`packBest`)

**파일**: `lib/packing/algorithm.ts:packBest`

- 같은 화물 데이터로 56 가지 (정렬 7 × 모드 2 × 컨 순서 2 × 클러스터링 2) 조합 시도
- **lex 비교** (점수 합산 X):
  ① 미배치 적은 것 → ② 입고완료 마감된 것 → ③ 충전률 → ④ 동종 컨 균형(`balancePenalty`)
- 가장 좋은 결과 채택

## 6단계: Swap 패스 — 균형 보정

**파일**: `lib/packing/algorithm.ts:packBest` 3단계 swap loop

- 발동 조건: best 결과가 unp=0 + 동종 컨 ≥ 2 대 + 편차 > 3 m³
- 큰 컨 → 작은 컨으로 cargo 1개 이동 시도 (`fixedAssignment` 강제 후 재pack)
- 모든 후보 평가 → best balance 채택
- 최대 8 회 반복 또는 개선 없음 시 종료

## 7단계: 시각 결과 + 화물 표 출력

**파일**: `lib/packing/display-rows.ts`, UI 컴포넌트

- 컨테이너별 적재 배치도 (3D/2D 시각화) — 화주별 색상·라벨
- 화물 목록 표 — 화주/부킹/사이즈/수량/CBM/무게/배정 컨
- 컨테이너별 통계 — 적재율 (CBM %·무게 %), 만재 여부, 안전마진

> 7단계는 결과 출력 전용 — 알고리즘 의사결정 흐름과 무관.

---

## 핵심 절대 룰 (코드 수정 시 반드시 유지)

1. **CBM 쪼개기 절대 금지** — 한 cargoId 의 unit 은 한 컨테이너에만 (통로 A·B 양쪽 강제)
2. **점수 합산 사용 금지** — 모든 best 선택은 lex 비교 (4 순위 lexicographic)
3. **부킹 anchor** — 같은 booking 화물은 같은 컨 (위반 시 통관/검수 두 번)
4. **안전마진** — slack < 1.5 m³ 조합 제외 (운송 안전)

---

## 자동 갱신 메커니즘

`.claude/settings.json` 의 `PostToolUse` 훅이 `lib/packing/algorithm.ts` 수정 감지 시 이 문서 갱신 리마인더를 모델 컨텍스트에 주입.

룰: [keep-algorithm-pipeline-updated.md](../.claude/rules/keep-algorithm-pipeline-updated.md)
