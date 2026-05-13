# 3차 단계 — Strict Visual Placement Engine 보강 (계획)

date: 2026-05-13
status: **계획 단계 (코드 수정 X)**
선행 완료: 1차 (cbmSource 인프라) + 2차-A (declared CBM 헬퍼) + 2차-A-2 (API useCandidateUnion 옵션)

---

## 목표

`strictVisualClassification: true` 모드 (즉 사이즈 있는 행이 무조건 visual 트랙으로 가는 상태) 에서 발생하는 미배치를 시각 배치 엔진 보강으로 해결.

production 기본 동작은 그대로 유지 (`strictVisualClassification` opt-in 진단 모드만 켬 → 미배치 cargo 분석 → 엔진 보강 후 점진 적용).

---

## 현재 strict visual 미배치 샘플 (1차 측정 기준)

| 샘플 | 통과 | 미배치 cargo | unit 수 | 추정 원인 |
|---|---|---|---|---|
| 망작 SG | ❌ | mangjak-10 (110×110×80, 500kg, FBSIN260394) | 1 | **컨 1 CBM 0.04 m³ 남음 / 컨 2 20FT 0/28 비어있는데 못 감** — booking anchor / visual track 컨 선택 룰 |
| 1ST SG | ❌ | sg-1-4 ×4 (180×90×27, 2310kg), sg-1-13 ×3 (100×100×50, 2000kg) | 7 | **잔여 공간 충분** (컨1 13.5m³ / 컨2 6.4m³) — atomic + 공간 fragmentation |
| 4ST SG | ❌ | sg-4-47 ×8 (119×119×128, 5400kg) | 8 | 8 unit atomic, 컨마다 7~18m³ 산재 — 묶음 룰 |
| 5ST SG | ❌ | sg-5-1 ×8 (118×114×59), sg-5-2 ×3 (117×111×103), sg-5-7 ×5 (111×111×107) | 16 | sg-5-7 5 unit × 5458kg = **27290kg → 단일 컨 25t 초과** (cargoId atomic 분리 불가 → 트럭 셋 부족), 나머지는 시각 배치 한계 |

---

## 원인 분류

### 분류 A — 트럭 셋 자체 부족 (candidateUnion 으로 해결 가능)
- **5ST SG sg-5-7**: 5 unit × 5458kg = 27.3 t → 25t 한 컨 초과. 더 큰 컨 셋 필요 (40FT × 3 이상).
- **망작 SG mangjak-10**: 컨 1 가득 + 컨 2 비어있는데 못 감 — booking 분배 룰 (단독 cargo 가 빈 컨 으로 못 옮겨감)

### 분류 B — 시각 배치 엔진 한계 (잔여 공간 충분한데 자리 못 찾음)
- **1ST SG sg-1-4 / sg-1-13** — 컨 2 잔여 6.4 m³ 인데 1.75 m³ + 1.5 m³ atomic 못 들어감
- **4ST SG sg-4-47** — 어느 컨도 16~18 m³ 산재한데 8 unit atomic 통째로 안 들어감
- **5ST SG sg-5-1 / sg-5-2** — 잔여 공간 부분 있는데 자리 못 찾음

---

## 3차 보강 우선순위 (사용자 명시)

1. **묶음 룰 완화 / 인접 lane bundling** — 같은 cargoId 박스가 한 컬럼에 다 안 들어가면 인접 row/lane 으로 나눠 배치. cargoId atomic 유지. 같은 컨테이너 안 인접 배치 우선. lex 기준.
2. **회전 탐색 강화** — 6방향 회전 후보 평가 (allowedFaces 안). orientation=fixed 강제 회전 금지.
3. **gap-fill pass** — 미배치 발생 시만 발동. 작은 박스부터 빈 공간 재시도. 성공 시만 commit, 실패 시 rollback.
4. **reposition pass** — 마지막 단계. 이미 들어간 cargoId 통째 빼고 미배치 cargo 넣은 뒤 재배치. cargo 일부 제거 X (atomic 유지). 개선 없으면 원복.

---

## 샘플별 격리 해결 순서

1. 망작 SG mangjak-10 → 1
2. 1ST SG sg-1-4 / sg-1-13 → 7
3. 4ST SG sg-4-47 → 8
4. 5ST SG sg-5-7 (트럭 셋 부족) 우선 → 그다음 sg-5-1 / sg-5-2 (배치 엔진)
5. 3ST SG Rule G 회귀 0 유지 확인
6. 4ST HM 40+40+20 후보 유지 확인

각 단계마다:
- 해당 샘플 fast 진단
- 단위 테스트
- 10 샘플 회귀
- pack 시간 측정 (60초 초과 시 별도 성능 이슈)

---

## 성능 이슈 별도 기록

| 항목 | 시간 | 메모 |
|---|---|---|
| 4ST HM candidateUnion | 79.5 s | 2차-A-2 측정. 후보 union 시도 비용. 사용자 명시 — 별도 성능 과제, 기본 활성 보류. |
| 3ST SG candidateUnion | (측정 중단) | 14분+ 정체. brute-force budget 추가 필요 가능. |

---

## 절대 룰 (3차 진행 시 준수)

- 자동 CBM 기능 끄지 말 것
- 사용자가 CBM 비워야 visual 로 가는 구조 금지
- 사이즈 있는 행 CT bulk fallback 금지
- fixedAssignment 금지
- 점수 합산 금지
- safety buffer 복원 금지
- 특정 샘플 hardcoding 금지
- Rule G/D/E/audit 기존 성공 로직 변경 금지
- production route 즉시 변경 금지
- strictVisualClassification 을 production 기본값으로 켜지 말 것

---

## 다음 작업 시작 전 체크리스트

1. strictVisualClassification=true 진단 모드 재현 (현재 `scripts/_diagnose-strict-visual-10-samples.mjs` 사용)
2. 망작 SG → 1ST SG → 4ST SG → 5ST SG 순서로 미배치 cargoId 별 실패 phase 정밀 분석 (어느 fallback 단계에서 떨어졌는지)
3. 묶음 룰 완화 → 회전 탐색 → gap-fill → reposition 순으로 작은 변경 적용 + 매 단계 회귀
