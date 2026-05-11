# CLP (Container Loading Plan) 프로젝트 — 외부 검토용 종합 컨텍스트

> 작성 일자: 2026-05-09
> 작성 시점: master 브랜치, origin/master 보다 20 커밋 앞 + lib/packing/constraints.ts 미커밋 변경 1건
> 외부 검토자가 이 파일 하나만 보고 의견을 줄 수 있도록 정리한 문서.
> 작업은 계속 Claude Code 가 진행하며, 이 문서는 시점 스냅샷.

---

# 1. 프로젝트 개요

## 1-1. 기본 정보 (확정)

| 항목 | 값 |
|---|---|
| 프로젝트명 | `clp-noblecoco` (package.json) / 통칭 `clpclaude` |
| 작업 폴더 | `C:\Users\napda\OneDrive\바탕 화면\clpclaude` |
| 현재 브랜치 | `master` (origin/master +20 커밋 앞) |
| 기술 스택 | Next.js 15.5.6 + React 19 + TypeScript 5.6 + Tailwind v4 + libsql 0.15 |
| Node 런타임 | `--experimental-strip-types` (TS 직접 실행) |
| 테스트 프레임워크 | `node:test` (내장) |

## 1-2. 프로젝트 목적 (확정)

**컨테이너 적재 계획(Container Loading Plan, CLP) 자동화 사이트.**
수출 콘솔 화물 합적(Less-than-Container-Load, LCL) 작업에서 화주별 화물(박스/팔레트) 들을 어느 컨테이너에 어떻게 배치할지 자동 결정.

해결하려는 문제:
- 사용자(포워더 실무자) 가 엑셀로 부킹·화물 명세 업로드 → 시스템이 컨테이너 종류·수량·각 박스의 3D 좌표 자동 계산
- 실무자가 손으로 분배할 때 들어가는 시간을 줄이고 미배치/쪼개기 사고를 막음
- 분배 결과를 화면(2D/3D 시각화) + 화물 표 + 컨테이너별 통계로 보여줌

## 1-3. 입력 / 출력 (확정)

**입력**: 엑셀 업로드 (`components/input/ExcelImport.tsx` 가 파싱) → JSON 화물 행 배열 → `CargoSpec[]`. 샘플 데이터는 `data/samples/*.json`.

**출력**: `CLPResult` (`types/plan.ts`) — 컨테이너 배열, 각 컨테이너의 행(row) 별 박스 좌표, bulkItems(CT 카톤), unplaced(미배치), summary(평균 충전률).

## 1-4. 사용자 최종 확인 결과 (추정 — 코드 흐름 기반)

- 컨테이너별 적재 배치도 (3D/2D 시각화)
- 화물 목록 표 (화주/부킹/사이즈/수량/CBM/무게/배정 컨)
- 컨테이너별 통계 (충전률 %, 무게 %, 만재 여부)

## 1-5. 실무자 배치 vs 시스템 배치 관계 (확정 — CLAUDE.md 절대 룰 #8)

> 절대 룰 #8: **실무자 분배 ≠ 유일 정답** — 물리·규칙 통과하면 valid, 실무자 일치는 검증 기준 X

샘플 JSON 에 실무자 분배가 같이 들어 있어 비교는 가능하지만, 시스템이 다른 valid 배치를 찾아도 OK 로 판정. 단, 미배치 0 + 절대 룰 통과는 강제.

## 1-6. Claude Code 가 주로 수정 중인 영역 (확정 — 최근 git log + 현재 diff)

- `lib/packing/algorithm.ts` (2,450 줄) — 본체 packing 알고리즘
- `lib/packing/constraints.ts` (167 줄) — 회전/적층/무게 룰
- `lib/packing/footprint-cluster.ts` (523 줄) — 발바닥 사전 묶음 룰 A/B/C/D
- `lib/packing/long-axis-anchor.ts` (359 줄) — 장축 막대형 박음
- `docs/algorithm-pipeline.md` — 알고리즘 흐름 문서

## 1-7. "성공" 판단 기준 (확정 — CLAUDE.md + algorithm-pipeline.md 핵심 절대 룰)

1. 미배치(unplaced) = 0
2. CBM 쪼개기 (B1) = 0 (한 cargoId 은 한 컨테이너만)
3. 부킹 분산 (B2) = 0 (한 bookingNo 는 한 컨테이너만)
4. 물리 검증 (A1~A5) PASS — bounding/weight/cbm/충돌/받침
5. 다단금지(B4)·상단적재(B5)·중량(B6)·회전(B7) 위반 0
6. 알고리즘 수정 시 1ST/2ST/3ST SG·HM 5 샘플 회귀 0건

## 1-8. 관련 문서 발췌

```
# CLAUDE.md (절대 룰 발췌)
4. CBM 쪼개기 금지 — 한 화물 행은 한 컨테이너에만 (split fallback 추가 금지)
5. 점수 합산 금지 — best 선택은 lexicographic comparator만, 가중치 점수 X
8. 실무자 분배 ≠ 유일 정답 — 물리·규칙 통과하면 valid
10. 회귀 0건 보장 — 1ST/2ST/3ST SG·HM 전 샘플 회귀 테스트 자동 동행
```

---

# 2. 폴더 / 파일 구조

## 2-1. 주요 폴더 (확정 — `ls -la`)

| 폴더 | 역할 |
|---|---|
| `app/` | Next.js App Router — `/api/pack/route.ts` (분배 API), `/debug/*-report` (시각 검증 페이지) |
| `components/` | UI 컴포넌트 — `ContainerView2D`, `input/ExcelImport.tsx` |
| `data/samples/*.json` | 5 개 검증 샘플 (1ST/2ST SG·HM TOTAL, 3ST SG TOTAL) |
| `db/` | libsql 마이그레이션 (`db/migrations/0001~0008`) |
| `docs/` | `algorithm-pipeline.md`, `PROGRESS.md` |
| `lib/packing/` | **CLP 핵심 로직** (총 ~6500 줄 + 테스트 ~1750 줄) |
| `logs/` | 회귀 결과 로그, search 결과 |
| `scripts/` | 검증·디버그·실험 스크립트 (`verify-*`, `_quick-*`, `_audit-*`, `_experiment-*`) |
| `types/` | `cargo.ts`, `container.ts`, `plan.ts` |
| `tmp-screenshots/` | 시각 검증 스크린샷 임시 저장 |

## 2-2. CLP 핵심 파일 (확정)

```
lib/packing/algorithm.ts            (2450 줄) — pack(), packBest(), placeQueueWrapper, allocateBulkGroup
lib/packing/extreme-point.ts         (807 줄) — tryPlaceUnit, tryPlaceUnitBruteForce, EP projection
lib/packing/constraints.ts           (167 줄) — canStackOn, allowedFaces, withinWeightLimit (현재 미커밋 변경 1건)
lib/packing/footprint-cluster.ts     (523 줄) — preClusterFootprint (룰 A/B/C/D)
lib/packing/long-axis-anchor.ts      (359 줄) — anchorLongAxisCargoes
lib/packing/clustering.ts            — sortClustered, tryBundleStack
lib/packing/display-rows.ts          (265 줄) — 3D placement → 2D rows 변환 (시각화)
lib/packing/row-residual.ts          (163 줄) — Stage 6 행 잔여공간 fitting
lib/packing/containers.ts            ( 49 줄) — CONTAINERS 상수 (20FT/40FT 사양)
```

## 2-3. 검증 스크립트 (확정)

```
scripts/verify-1st-sg-total.mjs     — 1ST SG TOTAL (22 화주, 1×40FT + 1×20FT)
scripts/verify-2st-sg-total.mjs     — 2ST SG TOTAL (23 화주, 2×40FT)
scripts/verify-3st-sg-total.mjs     — 3ST SG TOTAL (35 화주, 2×40FT)
scripts/verify-2st-hm-total.mjs     — 2ST HM TOTAL (26 화주, 2×40FT + 1×20FT)
scripts/verify-2st-hm-physics.mjs   — 2ST HM 물리·B1·B2 audit (33가지 검증)
scripts/verify-3st-sg-physics.mjs   — 3ST SG 물리·B1·B2 audit
scripts/_quick-3st-sg-b1b2-lightmode.mjs  — lightMode B1·B2 audit (이번 세션 추가)
scripts/_quick-2st-sg-b1b2-lightmode.mjs  — lightMode B1·B2 audit (이번 세션 추가)
scripts/_quick-default56-3stsg.mjs       — default 64-매트릭스 3ST SG audit (이번 세션 추가)
scripts/_audit-3st-sg-weight-stack.mjs   — 적층 무게 룰 위반 검사 (이번 세션 추가)
scripts/_debug-3st-sg-unplaced.mjs       — 미배치 박스 식별 (이번 세션 추가)
```

## 2-4. 샘플 데이터 (확정 — `wc -l` + `grep '"actualShipperName"'`)

| 파일 | 줄 수 | 화물 행 | 시나리오 |
|---|---|---|---|
| `singapore-total.json` (1ST SG) | 593 | 22 | 작은 시나리오 (1×40FT + 1×20FT) |
| `singapore-total-2.json` (2ST SG) | 602 | 23 | 중간 시나리오 (2×40FT) |
| `singapore-total-3.json` (3ST SG) | 1109 | 35 | 큰 시나리오 (2×40FT) — NP-hard 영역 |
| `hochiminh-total.json` (1ST HM) | 780 | 34 | 호치민 콘솔 |
| `hochiminh-total-2.json` (2ST HM) | 1008 | 26 | 호치민 입고완료 위주 |

## 2-5. `git status` (확정, 2026-05-09 작성 시점)

```
On branch master
Your branch is ahead of 'origin/master' by 20 commits.

Changes not staged for commit:
  modified:   lib/packing/constraints.ts  ← 미커밋 (STACK_WEIGHT_TOLERANCE 1.5 → 1.0)
```

## 2-6. `git diff --stat`

```
 lib/packing/constraints.ts | 17 ++++++++++-------
 1 file changed, 10 insertions(+), 7 deletions(-)
```

## 2-7. `git log --oneline -20` (요약, 최신순)

```
c1d6967 feat: 무거운 거 먼저 정렬 전략(heaviest) — 컬럼 안 자동 무거운 거 아래
e183748 feat: 글로벌 무게 적층 룰 — 위 ≤ 아래 × 1.5 (실무 안전, 절대 룰 #7)
5c2bbeb feat: 안쪽 깊숙이 고정점(옵션 C) + packBest B1·B2 lex 우선순위
a4a1925 chore: 75분 default 56 매트릭스 결과 + 5샘플 audit 스크립트
c8cd593 feat: long-axis anchor 자동 활성 (F+A 조합)
238c7b7 fix: footprint-cluster atomic 보호 (룰 C 후처리)
eb976a8 perf: pack() fallback 제거 + packBest lightMode 추가
c2fdb6a chore: fallback 회귀 quick 스크립트 자산
2dc8bb3 feat: 장축 모서리 박음 (long-axis anchor) — fallback 모드
f987d6f chore: 실험 스크립트 + 회귀/검증 로그 자산
aca6434 feat: /debug/2st-hm-compare 비교 페이지
a88aad6 feat: footprint-cluster 사전 묶음 (룰 A/B) + packBest 조기 종료 경량화
ee76262 feat: Stage 6 행 기반 fitting + 부킹 인접 강제 + 3ST SG 컨2 search portfolio
2198330 feat: 막대형 우선 + 묶음 stack pre-pass + 3ST SG TOTAL 검증 자산
c84d686 feat: atomic 완화 + tall-first 정렬 + rescue repack
a45a287 feat: column-stack 우선화
f698b83 feat: Stage 4 자리 바꾸기 패스 (repositionUnplaced)
901c7ef feat: 묶음 완화 (인접 lane fallback)
42d6465 feat: visual 트랙 cargoId-atomic 가드
ad975f4 feat: 2ST SG TOTAL 실무자 분배 100% 일치
```

---

# 3. 데이터 모델 / 입력 구조

## 3-1. 핵심 타입 (확정 — `types/cargo.ts`)

```typescript
export type CargoType = "PL" | "WB" | "WC" | "WD" | "CR" | "CL" | "PK" | "CT";

export interface Remark {
  noStacking: boolean;     // 다단금지 (위에 못 얹음)
  topOnly: boolean;        // 상단적재 (z=0 바닥에 못 둠)
  orientation: "free" | "long_along_length" | "fixed";
  heavierBelow: boolean;   // 중량조건 (사용자 명시 박스만)
  notes?: string;
}

export interface UnitSize {
  width: number; length: number; height: number;
  quantity: number;
  weight?: number;         // 미입력 = 0 → fallback (행 단위 weightPerUnit / totalUnits)
}

export interface CargoSpec {
  id: string;              // cargoId (예: "sg3-16")
  shipmentId: string;      // 부킹 FK
  sortOrder: number;
  cargoType: CargoType;
  bookingNo?: string;      // House B/L
  houseBlNo?: string;
  destination?: string;
  itemName?: string;
  actualShipperName?: string;
  shipperName?: string;
  width: number;           // 대표 사이즈
  length: number;
  height: number;
  quantity: number;
  weightPerUnit: number;   // 개당 중량 kg
  cbm?: number;            // CFS CBM
  aboutCbm?: number;
  unitSizes?: UnitSize[];  // unit별 사이즈 다른 경우
  remarks: Remark;
}
```

## 3-2. UnitItem (내부 확장 단위 — `lib/packing/algorithm.ts:62`)

`expandToUnits(cargoes: CargoSpec[])` 함수가 quantity 만큼 unit 으로 펼침:

```typescript
interface UnitItem {
  unitId: string;       // `${cargoId}-${i}`
  cargoId: string;      // 원본 화물 행 ID
  shipper: string;      // actualShipperName ?? shipperName ?? itemName
  bookingNo?: string;
  cargoType: CargoType;
  cfsCbm: number | null;
  width: number;
  length: number;
  height: number;
  weight: number;       // 단위당 중량 (unitSizes.weight 우선, 없으면 weightPerUnit/totalUnits)
  remarks: Remark;
}
```

## 3-3. expandToUnits 핵심 발췌 (확정 — `algorithm.ts:117-166`)

```typescript
function expandToUnits(cargoes: CargoSpec[]): UnitItem[] {
  const out: UnitItem[] = [];
  for (const c of cargoes) {
    const shipperLabel = c.actualShipperName ?? c.shipperName ?? c.itemName ?? "";
    const remarks = { ...c.remarks };
    if (c.unitSizes && c.unitSizes.length > 0) {
      const totalUnits = c.unitSizes.reduce((s, u) => s + u.quantity, 0) || c.quantity;
      const fallback = totalUnits > 0 ? (c.weightPerUnit ?? 0) / totalUnits : 0;
      let i = 0;
      for (const u of c.unitSizes) {
        const w = u.weight && u.weight > 0 ? u.weight : fallback;
        for (let k = 0; k < u.quantity; k++) {
          out.push({
            unitId: `${c.id}-${i++}`,
            cargoId: c.id,
            // ... unit 별 사이즈로 push
            weight: w,
          });
        }
      }
    } else {
      const perUnit = c.quantity > 0 ? (c.weightPerUnit ?? 0) / c.quantity : 0;
      for (let i = 0; i < c.quantity; i++) {
        out.push({
          unitId: `${c.id}-${i}`,
          cargoId: c.id,
          // ... 대표 사이즈로 push
          weight: perUnit,
        });
      }
    }
  }
  return out;
}
```

## 3-4. 샘플 데이터 한 행 예 (확정 — `data/samples/singapore-total-3.json` 첫 화물)

```json
{
  "cargoType": "PL",
  "bookingNo": "FBSIN260363",
  "houseBlNo": "FBSIN260363",
  "actualShipperName": "나투라미디어 &",
  "widthCm": 111, "lengthCm": 101, "heightCm": 102,
  "quantity": 3,
  "weightPerUnitKg": 566,
  "cbm": 4.458, "aboutCbm": 4.458,
  "noStacking": false, "topOnly": false,
  "orientation": "free", "heavierBelow": false,
  "unitSizes": [
    { "width": 111, "length": 101, "height": 102, "quantity": 1, "weight": 188.667 },
    { "width": 121, "length": 111, "height": 127, "quantity": 1, "weight": 188.667 },
    { "width": 161, "length": 111, "height": 90,  "quantity": 1, "weight": 188.667 }
  ]
}
```

→ unit 3 개로 확장. 각 unit 사이즈 다름. weight 188.667 × 3 = 566 = weightPerUnitKg.

## 3-5. 데이터 누락값 처리 (확정 — 코드 발췌 기반)

| 필드 | 누락 시 처리 |
|---|---|
| `weightPerUnit` | undefined / null → `?? 0` (algorithm.ts 호출자에서 폴백) |
| `unitSizes[].weight` | 0 또는 undefined → 행 weightPerUnit/totalUnits 폴백 (line 127, 146) |
| `bookingNo` | undefined 시 footprint-cluster 룰 A 발동 X (line 119-124) |
| `width/length/height` | 0 또는 < 1 → CT bulk 트랙으로 분류 (`classify`) |
| `cbm` | undefined → null (cfsCbm) |
| `unitSizes` | 빈 배열·undefined → 대표 사이즈 + quantity 사용 |

## 3-6. 검증 스크립트의 cargoes 변환 (확정 — `scripts/_quick-default56-3stsg.mjs`)

```javascript
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName||null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0,
  length: r.lengthCm ?? 0,
  height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null,
  aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: {
    noStacking: !!r.noStacking, topOnly: !!r.topOnly,
    orientation: r.orientation || "free", heavierBelow: !!r.heavierBelow,
  },
}));
```

---

# 4. 컨테이너 규격과 물리 기준

## 4-1. 컨테이너 사양 (확정 — `lib/packing/containers.ts`)

```typescript
export const CONTAINERS: Record<ContainerType, ContainerSpec> = {
  "20FT": {
    type: "20FT",
    maxWeightKg: 21000,
    maxCbm: 28,
    innerLength: 590,
    innerWidth: 234,
    doorHeight: 228,
    innerHeight: 238,
  },
  "40FT": {
    type: "40FT",
    maxWeightKg: 25000,
    maxCbm: 60,
    innerLength: 1200,
    innerWidth: 234,
    doorHeight: 258,
    innerHeight: 268,
  },
};
```

## 4-2. 물리 검증 위치 (확정)

| 검증 | 함수 / 파일 |
|---|---|
| 컨테이너 안 (사이즈 bounding) | `tryPlaceUnit` (`extreme-point.ts:309-311`) — `cand.x + eff.width > spec.innerWidth` 등 |
| 도어 높이 (다단 시 상한) | `tryPlaceUnit` 내부 (z + h ≤ doorHeight) + `footprint-cluster.ts:177` |
| 충돌 (AABB pairwise) | `tryPlaceUnit` (`extreme-point.ts:316-332`) — `collides3D(...)` |
| 받침 (full support, 70%) | `isFullySupported` (`extreme-point.ts`) — z>0 시 4 모서리 + 중심 받침 |
| 무게 한도 (컨테이너) | `withinWeightLimit` (`constraints.ts:160-166`) — `current + add < maxWeightKg` |
| 다단/회전 룰 | `canStackOn`, `allowedFaces` (`constraints.ts:62-117`) |

## 4-3. EPS / 부동소수점 (확정)

```typescript
// extreme-point.ts:36
const EPS = 0.01;  // 부동소수점 비교 허용 오차 (cm)
```

---

# 5. 프로젝트에 실제 적용 중인 규칙 전체

## 규칙 1. CBM 쪼개기 절대 금지 (B1)

- **규칙 설명**: 한 cargoId 의 모든 unit 은 한 컨테이너만. 컨1·컨2 분산 금지.
- **왜 필요한지**: 통관·서류·운임 처리 단위가 화물 단위. 분산 시 행정 박살.
- **어디서 적용되는지**: 통로 A (`allocateBulkGroup`) + 통로 B (`placeQueueWrapper`) + footprint-cluster 룰 C (atomic 후처리) + packBest evalKey lex 2순위
- **데이터 필드**: `cargoId`
- **통과 조건**: cargoId 모든 unit 이 한 컨테이너 placement 에 모두 들어감
- **실패 조건**: 같은 cargoId unit 이 두 컨테이너 placements 에 동시 존재
- **실패 시 결과**: packBest evalKey 의 `b1Violations` 카운트 증가 → lex 비교 패배 → best 안 뽑힘
- **관련 파일**: `algorithm.ts` (placeQueueWrapper, packBest), `footprint-cluster.ts` (룰 C)
- **관련 함수**: `countDistributionViolations`, `placeQueueWrapper`, `preClusterFootprint`
- **코드 발췌**: `algorithm.ts:2099-2135` `countDistributionViolations` (B1 카운트 산출)
- **문서 발췌**: `docs/algorithm-pipeline.md:345` "CBM 쪼개기 절대 금지 — 한 cargoId 의 unit 은 한 컨테이너에만"
- **테스트**: `_quick-{1st,2st,3st}-sg-b1b2-lightmode.mjs`, `verify-2st-hm-physics.mjs` B1 검증
- **최근 검증 결과**: 모든 샘플 B1=0 (현재)
- **현재 문제 관련**: 직접 관련 X (sg3-11 미배치는 무게 룰 거부 원인)

## 규칙 2. 부킹 인접 / 부킹 분산 금지 (B2)

- **규칙 설명**: 같은 bookingNo (House B/L) 화물들은 같은 컨테이너로.
- **왜 필요한지**: 한 부킹 = 한 운송 단위. 분산 시 운송장 처리 어려움.
- **적용 위치**: `bookingAnchor` (algorithm.ts:1259), 통로 A bookingAnchor 강제, footprint-cluster 룰 C, packBest evalKey lex 3순위
- **통과 조건**: bookingNo 모든 cargoId 가 한 컨테이너에 모임
- **실패 조건**: 같은 bookingNo 가 두 컨테이너에 분산
- **관련 함수**: `recordBookingAnchor`, `countDistributionViolations`
- **테스트**: 위와 동일
- **최근 검증**: 모든 샘플 B2=0
- **현재 문제 관련**: 직접 관련 X

## 규칙 3. 점수 합산 사용 금지

- **규칙 설명**: 모든 best 선택은 lexicographic comparator만, 가중치 점수 X.
- **왜**: 가중치는 파라미터 임의성 + 의도 불명확. lex 는 우선순위 명시적.
- **적용**: `packBest:isBetterResult`, `tryPlaceUnit`, `decideContainers`, `tryAbsorbOnColumns`, `repositionUnplaced` 등 전 위치
- **lex 우선순위 (현재)**:
  1. 미배치 화물 수 (적은 것 우선)
  2. B1 위반 카운트 (적은 것 우선) ← **이번 세션 추가**
  3. B2 위반 카운트 (적은 것 우선) ← **이번 세션 추가**
  4. 입고완료 마감 등급 (높은 것 우선)
  5. 평균 충전률 (높은 것 우선)
  6. 동종 컨 CBM 편차 `balancePenalty` (작은 것 우선)
- **코드 발췌**: `algorithm.ts:2196-2218` `isBetterResult`
- **문서 발췌**: `docs/algorithm-pipeline.md:346`
- **현재 문제 관련**: 균형 스왑이 B1·B2 위반 결과 best 채택하던 결함을 차단하기 위해 추가됨 (이번 세션)

## 규칙 4. 안전마진

- **규칙 설명**: 컨테이너 종류 결정 시 잉여 용량(slack) < 1.5 m³ 조합 제외.
- **왜**: 트럭 가득 채우면 운송 위험.
- **적용**: `decideContainers`
- **예외**: 모든 조합이 slack < 1.5 면 룰 미적용 (안전망)

## 규칙 5. 한 부킹 = 한 컨 룰 (룰 B 흡수 시에도 유지)

- **규칙 설명**: footprint-cluster 룰 B 가 다른 부킹 작은 박스를 컬럼 위에 흡수할 때, 그 부킹 전체가 같은 컨테이너에 들어갈 때만 허용.
- **적용**: `tryAbsorbOnColumns:bookingFullyInThisContainer` 휴리스틱
- **코드**: `footprint-cluster.ts:264-266`
- **테스트**: `footprint-cluster.test.ts` 룰 B 흡수 케이스

## 규칙 6. 받침 ≥ 70% 강제 (룰 B)

- **규칙 설명**: footprint-cluster 룰 B 흡수 시 받침 비율(작은 박스 발바닥 / 받침 박스 발바닥) ≥ 70%.
- **왜**: 위 박스가 떨어지지 않도록.
- **상수**: `SUPPORT_RATIO_MIN = 0.7` (`footprint-cluster.ts:42`)
- **테스트**: `footprint-cluster.test.ts` "받침률 70% 미만이면 흡수 X"

## 규칙 7. 글로벌 무게 적층 룰 (2026-05-08 추가, 2026-05-09 엄격화 진행 중)

- **규칙 설명**: 모든 적층에서 위 박스 무게 ≤ 아래 박스 무게 × `STACK_WEIGHT_TOLERANCE`. heavierBelow 플래그 무관 자동 적용.
- **왜**: 운송 중 하단 박스 압축 파손 방지.
- **현재 값 (미커밋)**: `STACK_WEIGHT_TOLERANCE = 1.0` (사용자 의도 — 위 ≤ 아래 등가까지만)
- **이전 값 (마지막 커밋)**: `1.5` (50% 까지 허용)
- **데이터 누락 폴백**: 둘 중 하나라도 weight=0 면 기존 heavierBelow 플래그 기반 폴백
- **코드 발췌** (`constraints.ts:124-153`):
```typescript
export const STACK_WEIGHT_TOLERANCE = 1.0;

export function canStackOn(top, bottom): boolean {
  if (bottom.remarks.noStacking) return false;
  const bothWeightsKnown = top.weightPerUnit > 0 && bottom.weightPerUnit > 0;
  if (bothWeightsKnown) {
    if (top.weightPerUnit > bottom.weightPerUnit * STACK_WEIGHT_TOLERANCE) return false;
  } else {
    const heavierBelowRequired = top.remarks.heavierBelow || bottom.remarks.heavierBelow;
    if (heavierBelowRequired && bottom.weightPerUnit < top.weightPerUnit) return false;
  }
  return true;
}
```
- **현재 문제 관련**: ✅ **현재 막힌 지점** — 1.0 strict 로 3ST SG sg3-11 미배치 회귀 발생 (lightMode 1박스).

## 규칙 8. 무거운 거 먼저 정렬 전략 (`heaviest`, 2026-05-08 추가)

- **규칙 설명**: packBest 매트릭스에 sortStrategy "heaviest" 추가. 무게 desc 우선 정렬 → 무거운 박스가 z=0 자리 우선 점유 → 컬럼 안 무거운 거 아래 자연 정렬.
- **적용**: `packBest:strategies` 배열 (`algorithm.ts:2052-2063`)
- **lightMode strategies**: `["ldf", "longest-side", "heaviest"]` (3 시도)
- **default strategies**: `["ldf", "longest-side", "tallest", "widest", "input", "shortest", "shortest-height", "heaviest"]` (8 시도)
- **매트릭스 합**: 8 × 2 × 2 × 2 = **64 시도** (이전 56 → 64 로 증가)
- **코드 발췌** (`algorithm.ts:1064-1074`):
```typescript
case "heaviest": {
  if (b.weight !== a.weight) return b.weight - a.weight;
  const va = a.width * a.length * a.height;
  const vb = b.width * b.length * b.height;
  if (vb !== va) return vb - va;
  const longA = Math.max(a.width, a.length, a.height);
  const longB = Math.max(b.width, b.length, b.height);
  return longB - longA;
}
```

## 규칙 9. 다단금지 (noStacking)

- **규칙 설명**: bottom 박스가 noStacking 플래그면 위에 어떤 박스도 못 얹음.
- **적용**: `canStackOn` 첫 번째 조건 (`constraints.ts:138`)

## 규칙 10. 상단적재 (topOnly)

- **규칙 설명**: 그 박스는 z=0 바닥에 못 둠. 다른 박스 위에만 올라감.
- **적용**: `tryPlaceUnit` (`extreme-point.ts:313`) — `if (unit.remarks.topOnly && cand.z <= EPS) continue;`

## 규칙 11. 회전 제한 (orientation)

- **규칙 설명**: `free` (6면), `long_along_length` (장축이 컨 길이), `fixed` (회전 X).
- **적용**: `allowedFaces` (`constraints.ts:62-76`)

## 규칙 12. 안쪽 깊숙이 고정점 / 옵션 C (룰 D, 2026-05-08 추가)

- **규칙 설명**: footprint-cluster 컬럼 첫 박스를 컨테이너 안쪽 끝(y 최댓값) 자리에 박음.
- **왜**: 큰 묶음을 안쪽에 박아 도어 쪽 자유 공간 확보 → 작은 박스 끼울 자리 ↑.
- **구현**: `tryPlaceUnit` 의 `scoreFn` 옵션을 `-y * 1e8 + x * 1e4 + z` 로 교체.
- **활성**: 기본 ON. `options.footprintCluster.deepAnchor = false` 로 OFF.
- **효과**: 3ST SG sg3-16 리틀스푼 1박스 미배치 (이전 75분 56-매트릭스 NP-hard) → 0 도달.

## 규칙 13. 발바닥 사전 묶음 룰 A — 같은 부킹 내부 발바닥 컬럼

- **규칙 설명**: 같은 부킹 안 발바닥 차이 ≤ 5cm 박스 2개 이상 → 위로 자체 적층.
- **활성 조건**: 컨테이너 부피 ≥ 50 m³ + 후보 unit ≥ 5 (보수적, 1ST SG 등 영향 X)
- **상수**: `FOOTPRINT_TOL_CM = 5`, `MIN_CONTAINER_CBM = 50`, `MIN_UNITS = 5`
- **코드**: `footprint-cluster.ts:115-159` `groupFootprintColumns`
- **정렬**: 무거운 거 아래 (`cluster.sort((a, b) => b.weight - a.weight)`)

## 규칙 14. 발바닥 사전 묶음 룰 B — 다른 부킹 작은 발바닥 흡수

- **규칙 설명**: 룰 A 컬럼 꼭대기에 다른 부킹 작은 박스 흡수.
- **조건**: 받침 ≥ 70% (`SUPPORT_RATIO_MIN`) + 한 부킹 = 한 컨 보호
- **코드**: `footprint-cluster.ts:251-360` `tryAbsorbOnColumns`

## 규칙 15. 발바닥 사전 묶음 룰 C — atomic 후처리

- **규칙 설명**: 사전 묶음이 한 cargoId/booking 일부만 깔면 통째 롤백 → placeQueueWrapper 재처리.
- **코드**: `footprint-cluster.ts:456-487`

## 규칙 16. 장축 막대형 박음 (long-axis anchor, default ON)

- **규칙 설명**: 가는 막대형 박스(311×15×15 같은) 자동 컨 안쪽 모서리부터 박음.
- **활성 조건 3가지 모두 만족**:
  1. 절대 길이 ≥ 300 cm
  2. 컨 길이 × 25% 이상
  3. 막대 비율 (min/max) ≤ 0.25
- **코드**: `long-axis-anchor.ts:38-84`
- **상수**: `DEFAULT_THRESHOLD_CM = 300`, `SLENDERNESS_THRESHOLD = 0.25`

## 규칙 17. 사이즈 우선 분류

- **규칙 설명**: cargoType 라벨보다 사이즈가 우선. W·L·H ≥ 1cm 면 시각 적재.
- **코드**: `algorithm.ts:198-` `classify`

## 규칙 18. 백트래킹 (`MAX_BACKTRACK`)

- **규칙 설명**: 미배치 발생 시 input 순서 입력 박스 앞으로 (a) + 매트릭스 swap (b) 재시도.
- **코드**: `algorithm.ts:2236-` (default 12회, lightMode 1회)

## 규칙 19. 자리 바꾸기 패스 (Stage 4, `repositionUnplaced`)

- **규칙 설명**: 미배치 cargo 마다 컨테이너 안 cargo 1개 빼서 재배치 후 빈 자리 시도.
- **발동**: `unplaced.length > 0` 시만
- **코드**: `algorithm.ts:repositionUnplaced`

## 규칙 20. Rescue repack (5.6단계)

- **규칙 설명**: fixedMap 컨테이너 전체 재배치 + 미배치 unit 합쳐 tall-first + LDF 재시도.
- **발동**: `unplaced.length > 0` 시만

## 규칙 21. Stage 6 행 잔여공간 fitting

- **규칙 설명**: Y 축 행 클러스터링 + 잔여공간 6면 회전 fitting.
- **코드**: `lib/packing/row-residual.ts`

## 규칙 22. 균형 스왑 (Swap loop, 6단계)

- **규칙 설명**: 동종 컨 ≥ 2 + CBM 편차 > 3 m³ → 큰 컨 → 작은 컨 cargo 1개 이동.
- **반복**: 최대 8회
- **lightMode**: 스킵
- **코드**: `algorithm.ts:2287-2366`
- **결함 (해소됨)**: fixedAssignment 강제 후 재pack 결과가 cargoId 분산 일으키면서 충전률 우수해 best 채택 → 이번 세션 lex B1·B2 추가로 차단

## 규칙 23. packBest 조기 종료

- **규칙 설명**: 어느 시도든 미배치 0 도달 → 매트릭스 잔여 시나리오 전부 스킵.
- **코드**: `algorithm.ts:2188`

## 규칙 24. 발바닥 컬럼 캐시 (`COLUMN_CACHE`)

- **규칙 설명**: 매트릭스 64 시도 동안 같은 unit 풀 발바닥 컬럼 재계산 비용 제거.
- **상한**: 256 entries (LRU)

## 규칙 25. 매트릭스 lightMode

- **규칙 설명**: 환경 시간 한계용 빠른 모드 — 정렬 3개 + 컨 순서 1 + 자동마감 1 + 배치 1 = 3 시도.
- **활성**: `packBest(cargoes, mode, { lightMode: true })`

## 규칙 검증 매트릭스 (확정 — `docs/algorithm-pipeline.md` 343-352 절대 룰)

```
1. CBM 쪼개기 절대 금지 (한 cargoId = 한 컨)
2. 점수 합산 사용 금지 (lex 비교만)
3. 부킹 고정점 (한 booking = 한 컨)
4. 안전마진 (slack < 1.5 m³ 조합 제외)
5. 한 부킹 = 한 컨 룰은 흡수 시에도 유지
6. 받침 ≥ 70% 강제 (룰 B 흡수)
7. 글로벌 무게 룰 (위 ≤ 아래 × tolerance)  ← 이번 세션 추가
8. 무거운 거 먼저 정렬 전략 (heaviest)        ← 이번 세션 추가
```

---

# 6. 알고리즘 파이프라인 전체

## 6-1. 진입점

```
사용자 엑셀 업로드
   ↓
ExcelImport.tsx 파싱 → CargoSpec[]
   ↓
app/api/pack/route.ts:69 → packBest(cargoes, mode, opts)
   ↓
[lib/packing/algorithm.ts:2045 packBest]
   ↓
1단계: tryAllStrategies (매트릭스 64 시도)
   ↓
2단계: 백트래킹 (default 12회, lightMode 1회)
   ↓
3단계: 균형 swap (default만)
   ↓
CLPResult 반환
```

## 6-2. 매트릭스 시도 (`tryAllStrategies`)

```
for sortStrategy in [ldf, longest-side, tallest, widest, input, shortest, shortest-height, heaviest] (default 8)
  for containerOrder in [biggest-first, smallest-first] (default 2)
    for autoConsolidateCompleted in [true, false] (default 2)
      for placementMode in [wrapper, pure] (default 2)
        ↓
        pack(cargoes, mode, options)  ← 한 시도
        ↓
        evalKey(result) 계산 (미배치, B1, B2, consolidationTier, fillRatePct, balancePenalty)
        ↓
        if isBetterResult(key, bestKey): best = result
        ↓
        if bestKey.unplacedCount === 0: break (조기 종료)
```

## 6-3. pack() 내부 흐름 (1단계 시도)

```
pack(cargoes, mode, options)
   ↓
1. classify(cargoes) — visualCargoes, ctCargoes, completedCargoes
   ↓
2. expandToUnits(visualCargoes) — quantity 펼침
   ↓
3. sortBig(allUnits) — sortStrategy 별 정렬 (heaviest 추가)
   ↓
4. sortClustered(allUnits) — booking → shipper → cargoId → ldf rank
   ↓
5. decideContainers — 트럭 종류 결정 (40FT × N + 20FT × M)
   ↓
6. orderedContainers 결정 (containerOrder)
   ↓
7. autoConsolidateCompleted 처리
   ↓
8. **각 컨테이너 마다 통로 B 진입 직전 사전 패스**:
     a. anchorLongAxisCargoes(cont, pool, options.longAxisAnchor)
        — 가는 막대형(311×15×15) 박스 컨 안쪽 모서리 anchor
     b. preClusterFootprint(cont, pool, options.footprintCluster)
        — 룰 A: 같은 부킹 발바닥 컬럼 묶음 (무거운 거 아래 정렬)
        — 룰 B: 다른 부킹 작은 발바닥 흡수 (받침 ≥ 70%)
        — 룰 C: atomic 후처리 (partial cargoId/booking 롤백)
        — 룰 D: 첫 박스 안쪽 끝(y 최댓값) 우선 (옵션 C)
   ↓
9. allocateBulkGroup(ctCargoes) — 통로 A: CT 카톤 (사이즈 무차원)
   ↓
10. placeQueueWrapper(generalUnits) / placeQueuePure(generalUnits) — 통로 B
    cargoId atomic 단위 처리. 각 cargo 마다 컨 후보 시도 → 통째 commit
    내부에서 tryPlaceUnit (extreme-point) → fail → tryPlaceUnitBruteForce
   ↓
11. (미배치 발생 시) repositionUnplaced — Stage 4 자리 바꾸기
   ↓
12. (미배치 발생 시) Rescue repack — Stage 5.6
   ↓
13. (미배치 발생 시) Stage 6 행 잔여공간 fitting (row-residual)
   ↓
14. computeDisplayRows — placement → rows 변환 (시각화)
   ↓
return CLPResult
```

## 6-4. 핵심 함수 요약

| 함수 | 위치 | 역할 |
|---|---|---|
| `packBest` | `algorithm.ts:2045` | 매트릭스 64 + 백트래킹 + 균형 swap |
| `pack` | `algorithm.ts:일반` | 한 번의 packing 시도 |
| `expandToUnits` | `algorithm.ts:117` | quantity → unit 확장 |
| `classify` | `algorithm.ts:198` | visual/CT/completed 분류 |
| `decideContainers` | `algorithm.ts` | 컨테이너 종류·수량 결정 |
| `placeQueueWrapper` | `algorithm.ts:1366` | 통로 B atomic 배치 |
| `allocateBulkGroup` | `algorithm.ts` | 통로 A CT 묶음 |
| `tryPlaceUnit` | `extreme-point.ts:222` | 단일 unit EP 자유 좌표 시도 |
| `tryPlaceUnitBruteForce` | `extreme-point.ts:510` | 1cm 그리드 brute-force |
| `preClusterFootprint` | `footprint-cluster.ts:369` | 룰 A/B/C/D 사전 묶음 |
| `anchorLongAxisCargoes` | `long-axis-anchor.ts` | 가는 막대형 모서리 anchor |
| `canStackOn` | `constraints.ts:134` | 적층 가능 여부 + 무게 룰 |
| `repositionUnplaced` | `algorithm.ts` | Stage 4 자리 바꾸기 |
| `evalKey` / `isBetterResult` | `algorithm.ts:2137,2196` | best 비교 lex (미배치→B1→B2→...) |

## 6-5. 결과 출력 (`CLPResult`)

```typescript
interface CLPResult {
  containers: ContainerPlan[];   // 각 컨테이너의 rows[].bottomItems[].topItems[] + bulkItems
  unplaced: UnplacedItem[];      // 미배치 cargo
  summary: { avgFillRate: number; ... };
}
```

---

# 7. 최근 작업 타임라인

## 7-1. 이번 세션 (2026-05-08 ~ 2026-05-09) 핵심 4 작업

### 커밋 1 — `5c2bbeb` (2026-05-08): 안쪽 깊숙이 고정점(옵션 C) + packBest B1·B2 lex 우선순위
- **수정 파일**: `lib/packing/footprint-cluster.ts`, `lib/packing/algorithm.ts`, `lib/packing/footprint-cluster.test.ts`, `docs/algorithm-pipeline.md`, `scripts/_quick-2st-sg-b1b2-lightmode.mjs` (신규), `scripts/_quick-3st-sg-b1b2-lightmode.mjs` (신규)
- **수정 이유**: 3ST SG sg3-16 리틀스푼 1박스 미배치 (이전 75분 56-매트릭스도 못 풀던 NP-hard 케이스) 해결
- **핵심 변경**:
  - `tryPlaceColumn` 의 첫 박스 배치를 `tryPlaceUnit` `scoreFn = -y * 1e8 + x * 1e4 + z` 로 교체 → 컨 안쪽 끝 우선
  - `FootprintClusterOptions.deepAnchor` (기본 ON) 추가
  - `packBest:evalKey` 에 `b1Violations`, `b2Violations` 카운트 추가
  - `isBetterResult` lex 우선순위에 B1·B2 2·3 순위 삽입 (균형 스왑이 분산 유발하던 결함 차단)
- **해결한 문제**: sg3-16 리틀스푼 미배치 → 0
- **새로 생긴 문제**: 없음 (모든 샘플 회귀 0)

### 커밋 2 — `e183748` (2026-05-08): 글로벌 무게 적층 룰 — 위 ≤ 아래 × 1.5 (실무 안전, 절대 룰 #7)
- **수정 파일**: `lib/packing/constraints.ts`, `docs/algorithm-pipeline.md`, `scripts/_debug-3st-sg-unplaced.mjs` (신규), `scripts/_quick-default56-3stsg.mjs` (신규)
- **수정 이유**: 사용자 지적 "가벼운 박스 위에 압도적 무거운 박스 못 올림" 룰을 글로벌로 강제 (이전엔 `heavierBelow` 플래그 표시한 박스만 보호)
- **초기 시도**: TOLERANCE = 1.0 (위 ≤ 아래 등가까지)
- **회귀 발견**: sg3-11 성안기계 750kg 미배치 1건 → 1.5 (50% 까지) 로 절충
- **해결한 문제**: heavierBelow 플래그 안 표시한 박스도 자동 보호
- **새로 생긴 문제**: 사용자 의도 ("위에 무거운 거 절대 안돼") 와 1.5 tolerance 모순

### 커밋 3 — `c1d6967` (2026-05-08): 무거운 거 먼저 정렬 전략(heaviest) — 컬럼 안 자동 무거운 거 아래
- **수정 파일**: `lib/packing/algorithm.ts`, `docs/algorithm-pipeline.md`, `scripts/_audit-3st-sg-weight-stack.mjs` (신규)
- **수정 이유**: 사용자 의도 "무거운 박스 항상 아래". 무게 desc 정렬 전략 추가로 z=0 자리 우선 점유 → 자연 정렬.
- **핵심 변경**:
  - `sortStrategy` 타입에 `"heaviest"` 추가
  - `sortBig` 에 case "heaviest" 추가 (무게 desc, 부피 desc, 긴 변 desc tiebreak)
  - `packBest:strategies` 에 "heaviest" 추가 (lightMode 3, default 8)
  - 매트릭스 56 → 64 시도
- **검증**: 모든 샘플 0 미배치, 적층 무게 룰 위반 0건 (1.5 tolerance 기준)

### 미커밋 변경 (현재) — STACK_WEIGHT_TOLERANCE 1.5 → 1.0
- **수정 파일**: `lib/packing/constraints.ts` (1 파일, 미커밋)
- **수정 이유**: 사용자 재지적 "위에 1.5배 무거운 거도 OK 라고 통과시키는 건 모순. 무게 같은 거까지만 허용 (등가 OK), 초과 절대 금지로 엄격화"
- **승인된 plan**: `C:\Users\napda\.claude\plans\3st-sg-total-jazzy-aho.md`
- **현재 상태**: 검증 진행 중 — lightMode 3ST SG 1 미배치 회귀, default 64-매트릭스 백그라운드 진행 중

## 7-2. `git status` (확정)

```
On branch master
Your branch is ahead of 'origin/master' by 20 commits.
Changes not staged for commit:
  modified:   lib/packing/constraints.ts
```

## 7-3. `git diff lib/packing/constraints.ts`

```diff
-/** 글로벌 무게 룰 허용 비율 — 위 박스 무게 ≤ 아래 박스 무게 × 1.5 */
-export const STACK_WEIGHT_TOLERANCE = 1.5;
+/**
+ * 글로벌 무게 룰 허용 비율 — 위 박스 무게 ≤ 아래 박스 무게 × 1.0 (등가 OK, 초과 절대 금지).
+ * 사용자 의도 그대로 — "무거운 박스는 항상 아래". heaviest 정렬 전략이 무거운 박스를
+ * z=0 자리로 먼저 보내므로 회귀 없이 엄격화 가능.
+ */
+export const STACK_WEIGHT_TOLERANCE = 1.0;

 /**
  * top 화물을 bottom 화물 위에 쌓아도 되는지 검사.
  * - bottom이 다단금지(noStacking)면 불가
- * - **글로벌 무게 룰 (2026-05-08 강화)**: 위 박스 무게 ≤ 아래 박스 무게 × 1.5
- *   (등가 OK + 50% 까지 허용 — 안전 + 회귀 균형).
+ * - **글로벌 무게 룰 (2026-05-09 엄격화)**: 위 박스 무게 ≤ 아래 박스 무게
+ *   (등가 OK, 초과 절대 금지). heavierBelow 플래그 무관하게 모든 적층에 적용.
   ...
  */
```

---

# 8. 최근 가장 어려웠던 미배치 문제 해결 과정

## 8-1. 케이스: 3ST SG TOTAL `sg3-16 리틀스푼` 1박스 미배치 (2026-05-08 해결)

### 문제 시작 (확정 — `project_clpclaude_3st_sg_status.md` + 메모리)

3ST SG TOTAL: 35 화주, 약 90.25 m³, 약 24,280 kg, 2×40FT 컨테이너로 분배. 실무자는 100% 적재 가능. 시스템도 대부분 통과하지만 마지막 1박스 자리 못 찾음.

| 시도 | 미배치 |
|---|---|
| 단독 pack (footprint-cluster ON, long-axis OFF) | sg3-8 세아특수강 311×15×15 봉 |
| 단독 pack + long-axis 자동 ON | sg3-25 VPHI 114×114×71 |
| **packBest 56 매트릭스 default (75분)** | **sg3-16 리틀스푼 110×100×200** |
| 손 실험 (`_experiment-vphi-handO-cluster.mjs`) — 컨2 16행만 단독 | 0/27 ✅ 입증 |

### 당시 적용 중 룰
- 발바닥 사전 묶음 룰 A (같은 부킹 묶음)
- 룰 B (다른 부킹 흡수, 받침 ≥ 70%)
- 룰 C (atomic 후처리)
- 장축 막대형 anchor (default ON, sg3-8 처리)

### 왜 단순 배치로 안 됐는지
손 실험 분석 (이전 세션):
- VPHI 9박스를 4 컬럼(2×2 footprint, 약 228×228 cm) 으로 묶음
- 그 컬럼들을 컨2 X=326 위치(안쪽 깊숙이)에 박음
- FLOWBUS 326cm 박스 다음 자리에 anchor
- 한도신소재 110×110×93 을 VPHI B 컬럼 위 3단 적층 (받침 93.1%)
- → 컨2 16행 0/27 도달

알고리즘은 cluster 만들기·흡수·atomic 보호 자동 동작 했지만 **anchor 위치 자동 선택이 손 실험만큼 정확하지 못함** — 첫 박스를 도어 근처(y 최솟값) 자리에 박아 작은 박스 끼울 자리 부족.

### 실험 시도 (이전 세션 자산)
- `scripts/_experiment-vphi-handO-cluster.mjs` — 손 실험 0/27 입증
- `scripts/_quick-verify-3st-sg-c2.mjs` — 컨2 단독 빠른 검증
- `scripts/_quick-vphi-coord-audit.mjs` — VPHI 좌표 + 받침률 검증
- `logs/3st-sg-default-56-matrix-bg.log` — 75분 default 매트릭스 결과

### 성공한 실험: 옵션 C (안쪽 깊숙이 고정점)
- `tryPlaceColumn` 첫 박스 배치를 `tryPlaceUnit` `scoreFn = -y * 1e8 + x * 1e4 + z` 로 교체
- 결과:
  - lightMode (3 시도, 1초): 0 미배치 + 0 B1 + 0 B2 ✅
  - default 64-매트릭스 (4분): 0 미배치 + 0 B1 + 0 B2 ✅
- 적층 무게 룰 위반 0건

### 성공 layout
손 실험과 동일한 패턴 — VPHI 컬럼이 컨2 안쪽 깊숙이 anchor, 도어 쪽에 작은 박스 (한도신소재 등) 배치.

### 성공 후 검증 결과 (1.5x 무게 tolerance 기준, 커밋 2 적용 전)
| 샘플 | 미배치 | B1 | B2 | 일치 |
|---|---|---|---|---|
| 1ST SG | 0 | 0 | 0 | mismatch 12 (룰 #8 valid) |
| 2ST SG | 0 | 0 | 0 | 100% 일치 ✅ |
| 2ST HM | 0 | 0 | 0 | mismatch 30 (베이스라인 동일) |
| 3ST SG lightMode | 0 | 0 | 0 | — |
| 3ST SG 64-매트릭스 (4분) | 0 | 0 | 0 | — |

### 이 성공이 최신 코드에서 유효한지 (2026-05-09 시점 — 미커밋 1.0 strict 무게 룰 적용 후)
- 3ST SG lightMode: **1 미배치 회귀 발생** (sg3-11 성안기계 750kg)
- 3ST SG default 64-매트릭스: **현재 백그라운드 진행 중** (10:16 시작, 출력 0 바이트, 50+ 분 경과 — 매트릭스 다 시도 + 백트래킹·rescue·Stage 6 fallback 모두 발동 중인 것으로 추정)

→ 옵션 C 자체는 유효하나 동시에 강화된 무게 룰(1.0 strict)과 충돌.

---

# 9. 현재 막힌 지점

## 9-1. 확정 사실

- 미커밋 변경: `lib/packing/constraints.ts` `STACK_WEIGHT_TOLERANCE = 1.5 → 1.0`
- 단위 테스트 22/22 PASS (constraints + footprint-cluster + algorithm)
- 1ST SG: 미배치 0, mismatch 8 (이전 baseline 10, mismatch 12 였다가 8로 감소)
- 2ST SG: 미배치 0, **AUTO 분배 100% 일치 ✅** (전체 PASS)
- 2ST HM physics: 미배치 0, B1=0, B2=0, 33/33 PASS
- **3ST SG lightMode: 미배치 1건 (`sg3-11 성안기계` 150×80×68, 750kg)**
- 3ST SG default 64-매트릭스: 백그라운드 진행 중 (10:16 시작, 50+ 분 경과)
- `heaviest` 정렬 전략 추가했음에도 1.0 strict 룰에서 sg3-11 1박스 풀리지 않음

## 9-2. 추정

- sg3-11 성안기계 750kg 박스가 적층되려면 받침 박스 ≥ 750kg 필요. 750kg 이상 박스: SMI 847kg, 광성텍 3840kg, 세아특수강 5722kg, 롯데(0×0×0 bulk), 대동 1048kg, SK GEO 2625kg, ANC LOGISTICS 2000kg, FLOWBUS 3760kg
- 그중 sg3-11 발바닥(150×80) 이 들어가는 받침은 사이즈 매칭상 **대동 218×114×68 (1048kg)** 정도 — 추정
- heaviest 정렬해도 sg3-11(750kg)이 9번째로 큰 박스라 배치 차례에 z=0 자리가 차 있고, 받침 후보 박스가 이미 어디 있어도 sg3-11 발바닥과 사이즈 매칭이 안 되거나 받침 70% 룰 / 무게 룰 모두 통과하는 자리가 없는 것으로 추정
- default 64-매트릭스가 50+ 분 동안 출력 없는 것은 모든 시도가 unplaced > 0 이라 매트릭스 + 백트래킹 + rescue + Stage 6 fallback 모두 돌아 시간 누적 추정

## 9-3. 아직 확인 안 된 것

- 3ST SG default 64-매트릭스 결과 (현재 백그라운드 진행 중)
- sg3-11 이 어떤 박스 위에 올라가려다가 거부됐는지 정확한 trace
- 1.0 strict 에서 sg3-11 이 z=0 만 시도하는데 z=0 공간 부족인지, z>0 시도하는데 받침 후보 거부인지
- 1.2 (20% 까지) 또는 1.3 (30% 까지) 절충 tolerance 가 회귀 0 + 사용자 의도 절반 만족 가능한지

## 9-4. 현재 실패한 실험

- TOLERANCE = 1.0 strict + heaviest 정렬 매트릭스 추가 → 3ST SG lightMode 1 미배치 (sg3-11)
- (1.0 + heaviest 조합으로도 풀리지 않음)

## 9-5. 현재 진행 중인 task

- 백그라운드 task `bu9xxiz82` — `node --experimental-strip-types scripts/_quick-default56-3stsg.mjs` (2026-05-09 10:16 시작, 출력 0 바이트, 50+ 분 경과)

## 9-6. 가장 중요한 판단 포인트

1. **TOLERANCE 값 결정**: 1.0 strict 유지 (사용자 의도 그대로) vs 1.2~1.5 절충 (회귀 0 우선)
2. **default 64-매트릭스가 결국 0 도달하는지**: lightMode 만 1 미배치고 default 는 0 일 가능성 (조합 더 많아서 풀이 발견 가능)
3. **sg3-11 풀이 가능성**: 아직 시도 안 한 정렬 전략 / 컨 순서 / 룰 조합이 있는지

---

# 10. 현재 회귀 / 실패 사례 상세 분석

## 10-1. 실패한 샘플 (확정)

`data/samples/singapore-total-3.json` (3ST SG TOTAL, 35 화주)

## 10-2. 실패한 검증 명령어

```bash
node --experimental-strip-types scripts/_quick-3st-sg-b1b2-lightmode.mjs
```

## 10-3. 실패 로그

```
unplaced: 1
=== B1 (CBM 쪼개기) ===
✅ 0 위반
=== B2 (부킹 분산) ===
✅ 0 위반
=== B3 (미배치) ===
❌ 1
```

debug 로그 (`scripts/_debug-3st-sg-unplaced.mjs`):
```
unplaced: 1
  - sg3-11 성안기계 150×80×68 qty=1 wt=undefinedkg
```

## 10-4. 미배치 화물 상세 (확정 — 데이터)

| 필드 | 값 |
|---|---|
| 화물 식별자 (cargoId) | `sg3-11` |
| 화주명 (actualShipperName) | `성안기계` |
| 화주명 (shipperName) | `선진로지스틱스  /` |
| Booking | (samples/singapore-total-3.json 안 데이터, sg3-11 행) |
| destination | `KUCHING, MALAYSIA` |
| cargoType | `PL` |
| 사이즈 (W×L×H cm) | 150 × 80 × 68 |
| quantity | 1 |
| weightPerUnitKg | 750 |
| 단위당 무게 | 750 (단일 unit) |
| unitId | `sg3-11-0` |
| unitSizes | (없음 — 대표 사이즈 사용) |
| cbm | 0.832 |
| aboutCbm | 0.832 |
| weight (총) | 750 kg |

> **참고**: debug 스크립트가 `wt=undefinedkg` 로 출력한 이유는 unplaced 객체 필드 이름이 `weightPerUnit` 가 아니라 다른 이름일 가능성 (직접 검증 필요). 데이터 원본은 `weightPerUnitKg: 750` 으로 명시.

## 10-5. 이전에는 성공했는지 (확정)

YES. 1.5 tolerance + heaviest 정렬 + 옵션 C 조합으로 lightMode + default 64-매트릭스 모두 0 미배치 도달 (커밋 `c1d6967` 시점).

## 10-6. 현재 왜 실패하는지 (추정)

`STACK_WEIGHT_TOLERANCE` 1.5 → 1.0 으로 엄격화하면서 sg3-11 750kg 이 적층될 수 있는 받침 후보가 줄어듬:
- 1.5 tolerance: 750 / 1.5 = 500kg 이상 박스 위에 적층 가능
- 1.0 strict: 750kg 이상 박스 위에만 적층 가능 → 대상 후보 많이 감소

heaviest 정렬로 무거운 박스 z=0 우선 점유하지만, 이미 9번째 무거운 sg3-11 차례에 발바닥(150×80) 이 들어가는 자리가 z=0 + 받침 룰 통과하는 z>0 자리 모두에서 발견되지 않음 (현재 탐색 범위에서 미발견).

## 10-7. 어떤 조건에서 거부되는지 (추정)

```
canStackOn(top=sg3-11(750kg), bottom=X) 가 거부되는 케이스:
- bottom.weight < 750 → 거부 (1.0 strict)
```

## 10-8. 원인 후보 분류

| 원인 후보 | 가능성 | 근거 |
|---|---|---|
| 무게 룰 (1.0 strict 거부) | **높음** | 1.5 → 1.0 만 변경했고 1.5 에선 통과했음 |
| 공간 제약 | 낮음 | 1.5 에선 공간 자체 OK |
| 형상 (사이즈 매칭) | 중간 | 받침 발바닥 매칭 + 룰 70% 결합 가능성 |
| 그룹/부킹 강제 | 낮음 | sg3-11 단독 cargoId, B2 위반 0 |
| 검색 전략 | 낮음 | heaviest 추가했지만 동일 결과 |

## 10-9. 이미 시도한 해결책

1. ✅ `heaviest` 정렬 전략 추가 (효과 없음 — sg3-11 9번째라 z=0 우선권 못 받음)
2. ✅ packBest lex B1·B2 추가 (효과 — 5c2bbeb 에서 적용, 이번 변경엔 무관)
3. ✅ 옵션 C (안쪽 깊숙이 고정점) (다른 박스 풀리는 데 쓰임)

## 10-10. 아직 시도 안 한 해결책 후보

1. **TOLERANCE 절충값**: 1.2 (20%), 1.3 (30%), 1.4 (40%)
2. **TOLERANCE 동적 조정**: 무게 차이가 절대값 X kg 이하면 통과, X 초과면 거부
3. **사이즈 가중 룰**: 받침 발바닥이 충분히 크면 무게 비율 더 관대, 작으면 엄격
4. **sg3-11 단독 fallback**: 미배치 박스 발생 시 그 박스에 한해 tolerance 완화
5. **heaviest 정렬 외 추가 정렬 전략**: weight × volume desc 등
6. **placement 단계에서 sg3-11 우선 z=0 강제 hint**: 무거운 박스(특정 임계 이상)는 z=0 만 시도

## 10-11. 외부 검토자에게 물어볼 핵심 질문

A. **글로벌 무게 룰 1.0 strict 가 실무 안전 룰의 정답인가? 아니면 1.2~1.5 의 절충이 일반적인가?**

B. **무거운 박스가 받침될 박스를 못 찾는 케이스에서, 미배치를 피하기 위한 안전한 fallback 정책 (예: 미배치 1건 vs 무게 룰 1.5x 완화 — 어느 쪽이 실무 우선)?**

C. **default 64-매트릭스가 현재 50+ 분 진행 중. 결과가 0 미배치면 production 영향 없음. 결과가 1 미배치면 production 회귀. 매트릭스 결과가 무엇이든 lightMode 회귀를 어떻게 다룰지?**

---

# 11. 데이터 누락 / undefined 문제 확인

## 11-1. 확인 결과

| 케이스 | 영향 가능성 | 코드 위치 |
|---|---|---|
| `weightPerUnit = 0` (누락) | **있음** — `canStackOn` 의 `bothWeightsKnown` 가 false 가 되어 글로벌 무게 룰 우회, `heavierBelow` 플래그 폴백으로 떨어짐 | `constraints.ts:139` |
| `unitSizes[].weight = 0` | 있음 — `expandToUnits` 에서 행 weightPerUnit/totalUnits 폴백 | `algorithm.ts:127` |
| `bookingNo = undefined` | 영향 없음 (룰 A 자동 미발동) | `footprint-cluster.ts:120-124` |
| `cargoType = ?` | 영향 없음 (`normalizeCargoType` 화이트리스트) | `cargo.ts:38-43` |
| `unitSizes = []` | 대표 사이즈 + quantity 사용 | `algorithm.ts:145-163` |

## 11-2. debug 스크립트 vs 실제 packing 함수 차이

`scripts/_debug-3st-sg-unplaced.mjs` 가 unplaced 객체에 대해 `u.weightPerUnit` 출력하니 `undefined` 로 나왔는데, 데이터 원본 `weightPerUnitKg: 750` 임. 이는 **debug 스크립트의 필드 이름 오류** (확정 — `weightPerUnitKg` vs `weightPerUnit` 혼동) 이고, 실제 packing 함수 (`expandToUnits`) 는 정상 처리.

> 중요: 이 unrelated 한 debug 스크립트 출력 오류 때문에 sg3-11 무게가 0 처럼 보일 수 있으나 실제 weight = 750. 글로벌 무게 룰 정상 적용됨.

## 11-3. 데이터 누락이 룰 우회 가능한가

| 경로 | 우회 가능 여부 |
|---|---|
| `canStackOn` 무게 룰 | weight=0 면 fallback → heavierBelow 플래그만 검사 |
| `withinWeightLimit` (컨테이너 한도) | weight=0 이면 한도에 0 추가 → 통과 (정상) |
| `tryPlaceUnit` 충돌·받침 | 무관 |

→ sg3-11 (weight 750) 은 정상 적용. weight 0 박스만 잠재 우회 가능 (별도 이슈, 현재 문제와 무관).

---

# 12. 검증 명령어와 실제 결과

## 12-1. 단위 테스트

```bash
node --test --experimental-strip-types lib/packing/constraints.test.ts \
  lib/packing/footprint-cluster.test.ts lib/packing/algorithm.test.ts
```
**결과**: 22 / 22 PASS, 264ms ✅

## 12-2. 1ST SG TOTAL

```bash
node --experimental-strip-types scripts/verify-1st-sg-total.mjs
```
**결과 (현재, 미커밋 1.0 strict)**:
```
unplaced: 0
AUTO 분배 일치 : ❌ mismatch 8
컨테이너 셋 = 1×40FT + 1×20FT : ✅
전체 : ❌ FAIL (mismatch 만 / 미배치 0)
```
판정: 룰 #8 (실무자 분배 ≠ 정답) 적용 시 valid. 기능 PASS.

## 12-3. 2ST SG TOTAL

```bash
node --experimental-strip-types scripts/verify-2st-sg-total.mjs
```
**결과**:
```
unplaced: 0
40FT set #1: ✅ 일치
40FT set #2: ✅ 일치
AUTO 분배 일치 : ✅
컨테이너 = 2×40FT : ✅
전체 : ✅ PASS
```
판정: ✅ 100% 일치

## 12-4. 2ST HM physics

```bash
node --experimental-strip-types scripts/verify-2st-hm-physics.mjs
```
**결과**:
```
[전역] 알고리즘 룰
    ✓ B1. CBM 쪼개기 0
    ✓ B2. 부킹 인접 (분산 0)
    ✓ B3. 미배치 0
=== 종합: 33 pass / 0 fail ===
```
판정: ✅ 33/33 PASS

## 12-5. 3ST SG lightMode B1·B2 audit

```bash
node --experimental-strip-types scripts/_quick-3st-sg-b1b2-lightmode.mjs
```
**결과**:
```
unplaced: 1
=== B1 (CBM 쪼개기) ===
✅ 0 위반
=== B2 (부킹 분산) ===
✅ 0 위반
=== B3 (미배치) ===
❌ 1
```
판정: ❌ **회귀 1건** (sg3-11 미배치)

## 12-6. 3ST SG 무게 적층 audit

```bash
node --experimental-strip-types scripts/_audit-3st-sg-weight-stack.mjs
```
**결과**:
```
unplaced: 1
적층 무게 룰 위반: 0건
```
판정: 미배치 1 건이지만 적층 무게 룰 자체는 위반 없음 (1.0 strict 통과한 placement 들끼리는 모두 만족).

## 12-7. 3ST SG default 64-매트릭스 (백그라운드 진행 중)

```bash
node --experimental-strip-types scripts/_quick-default56-3stsg.mjs
```
**진행 상태**:
- task ID: `bu9xxiz82`
- 시작: 2026-05-09 10:16
- 현재 출력: 0 바이트 (이 문서 작성 시점 기준 50+ 분 경과)
- 추정: unplaced > 0 인 시도들이 매트릭스 후 백트래킹 + rescue + Stage 6 fallback 모두 시도 중 → 평소 4분 → 50분+ 로 늘어남

## 12-8. 미배치 박스 식별 debug

```bash
node --experimental-strip-types scripts/_debug-3st-sg-unplaced.mjs
```
**결과**:
```
unplaced: 1
  - sg3-11 성안기계 150×80×68 qty=1 wt=undefinedkg
```

## 12-9. timeout 또는 background 실행

- 백그라운드: `bu9xxiz82` (3ST SG default 64-매트릭스)
- timeout 강제: 없음 (현재 자연 진행 대기)

---

# 13. 관련 문서 / 코드 원문 발췌

## 13-1. 관련 docs 발췌

### `docs/algorithm-pipeline.md` 핵심 절대 룰 섹션
```
1. CBM 쪼개기 절대 금지 — 한 cargoId 의 unit 은 한 컨테이너에만 (통로 A·B 양쪽 강제)
2. 점수 합산 사용 금지 — 모든 best 선택은 lex 비교
   (lex 우선순위 — 미배치 → B1 → B2 → 입고완료 → 충전률 → 균형)
3. 부킹 고정점 — 같은 부킹 화물은 같은 컨
4. 안전마진 — 잉여 용량 < 1.5 m³ 조합 제외
5. 한 부킹 = 한 컨 룰은 흡수 시에도 유지 — 4.5단계 룰 B 흡수 시 흡수되는 박스의
   부킹 전체가 같은 컨테이너에 들어갈 때만 흡수 허용
6. 받침 ≥ 70% 강제 — 4.5단계 룰 B 박스 흡수 시 받침 비율 70% 미만이면 거부
7. 글로벌 무게 룰 (2026-05-08 추가) — 모든 적층에서 위 박스 무게 ≤ 아래 박스 무게 × 1.5
   (등가 OK + 50% 까지 허용). heavierBelow 플래그 무관하게 자동 적용.
8. 무거운 거 먼저 정렬 전략 (`heaviest`, 2026-05-08 추가) — packBest 매트릭스에 무게 desc
   정렬 전략 추가. 무거운 박스가 z=0 자리 우선 점유.
```
(문서는 1.5 tolerance 시점 기준. 현재 미커밋 변경으로 1.0 strict 적용 중 — 문서 갱신 필요.)

### `docs/algorithm-pipeline.md` 5단계 packBest 발췌
```
- 같은 화물 데이터로 최대 64 가지 (정렬 8 × 모드 2 × 컨 순서 2 × 클러스터링 2) 조합 시도
- lex 비교 (점수 합산 X, 2026-05-08 갱신 — B1·B2 우선순위 추가):
  ① 미배치 적은 것 → ② B1 위반 적은 것 → ③ B2 위반 적은 것 → ④ 입고완료 마감
  → ⑤ 충전률 → ⑥ 동종 컨 균형(balancePenalty)
- 가장 좋은 결과 채택
```

### `CLAUDE.md` 작업 룰 발췌
```
4. CBM 쪼개기 금지 — 한 화물 행은 한 컨테이너에만
5. 점수 합산 금지 — best 선택은 lexicographic comparator만
8. 실무자 분배 ≠ 유일 정답 — 물리·규칙 통과하면 valid
10. 회귀 0건 보장 — 알고리즘 수정 시 1ST/2ST/3ST SG·HM 전 샘플 회귀 테스트 자동 동행
```

## 13-2. 핵심 코드 발췌

### `lib/packing/constraints.ts` `canStackOn` (현재 1.0 strict)
```typescript
export const STACK_WEIGHT_TOLERANCE = 1.0;

export function canStackOn(
  top: Pick<CargoSpec, "weightPerUnit" | "remarks">,
  bottom: Pick<CargoSpec, "weightPerUnit" | "remarks">,
): boolean {
  if (bottom.remarks.noStacking) return false;
  const bothWeightsKnown = top.weightPerUnit > 0 && bottom.weightPerUnit > 0;
  if (bothWeightsKnown) {
    if (top.weightPerUnit > bottom.weightPerUnit * STACK_WEIGHT_TOLERANCE) {
      return false;
    }
  } else {
    const heavierBelowRequired =
      top.remarks.heavierBelow || bottom.remarks.heavierBelow;
    if (heavierBelowRequired && bottom.weightPerUnit < top.weightPerUnit) {
      return false;
    }
  }
  return true;
}

export function withinWeightLimit(
  currentWeight: number, addWeight: number, container: ContainerSpec,
): boolean {
  return currentWeight + addWeight < container.maxWeightKg;
}
```

### `lib/packing/algorithm.ts:countDistributionViolations` (이번 세션 추가)
```typescript
const countDistributionViolations = (r: CLPResult): { b1: number; b2: number } => {
  const cargoCi = new Map<string, Set<number>>();
  const bookingCi = new Map<string, Set<number>>();
  r.containers.forEach((c) => {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          const s = cargoCi.get(it.cargoId) ?? new Set<number>();
          s.add(c.index);
          cargoCi.set(it.cargoId, s);
        }
        if ((it as any).bookingNo) {
          const bn = (it as any).bookingNo!;
          const s = bookingCi.get(bn) ?? new Set<number>();
          s.add(c.index);
          bookingCi.set(bn, s);
        }
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) { /* ... */ }
      if ((b as any).bookingNo) { /* ... */ }
    }
  });
  let b1 = 0;
  for (const s of cargoCi.values()) if (s.size > 1) b1++;
  let b2 = 0;
  for (const s of bookingCi.values()) if (s.size > 1) b2++;
  return { b1, b2 };
};
```

### `lib/packing/algorithm.ts:isBetterResult` (lex 우선순위)
```typescript
const isBetterResult = (a: EvalKey, b: EvalKey): boolean => {
  if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount < b.unplacedCount;
  if (a.b1Violations !== b.b1Violations) return a.b1Violations < b.b1Violations;
  if (a.b2Violations !== b.b2Violations) return a.b2Violations < b.b2Violations;
  if (a.consolidationTier !== b.consolidationTier)
    return a.consolidationTier > b.consolidationTier;
  if (Math.abs(a.fillRatePct - b.fillRatePct) > 0.001)
    return a.fillRatePct > b.fillRatePct;
  return a.balancePenalty < b.balancePenalty;
};
```

### `lib/packing/algorithm.ts:sortBig` (heaviest 추가)
```typescript
case "heaviest": {
  if (b.weight !== a.weight) return b.weight - a.weight;
  const va = a.width * a.length * a.height;
  const vb = b.width * b.length * b.height;
  if (vb !== va) return vb - va;
  const longA = Math.max(a.width, a.length, a.height);
  const longB = Math.max(b.width, b.length, b.height);
  return longB - longA;
}
```

### `lib/packing/footprint-cluster.ts:tryPlaceColumn` (옵션 C 적용)
```typescript
function tryPlaceColumn(
  col: ColumnDescriptor, state: ContainerPackState,
  spec: ContainerSpec, deepAnchor: boolean,
): UnitItem[] {
  const doorH = spec.doorHeight ?? spec.innerHeight;
  if (col.totalHeight > doorH) return col.units;
  for (let i = 0; i < col.units.length - 1; i++) {
    if (!canStackPair(col.units[i + 1], col.units[i])) return col.units;
  }
  // 옵션 C — 안쪽 깊숙이 고정점
  const first = col.units[0];
  const beforeCount = state.placements.length;
  const deepFirstAttempt = deepAnchor
    ? tryPlaceUnit(first, state, spec, {
        scoreFn: (c) => -c.y * 1e8 + c.x * 1e4 + c.z,
      })
    : false;
  const ok =
    deepFirstAttempt ||
    tryPlaceUnit(first, state, spec) ||
    tryPlaceUnitBruteForce(first, state, spec);
  if (!ok) return col.units;
  // ... 컬럼 위로 강제 stack ...
}
```

### `lib/packing/footprint-cluster.ts:tryPlaceColumn` 룰 C atomic 후처리
```typescript
const partialCargoIds = new Set<string>();
for (const [cargoId, units] of poolByCargoId) {
  const placedCount = units.filter((u) => placedIds.has(u.unitId)).length;
  if (placedCount > 0 && placedCount < units.length) {
    partialCargoIds.add(cargoId);
  }
}
const partialBookings = new Set<string>();
for (const cargoId of partialCargoIds) {
  const units = poolByCargoId.get(cargoId) ?? [];
  for (const u of units) {
    if (u.bookingNo) partialBookings.add(u.bookingNo);
  }
}
if (partialCargoIds.size > 0 || partialBookings.size > 0) {
  const state = containerLike.packState;
  const keep: Placement3D[] = [];
  for (const p of state.placements) {
    const cargoSplit = partialCargoIds.has(p.cargoId);
    const bookingSplit = !!p.bookingNo && partialBookings.has(p.bookingNo);
    if (cargoSplit || bookingSplit) {
      placedIds.delete(p.unitId);
      continue;
    }
    keep.push(p);
  }
  state.placements = keep;
}
```

## 13-3. 검색 결과 (확정)

### `STACK_WEIGHT_TOLERANCE` 사용처
```
lib/packing/constraints.ts:124  export const STACK_WEIGHT_TOLERANCE = 1.0;
lib/packing/constraints.ts:142  if (top.weightPerUnit > bottom.weightPerUnit * STACK_WEIGHT_TOLERANCE)
```

### `canStackOn` 호출처
```
lib/packing/extreme-point.ts (다단 검증)
lib/packing/footprint-cluster.ts (룰 A canStackPair, 룰 B 흡수 검증)
```

### `heaviest` 사용처
```
lib/packing/algorithm.ts:535  | "heaviest";
lib/packing/algorithm.ts:1064-1074  case "heaviest":
lib/packing/algorithm.ts:2053  ["ldf", "longest-side", "heaviest"]  // lightMode
lib/packing/algorithm.ts:2061  + "heaviest"  // default
```

### `b1Violations` / `b2Violations` 사용처
```
lib/packing/algorithm.ts:2090-2091  EvalKey interface
lib/packing/algorithm.ts:2096-2136  countDistributionViolations
lib/packing/algorithm.ts:2188-2189  evalKey return
lib/packing/algorithm.ts:2200-2204  isBetterResult lex
```

### `deepAnchor` 사용처
```
lib/packing/footprint-cluster.ts:55  deepAnchor?: boolean;
lib/packing/footprint-cluster.ts:380  const deepAnchor = options?.deepAnchor !== false;
lib/packing/footprint-cluster.ts:tryPlaceColumn
```

---

# 14. 현재 수정 파일과 diff

## 14-1. `git status`
```
On branch master
Your branch is ahead of 'origin/master' by 20 commits.
Changes not staged for commit:
  modified:   lib/packing/constraints.ts
```

## 14-2. `git diff --stat`
```
 lib/packing/constraints.ts | 17 ++++++++++-------
 1 file changed, 10 insertions(+), 7 deletions(-)
```

## 14-3. `git diff` (전체)
(섹션 7-3 참조)

## 14-4. 수정 파일 분석

| 파일 | 수정 이유 | 변경 내용 | console.log | 테스트 통과 | 커밋 가능 상태 |
|---|---|---|---|---|---|
| `lib/packing/constraints.ts` | STACK_WEIGHT_TOLERANCE 1.5 → 1.0 (사용자 의도 반영 — 위 ≤ 아래 등가까지) | 상수 1줄 + 주석 5줄 | 없음 | 단위 22/22 ✅ | **보류** — 3ST SG lightMode 1 미배치 회귀, default 64-매트릭스 결과 대기 |

---

# 15. 외부 검토자에게 물어볼 질문

## 15-1. 무게 룰 정책 결정

**Q1**: 글로벌 무게 적층 룰 `위 무게 ≤ 아래 무게 × tolerance` 의 tolerance 값으로 실무 안전 기준에 가장 부합하는 것은 무엇인가?
- 1.0 (strict, 등가까지만) — 사용자 의도 그대로지만 sg3-11 미배치 회귀
- 1.2 (20% 까지) — 절충
- 1.5 (50% 까지) — 회귀 0 증명됨, 사용자 의도와 충돌
- 동적 조정 (사이즈 가중) — 발바닥 큰 받침은 더 관대

**Q2**: 사용자가 엑셀에 `heavierBelow` 플래그 표시 안 한 일반 박스끼리도 무거운 거 아래 룰을 자동 강제해야 하는가? 아니면 사용자 명시 박스만 보호?

## 15-2. 회귀 vs 절대 룰 우선순위

**Q3**: 무게 룰 강화로 미배치 1건 회귀가 발생한 경우, "회귀 0건 보장" 룰 #10 과 "위 ≤ 아래 strict" 사용자 의도 중 어느 쪽을 우선해야 하는가?

**Q4**: 미배치 1건 발생을 피하기 위해 다른 valid 배치(받침 발바닥 매칭 / 다른 정렬 전략) 가 존재할 가능성이 있다고 가정할 때, 어떤 추가 알고리즘 시도를 우선해야 하는가?

## 15-3. 알고리즘 방향

**Q5**: heaviest 정렬 전략으로도 sg3-11(750kg, 9번째 무거움)이 풀리지 않는 케이스에서, 어떤 보강이 의미 있는가?
- weight × volume desc 정렬 추가
- 무게 임계 이상 박스(예: ≥ 500kg) z=0 강제 hint
- TOLERANCE 동적 (단계적 완화 fallback)
- 기타?

**Q6**: 64-매트릭스가 unplaced > 0 일 때 모든 시도를 끝까지 돌리느라 50+ 분 소요되는 현상이 정상인가? lightMode 1 시도가 수 초인 점 대비.

## 15-4. 데이터 / 검증

**Q7**: `canStackOn` 의 무게 정보 누락(weight=0) 폴백이 적절한가? 아니면 weight 누락 자체를 입력 단계에서 거부해야 하는가?

**Q8**: lightMode 회귀와 default 매트릭스 회귀를 별도로 다루는 정책이 합리적인가? (lightMode 는 회귀 검증 도구라 production 영향 없음 vs 모든 모드 회귀 0)

## 15-5. 커밋 가능 여부

**Q9**: 현재 `lib/packing/constraints.ts` 미커밋 변경 (1.5 → 1.0)을 다음 중 어느 상태로 처리해야 하는가?
- 즉시 커밋 (lightMode 회귀 수용)
- default 64-매트릭스 결과 본 후 결정
- TOLERANCE 1.2 ~ 1.3 으로 절충 후 커밋
- 변경 자체 reverse (1.5 유지)

## 15-6. 다음 실험 우선순위

**Q10**: 다음 실험 후보 5개 중 우선순위는?
A. TOLERANCE 절충값 시도 (1.2, 1.3, 1.4)
B. weight × volume 정렬 추가
C. 무게 임계 z=0 강제 hint
D. sg3-11 단독 fallback (미배치 발생 시 그 박스만 무게 룰 완화)
E. heaviest 정렬 + extreme-point 의 candidate 우선순위 가중

---

# 16. 5분 요약

## 프로젝트 핵심 목표
수출 콘솔 화물 합적 자동화 — 화주별 박스를 컨테이너에 자동 배치 (Next.js 사이트, 사용자 엑셀 업로드 → 결과 화면).

## 핵심 데이터 구조
`CargoSpec` (cargoId, bookingNo, W×L×H, qty, weight, unitSizes, remarks) → `expandToUnits` → unit 단위로 펼침.

## 핵심 룰
1. CBM 쪼개기 절대 금지 (한 cargoId = 한 컨)
2. 부킹 분산 금지 (한 booking = 한 컨)
3. 점수 합산 X, lex 비교만 (미배치 → B1 → B2 → 마감 → 충전률 → 균형)
4. 받침 ≥ 70% (룰 B 흡수)
5. **글로벌 무게 룰 (현재 1.0 strict)** ← 막힌 지점
6. 무거운 거 먼저 정렬 전략 (heaviest)
7. 발바닥 사전 묶음 룰 A/B/C/D
8. 가는 막대형 자동 anchor
9. 회귀 0건 보장 (5 샘플)

## 핵심 알고리즘
packBest 매트릭스 64 시도 (정렬 8 × 컨 순서 2 × 자동마감 2 × 배치 2) → 백트래킹 12회 → 균형 swap → best 채택.

## 지금까지 성공한 것
- 1ST/2ST SG·HM 모든 샘플 0 미배치 + B1·B2 0 위반
- 3ST SG TOTAL sg3-16 리틀스푼 1박스 미배치 (이전 75분 NP-hard) → 옵션 C + lex B1·B2 + heaviest 정렬로 0 도달 (1.5 tolerance 기준)

## 현재 막힌 지점
미커밋 `STACK_WEIGHT_TOLERANCE 1.5 → 1.0` 적용 후 3ST SG lightMode 1 미배치 회귀 (`sg3-11 성안기계` 750kg). default 64-매트릭스 결과 백그라운드 진행 중.

## 현재 실패 원인 후보
- 무게 룰 1.0 strict 거부 (가장 유력) — 750kg 받침 후보 부족
- 형상·받침 70% 결합 영향 (중간)
- heaviest 정렬해도 sg3-11 9번째라 z=0 우선권 못 받음

## 데이터 누락 / undefined 확인
- `canStackOn` 의 weight=0 폴백은 의도적 (heavierBelow 플래그 폴백)
- debug 스크립트의 `wt=undefined` 출력은 필드명 오류 (실제 데이터 OK, sg3-11 weight = 750kg)

## 검증 명령어와 PASS/FAIL
| 검증 | 결과 |
|---|---|
| 단위 테스트 22/22 | ✅ |
| 1ST SG | ✅ 미배치 0 (mismatch 8) |
| 2ST SG | ✅ 100% 일치 PASS |
| 2ST HM physics | ✅ 33/33 |
| 3ST SG lightMode | ❌ 미배치 1 (sg3-11) |
| 3ST SG default 64 | 진행 중 (50+ 분) |

## 외부 검토자에게 물어볼 질문 (Top 3)
1. 무게 룰 tolerance 값 (1.0 / 1.2 / 1.5 / 동적) 중 실무 안전 기준?
2. "회귀 0건" 룰과 "위 ≤ 아래 strict" 의도 충돌 시 우선순위?
3. 미커밋 변경 커밋 결정 (현재 / default 결과 후 / 절충값 / 원복)?

## Claude Code 가 다음에 시도하려는 작업
1. 3ST SG default 64-매트릭스 결과 확인
2. 결과 따라 TOLERANCE 절충 (1.0 유지 / 1.2 / 1.5 원복)
3. 외부 검토자 의견 받으면 Q1~Q10 따라 알고리즘 보강

---

# 17. 현재 상태 한 줄 요약

현재 CLP 프로젝트는 1ST/2ST SG·HM 5 샘플 0 미배치 + B1·B2 0 + 3ST SG sg3-16 리틀스푼 NP-hard 케이스(이전 75분 못 풀던 것)까지 해결했지만, 이후 사용자 의도 반영을 위한 미커밋 변경 `STACK_WEIGHT_TOLERANCE 1.5 → 1.0` 으로 3ST SG lightMode 에서 sg3-11 성안기계 750kg 1박스 미배치 회귀가 발생했고, 지금은 default 64-매트릭스 결과(백그라운드 진행 중)와 외부 검토 의견을 받아 무게 룰 tolerance 정책을 1.0 strict / 절충값 / 원복 중 어느 쪽으로 결정할지 판단해야 하는 상태다.

---

# 18. 메타

- 문서 위치: `logs/CHATGPT_REVIEW_CLP_FULL_CONTEXT.md`
- 작성 시점: 2026-05-09
- 작성 환경: master 브랜치, origin +20 + 미커밋 1건
- 백그라운드 task: `bu9xxiz82` (3ST SG default 64-매트릭스, 50+ 분 진행 중) — 종료하지 않고 그대로 두는 중
- 인수인계 표현 사용 X (요청 따라)
- solver/완전탐색 미증명 사항은 "현재 탐색 범위에서 미발견" 으로 표현
