# clpclaude 분배 알고리즘 파이프라인

> **자동 갱신 룰**: `lib/packing/algorithm.ts` 수정 시 이 파일도 함께 보강할 것 (rule: `keep-algorithm-pipeline-updated`).
> 마지막 갱신: 2026-05-08 (5.1 조기 종료 + 5.2 발바닥 컬럼 캐시 추가 — packBest 매트릭스 시간 예산 보호; 4.5 발바닥 사전 묶음은 그대로 유지)

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

## 4.5단계: 발바닥 사전 묶음 (큰 컨 전용 사전 컬럼 적층)

**파일**: `lib/packing/footprint-cluster.ts`, `lib/packing/algorithm.ts` (1597-1635줄, 통로 B 진입 직전)

**왜 필요했나**

- 40FT TOTAL 같은 큰 컨테이너에서 앞 단계만 거치면 마지막 1~2 박스가 자리를 못 찾아 미배치로 떨어지는 문제 잔존
- 작은 박스를 통로 B 가 자연 배치할 때 빈틈 위에 못 올리고 옆으로만 깔다가 잔여 공간 낭비

**원리 한 줄**

> "박스 발바닥(바닥면 가로·세로) 같으면 미리 위로 쌓아 자리 만들기"

### 룰 A — 같은 부킹 내부 발바닥 컬럼 묶기

같은 부킹 안에 발바닥 크기(가로·세로) 가 동일(±5cm) 한 박스들이 2개 이상이면 **사전에 위로 자체 적층**.

| 항목 | 내용 |
|---|---|
| 묶음 조건 | 같은 부킹 + 발바닥 차이 ≤ 5cm |
| 정렬 | 무거운 것 아래 (heavierBelow 룰 통과) |
| 높이 한도 | 컬럼 총 높이 ≤ 도어 높이 |
| 거부 조건 | 다단금지 박스 포함 시 묶음 X |

### 룰 B — 큰 컬럼 위에 작은 발바닥 박스 흡수

룰 A 가 만든 컬럼의 꼭대기 위에 **다른 부킹**의 작은 발바닥 박스를 흡수.

| 항목 | 내용 |
|---|---|
| 흡수 조건 | 받침 비율 (작은 박스 발바닥 / 받침 박스 발바닥) ≥ 70% |
| 부킹 보호 | 흡수되는 박스의 부킹 전체가 같은 컨테이너에 들어갈 때만 (한 부킹 = 한 컨 룰 보호) |
| 후보 우선순위 | 받침률 높을수록 → 낮은 위치 → 안쪽 (lex 비교, 점수 합산 X) |
| 거부 조건 | 다단금지·도어 높이 초과·중량 한도 초과·충돌 |

### 활성 조건 (보수적 — 작은 시나리오 영향 X)

| 조건 | 값 |
|---|---|
| 컨테이너 부피 | ≥ 50 m³ (40FT급만) |
| 후보 박스 풀 | ≥ 5개 |
| 모드 | 통로 B (사이즈 있는 박스) 만 |
| 비활성 옵션 | `options.footprintCluster.enabled = false` |

→ 1ST SG 같은 20FT 적은 박스 시나리오는 자동 우회.

### 예시 — 3ST SG 컨2 VPHI 케이스

| 상태 | 결과 |
|---|---|
| 사전 묶음 전 | VPHI 부킹 9 박스 자연 배치 → 마지막 1 박스 자리 부족 |
| 룰 A 적용 | VPHI 9 박스 중 발바닥 동일 6 박스를 3 컬럼(2단)으로 사전 적층 |
| 룰 B 적용 | 그 컬럼 꼭대기 받침 75% 자리에 다른 부킹 작은 박스 1 개 흡수 |
| 결과 | 마지막 1 박스 자리 확보 + 다른 부킹 박스 1 개 추가 흡수 |

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

## 5.6단계: 자리 바꾸기 후 rescue repack (`Rescue repack`)

**파일**: `lib/packing/algorithm.ts` (5.6 rescue repack 블록)

**발동 조건**: `unplaced.length > 0` (미배치 발생 시만)

- 미배치 cargo 가 fixedMap 으로 지정된 컨테이너에 이미 배치된 모든 unit 꺼내기
- 미배치 unit 포함하여 tall-first + LDF 순으로 재배치 시도
- 모두 들어가면 commit, 하나라도 실패하면 스냅샷 복원
- 점수 합산 X — 미배치 줄었을 때만 commit

## 5.7단계: 행 기반 잔여공간 fitting (Stage 6)

**파일**: `lib/packing/row-residual.ts`, `lib/packing/algorithm.ts` (5.7 Stage 6 블록)

**발동 조건**: `unplaced.length > 0` (rescue repack 후에도 미배치 남을 때만)

원리:
1. 컨테이너 현재 배치물을 Y 축 경계로 클러스터링 → "행(row)" 목록 추출
2. 각 행의 잔여공간 계산: 바닥 우측 빈 폭(`floorFreeWidth`), 천장 여유(`ceilClearance`)
3. 미배치 unit 을 cargoId 사전식 정렬 후, 각 행 잔여공간에 6면 회전 fitting 시도
4. 기존 `tryPlaceUnit` / `tryPlaceUnitBruteForce` 재사용 (받침면·충돌·다단금지 검사 자동)

**cargoId 원자성 보장**:
- 같은 cargoId 의 모든 unit 이 한 컨에 모두 들어갈 때만 commit
- 하나라도 실패 → 스냅샷 전체 복원, 다음 컨 시도
- 어느 컨도 실패 → 미배치 그대로 유지

## 5단계: 다중 strategy 비교 (`packBest`)

**파일**: `lib/packing/algorithm.ts:packBest`

- 같은 화물 데이터로 최대 56 가지 (정렬 7 × 모드 2 × 컨 순서 2 × 클러스터링 2) 조합 시도
- **lex 비교** (점수 합산 X):
  ① 미배치 적은 것 → ② 입고완료 마감된 것 → ③ 충전률 → ④ 동종 컨 균형(`balancePenalty`)
- 가장 좋은 결과 채택

### 5.1 — 조기 종료 (시간 예산 보호, 2026-05-08 추가)

큰 시나리오(35 화주 × 다중 시나리오 매트릭스)에서 매트릭스가 너무 무거워 8분 환경 한계 초과 문제 해결.

| 단계 | 종료 조건 | 효과 |
|---|---|---|
| 매트릭스 (`tryAllStrategies`) | 어느 시도 결과의 미배치 0 도달 | 잔여 시나리오 전부 스킵 (중첩 4중 루프 모두 break) |
| 백트래킹 루프 | (a)/(b) 통과 후 미배치 0 | 백트래킹 즉시 종료 |
| 우선순위 | `ldf` × `biggest-first` × `consolidate=true` × `wrapper` 가 1번 시도 | 발바닥 사전 묶음 활성 시나리오부터 → 조기 종료 빨리 발동 |

**왜 안전한가**: 사용자 1순위인 미배치 0 만족 시 추가 시도의 비용 > 이득. 균형/충전률 차이는 백트래킹 단계 (b)·6단계 swap 으로 보정됨.

### 5.2 — 발바닥 컬럼 캐시 (2026-05-08 추가)

**파일**: `lib/packing/footprint-cluster.ts` — `cachedGroupFootprintColumns` (Map cache, 상한 256개)

- packBest 매트릭스가 같은 unit 풀에 대해 같은 발바닥 컬럼을 매번 재계산하던 비용 제거
- key = unit signature (id+w+l+h+booking+weight+noStacking) 정렬 join
- LRU 식 상한 (오래된 항목 1개 제거) — 메모리 폭주 방지

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
3. **부킹 고정점** — 같은 부킹 화물은 같은 컨 (위반 시 통관/검수 두 번)
4. **안전마진** — 잉여 용량 < 1.5 m³ 조합 제외 (운송 안전)
5. **한 부킹 = 한 컨 룰은 흡수 시에도 유지** — 4.5단계 룰 B 흡수 시 흡수되는 박스의 부킹 전체가 같은 컨테이너에 들어갈 때만 흡수 허용 (다른 컨으로 부킹 쪼개지 않음)
6. **받침 ≥ 70% 강제** — 4.5단계 룰 B 박스 흡수 시 받침 비율 70% 미만이면 거부 (떨어지는 적재 방지)

---

## 자동 갱신 메커니즘

`.claude/settings.json` 의 `PostToolUse` 훅이 `lib/packing/algorithm.ts` 수정 감지 시 이 문서 갱신 리마인더를 모델 컨텍스트에 주입.

룰: [keep-algorithm-pipeline-updated.md](../.claude/rules/keep-algorithm-pipeline-updated.md)
