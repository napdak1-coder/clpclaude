# clpclaude 진행 상황 (2026-05-02 시점)

## 도메인 개념

| 용어 | 의미 |
|---|---|
| **CT 카톤** | 시각 좌표 없이 CBM 합산만. `bulkItems` 로 컨테이너에 분배. 컨테이너 그림에 안 그려짐 |
| **입고완료** | 사용자가 CFS CBM (`cargo.cbm`) 입력한 화물. 시각 적재 대상 (CT 만 bulk) |
| **시스템 CBM** | W × L × H × qty / 1,000,000 (자동 계산) |
| **엑셀 CBM** | 사용자 입력 CFS CBM. "엑셀 CBM" 라벨 사용 |
| **샘플 영속화** | `public/samples/singapore-total.xlsx` 1차 폴백 + 사용자 편집본 `data/samples/<key>.json` (`/api/samples/[key]` GET/PUT) |

## 알고리즘 현황 — 9번 자유 좌표 적재 완료 (2026-05-02)

`lib/packing/algorithm.ts` `pack()` 본체를 새 packer 로 교체. 행(row) 단위 제약 폐기, 컨테이너 전체를 자유 좌표로 packing.

### 신규 파일
- `lib/packing/extreme-point.ts` — extreme-point 자유 좌표 packer
  - `packExtremePoint(units, spec)` — batch packing
  - `tryPlaceUnit(unit, state, spec)` — per-unit 배치 (다중 컨테이너 분배용)
  - `makeContainerState()` — 컨테이너 packing 상태 초기화
- `lib/packing/extreme-point.test.ts` — 단위 테스트 18개 전부 통과
- `lib/packing/display-rows.ts` — placements → 화면용 Row[] 변환 (layered display)

### 폐기된 함수 (`lib/packing/algorithm.ts`)
- `RowState`, `openRow`, `placeBottom`, `getStackTop`, `tryPlaceOnTop`, `tryPlaceInContainer`, `tryPlaceInRowGap`, `tryPlaceOnTopAcross`, `finalizeRow`, `pickFace`, `asCargoLike`

### 보존된 핵심 함수
- `classify` (CT/visual 분류)
- `decideContainers` (컨테이너 종류·개수)
- `expandToUnits` (CargoSpec → UnitItem)
- `allocateBulkGroup` (CT bulk 분배)
- `orderForCompleted` (완료 그룹 분배 우선순위)
- `packBest` (7전략 정렬 + 12백트래킹)

### 검증 결과
- **단위 테스트 27/27 통과** (algorithm 9 + extreme-point 18)
- **싱가폴 TOTAL 사용자 분배 미배치 8 → 0** (목표 달성)
- 40FT fillRate 86.3%, 20FT fillRate 68.8%
- Excel CFS CBM 매핑 23/23 일치

## 시각화 (`components/plan/ContainerView2D.tsx`)

자유 좌표 결과를 layered display 로 표시:
- **컬럼 stack** — 각 top 이 자기 supporter bottom 바로 위에 stack (갭 0)
- **상단/하단 분리** — 시각 오버레이 X, 별도 박스
- **모든 화물 이름·W×L×H·종류 표시** — 폰트 자동 조정 (한글 1.0×, 영숫자 0.55× 가중)
- **점선 박스 1px** — 모든 화물 dashed border
- **굵은 1px 외곽 테두리** — 행마다 명확한 구분
- **세로 화살표 천장여유** — 각 컬럼 최상단 위 ▲↕▼ + Xcm
- **anisotropic scale** — 가로/세로 별도 비율 prop 지원

## UI 보정 (`app/shipments/new/page.tsx`, `[id]/page.tsx`)

- POST /api/shipments 응답 처리 — `res.ok` 체크 후 `.json()` (이전 DOCTYPE 에러 차단)

## 디버그 페이지

- `/debug/rows-mockup` — 자유 좌표 적재 결과 시각화 미리보기 (싱가폴 샘플)
- 스크린샷 자동 생성: `node scripts/screenshot-mockup.mjs`

## 데이터 파일 (gitignored)

- `data/clpnice.db` — SQLite DB. 신규 클론 시 `npm run db:init` 필요
- `data/samples/singapore-total.json` — 사용자 편집본 샘플
- `tmp-screenshots/` — 디버그용 (gitignored)

## 다음 세션 시작점

1. **이어서 가능한 작업**:
   - Phase 5 — DB 마이그레이션 0007 (plan_row_id NULLABLE — 현재 동작에는 영향 없음, 정리 차원)
   - 시각화 미세조정 — production 페이지 `/shipments/[id]/plan/[planId]` 에서 사용자 피드백 수집
   - RowEditor 컴포넌트 처리 (자동 계산 안내로 변경 또는 제거)

2. **남은 미실행 알고리즘 (선택)**:
   - 6) 행 길이 동적 축소 — 현재 9번이 행 자체를 폐기했으므로 의미 없음
   - 7) 작은 화물 top 우선 두 번째 pass — 현재 packBest 가 이미 처리
   - 10) 사용자 분배 모드 안내 UI — 미배치 0 이라 우선순위 낮음

## 마지막 git 상태

- master 브랜치 push 완료 (커밋 9번 완료)
- 다음 작업 시작점: 사용자 production 화면 검증 결과에 따라 추가 미세조정

## 사용자 (비개발자) 협업 지침

- 코드/타입/함수명 같은 기술 용어 빼고 화면·동작 위주로 설명
- 비유 적극 활용 (테트리스, 가방 등)
- 표·짧은 bullet 위주
- 한 단계씩 진행 결과 보고
