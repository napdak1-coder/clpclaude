# clpclaude 진행 상황 (2026-05-03 시점)

## 도메인 개념

| 용어 | 의미 |
|---|---|
| **CT 카톤** | 일반 택배박스. 보통 사이즈 안 적힘, CBM 만 옴 |
| **PK 묶음** | 화주가 단위 안 알려줘도 사이즈 적힌 묶음 (WC+카톤 섞임 등). 시각 적재 대상 |
| **입고완료** | 사용자가 CFS CBM (`cargo.cbm`) 입력한 화물 — 자동 마감 후보 |
| **시스템 CBM** | W × L × H × qty / 1,000,000 (자동 계산) |
| **샘플 영속화** | `public/samples/singapore-total.xlsx` 1차 폴백 + 사용자 편집본 `data/samples/<key>.json` (`/api/samples/[key]` GET/PUT) |

## 알고리즘 — 강화 완료 (2026-05-03 commit d241078)

### packBest 56 조합 + 백트래킹
- 7 sortStrategy × 2 containerOrder × 2 autoConsolidate × 2 placementMode = 56
- backtracking 12회 (미배치 cargoId front-swap)
- evaluate: -unp×100000 + consolidationBonus + fillRate
  - 입고완료 가장 작은 컨테이너에 모임 → +2000
  - 큰 컨테이너에 모임 → +1000
  - 흩어짐 → -200 × (분산 컨 수 - 1)

### 핵심 룰

1. **사이즈 우선 분류** (`classify`) — width/length/height > 0 이면 cargoType 무관 시각 적재. 사이즈 없으면 CT bulk
2. **같은 화주 클러스터링** (`sortClustered`) — 같은 shipper unit 인접 배치. LDF 우선순위 보존
3. **같은 cargoId 묶음 stack** (`tryBundleStack`) — 같은 사이즈 ≥2 unit 한 컬럼 세로 stack
   - 회전-aware face 선택 (가장 작은 height)
   - multi-column 반복 (qty=6 → 4-stack + 2-stack)
   - sub-bucket 분리 (unitSizes 다양 → 동일 사이즈만 bundle)
4. **입고완료 자동 마감** (`autoConsolidateCompleted`) — cbm 입력된 화물 합 ≤ 작은 컨테이너 한도면 그 컨에 strict 모음
5. **placeQueue 모드 분기**:
   - `pure` — 단순 LDF + brute-force fallback (작은 그룹용)
   - `wrapper` — bundle/cluster/sub-bucket (큰 그룹용)
   - autoConsolidate 시 split-execute: 입고완료 pure / 비-입고완료 wrapper
6. **EP projection** — Crainic 2008 기법. 박스 6 corner + 6 projection = 12 EP
7. **brute-force grid scan fallback** — extreme-point candidate 못 찾는 빈 자리 5cm 그리드 스캔

### 핵심 함수 (구현 완료)
- `lib/packing/extreme-point.ts`
  - `packExtremePoint(units, spec)` — batch packer
  - `tryPlaceUnit(unit, state, spec, options?)` — per-unit placement
    - options: `scoreFn`, `forceFaceIdx`
  - `tryPlaceUnitBruteForce(unit, state, spec)` — 5cm grid scan fallback
  - `makeContainerState()` — packing state 초기화
- `lib/packing/algorithm.ts`
  - `pack()` — 메인. 분류 → 컨테이너 결정 → designated 결정 → placeQueue
  - `packBest()` — 56 조합 + 백트래킹
  - `tryBundleStack(group, candidates)` — 묶음 stack
  - `pickBundleFace(unit, spec, groupSize)` — 회전 face 결정
  - `sortClustered(units)` — 화주/cargo 클러스터 정렬
  - `placeQueueWrapper(queue)`, `placeQueuePure(queue)` — 두 placement 모드

## 화물 종류 — PK 추가 (2026-05-03)

| 종류 | 처리 |
|---|---|
| PL/WB/WC/WD/CR/CL | 시각 적재 |
| **PK** (신규) | 시각 적재 (사이즈 적힌 묶음) |
| CT | 사이즈 있으면 시각, 없으면 CBM 합산만 |

DB CHECK: `cargo_type IN ('PL','WB','WC','WD','CR','CL','PK','CT')` (마이그레이션 0008)

## DB 마이그레이션 현황

- 0001_init — 기본 스키마
- 0002_cargo_shipper — actual/shipper_name 컬럼
- 0003_plan_normalized — clp_plans 정규화 (plan_containers, plan_rows, plan_placements, plan_unplaced)
- 0004_cargo_unit_sizes — unit_sizes_json 컬럼
- 0005_cargo_about_cbm — about_cbm 컬럼
- 0006_cargo_type — cargo_type 컬럼 + CHECK
- **0007_plan_placements_nullable_row** (2026-05-02) — plan_row_id NULLABLE + ON DELETE SET NULL
- **0008_cargo_type_pk** (2026-05-03) — cargo_type CHECK 에 'PK' 추가

## 시각화 (`components/plan/ContainerView2D.tsx`)

자유 좌표 결과를 layered display 로 표시 — 컬럼 stack, 점선 박스, 천장여유 화살표, anisotropic scale.

**Production scale**: `{x: 1.79, y: 0.385}` (PlanView 에서 적용)

### 알려진 quirk
- `display-rows.ts` 의 supporter 검색이 bottomsAll 에만 → top-on-top stack 일부 화물 화면 누락 (placement 자체는 정상). 별도 작업으로 해결 필요.

## UI 변경

- **RowEditor 삭제** (2026-05-02) — 자유 좌표 알고리즘에서는 행 수동 조정 의미 없음. 자동 계산 안내 문구로 대체
- POST /api/shipments 응답 처리 — `res.ok` 체크 후 `.json()` (이전 DOCTYPE 에러 차단)

## 디버그 / 검증 페이지

- `/debug/rows-mockup` — 자유 좌표 적재 결과 시각화 미리보기 (싱가폴 샘플)
- 스크린샷 자동 생성: `node scripts/screenshot-mockup.mjs <url>`

## 데이터 파일 (gitignored)

- `data/clpnice.db` — SQLite DB. 신규 클론 시 `npm run db:init` 필요
- `data/clpnice.db.bak` — 2026-05-03 데이터 정리 전 백업
- `data/samples/singapore-total.json` — 사용자 편집본 샘플
- `tmp-screenshots/` — 디버그용 (gitignored)

## 검증 스크립트

| 스크립트 | 용도 |
|---|---|
| `verify-physical-rules.mjs` | 사용자 강제분배 시나리오 물리·규칙 audit |
| `verify-completed-20ft.mjs` | 입고완료 5종 20FT 적합성 |
| `verify-distribution-after-cleanup.mjs` | 22종 자동 분배 일치 + 물리 검증 |
| `verify-17-in-40ft.mjs` | 17종 단독 40FT 적재 (모든 strategy 시도) |
| `compare-layout.mjs` | 사용자 손-레이아웃 vs 시스템 텍스트 diff |
| `debug-unplaced.mjs`, `debug-ykmc-unplaced.mjs` | 미배치 분석 |

## 검증 결과 (싱가폴 TOTAL 샘플 기준)

| 시나리오 | 결과 |
|---|---|
| 17종 → 40FT 단독 | ✅ unplaced 0 (84.7% 충전) |
| 5종 → 20FT 단독 | ✅ unplaced 0 (82.1% 충전) |
| 22종 auto 모드 | ✅ unplaced 0 + **5종 → 20FT 정확 마감** + 17종 → 40FT |
| 단위 테스트 | ✅ **40/40 통과** (algorithm 11 + extreme-point 18 + clustering 11) |
| 물리·규칙 (충돌·한도·도어·중량·rules) | ✅ 100% PASS |

## 사용자 입고완료 정의 (현재 적용 중)

다음 5종이 cbm 입력 = 입고완료 표식:
- AWOT
- 대원산업
- 씨에스에프
- HD현대건설기계
- 포컴퍼니

다른 17종은 cbm 비어있음 (입고 전 — 시스템 추정만).

## 다음 세션 시작점

### 우선순위 1 — display-rows top-on-top quirk
같은 컬럼에 top-on-top stack 발생 시 일부 화물이 화면에서 누락 (placement 정상, 화면 표시만 누락). `lib/packing/display-rows.ts` 의 supporter 검색을 `topsAll` 까지 재귀로 확장하면 해결.

### 우선순위 2 — UI에 입고완료 마감 안내
production 화면에 "이 컨은 입고완료 5종 마감 컨테이너입니다" 라벨 추가. 자동 마감된 컨 식별 + 시각 안내.

### 우선순위 3 — fixedAssignment UI
사용자가 화면에서 "이 화물은 어느 컨테이너에" 직접 지정. 이미 옵션 코드에 있음 (`PackOptions.fixedAssignment`), UI만 붙이면 됨.

### 우선순위 4 — DB weight 컬럼명 정정
`weight_per_unit_kg` 가 실제로는 row 총 중량 (G.W/T) — 이름이 misleading. `weight_total_kg` 로 rename 마이그레이션.

### 후보 작업 (우선순위 외)
- Crainic full EP projection 더 정밀 (현재 12 EP, 표준은 18)
- Local search swap (미배치 시 작은 placement 제거 → 큰 unit 끼워넣기 → 작은 거 재시도)
- 다른 샘플 (Cebu, Manila 등) 도 동일 검증 통과 확인
- ExcelImport 의 cargo_type/unitSizes 자동 파싱 정확도 검토

## 사용자 (비개발자) 협업 지침

- 코드/타입/함수명 같은 기술 용어 빼고 화면·동작 위주로 설명
- 비유 적극 활용 (테트리스, 가방 등)
- 표·짧은 bullet 위주
- 한 단계씩 진행 결과 보고

## 기술 스택

Next.js 15 + React 19 + TS + Tailwind v4 + libsql (`file:data/clpnice.db`)
Dev: `npm run dev` (port 3000/3001)

## 검증 명령

```bash
# 단위 테스트
node --test --experimental-strip-types lib/packing/algorithm.test.ts lib/packing/extreme-point.test.ts lib/packing/clustering.test.ts

# 분배 + 물리 검증
node --experimental-strip-types scripts/verify-distribution-after-cleanup.mjs

# 17종 단독 40FT
node --experimental-strip-types scripts/verify-17-in-40ft.mjs

# 사용자 강제분배
node --experimental-strip-types scripts/verify-physical-rules.mjs

# 시각 검증
node scripts/screenshot-mockup.mjs "http://localhost:3000/shipments/<id>/plan/<planId>"
```

## Git 상태

- master 브랜치 commit `d241078` (2026-05-03) push 완료
- 이전 마일스톤: `eb63608` (9번 자유 좌표 적재) — 2026-05-02
