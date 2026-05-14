# 3차 단계 — 현재 문서 기준 절대 배분규칙 체크리스트

date: 2026-05-13
status: **read-only 점검 결과** (코드 변경 없음)
source:
- `docs/algorithm-pipeline.md`
- `docs/practitioner-list-always-fits.md`
- `docs/algorithm-rules-design-from-2st-hm.md`
- `docs/algorithm-spatial-improvement-plan.md`
- `docs/stage4-reposition-plan.md`
- `docs/cbm-source-diff-preview.md`
- `docs/handoff-2026-05-13.md`
- `docs/3rd-phase-strict-visual-placement.md`
- `lib/packing/algorithm.ts` (구현 검증)
- `lib/packing/audit.ts` (strictStackAudit 구현)

---

## 1. 절대 배분규칙 목록 (총 12 카테고리)

### 1-1. 컨테이너 셋 결정 규칙

| 룰 | 내용 | 위치 |
|---|---|---|
| 사이즈/컨테이너 수 | 가능한 40FT × N + 20FT × M 조합 후보 | `decideContainers` |
| 안전마진 | 잉여 용량 < 1.5 m³ 조합 제외 (모두 < 1.5 면 비활성) | `decideContainers` |
| lex 비교 | ① 미배치 ↓ → ② 입고완료 마감 → ③ 충전률 → ④ 동종 컨 균형 | `decideContainers` |
| 점수 합산 금지 | 모든 우선순위는 lex (가중치 X) | 전역 |
| declared CBM 우선순위 (2차-A) | CFS(excel/manual/distributed/legacy) → ABOUT → 시스템 CBM | `getDeclaredCbmForContainerDecision` |
| candidateUnion (옵션) | declared 후보 ∪ physical 후보 → valid 작은 셋 우선 | `packBestWithCandidateUnion` |

### 1-2. 같은 bookingNo 같은 컨테이너 규칙 (B1)

| 룰 | 내용 | 위치 |
|---|---|---|
| **booking anchor (CT 벌크)** | 같은 부킹 화물은 같은 컨, 통째로 안 들어가면 미배치 | `allocateBulkGroup` |
| **booking anchor (visual)** | 같은 bookingNo 첫 cargo 가 컨 i 에 안착하면 후속 cargo 도 컨 i 강제 | algorithm.ts:450~538, 1416~1537 |
| **booking split 검사** | b2Violations 카운트 — bookingNo 가 ≥ 2 컨에 분산되면 위반 | `summary.b2Violations`, audit |
| **valid 6 조건 (candidateUnion)** | bookingSplit > 0 → invalid | `isValid6 / countSplits` |

### 1-3. cargoId atomic 규칙

| 룰 | 내용 | 위치 |
|---|---|---|
| **cargoId atomic** | 같은 cargoId 의 모든 unit 통째로 한 컨에 들어가야 함 | placeQueueWrapper / placeQueuePure |
| **partial → rollback** | 일부 unit 만 들어가면 snapshot 복원 후 미배치 분류 | 룰 G/F/E partial 보호 |
| **cargoId split 검사** | cargoSplit > 0 → invalid | `countSplits` |

### 1-4. 입고완료 자동 마감 규칙

| 룰 | 내용 | 위치 |
|---|---|---|
| **자동 마감** | 입고완료 (c.cbm 입력된) 화물 총합이 한 컨 capacity 안이면 그 컨에 우선 배치 | `autoConsolidateCompleted` 옵션 |
| **비활성 조건** | `fixedAssignment` 또는 `completedExclusiveContainerIndex` 명시 시 비활성 | algorithm.ts |
| **completedCargoSpread 검사** | 입고완료 화물이 분산되면 회귀로 표시 (이번 실험 매트릭스 출력에 필수) | (검증 단계에서 추가) |

### 1-5. 무게 한도 규칙

| 룰 | 내용 | 임계 |
|---|---|---|
| **컨 maxWeight** | 20FT 21,000kg / 40FT 25,000kg 초과 금지 | `containers.ts` |
| **위 박스 무게 ≤ 아래 박스 무게** | 적층 시 위 ≤ 아래 강제 | `STACK_WEIGHT_TOLERANCE = 1.0` |
| **heavierBelow 조건** | cargo 단위 heavierBelow=true 면 같은 cargoId 안 무거운 unit 아래 | algorithm.ts |
| **weight overflow 검사** | totalWeight > maxWeight + 0.001 → invalid | `isValid6` |

### 1-6. 적층 규칙

| 룰 | 내용 |
|---|---|
| **noStacking** | true 면 그 박스 위에 다른 박스 못 올림 (자기는 z=0 어디든 가능) |
| **bottomOnly** | true 면 그 박스는 z=0 만 가능 |
| **topOnly** | true 면 그 박스는 다른 박스 위에만 가능 |
| **받침률** | 위 박스 발바닥 / 받침 박스 발바닥 ≥ 70% (룰 B 흡수 기준) |
| **strictStackAudit pass** | `lib/packing/audit.ts:strictStackAudit` 사후 검증 통과 필수 |

### 1-7. 회전 / orientation 규칙

| 룰 | 내용 |
|---|---|
| **allowedFaces** | 6 회전 후보 중 cargo 별로 허용된 면 안에서만 |
| **orientation=fixed** | 회전 X — face 0 만 (기본 W·L·H 순) |
| **orientation=free** | 6 회전 모두 시도 |
| **orientation=long_along_length** | 가장 긴 변이 컨 길이 축 정렬 |

### 1-8. strictStackAudit 규칙

| 룰 | 내용 | 위치 |
|---|---|---|
| **사후 검증** | pack 결과의 placements 좌표 검증 — 충돌·받침·무게 룰 | `audit.ts:strictStackAudit` |
| **violations 0 필수** | violations.length > 0 → invalid | `isValid6` |
| **활성 조건** | 모든 적층 사후 검증 (pack 종료 후) |

### 1-9. candidateUnion 사용 조건

| 룰 | 내용 |
|---|---|
| **기본 비활성** | production `/api/pack` 라우트 기본 useCandidateUnion=false (packBest 사용) |
| **활성 트리거** | API 요청에 `useCandidateUnion: true` |
| **동작** | declared/physical 후보 ∪ → 컨 수 asc → capacity asc → 작은 셋부터 시도 → valid 6 통과 시 단락 채택 |
| **valid 6 조건** | unplaced 0 + audit pass + 각 컨 maxCbm 통과 + 각 컨 maxWeight 통과 + cargoSplit 0 + bookingSplit 0 |
| **lex fallback** | 모두 invalid 시 lex comparator (점수 합산 X) — keys = [unplaced, auditFail, hardViolations, cbmOverflow, weightOverflow, cargoSplit, bookingSplit, 컨 수, 총 capacity] |
| **fixedAssignment 금지** | 사용 X |

### 1-10. 실무자 답안 활용 가능 범위와 금지 범위

| 가능 | 금지 |
|---|---|
| ✅ 물리적 가능 패턴 확인 (어떤 cargo 가 같은 컨에 있는지) | ❌ `fixedAssignment` 로 cargo 강제 배정 |
| ✅ 패턴 추출용 오라클 (큰 cargo 우선 배치 패턴 등) | ❌ 특정 cargoId / 화주 하드코딩 |
| ✅ 임계값 캘리브레이션 참고 (20FT/40FT 평균 CBM 등) | ❌ 100% 일치 강제 |
| ✅ 일반 룰 후보 도출 (반복 패턴 보이면 룰화) | ❌ 점수 합산 기준 |

**핵심 원칙 (`practitioner-list-always-fits.md`)**: 실무자 분배 = 항상 물리·규격·룰을 만족하는 유효 해. 시스템이 더 효율적이라고 단정 금지.

### 1-11. cbmSource 출처 분리 (1차 — 인프라)

| 출처 | 의미 | 컨 셋 결정 영향 |
|---|---|---|
| `excel-cfs` | 엑셀 CFS CBM 셀 | CFS 계열 (declared 1순위) |
| `manual-cfs` | 사용자 메인 표 직접 입력 | CFS 계열 |
| `distributed-cfs` | distributeBookingValues 분배 | CFS 계열 |
| `distributed-about` | (forward compat) | ABOUT 계열 |
| `calculated` | UI 자동 계산 (W×L×H×Q) | 시스템 CBM 폴백 |
| `legacy-cfs` | DB 마이그레이션 폴백 | CFS 계열 (excel-cfs 동등) |

### 1-12. classify 진단 옵션 (production 영향 X)

| 옵션 | 동작 |
|---|---|
| `strictVisualClassification` (기본 false) | true 면 룰 1 (allHaveCbm) 에 `!anyHasSize` 가드 적용 → 사이즈 있는 행 무조건 visual 트랙 |
| **production 기본 적용 금지** | 사용자 명시 — 진단 전용 |

---

## 2. 현재 booking split 실제 0 인지 검증 필요

`pack()` 안에 `bookingAnchor` 메커니즘이 visual / CT 양쪽에 있지만, **strictStackAudit / valid 6 검사에서 bookingSplit 위반을 invalid 처리하는 경로는 `packBestWithCandidateUnion` 안 `isValid6` 만** — production `packBest` 단독 호출은 booking split 발생 가능 (`summary.b2Violations` 로 보고만 함).

**확인 필요**: 10 샘플에서 production packBest 가 실제 bookingSplit 0 을 지키는지.

이 부분은 진단 스크립트로 측정 가능 (cargoId/bookingNo → container index 매핑 후 multiset 검사).

---

## 3. 절대 룰 (이번 실험 매트릭스 진행 시 모두 준수)

1. 같은 bookingNo 한 컨테이너 — 위반 시 invalid
2. cargoId atomic — partial 발생 시 invalid
3. CBM 쪼개기 금지 — cargo split 0
4. 점수 합산 금지 — lex only
5. fixedAssignment 금지
6. safety buffer 복원 금지
7. 특정 cargoId 하드코딩 금지
8. 자동 CBM 기능 끄기 금지
9. 사이즈 있는 화물 CT bulk fallback 금지
10. Rule G/D/E/audit 임의 변경 금지
11. production route 즉시 변경 금지
12. strictVisualClassification production 기본 적용 금지
13. candidateUnion 기본값 전환 금지
14. 컨 셋 결정에서 CFS → ABOUT → 시스템 CBM 순서 유지
15. 실무자 답안 = 오라클 (강제 X)
16. 입고완료 자동 마감 룰 유지

---

## 4. 실험 매트릭스 결과표 필수 컬럼 (16개)

| 컬럼 | 출처/계산 |
|---|---|
| sampleName | 샘플 id |
| experimentId | E0~E6 |
| containerSet | result.containers.map(spec.type).join("+") |
| decisionMode | packBest / candidateUnion |
| completedConsolidation 유지 여부 | autoConsolidateCompleted 결과 보존 |
| unplacedCount | result.unplaced.reduce(qty) |
| unplacedCargoIds | result.unplaced.cargoIds |
| cargoIdSplitCount | countSplits(result).cargoSplit |
| bookingSplitCount | countSplits(result).bookingSplit |
| strictAuditPass | strictStackAudit(result).pass |
| cbmOverflow | 각 컨 totalCbm+ctCbm > maxCbm+0.001 카운트 |
| weightOverflow | 각 컨 totalWeight > maxWeightKg+0.001 카운트 |
| noStackingViolation | strictStackAudit violations 중 noStacking 위반 |
| supportViolation | strictStackAudit violations 중 받침 < 70% |
| orientationViolation | placements 회전이 allowedFaces 위반 / fixed 위반 |
| completedCargoSpread 여부 | 입고완료 cargo 가 ≥ 2 컨 분산 → true |
| packTime | Date.now() 차 |
| changedPlacementCount | E0 대비 변경된 cargo 수 |
| 실무자 답안 대비 개선/악화 | 미배치 cargo 화주 매핑 비교 |
| MD 규칙 만족/위반 | 위 1~16 카테고리 별 yes/no |

---

## 5. 다음 단계 (사용자 명시 진행 순서)

1. **MD 파일에서 현재 배분규칙 체크리스트 추출** ← 이 문서 (1단계 완료)
2. **현재 알고리즘이 bookingNo split 을 실제로 0 으로 지키는지 10샘플 기준 확인** ← 다음 단계
3. E0/E1/E2 실험 매트릭스 실행
4. 실무자 답안과 시스템 실패 패턴 비교
5. 어떤 실험이 어떤 샘플을 해결했는지 보고
6. 공통 물리 규칙 후보 정리
7. 구현 전 사용자 승인 요청

이번 목표 (재정의):
> 망작 / 1ST SG / 4ST SG / 5ST SG 전체 대상,
> 문서화된 배분규칙 어기지 않는 범위에서,
> **큰 cargo pre-anchor 가 공통 해결책인지 확인**.
