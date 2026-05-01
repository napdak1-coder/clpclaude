# clpclaude 진행 상황 (2026-05-01 시점)

## 도메인 개념

| 용어 | 의미 |
|---|---|
| **CT 카톤** | 시각 좌표 없이 CBM 합산만. `bulkItems` 로 컨테이너에 분배. 컨테이너 그림에 안 그려짐 |
| **입고완료** | 사용자가 CFS CBM (`cargo.cbm`) 입력한 화물. 2026-04-30부터 시각 적재 대상 (CT 만 bulk) |
| **시스템 CBM** | W × L × H × qty / 1,000,000 (자동 계산) |
| **엑셀 CBM** | 사용자 입력 CFS CBM (= `cbm` 필드). 입력 폼 / 결과 표 모두 "엑셀 CBM" 라벨 사용. 채워져 있으면 입고완료, 비어있으면 미입고 |
| **샘플 영속화** | `public/samples/singapore-total.xlsx` 가 1차 폴백, 사용자 편집본은 `data/samples/<key>.json` 에 저장 (`/api/samples/[key]` GET/PUT) |

## 알고리즘 현황

`lib/packing/algorithm.ts` — 룰 기반 + 다단 + 6면 회전 + best-fit + 행 안 2D + 백트래킹.

### 적용 완료 (1, 2, 3, 4, 5, 8번)

1. **다단 적재 (3·4층)** — `tryPlaceOnTop` + `getStackTop` 으로 stack 누적 인식. `finalizeRow` 가 column 별 stack 합 최대값으로 행 높이 계산
2. **6면 회전** — `pickFace` + `allowedFaces` 로 W/L/H 모든 자세 시도. `fixed` orientation 만 회전 금지
3. **사용자 분배 강제 모드** — `PackOptions.fixedContainers` (컨테이너 종류 강제) + `fixedAssignment` (cargoId → 컨테이너 인덱스)
4. **행 안 2D bin packing** — `tryPlaceInRowGap` 이 빈 length 영역 점 후보 검사 + 충돌 검증
5. **다중 시뮬레이션** — `packBest` 가 7가지 정렬 전략(LDF / longest-side / tallest / widest / input / shortest / shortest-height) 시도 후 베스트 채택
8. **백트래킹** — `packBest` 안에서 미배치 화물 우선 input 으로 12회 reorder

### 미실행 (6, 7, 9, 10번)

- **6) 행 길이 동적 축소** — 행 yEnd 가 한 번 max 로 늘어나면 안 줄어듦. 행 안 화물의 실제 max length 로 yEnd 재계산해 자투리 회수
- **7) 작은 화물 top 우선 두 번째 pass** — N/ANS 같은 낮은 화물을 큰 화물 다 넣은 후 빈 자리에 적극 끼우기
- **9) 3D skyline / extreme-points** — 행 단위 폐기, 컨테이너 전체 자유 좌표 packing. 가장 강력하지만 알고리즘 새로 작성
- **10) 사용자 분배 모드 안내 UI** — 미배치 발생 시 "이 화주를 다른 컨테이너로 옮기세요" 또는 "컨테이너 추가" 제안

## 남은 한계

싱가폴 TOTAL 샘플 + 사용자 분배 (40FT 17 화주 / 20FT 5 화주) 시뮬레이션:

| | 사용자 분배 강제 | 자동 분배 |
|---|---|---|
| 미배치 unit | **8** (FCA ×3, 위너스 ×1, N/ANS ×4) | **6** (4종) |
| 40FT fillRate | 78.6% | 63.3% |
| 20FT fillRate | 68.8% | 84.8% |

합계·차원상 fit 가능하지만 행 단위 + 점 후보 검사 자료구조 한계로 못 끼움. 8번까지 다 시도해도 8 unit 동일 → **9번(3D skyline)** 또는 **10번(사용자 안내 UI)** 필요.

## UI 컴포넌트 위치

- `components/plan/ContainerView2D.tsx` — 세로형 컨테이너 평면도 (위=안쪽, 아래=입구). 행 좌측 (번호 / 행 길이 / 누적), 우측 (가로 여유 / 천장 여유). 상단 빈 슬롯 점선 표시. 빈 컨테이너 placeholder.
- `components/plan/ContainerItemList.tsx` — 컨테이너별 화물 목록 (분류·구분·화주·품목·사이즈·수량·시스템 CBM·엑셀 CBM·분량·중량·층)
- `components/plan/PlanSummary.tsx` — 입고완료 단독 카드 + 미배치 화물 표 (10칸, 컨테이너 표와 동일 칼럼 + "분량 (못 들어감)")
- `components/plan/PlanView.tsx` — 위 컴포넌트들 조합

## 자료구조

- `BulkItem` (types/plan.ts): width / length / height / quantity / weightPerUnit / totalCbm / cfsCbm — CT/입고완료 분배 항목
- `PlacedCargo`: cargoType, cfsCbm 추가 (시각화·표시 정보)
- `UnplacedItem`: 표시용 풍부한 메타데이터 (사이즈 / 수량 / 시스템·CFS CBM / 중량 / group)
- `PackOptions`: fixedContainers, fixedAssignment, sortStrategy 등 추가

## 검증 스크립트

실행: `node --experimental-strip-types scripts/<name>.mjs`

| 스크립트 | 용도 |
|---|---|
| `verify-sample-pack.mjs` | 샘플 알고리즘 검증 (xlsx 파싱부터 pack 까지) |
| `verify-excel-cbm-mapping.mjs` | CFS CBM ↔ 엑셀 CBM 매핑 (23/23 일치 확인) |
| `verify-user-split.mjs` | 사용자 분배 두 그룹 단독 패킹 (mode 별) |
| `verify-user-split-fixed.mjs` | 사용자 분배 강제 모드 (fixedContainers + fixedAssignment + packBest) |

## 다음 세션 시작점

새 세션에서 "clpclaude 이어서 작업" 같은 문맥 주면 이 문서 + 메모리 자동 로드. 작업 우선순위 후보:

1. **9번 3D skyline** — 미배치 거의 0 가능, 알고리즘 큰 재작성
2. **10번 사용자 분배 모드 안내 UI** — 미배치 발생 시 화주 이동 제안 + 컨테이너 추가 옵션
3. **6 + 7번** — 행 길이 동적 축소 + 작은 화물 top 우선 (보조 개선)

## 사용자 (비개발자) 협업 지침

- 코드 / 타입 / 함수명 같은 기술 용어 빼고 **화면·동작 위주**로 설명
- 비유 적극 활용 (테트리스, 가방 등)
- 표 · 짧은 bullet 위주
- 한 단계씩 진행 결과 보고

## 마지막 git 상태

- master 브랜치 push 완료 (커밋 `32ce131` — 2026-05-01)
- 다음 작업 시작점: 9번 또는 10번 결정 대기
