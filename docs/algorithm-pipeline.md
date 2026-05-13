# clpclaude 분배 알고리즘 파이프라인

> **자동 갱신 룰**: `lib/packing/algorithm.ts` 수정 시 이 파일도 함께 보강할 것 (rule: `keep-algorithm-pipeline-updated`).
> 마지막 갱신: 2026-05-13 (**cbmSource 인프라 + 컨테이너 셋 결정용 declared CBM 헬퍼 (2차-A) + `/api/pack` useCandidateUnion 옵션 (2차-A-2)**):
> ① `types/cargo.ts` 에 `CargoCbmSource` (6종: excel-cfs/manual-cfs/distributed-cfs/distributed-about/calculated/legacy-cfs) + `UnitSizeCbmSource` (5종: user/calculated/distributed-cfs/distributed-about/legacy-unit-cbm) 신규.
> ② `CargoSpec.cbmSource` + `UnitSize.cbmSource` 필드 추가 (옵셔널).
> ③ ExcelImport 파싱 → 'excel-cfs', 메인 표 직접 입력 → 'manual-cfs', distributeBookingValues 분배 → 'distributed-cfs/about', UnitSizesModal 자동 분배 → 'distributed-cfs/about/calculated', 모달 직접 입력 → 'user'.
> ④ DB 마이그레이션 0011: `cargo_items.cbm_source` 컬럼 추가, legacy 폴백 'legacy-cfs' 처리.
> ⑤ `getDeclaredCbmForContainerDecision(c)` 헬퍼: CFS 계열 → ABOUT → 시스템 CBM 순으로 컨 셋 결정용 부피 계산.
> ⑥ `pack()` 안 `_dbgUserDeclaredTotalCbm` 가 헬퍼 사용 → `packBestWithCandidateUnion` declared 후보 생성이 cbmSource 기반으로 정확해짐.
> ⑦ `/api/pack` 라우트에 `useCandidateUnion` 옵션 추가 — 기본 false (packBest 그대로), true 면 `packBestWithCandidateUnion` 사용. 응답에 `decisionMode: 'packBest' | 'candidateUnion'` 부착.
> 검증: 단위 테스트 54/54, 10 샘플 production 경로 회귀 0, useCandidateUnion=true 시 망작 SG 40FT 1대 단락 채택 / 4ST HM 40+40+20 유지 / 5ST SG 40+40 유지. 성능 이슈: 4ST HM candidateUnion 79.5s (별도 과제).
> classify 본체·Rule G/D/E/audit 무변경. production 기본 경로 영향 0.
>
> 이전 갱신: 2026-05-12 (**룰 G 사전 묶음 승격 — 5.36 단계 신규 + 활성 조건 강화 (variable unitSizes + noStacking 필터)**: 룰 G 를 기존 5.44 fallback (룰 F 직전) 만이 아니라 **5.36 사전 단계 (preClusterFootprint 직후, 일반 placeQueue 직전)** 에도 호출해 noStacking=true + variable unitSizes 묶음이 일반 박스에 자리 빼앗기기 전에 우선 row-lane 배치. fallback 단계 (5.44) 는 안전망으로 그대로 유지. `groupNearRowLaneBundles` 에 신규 두 조건: ① 적어도 한 unit 이 noStacking=true (적층 금지 보호 필요한 묶음만) ② variable unitSizes — 같은 cargoId 안 unit 사이즈가 모두 정확히 동일하면 skip (일반 큐가 처리). cargoId atomic 보호 — partial 발생 시 전체 롤백 (tryPlaceRowLaneBundle snapshot 복원). 모든 활성 컨테이너에 시도 (fixedAssignment 금지, 사용자 룰 6). 사례: SK GEO CENTRIC (FBSIN260431) sg3-35 — 변경 전 통합 환경에서 1건 미배치 (일반 박스 자리 다 차지한 뒤 룰 G 호출 → 빈 공간 없음, pack 시간 487초) → 변경 후 미배치 0건, pack 시간 5.5초 (88배 단축). 단위 테스트 109/109 통과. 회귀 매트릭스 5/5: 1ST SG (미배치 0·mismatch 8 동일), 2ST SG (PASS 동일), 3ST SG (미배치 1→0·mismatch 29→28 개선), 1ST HM (PASS 동일), 2ST HM (미배치 0 동일·mismatch 30→28 개선). 회귀 0건 확인.)
>
> 이전 갱신: 2026-05-12 (**룰 G — Row-lane 묶음 (footprint-cluster.ts `preClusterRowLane`)**: 같은 cargoId 박스가 noStacking=true 라서 위로 못 쌓는 케이스를 두 컬럼 폭 방향 옆 + 각 컬럼 안 길이 방향 직렬 배치로 푼다. 모든 박스 z=0 강제 (noStacking 보호). pickLaneFace 가 allowedFaces 안에서 eff.width 작은 면 lex 우선으로 골라 두 컬럼 폭 합 ≤ 컨 안쪽 폭 보장. 활성 조건 10개 모두 검증: ①same cargoId (booking 확장 X) ②noStacking 단 한 박스라도 있으면 모든 unit z=0 강제 ③W/L footprint 차이 ≤5cm ④두 컬럼 이하 ⑤allowedFaces 안에서만 ⑥pickLaneFace 신규 (long-axis-anchor 재사용 X) ⑦orientation=fixed 면 face 0 만 ⑧충돌·경계·atomic·strictStackAudit 통과 ⑨실패/partial 시 전체 롤백 (snapshot 복원) ⑩발동 로그 모듈 변수 (production console.log 금지). 호출 위치: algorithm.ts 5.44 단계 (룰 F 직전, wrapper 모드 + unplaced > 0 시만). 사례: SK GEO CENTRIC (FBSIN260431) sg3-35 — 137×115×85 ×1 + 135×115×129 ×2 모두 noStacking=true. face 1(L×W) 회전 → 폭 115, 두 컬럼 230 ≤ 234. 첫 컬럼 137 + 둘째 컬럼 135+135 직렬. 단위 테스트 40/40 통과 (룰 G 신규 8종). 회귀 매트릭스: 2ST SG TOTAL ✅, 1ST HM TOTAL ✅.)
>
> 이전 갱신: 2026-05-12 (**룰 F — 근사 footprint 적층 묶음 (footprint-cluster.ts `preClusterNearFootprint`)**: 룰 E (정확 동일) 가 풀지 못한 잔여 미배치 unit 풀에 한해서만 fallback 으로 발동. 같은 booking + cargoId atomic + W/L 차이 각각 ≤ 5cm 허용 (높이 다름 OK). 활성 조건 12개 모두 검증: ①같은 booking ②cargoId atomic ③W/L 차이 ≤5cm ④높이 다름 허용 ⑤아래 footprint ≥ 위 footprint ⑥noStacking/bottomOnly 위반 없음 ⑦위 무게 ≤ 아래 무게 (STACK_WEIGHT_TOLERANCE=1.0) ⑧총 적층 높이 ≤ 컨 안쪽 높이 ⑨두 컬럼 이하 (NEAR_MAX_COLUMNS=2) ⑩exact 룰 E 후 미배치 잔여 시만 fallback ⑪partial cargoId 발생 시 전체 롤백 ⑫strictStackAudit 통과 (조건 5+7 적층 단계마다 재검증). 성능 보호: 전역 brute force 금지, 미배치 cargo 의 fixedMap 컨테이너만 시도, 컨 당 최대 8 booking. 단일 cargo + 동일 W·L 묶음은 룰 A 영역으로 패스 (회귀 방지). 호출 위치: algorithm.ts 5.45 단계 (5.5 자리 바꾸기 직전, wrapper 모드 + unplaced > 0 시만). 사례: SK GEO CENTRIC (FBSIN260431) 137×115×85 + 135×115×129 같은 booking — noStacking=true 면 활성 조건 6 위반으로 발동 안 됨 (실제 데이터). 단위 테스트 32/32 통과 (룰 F 신규 9종). 회귀 매트릭스: pack 본체 12.5초·미배치 1·회귀 0; 2ST SG TOTAL PASS·pack 344ms·미배치 0.)
>
> 이전 갱신: 2026-05-12 (**룰 E — cross-cargoId 동일 사이즈 묶음 (footprint-cluster.ts 신규)**: 같은 booking 안 cargoId 가 다른 unit 들 중 W·L·H 모두 정확히 동일한 박스 그룹을 통째로 묶어 같은 row 옆 컬럼들 + 천장까지 적층. 활성 조건 보수적: 같은 booking + 정확히 동일 사이즈 + noStacking=false + 두 컬럼 폭 ≤ 컨 안쪽 폭 + 그룹 unit ≥ 3. CBM 쪼개기 보호 사전 필터: 사용 가능한 슬롯 (두 컬럼 × 천장 단수) 기준으로 cargoId atomic 통째로 들어갈 cargo 만 picked. 사례: VPHI 부킹 (FBSIN260400) sg3-23/24/25 같은 booking + 114×114×71 박스 7개 cross-cargo 묶음 — 룰 E 가 5박스 두 컬럼 3+2단 적층, 룰 A 가 같은 booking 동일 footprint sg3-24 2박스 별도 컬럼 → 7박스 모두 같은 컨, 사용자 답안 재현. 단위 테스트 23/23 통과 (룰 E 신규 7종 + 헬퍼 3종). 회귀 매트릭스 5종 미배치 0 유지.)
>
> 이전 갱신: 2026-05-12 (`tryBundleStack` 옆 컬럼 적층 — 같은 cargoId 동일 사이즈 unit 이 첫 컬럼 (수직 N단) 다 채운 뒤에도 남으면 같은 row 평면 옆 자리 (x = 첫 컬럼 x + 폭) 에 두 번째 컬럼 강제 적층 시도)
>
> 이전 갱신: 2026-05-12 (Row-lane bundle 추가 — `lib/packing/long-axis-anchor.ts` `SLENDERNESS_THRESHOLD` 0.25 → 0.40 완화 + `tryRowLaneAnchor` 신규 함수 추가. FLOWBUS 326×116×110 ×2 같은 동일 규격 막대형 묶음을 z=0 한 row 평면에 폭 방향으로 나란히 배치 — 116+116=232 ≤ 234 컨 폭. 큐브형 0.5+ 차단 그대로 유지 → 회귀 0건 목표. 단위 테스트 18/18 통과)
>
> 이전 갱신: 2026-05-11 (① 무게 적층 룰 엄격화 — `STACK_WEIGHT_TOLERANCE` 1.5 → 1.0 (위 박스 무게 ≤ 아래 박스 무게, 사용자 의도). ② `tryPlaceUnitBruteForce` budget+실패 cache 추가 — pack-attempt 1500회·unit 80회 상한, (unit+container+state fingerprint) 실패 캐시 → 같은 state 재시도 차단. ③ 백트래킹 unplacedSet cache — 같은 미배치 셋 두 번째 등장 시 break. ④ `lib/packing/audit.ts` 신규 — `strictStackAudit` 좌표 기반 사후 검증 함수. 결과: 3번 SG 80분+ 미수렴 → 4분 41초로 17배+ 단축, 5 샘플 모두 회귀 0건. 4.5 발바닥 사전 묶음 입구 258 검사 제거 동시 적용)

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

### 분기 기준 — **사이즈 우선** (cargoType 라벨 무시)

**파일**: `lib/packing/algorithm.ts:classify`

| 입력 화물 | 가는 통로 |
|---|---|
| W·L·H 모두 ≥ 1cm (또는 unitSizes 가 모두 양수) | **통로 B 시각 적재** (cargoType 가 CT 라도 시각화) |
| 사이즈 없음 (W/L/H ≤ 0 + unitSizes 도 비어있음) | **통로 A CT 벌크** (CBM 합산만) |
| 모든 행이 c.cbm 입력 + 화물 ≥ 2개 | **통로 A 전체 위임** (전부 입고완료 출하 케이스) |

→ "사이즈 적힌 건 다 시각" 룰 보장. cargoType 은 화면 라벨/색 구분 등에만 사용.

**진단 옵션**: `PackOptions.strictVisualClassification = true` (production 기본 X — 옵션) 일 때 위 표 3번째 룰에 `anyHasSize` 가드 적용 → 사이즈 입력된 행이 한 건이라도 있으면 룰 1 우회. 자동 계산 CBM / distributeBookingValues 분배 결과로 all `c.cbm > 0` 가 돼도 사이즈 있는 행을 visual 트랙으로 보냄. 진단/실험용, production 호출 경로 (`/api/pack` 기본값) 영향 0.

**컨 셋 결정용 declared CBM (2026-05-13 2차-A)**: `getDeclaredCbmForContainerDecision(c)` 헬퍼가 cbmSource 라벨 기준으로 우선순위 적용 — ① CFS 계열 (excel-cfs / manual-cfs / distributed-cfs / legacy-cfs) → `c.cbm`, ② `c.aboutCbm > 0` → ABOUT, ③ 폴백 → `cargoCbm(c)` (시스템 CBM). `packBestWithCandidateUnion` 의 declared 후보 생성에 직결되어 calculated 행이 사용자 신고 CFS 로 오인되는 결함 해소.

**`/api/pack` 라우트 (2026-05-13 2차-A-2)**: `useCandidateUnion: true` 옵션 시 `packBestWithCandidateUnion` 사용 (기본 false → 기존 `packBest`). 응답 summary 에 `decisionMode: 'packBest' | 'candidateUnion'` 부착.

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

#### `tryBundleStack` 묶음 stack 동작 (확장 — 2026-05-12)

| 단계 | 동작 |
|---|---|
| ① 동일 사이즈 검사 | 같은 cargoId 의 모든 unit 이 (w,l,h) 동일이어야 진입 (`allUnitsSameSize`) |
| ② 첫 컬럼 face 선택 | 컨 안에 들어가고 stack 효율 좋은 회전 면 선택 (`pickBundleFace`) |
| ③ 첫 컬럼 적층 | (x₀, y₀, z=0) 부터 위로 N단 적층, plannedStack 도달 시 종료 |
| ④ **옆 컬럼 적층 (신규)** | group 에 unit 더 남았으면 같은 (y₀, z=0) 의 옆 (x=x₀+폭) 에 같은 face 강제로 두 번째 컬럼 base 시도 |
| ⑤ 옆 컬럼 위 적층 | base 박음 성공하면 그 위로 plannedStack-1 단까지 강제 적층 |
| ⑥ 폭 한도 시 종료 | 다음 컬럼 폭이 컨 안쪽 폭 초과하면 종료, 남은 unit 은 호출자 fallback |

**활성 조건 (보수적)**: 같은 cargoId 안에서만, 한 row 안에서만, noStacking=false 인 경우만. cross-cargoId 묶음은 다루지 않음 (회귀 위험 고려) — 다른 cargoId 끼리의 옆 묶음은 `footprint-cluster` 단계에서 같은 booking 끼리만 처리.

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
| 높이 한도 | 컬럼 총 높이 ≤ 천장 높이 (입구 258 검사 X — 컬럼도 안에서 하나씩 쌓는 가정, 자유 적재와 일관성, 2026-05-11) |
| 거부 조건 | 다단금지 박스 포함 시 묶음 X |

### 룰 B — 큰 컬럼 위에 작은 발바닥 박스 흡수

룰 A 가 만든 컬럼의 꼭대기 위에 **다른 부킹**의 작은 발바닥 박스를 흡수.

| 항목 | 내용 |
|---|---|
| 흡수 조건 | 받침 비율 (작은 박스 발바닥 / 받침 박스 발바닥) ≥ 70% |
| 부킹 보호 | 흡수되는 박스의 부킹 전체가 같은 컨테이너에 들어갈 때만 (한 부킹 = 한 컨 룰 보호) |
| 후보 우선순위 | 받침률 높을수록 → 낮은 위치 → 안쪽 (lex 비교, 점수 합산 X) |
| 거부 조건 | 다단금지·천장 높이 초과·중량 한도 초과·충돌 (입구 검사 X) |

### 활성 조건 (보수적 — 작은 시나리오 영향 X)

| 조건 | 값 |
|---|---|
| 컨테이너 부피 | ≥ 50 m³ (40FT급만) |
| 후보 박스 풀 | ≥ 5개 |
| 모드 | 통로 B (사이즈 있는 박스) 만 |
| 비활성 옵션 | `options.footprintCluster.enabled = false` |

→ 1ST SG 같은 20FT 적은 박스 시나리오는 자동 우회.

### 룰 C — 화물·부킹 atomic 후처리 (2026-05-08 추가)

사전 묶음이 한 화물(cargoId)의 박스 일부만 깔고 나머지는 못 깔면 **CBM 쪼개기 위반**(절대 룰 #4) 위험.
같은 부킹의 다른 화물이 partial 이면 **B1 위반**(부킹 분산) 위험.

| 단계 | 동작 |
|---|---|
| 사전 묶음 종료 후 검사 | 풀 안 미배치 박스가 남은 cargoId 들 모음 (= partial cargo) |
| 부킹 확장 | partial cargo 가 속한 부킹들 모두 partial 부킹으로 표시 |
| 롤백 | partial cargo + partial 부킹의 사전 배치 placement 모두 제거 |
| 후속 단계 | placeQueueWrapper 가 통째로(atomic) 재배치 |

**효과 (3ST SG VPHI):** 사전 단계가 sg3-23 같은 cargo 의 박스 일부만 컨1 에 깔면 모두 되돌리고, 정식 단계가 부킹 9 박스를 컨1 에 통째로 처리.

### 예시 — 3ST SG 컨2 VPHI 케이스

| 상태 | 결과 |
|---|---|
| 사전 묶음 전 | VPHI 부킹 9 박스 자연 배치 → 마지막 1 박스 자리 부족 |
| 룰 A 적용 | VPHI 9 박스 중 발바닥 동일 6 박스를 3 컬럼(2단)으로 사전 적층 |
| 룰 B 적용 | 그 컬럼 꼭대기 받침 75% 자리에 다른 부킹 작은 박스 1 개 흡수 |
| 결과 | 마지막 1 박스 자리 확보 + 다른 부킹 박스 1 개 추가 흡수 |

### 룰 D — 안쪽 깊숙이 고정점 (best-fit-deepest, 2026-05-08 추가)

**왜 필요했나**

- 사전 묶음(컬럼)을 만들어도 첫 박스를 도어 근처(y 최솟값) 자리에 박으면 큰 묶음이 도어를 막아 작은 박스 끼울 자리가 부족
- 손 실험은 큰 묶음(VPHI 4컬럼)을 컨테이너 X=326 같은 안쪽 깊숙이 자리에 박아 도어 쪽에 자유 공간 남김 → 작은 박스 끼워넣기 쉬워져 0/27 도달
- 시스템도 같은 패턴 자동 시도 필요

**한 줄 원리**

> "묶음의 첫 박스는 컨테이너 안쪽 끝 자리 우선 — 도어 쪽에 자유 공간 남기기"

**이삿짐 트럭 비유** — 큰 소파·냉장고를 차 안쪽 벽에 먼저 박고, 작은 박스는 도어 쪽 빈 공간에 끼워 넣음.

| 단계 | 동작 |
|---|---|
| 묶음 첫 박스 자리 후보 검색 | `tryPlaceUnit` 의 lex 비교 점수 함수를 `-y * 1e8 + x * 1e4 + z` 로 교체 (안쪽 끝 우선 → 왼쪽 → 바닥) |
| 검증 재사용 | 충돌·지지(70%)·중량 한도·면 회전·다단금지 모두 기존 검증 그대로 |
| 자리 못 찾으면 | brute-force 차선책 그대로 사용 |
| 비활성 옵션 | `options.footprintCluster.deepAnchor = false` |

**효과 (3ST SG TOTAL):** sg3-16 리틀스푼 1박스 미배치(이전 75분 56-매트릭스에서도 못 풀던 NP-hard 케이스) → **lightMode (12 매트릭스, 1초)에서도 0 미배치 도달**.

### 룰 E — cross-cargoId 동일 사이즈 묶음 (2026-05-12 추가)

**왜 필요했나**

- 룰 A 는 같은 booking + 같은 footprint(±5cm) 박스를 컬럼 1개로만 묶음
- VPHI 같은 케이스: 같은 booking 안 cargoId 가 다른 박스가 모두 W·L·H 정확히 동일하면, **사용자 답안은 같은 row 옆에 두 컬럼 + 천장까지 적층** 후 마지막 1박스
- 룰 A·B 는 cargoId 경계 안에서만 컬럼 만들어서 옆 컬럼이 다른 row 로 흩어져 자리 낭비

**한 줄 원리**

> "같은 발송 부킹 안 박스 사이즈가 정확히 같으면, 화물 행이 달라도 옆에 묶어서 천장까지 한 row 에 쌓아라"

**이삿짐 트럭 비유** — 같은 거래처 짐이라 묶음표가 같고 박스 사이즈도 모두 똑같으면, 행이 다르더라도 같은 줄 옆에 차곡차곡 쌓는다.

| 단계 | 동작 |
|---|---|
| ① 후보 그룹 검색 | 같은 booking 안 W·L·H 정확히 동일 (±0) + noStacking=false 인 박스 모음 — 그룹 unit ≥ 3 |
| ② cargo atomic 사전 필터 | 두 컬럼 × 천장 단수 = 슬롯 수 산출, cargoId 별로 통째 들어갈 cargo 만 picked (CBM 쪼개기 절대 룰 보호) |
| ③ 첫 컬럼 base 박기 | deepAnchor 우선 (안쪽 끝 y 최댓값), 실패 시 자연 EP 또는 brute-force |
| ④ 첫 컬럼 천장까지 적층 | 같은 (x,y) 강제, heavierBelow + 무게 한도 + 천장 검사 |
| ⑤ 옆 컬럼 시작 | x = 첫 컬럼 x + 폭, 같은 row(y) z=base, 충돌 검사 통과 시 base 박기 |
| ⑥ 옆 컬럼 천장까지 적층 | ④ 와 동일 |
| ⑦ 폭 한도 도달 시 종료 | 다음 컬럼 폭 (x + 2*폭) > 컨 안쪽 폭 → 종료, 남은 unit 은 룰 A·B·정식 wrapper 에 위임 |

**활성 조건 (보수적)**

| 조건 | 값 |
|---|---|
| 같은 booking 그룹 unit | ≥ 3 (작은 묶음은 룰 A 가 처리) |
| 사이즈 비교 | W·L·H 정확히 동일 (±0) |
| 다단금지 박스 | 단 한 박스라도 있으면 그룹 제외 |
| 두 컬럼 폭 | width × 2 ≤ 컨 안쪽 폭 |
| 한 단 높이 | ≤ 컨 천장 높이 |

**사례 (3ST SG VPHI 컨2)**

| 박스 | 부킹 | cargo | 사이즈 | 수량 |
|---|---|---|---|---|
| sg3-23 | FBSIN260400 (VPHI) | sg3-23 | 114×114×71 | 2 |
| sg3-24 | FBSIN260400 | sg3-24 | 114×114×71 | 2 |
| sg3-25 | FBSIN260400 | sg3-25 | 114×114×71 | 3 |

→ 룰 E 가 큰 cargo 우선 picked: sg3-25(3) + sg3-23(2) = **5박스 cargo atomic** 으로 두 컬럼 3+2 단. sg3-24(2) 는 슬롯 초과로 제외 → 룰 A 가 같은 booking footprint 동일로 별도 컬럼 적층. **결과: 7박스 모두 같은 row 묶음 패턴으로 같은 컨 배치, 사용자 답안과 일치**.

### 룰 G — 같은 화물 다단금지 옆 나란히 깔기 (`preClusterRowLane`, 2026-05-12 사전 묶음 승격)

**왜 필요했나**

- 한 화물 안에 박스 사이즈가 살짝 다르고 **모두 다단금지** 표시인 케이스
- 위로 못 쌓고 옆으로만 나란히 깔아야 하는데, 룰 F(적층 묶음)는 다단금지 박스 포함 시 묶음 X
- 일반 큐가 자리 다 차지한 뒤 fallback 으로 호출되면 이미 빈 공간 없음 → 사전 묶음으로 승격

**한 줄 원리**

> "한 화물 안 박스 사이즈가 다르고 모두 다단금지면, 두 줄 폭 방향 옆으로 나란히 깔고 각 줄 안에서 길이 방향으로 직렬 배치하라"

**짐 정리 비유** — 길고 위에 못 쌓는 박스 묶음을 컨테이너 한쪽 벽 따라 두 줄 + 길이 직렬로 깔아두면, 나머지 공간이 일반 박스 받기 좋게 정돈된다.

| 단계 | 동작 |
|---|---|
| ① 같은 화물 묶음 검색 | 같은 cargoId, 다단금지 단 한 박스라도 true, 박스 사이즈가 정확히 같지 않은 변동 묶음, 박스 끼리 폭·길이 차이 ≤ 5cm |
| ② 깔기 면 선택 (`pickLaneFace`) | 회전 가능 면 중 폭 작은 면 우선 (두 줄 폭 합 최소화) |
| ③ 첫 줄 첫 박스 박기 | deepAnchor 우선 (안쪽 끝 y 최댓값), 회전 강제 |
| ④ 첫 줄 길이 방향 직렬 | 같은 x, 같은 z=0, y 누적, 다음 박스 충돌 검사 |
| ⑤ 옆 줄 시작 (두 줄 한도) | x = 첫 줄 x + 폭, 같은 base y, z=0 |
| ⑥ 옆 줄 길이 방향 직렬 | ④ 와 동일 |
| ⑦ 화물 atomic 검증 | 한 박스라도 못 들어가면 전체 롤백 (snapshot 복원) |

**활성 조건 (일반 물리 기준 — 특정 화물 하드코딩 X)**

| 조건 | 값 |
|---|---|
| 같은 화물(cargoId) 안 박스 | ≥ 2 |
| 다단금지(noStacking) | 단 한 박스라도 true |
| 박스 사이즈 | 정확히 같지 않은 변동 (모두 동일이면 일반 큐가 처리) |
| 폭·길이 footprint 차이 | ≤ 5cm |
| 줄 수 | ≤ 2 |
| 회전 면 선택 | `allowedFaces` 교집합 안에서, orientation=fixed 면 회전 X |
| 모든 박스 z 좌표 | 0 강제 (다단금지 보호) |
| 부킹 split / 화물 split | 절대 금지 (사전 단계와 fallback 양쪽) |
| 강제 컨테이너 배정 (`fixedAssignment`) | 사용 X — 모든 활성 컨테이너에 물리 시도 |

**적용 위치 (호출 순서 — 사전 + 안전망 이중)**

| 단계 | 위치 | 발동 조건 |
|---|---|---|
| **5.36 사전** | `preClusterFootprint` 직후, 일반 placeQueue 직전 | wrapper 모드 + footprintCluster 활성 |
| **5.44 안전망** | 룰 F 직전 | wrapper 모드 + unplaced > 0 |

**사례 (3ST SG SK GEO CENTRIC, FBSIN260431)**

| 박스 | 사이즈 | 수량 | 다단금지 |
|---|---|---|---|
| sg3-35 | 135×115×129 | 2 | true |
| sg3-35 | 137×115×85 | 1 | true |

- 회전 후 폭 115cm → 한 줄 직렬도 가능 (115+115+137 ≤ 1200, 두 줄 230 ≤ 234 도 가능)
- 변경 전: 일반 큐가 자리 다 차지 → 룰 G fallback 호출 시 빈 공간 없음 → 1박스 그룹 미배치, pack 487초
- 변경 후: 5.36 사전 단계에서 일반 큐 시작 전 자리 확보 → 미배치 0건, pack 5.5초 (88배 단축)

**회귀 매트릭스 (9 샘플, 2026-05-12)**

| 샘플 | baseline 미배치 | 변경 후 미배치 | mismatch 변화 | 비고 |
|---|---|---|---|---|
| 1ST SG TOTAL | 0 | 0 | 8 → 8 | 동일 |
| 2ST SG TOTAL | 0 | 0 | PASS | 동일 |
| 3ST SG TOTAL | **1 (SK GEO)** | **0** | 29 → 28 | 미배치 해결 + 개선 |
| 4ST SG TOTAL | 0 | 0 | — | 동일 |
| 망작 SG TOTAL | 0 | 0 | — | 동일 |
| 1ST HM TOTAL | 0 | 0 | PASS | 동일 |
| 2ST HM TOTAL | 0 | 0 | 30 → 28 | 개선 |
| 3ST HM TOTAL | 0 | 0 | — | 동일 |
| 4ST HM TOTAL | 0 | 0 | — | 동일 |

**회귀 0건. 미배치 1→0 해결. mismatch 1~2건 개선.** 단위 테스트 109/109 통과.

## 4.6단계: 긴 막대형 박스 모서리 박음 (장축 고정점 — 자동 활성 + 임계 강화)

**파일**: `lib/packing/long-axis-anchor.ts`, `lib/packing/algorithm.ts` (4.5 발바닥 사전 묶음 직전 hook)

**왜 필요했나**

- 3ST SG 같은 시나리오에 311×15×15 cm 같은 단행 막대형(롱빔) 박스가 들어 있음
- 작은 박스가 먼저 자리를 차지해서 311 cm 연속 슬롯을 못 찾고 미배치로 떨어짐
- 그러나 무조건 막대형을 먼저 박으면 큐브형 박스(예: 114×114×71 VPHI)에서 회귀 발생

**한 줄 원리**

> "기본 켜져 있음. 단, 정말 가는 막대형(311×15×15 같은) 만 골라서 컨테이너 안쪽 모서리부터 박는다."

### 동작 방식 — 자동 활성 (default ON, 2026-05-08 변경)

| 단계 | 동작 |
|---|---|
| 일반 시도 (변경 후) | `longAxisAnchor` **기본 활성** — pack() 단독 호출에서도 자동 발동 |
| 명시적 OFF | 호출자가 `longAxisAnchor: { enabled: false }` 지정 시만 비활성 |
| 추가 안전망 | `packBest` fallback 그대로 유지 — 미배치 발생 시 매트릭스 한 번 더 (이중 보호) |
| 결과 비교 | lex 비교 ① 미배치 적은 것 → ② 마감 → ③ 충전률 → ④ 균형 |

### 활성 조건 강화 (2026-05-08, 회귀 방지)

큐브형 박스가 막대형 룰에 잘못 끼지 않도록 세 가지 조건 모두 만족해야 후보:

| 조건 | 임계 | 예시 통과 / 탈락 |
|---|---|---|
| ① 절대 길이 | 최대 변 ≥ 300 cm | 311 통과 / 250 탈락 |
| ② 컨 비례 길이 | 최대 변 ≥ 컨 길이 × 25% | 40FT(1200) → 300 이상, 20FT(590) → 148 이상 |
| ③ 막대 형상 비율 | min 변 / max 변 ≤ 0.40 | 311×15×15 = 0.048 통과 / 326×116×110 FLOWBUS = 0.337 통과 / 114×114×71 VPHI = 0.62 탈락 |

→ 진짜 가는 봉 형태 (slender rod) + 긴 막대 (FLOWBUS급) 만 통과. 큐브형/판형은 일반 배치 그대로.

**변경 이력 (2026-05-12)**: 비율 임계 0.25 → 0.40 으로 완화. FLOWBUS 326×116×110 (비율 0.337) 같은 긴 막대형이 통과해 row-lane 묶음에 들어옴. 큐브형 (0.5+) 차단은 그대로 유지 → 회귀 0건 목표.

### Row-lane 묶음 (2026-05-12 추가)

같은 cargoId 의 동일 크기 막대형 박스 N개를 컨테이너 폭 방향으로 나란히 한 row 평면(z=0)에 묶어 배치.

| 활성 조건 | 내용 |
|---|---|
| ① 같은 cargoId unit ≥ 2 AND 모든 unit 동일 (w, l, h) | 동일 규격 묶음만 |
| ② noStacking=true 또는 가장 긴 변 ≥ 컨 길이 × 25% | 적층 가능 + 짧은 박스는 row-lane 안 발동 |
| ③ 회전 face 중 짧은 변 × N ≤ 컨 안쪽 폭 | 폭 안에 N개 나란히 들어가야 |

| 동작 | 내용 |
|---|---|
| 회전 강제 | 가장 긴 변을 length 축에 정렬 (long-along-X) — 기존 정책 유지 |
| 폭 방향 나열 | 첫 박스 x=0, 두 번째 x=짧은변, … 모두 z=0 한 row 평면 |
| 통째 commit | 모두 들어가야 commit, 한 박스라도 충돌·boundary 초과 시 반환 → 기존 cursor anchor 로 폴백 |
| 예시 | FLOWBUS 326×116×110 ×2 → 회전 후 width 116, length 326. 116+116=232 ≤ 234 컨 폭 → 두 박스 한 row 에 z=0 으로 나란히 |

### 막대형 박음 절차 (`anchorLongAxisCargoes`)

| 항목 | 내용 |
|---|---|
| 회전 강제 | 가장 긴 변이 컨테이너 길이 축에 일치 (long-along-X) |
| 시작 위치 | 컨테이너 안쪽 끝(y = 안쪽길이 - 막대길이) — 일반 박스의 y=0 영역 보호 |
| 한 화물 통째 | 한 cargoId 의 모든 unit 통째로 들어가야 commit (CBM 쪼개기 금지 ✅) |
| 부킹 보호 | 한 부킹 = 한 컨 룰 유지 (`bookingAnchor` 갱신) |
| 거부 시 | 다음 컨테이너 후보로 이동, 끝까지 안 되면 다음 단계로 패스 |

### 효과 (2026-05-08 변경 후)

| 시나리오 | 단독 pack() OFF | 단독 pack() ON (default) |
|---|---|---|
| 1ST SG | 1 미배치 (sg1-4 보현석재) | 1 미배치 (동일, 회귀 0) |
| 2ST SG | 0 미배치 | 0 미배치 (회귀 0) |
| 2ST HM | 0 미배치 | 0 미배치 (회귀 0, B1 atomic 유지) |
| 3ST SG | 1 미배치 (sg3-8 세아특수강 311 cm) | 막대형 풀림, packBest 매트릭스+swap 으로 0 도달 시도 |

→ 큐브형 회귀 0건. 막대형 시나리오에서 자동 발동.

### 2026-05-12 row-lane bundle 효과 (FLOWBUS 326×116×110)

| 단계 | 내용 |
|---|---|
| 변경 전 | FLOWBUS slenderness 0.337 → 0.25 임계 못 넘어 long-axis 후보 탈락 → 일반 배치에서 row 분산 |
| 변경 후 | 임계 0.40 통과 → row-lane 모드 발동 → 2개 박스 폭 방향 나란히 묶어 z=0 한 row block |
| 단위 테스트 | 18/18 통과 (FLOWBUS row-lane 묶음, 큐브 200³ 거부, 단일 unit 거부, 짧은 박스 거부, FLOWBUS×3 폭 초과 거부 모두 검증) |

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

- 같은 화물 데이터로 최대 64 가지 (정렬 8 × 모드 2 × 컨 순서 2 × 클러스터링 2) 조합 시도
- **lex 비교** (점수 합산 X, 2026-05-08 갱신 — B1·B2 우선순위 추가):
  ① 미배치 적은 것 → ② **B1 위반 적은 것** (CBM 쪼개기 금지, 절대 룰 #4) → ③ **B2 위반 적은 것** (부킹 분산 금지) → ④ 입고완료 마감된 것 → ⑤ 충전률 → ⑥ 동종 컨 균형(`balancePenalty`)
- 가장 좋은 결과 채택

> **왜 B1·B2 추가**: 기존 lex 는 미배치 0 동점 시 "충전률·균형" 우선이라, 균형 스왑 단계가 fixedAssignment 로 cargoId 분산을 일으키면서도 균형 우수해서 best 로 채택되는 결함 있었음. 옵션 C(안쪽 깊숙이 고정점) 도입과 함께 노출. lex 에 B1·B2 위반 카운트 추가로 절대 룰 위반 결과는 best 로 못 뽑게 차단.

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

### 5.3 — 가벼운 모드 (`lightMode`, 2026-05-08 추가)

**파일**: `lib/packing/algorithm.ts:packBest` (옵션 `PackBestOptions.lightMode`)

매트릭스가 너무 무거워 환경 시간 한계(8분) 안에 한 번도 못 끝나는 큰 시나리오용 빠른 검증 모드.

| 단계 | 기본 (lightMode=false) | lightMode=true |
|---|---|---|
| 정렬 전략 | 7개 (ldf/longest-side/tallest/widest/input/shortest/shortest-height) | **2개** (ldf, longest-side) |
| 컨 순서 | 2개 (biggest-first/smallest-first) | **1개** (biggest-first) |
| 자동마감 | 2개 (true/false) | **1개** (true) |
| 배치 모드 | 2개 (wrapper/pure) | **1개** (wrapper) |
| **매트릭스 합** | **56 시도** | **2 시도** |
| 백트래킹 (a) input front | 12 회 | 1 회 |
| 백트래킹 (b) 미배치 swap | unplaced 마다 매트릭스 재호출 | **스킵** |
| 균형 swap (Swap 패스) | 동작 | **스킵** |
| 장축 모서리 박음 fallback | 동작 (매트릭스 그대로) | 동작 (lightMode 매트릭스 = 2 시도) |

**효과**: 3ST SG TOTAL (35 행, 일반 매트릭스에서 환경 timeout) → lightMode ≈ **1분 44초** 완료.
**대가**: 미배치 0 보장 X (가능성 낮춰서 시간 보장). 회귀 테스트엔 lightMode=false (기본) 유지.

**활성**: `packBest(cargoes, mode, { lightMode: true })`

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
2. **점수 합산 사용 금지** — 모든 best 선택은 lex 비교 (lex 우선순위 — 미배치 → B1 → B2 → 입고완료 → 충전률 → 균형)
3. **부킹 고정점** — 같은 부킹 화물은 같은 컨 (위반 시 통관/검수 두 번)
4. **안전마진** — 잉여 용량 < 1.5 m³ 조합 제외 (운송 안전)
5. **한 부킹 = 한 컨 룰은 흡수 시에도 유지** — 4.5단계 룰 B 흡수 시 흡수되는 박스의 부킹 전체가 같은 컨테이너에 들어갈 때만 흡수 허용 (다른 컨으로 부킹 쪼개지 않음)
6. **받침 ≥ 70% 강제** — 4.5단계 룰 B 박스 흡수 시 받침 비율 70% 미만이면 거부 (떨어지는 적재 방지)
7. **글로벌 무게 룰 (2026-05-08 추가)** — 모든 적층에서 위 박스 무게 ≤ 아래 박스 무게 × 1.5 (등가 OK + 50% 까지 허용). heavierBelow 플래그 무관하게 자동 적용 (실무 안전 룰 — 하단 박스 압축 파손 방지). 무게 정보 누락(0)인 박스는 기존 heavierBelow 플래그 기반 폴백.
8. **무거운 거 먼저 정렬 전략 (`heaviest`, 2026-05-08 추가)** — packBest 매트릭스에 무게 desc 정렬 전략 추가. 무거운 박스가 z=0 자리 우선 점유 → 컬럼 안에서 자연스럽게 무거운 거 아래로 정렬 (룰 #7 강화 효과). 같은 무게는 부피 desc, 긴 변 desc 로 tiebreak.

---

## 자동 갱신 메커니즘

`.claude/settings.json` 의 `PostToolUse` 훅이 `lib/packing/algorithm.ts` 수정 감지 시 이 문서 갱신 리마인더를 모델 컨텍스트에 주입.

룰: [keep-algorithm-pipeline-updated.md](../.claude/rules/keep-algorithm-pipeline-updated.md)
