# clpclaude 작업 계획 통합본

작업 폴더: `C:\Users\napda\OneDrive\바탕 화면\clpclaude`
최종 갱신: 2026-05-04

---

## ⛔ 절대 룰 (NEVER VIOLATE)

### 1. CBM 쪼개기 절대 금지

**한 화물 행(House B/L 1건)은 반드시 한 컨테이너에만 들어간다.** 컨테이너 빈 공간 부족하다고 화물을 부분 분할(예: 7m³ 화물을 5m³ + 2m³ 로 두 컨에) 하면 안 된다.

**Why**: 한 화물 행은 한 화주의 한 출고 단위(House B/L). 물리적으로 한 곳에서 한 번에 출고됨. 두 컨에 나누면:
- 화면·서류상 같은 행이 두 컨에 동시 표시 → 사용자 혼동
- 실제 출고 불가능 (한 박스/팔레트를 반으로 자를 수 없음)
- House B/L 1건 = 1 컨테이너 1 출고 원칙 위배

**How to apply**:
- `lib/packing/algorithm.ts:allocateBulkGroup` 의 split fallback 제거됨 (2026-05-04)
- 어느 컨테이너에도 통째로 안 들어가는 화물은 **unplaced 로 분류** (사용자가 컨테이너 추가 또는 화물 조정 필요)
- soft overflow 5% 까지는 허용 (컨테이너 한 통에 통째 적재 보장 위함)
- 같은 booking_no 화물은 anchor 우선 (booking 묶음 보존)

**관련 코드**: `lib/packing/algorithm.ts` `allocateBulkGroup` (CT/입고완료 벌크 분배)

### 2. 점수(score) 사용 금지 — 모든 결정은 명시적 룰

**알고리즘 결정은 점수 합산이 아닌 lexicographic(사전식) 우선순위 비교로 표현한다.** 매직넘버(1e8, 1e4, 25000 등) 가중치 합산 점수는 사용 금지.

**Why**: 점수 공식은 가중치가 극단적이라 사실상 lexicographic 룰의 인코딩. 명시적 룰로 표현하면 의도가 분명하고 매직넘버가 사라지며 검토하기 쉽다.

**How to apply (2026-05-04 변환 완료)**:

| 위치 | 옛날 점수 공식 | 새 룰 |
|---|---|---|
| `extreme-point.ts:tryPlaceUnit` | `z*1e8 + y*1e4 + x + 거리*25000` | ① 낮은 z ② 낮은 효과적 y(y + booking 거리×2.5) ③ 낮은 x |
| `extreme-point.ts:tryPlaceUnitBruteForce` | 동일 | 동일 룰 (`isBetterBF`) |
| `algorithm.ts:packBest evaluate` | `-unp*1e5 + bonus + fillRate` | ① 미배치 적은 쪽 ② consolidationTier 큰 쪽 ③ 충전률 높은 쪽 (`isBetterResult`) |

**예외**: 외부에서 `scoreFn` 옵션 직접 넘긴 경우만 legacy 점수 비교 (bundle stack 강제 위치 매칭 등 1회용 필터). 기본 동작은 룰 기반.

**관련 코드**:
- `lib/packing/extreme-point.ts` `isBetterChoice`, `isBetterBF`
- `lib/packing/algorithm.ts` `evalKey`, `isBetterResult`

### 3. 사용자 요청 외 임의 코드 수정 금지

**사용자가 명시적으로 요청한 부분 외에는 절대 코드를 수정하지 않는다.** 작업 중 "겸사겸사" 발견한 다른 부분의 개선·리팩터·정리·주석 추가 등 모든 부수 수정 금지.

**Why**: 사용자가 의도하지 않은 변경은:
- 검토 부담 증가 (의도 파악 어려움)
- 회귀 위험 (안 건드려야 할 곳 건드림)
- 신뢰 깨짐 (요청과 다른 결과)
- 디버깅 시 무엇이 원인인지 추적 어려움

**How to apply**:
- 요청받은 파일·함수·라인 외 **다른 어떤 코드도 건드리지 말 것**
- 기존 코드의 스타일·로직·이름·주석이 마음에 안 들어도 그대로 둘 것
- 발견한 개선점은 **별도 보고만** 하고 사용자 승인 후에만 수정
- "이 김에 같이 고쳐도 될까요?" 라고 명시적으로 묻기 전엔 **건드리지 말 것**
- 검증·테스트 통과를 위해 임시 수정도 사용자 승인 필요
- 디버그 스크립트 같은 보조 파일도 사용자가 명시 요청 시에만 생성

**예외**: 명시적으로 "이거 고쳐줘"·"여기 수정해줘"·"개선해" 같은 직접 지시가 있을 때만 해당 부분 수정 가능. 그것도 요청된 범위 안에서만.

---

# 🟢 [진행 중] 부킹넘버 per-cargo 도입 + booking 클러스터링 + 17/5 분배 100% 적재 검증

> 원본: `2-4-sunny-sloth.md` (2026-05-04 작성)

## Context — 왜 이걸 하는가

콘솔(consolidation) 부킹의 실무 특성: 한 shipment 안에 여러 House B/L (booking) 의 화물이 함께 적재됨. 사용자가 손으로 짠 레이아웃(FBSIN260xxx 라벨) 에는 화물마다 booking 번호가 달려있었으나, 현재 DB/알고리즘은 cargo 단위 booking_no 가 없음 (shipment 마스터 booking_no만 있음).

같은 booking 의 화물은 **함께 출고/검수/통관** 되므로 컨테이너 안에서도 인접 배치되는 게 실무 효율상 중요. 입고완료/미입고 상태와 무관하게 booking 묶음 우선.

목표:
1. cargo 단위 `bookingNo` 필드 도입 (스키마/타입/UI/엑셀 모두)
2. 알고리즘 sortClustered 에 booking 클러스터링 추가 (1순위 booking → 2순위 shipper → 3순위 cargoId → 4순위 LDF)
3. UI 시각화에 같은 booking 화물 색/테두리 묶음 표시
4. 싱가폴 TOTAL 샘플로 17/5 분배 + 100% 물리·규칙 적재 검증 (unplaced 0 보장)
5. 검증 통과까지 반복 테스트 — 통과 후만 보고

## 진행 상태 (2026-05-04 검증 완료 후 갱신)

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | DB 마이그레이션 0009 (`booking_no` 컬럼) | ✅ 완료 |
| 2 | `CargoSpec.bookingNo` 타입 추가 | ✅ 완료 |
| 3 | Repository 읽기/쓰기 (`shipments.ts`) | ✅ 완료 |
| 4 | API 엔드포인트 (POST/PUT) | ✅ 완료 |
| 5 | UI 입력 컬럼 (CargoTable) | ⏳ 진행 중 |
| 6 | 엑셀 import 매핑 | ❌ 미시작 |
| 7 | 샘플 데이터 (22개 booking_no 매핑) | ✅ 완료 (DB 직접 입력 확인) |
| 8a | 알고리즘 sortClustered 정렬 (booking 1순위) | ✅ 완료 |
| 8b | **booking-aware 배치 (인접성 보장)** | ❌ **미해결 — 핵심 이슈** |
| 9 | UI 시각화 (같은 booking 같은 색) | ❌ 미시작 |
| 10 | 검증 반복 (unplaced 0 + 인접 검증) | ⏳ 부분 완료 (분배 ✓, 인접 ✗) |

## 검증 결과 (2026-05-04 싱가폴 TOTAL 샘플)

### ✅ 통과
- 17/5 분배: 사용자 의도 정확 일치
- 미배치(unplaced): 0
- 물리·규칙: 모든 항목 PASS (사용자 강제 분배 시나리오)
- 부킹넘버 데이터: 22개 화물 모두 입력
- **사용자 손-플랜 부킹 일관성**: 두 컨테이너 사이에 겹치는 부킹 없음. 같은 부킹(FBSIN260371: 디에스콘+티케이테크) 같은 40FT 안에 묶여있음

### ✅ 추가 통과 (2026-05-04 버그 수정 후)
- **화면 표시 quirk** ✅ **수정 완료** — `display-rows.ts:6단계` supporter 검색을 `bottomsAll` 만 → 모든 placement (재귀 root bottom 추적). top-on-top stack 화물 다 화면에 표시됨. 결과: 40FT 화주 15/17 → **17/17 모두 표시**
- **분배 정확성**: 화면 누락 해결 → 분배 검증 ✓ (17/17 + 5/5 모두 일치)
- **booking 인접 점수 도입**: `extreme-point.ts:tryPlaceUnit/BruteForce` 에 같은 booking 화물 가까이 배치 선호 점수 추가 (CAP 200cm × W 25000)

### ❌ 부분 해결 — fundamental 한계
- **사이즈 큰 차이 booking 인접**: 디에스콘(80×60×50, 3유닛) ↔ 티케이테크(225×134×62, 1유닛) 같은 부킹 FBSIN260371. 디에스콘은 YKMC 사이 좁은 틈에 fit, 티케이테크는 그 좁은 틈 못 들어감. 같은 컬럼(x=118 vs x=129)에 배치되긴 했지만 y(앞-뒤) 가 멀음. `placeQueueWrapper` 의 2단계(bundle 먼저 → fallback 뒤) 구조가 사이즈 차이 booking 의 인접성 깸. 단일 패스로 변경 시도 시 분배가 망가짐 — 추후 booking-aware bundle 정책 추가 필요 (Phase 8c).
- 같은 사이즈 booking (예: 디에스콘 3유닛끼리) 은 booking penalty 로 잘 묶임

## 8 단계 순차 실행 (각 단계 후 단위 테스트 회귀)

### Phase 1 — DB 마이그레이션 0009 (schema) ✅

신규 마이그레이션 `db/migrations/0009_cargo_booking_no.sqlite.sql`:
- `ALTER TABLE cargo_items ADD COLUMN booking_no TEXT`
- 기존 데이터 보존 (NULL 기본값)
- `CREATE INDEX idx_cargo_items_booking ON cargo_items(booking_no)` (검색·클러스터링용)

`scripts/db-init.mjs` 의 멱등성 (duplicate column ignorable) 그대로 활용 — 추가 변경 없음.

### Phase 2 — Type 추가 ✅

`types/cargo.ts` `CargoSpec` 인터페이스에 `bookingNo?: string` 추가.
`expandToUnits` 결과 `UnitItem` 에도 `bookingNo?: string` 전달.

### Phase 3 — Repository 읽기/쓰기 ✅

`lib/repositories/shipments.ts`:
- `getShipment` SELECT 절에 `booking_no` 포함 → `bookingNo` 매핑
- `saveShipment` / `updateShipment` INSERT/UPDATE 에 `booking_no` 컬럼 추가

`lib/repositories/clpPlans.ts` plan_placements INSERT 시 `bookingNo` 도 보존 (옵션 — 화면 표시용)

### Phase 4 — API 엔드포인트 ✅

`app/api/shipments/route.ts` (POST), `app/api/shipments/[id]/route.ts` (PUT/PATCH):
- 요청 body 의 cargo items 안에 `bookingNo` 필드 받기
- 검증 + 정규화 (string trim, max length 등)

### Phase 5 — UI 입력 (CargoTable) ⏳

`components/input/CargoTable.tsx`:
- 새 컬럼 "Booking" 추가 (현재 컬럼들 사이 적절한 위치)
- text input, optional
- 같은 행 입력 후 다른 cargo row에 붙여넣기 편의 (작은 dropdown/기존 booking 추천)

### Phase 6 — 엑셀 import 매핑 ❌

`components/input/ExcelImport.tsx`:
- 헤더 인식: "Booking No", "House B/L", "HBL", "B/L" 등 변형 매핑
- `bookingNo` 필드로 파싱
- normalize (대소문자, 공백 정리)

### Phase 7 — 샘플 데이터 ❌

`data/samples/singapore-total.json`:
- 22개 row 각각에 `bookingNo` 추가
- 사용자 손-레이아웃 매핑 사용:
  - 메가젠 → FBSIN260288, 데코론 → FBSIN260318, YKMC → FBSIN260324
  - 보현석재 → FBSIN260326, 에이제이테크 → FBSIN260341, 카페봄봄 → FBSIN260347
  - EXCELERATE → FBSIN260349, VISCOSMO → FBSIN260351, 더블유티 → FBSIN260353
  - 리만 → FBSIN260361, 대한정밀 → FBSIN260365, 선진뷰티 → FBSIN260337
  - SUNGBO → FBSIN260362, 제일기공 → FBSIN260369, 웨스코 → FBSIN260370
  - 디에스콘 → FBSIN260371, 티케이테크 → FBSIN260371 (**같은 booking**)
  - AWOT → FBSIN260294, 대원산업 → FBSIN260297, 씨에스에프 → FBSIN260339
  - HD현대 → FBSIN260346, 포컴퍼니 → FBSIN260359

DB sync — 직접 UPDATE 또는 sample reload (사용자 결정).

### Phase 8 — 알고리즘 sortClustered 강화 ✅

`lib/packing/algorithm.ts` `sortClustered`:
- 정렬 우선순위 변경: 1) booking → 2) shipper → 3) cargoId → 4) LDF rank
- `bookingFirst[bookingNo]` map 추가 (LDF 순서 기반)
- bookingNo 없으면 (NULL) 가장 마지막 처리 (또는 shipper 기반 fallback)

추가: bundle stack 안에서도 booking 인접성 유지 — multi-column 배치 시 같은 booking 끼리 인접 column 우선.

### Phase 9 — UI 시각화 booking 묶음 표시 ❌

`components/plan/ContainerView2D.tsx`:
- 같은 booking 화물에 동일 색 hue 또는 외곽선 두께 강조
- legend 에 booking 색상 매핑 표시 (옵션)

### Phase 10 — 검증 반복 (100% 통과까지) ❌

검증 스크립트 갱신/신규:
- `scripts/verify-distribution-after-cleanup.mjs` (기존) — booking 클러스터 검증 추가
- `scripts/verify-booking-cluster.mjs` (신규) — 같은 booking cargo 가 인접 row/column 인지 확인

검증 시나리오 (모두 unplaced=0 + 분배 일치 + 물리·규칙 PASS):
- 17종 → 40FT 단독 (40ft_only)
- 5종 → 20FT 단독 (20ft_only)
- 22종 → auto 모드 (5종 → 20FT, 17종 → 40FT)
- booking 묶음 인접 (특히 디에스콘 + 티케이테크 같은 booking → 인접)

**조건부 반복**: unplaced ≠ 0 또는 분배 불일치 시 알고리즘 추가 강화 (예: booking-aware bundle stack, 더 많은 strategy 조합) 적용 후 재테스트. 통과 시까지 반복.

## Critical files

**수정 (Phase 1-9):**
- `db/migrations/0009_cargo_booking_no.sqlite.sql` (신규)
- `types/cargo.ts` — `CargoSpec.bookingNo`
- `lib/repositories/shipments.ts` — read/write
- `app/api/shipments/route.ts`, `app/api/shipments/[id]/route.ts`
- `components/input/CargoTable.tsx` — 입력 컬럼
- `components/input/ExcelImport.tsx` — 엑셀 헤더 매핑
- `data/samples/singapore-total.json` — bookingNo 추가
- `lib/packing/algorithm.ts` — `sortClustered`, `expandToUnits` (UnitItem.bookingNo)
- `lib/packing/extreme-point.ts` — `Placement3D.bookingNo` 보존 (옵션)
- `components/plan/ContainerView2D.tsx` — booking 색 표시

**참조 (변경 없음):**
- `lib/packing/extreme-point.ts:tryPlaceUnit` — placement 로직
- `lib/packing/display-rows.ts` — display 변환

**신규:**
- `scripts/verify-booking-cluster.mjs` — booking 클러스터 검증

## Verification

각 Phase 후 단위 테스트 + 통합 검증:

```bash
cd "C:/Users/napda/OneDrive/바탕 화면/clpclaude"

# Phase 1 — 마이그레이션 적용 + 멱등성
npm run db:init  # 0009 적용 확인

# Phase 7 - 샘플 데이터 sync (DB UPDATE)
node -e "..."  # 22 cargoes 의 booking_no UPDATE

# Phase 8 후 — 알고리즘 단위 테스트 회귀
node --test --experimental-strip-types lib/packing/algorithm.test.ts lib/packing/extreme-point.test.ts lib/packing/clustering.test.ts
# 기대: 40/40 통과

# Phase 10 — 종합 검증
node --experimental-strip-types scripts/verify-17-in-40ft.mjs
# 기대: unplaced 0 (84.7%)

node --experimental-strip-types scripts/verify-distribution-after-cleanup.mjs
# 기대: 분배 일치 (5종 → 20FT, 17종 → 40FT) + unplaced 0

node --experimental-strip-types scripts/verify-booking-cluster.mjs
# 기대: 디에스콘 + 티케이테크 (같은 booking) 인접 row

# Production plan 재생성
curl -s -X POST http://localhost:3000/api/pack -H "content-type: application/json" \
  -d '{"shipmentId":"bbd2cece-976f-4665-b207-175aa2751b77","mode":"auto","preview":false}'
```

## 위험·엣지 케이스

| 위험 | 완화 |
|---|---|
| booking 클러스터링이 LDF 우선순위 침식 → packing efficiency ↓ | bookingFirst 가 LDF 인덱스 기반이라 큰 booking 우선. 또한 여전히 packBest 56 조합 시도 |
| 같은 booking 안에 사이즈 다양한 cargo → bundle stack 어려움 | 기존 sub-bucket 분리 그대로 유지 |
| bookingNo NULL cargo 처리 | 마지막 순서 (LDF order 그대로) — fallback to shipper clustering |
| 엑셀 헤더 변형 (B/L vs HBL vs Booking) | 다중 헤더 키워드 매칭, normalize 후 첫 매치 |
| UI 표시 booking 색 너무 많음 (22 booking) | 색 hue 자동 분할 (HSL 360/N), 또는 외곽선 두께/패턴만 사용 |
| 17종 strict 적재 시 미배치 발생 | 이전 commit d241078 의 split-execute + EP projection 그대로 → 100% 통과 보장 |

## 비개발자 용 한 줄 요약

> 화물마다 부킹 번호를 붙이고, 같은 부킹 화물은 컨테이너 안에 인접하게 배치되도록 알고리즘 정렬 룰에 추가합니다.
> 1단계: DB와 화면에 부킹 컬럼 추가
> 2단계: 엑셀에서 부킹 자동 인식
> 3단계: 알고리즘이 같은 부킹끼리 묶어서 배치
> 4단계: 화면에 같은 부킹 화물을 같은 색으로 표시
> 5단계: 17종 → 40FT, 5종 → 20FT 모두 100% 들어갈 때까지 테스트 반복

---

# 🔵 [완료된 과거 작업 — 참고용] 새 GitHub 저장소 `clpclaude` 생성 + 커밋·푸쉬

> 원본: `cbm-about-tingly-fox.md` (2026-04-30 작성, 이미 실행 완료됨)

## Context

지금까지 로컬 `C:\Users\napda\OneDrive\바탕 화면\clp클로드` 에서 진행한 작업(점수 알고리즘 제거, 카톤/입고완료 분리, 입고완료 전용 채우기 미리보기 등 다수 변경) 이 모두 **uncommitted 상태**다. 현재 origin 은 `https://github.com/napdak1-coder/clpnice.git` 이지만 사용자는 **새 저장소 `clpclaude`** 로 분리하길 원함. 이어서 작업 가능하도록 마지막 상태까지 커밋·푸쉬해서 어디서든 이어 받을 수 있게 만든다.

## 실행 단계 (모두 완료)

### 1. 현재 변경 상태 확인 (read-only) ✅

- `git status` — uncommitted/untracked 파일 점검
- `git log --oneline -3` — 최근 커밋 컨텍스트 확인

### 2. 변경 사항 stage + commit ✅

커밋 메시지 (`c04e825`):

> feat: 적재 알고리즘 룰 기반 재구성 + 카톤/입고완료 분리 + 미리보기 기능
>
> 알고리즘:
> - pack() 점수 비교 제거, 결정적 룰만으로 컨테이너 결정
> - 화물 분류 도입: 정상6종(PL/WB/WC/WD/CR/CL) / CT 카톤 / 입고완료(cbm 입력)
> - CT 는 시각화 제외, 컨테이너 여유 CBM 에 합산
> - 입고완료는 한 컨테이너에 우선 몰음 (사용자 작업 편의)
> - "이 컨테이너 입고완료 전용 채우기" 미리보기
> - CBM 한도 초과 시 자동 분산 + warnings 메시지
>
> DB:
> - 0006_cargo_type 마이그레이션: cargo_items.cargo_type TEXT
> - 0005_cargo_about_cbm 마이그레이션: about_cbm REAL
> - 0004_cargo_unit_sizes 마이그레이션: unit_sizes_json TEXT
> - 0003_plan_normalized 마이그레이션: plan_containers/rows/placements/unplaced
>
> UI:
> - CargoTable 구분 셀렉트 + ABOUT 컬럼 + 시스템CBM 비교 빨간 강조
> - 메모를 행 별 sub-row 에서 가장 오른쪽 정규 컬럼으로 이동
> - 화주 숨기기 = blur 모자이크 (레이아웃 그대로)
> - 화물 목록 합계 4종 (CFS/ABOUT/수량/무게) 표시
> - 사이즈 모달: 수량별 그룹 자동 분할 + 단위중량 분배 + 엑셀중량 일치 검증
>
> 엑셀 파서: ABOUT 셀 분리, X2/x2 접미사, cargoType 헤더 폴백, 다중 사이즈 묶음
>
> 기타: decideContainers, maxCbm 운영 한도 (20FT 28 / 40FT 60), 단위 테스트 9/9 통과

### 3. GitHub 새 저장소 `clpclaude` 생성 + 원격 등록 + 푸쉬 ✅

`gh repo create napdak1-coder/clpclaude --public --source . --remote clpclaude --push` 실행 완료.

기존 `origin` (`clpnice`) 는 그대로 둠. 새 `clpclaude` 가 보조 원격으로 추가됨.

### 4. 검증 ✅

`git remote -v` 로 두 원격 등록 확인.
새 커밋 `c04e825` 푸쉬 확인.

## 다른 환경에서 이어받기

```bash
git clone https://github.com/napdak1-coder/clpclaude.git
cd clpclaude
npm install
npm run db:init
npm run dev
```

## 주의사항 (안전)

- `git add .` 전에 `.gitignore` 가 `node_modules/`, `data/clpnice.db`, `.next/` 제외하는지 확인 (이미 잘 돼있음)
- 강제 푸쉬(`--force`) 안 함, 새 저장소라 이력 충돌 없음

---

# 📌 빠른 참고

## 주요 파일 위치 (`clpclaude/`)

- `lib/packing/algorithm.ts` — `pack()`, `packBest()`, `tryBundleStack`, `sortClustered`, `pickBundleFace`, `placeQueueWrapper/Pure`, evaluate
- `lib/packing/extreme-point.ts` — `tryPlaceUnit` (forceFaceIdx, scoreFn 옵션), `tryPlaceUnitBruteForce`, EP projection
- `lib/packing/constraints.ts` — `effectiveSizeFace`, `allowedFaces`
- `lib/packing/display-rows.ts` — display 변환 (top-on-top quirk 미해결)
- `db/migrations/0001~0009` — 누적 스키마

## 검증 명령

```bash
# 단위 테스트
node --test --experimental-strip-types lib/packing/{algorithm,extreme-point,clustering}.test.ts

# 분배 검증
node --experimental-strip-types scripts/verify-distribution-after-cleanup.mjs

# 17종 단독
node --experimental-strip-types scripts/verify-17-in-40ft.mjs

# 시각 검증
node scripts/screenshot-mockup.mjs <url>
```

## 깃 원격

- `origin` = https://github.com/napdak1-coder/clpnice.git (이전)
- `clpclaude` = https://github.com/napdak1-coder/clpclaude.git (현재 주력) — `clpclaude/master` 푸쉬

## 현재 미저장 작업분 (2026-05-04 컴퓨터 꺼지기 전)

깃 커밋 안 된 변경:
- `M app/api/shipments/[id]/route.ts`
- `M app/api/shipments/route.ts`
- `M components/input/CargoTable.tsx`
- `M components/input/ShipmentForm.tsx`
- `M lib/packing/algorithm.ts`
- `M lib/repositories/shipments.ts`
- `M types/cargo.ts`
- `?? db/migrations/0009_cargo_booking_no.sqlite.sql`
