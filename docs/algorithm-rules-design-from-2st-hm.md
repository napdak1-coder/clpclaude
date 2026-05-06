# 2ST HM TOTAL 분석에서 도출된 알고리즘 보강 룰 설계안

작성: 2026-05-06
근거: 2ST HM TOTAL 실무자 분배 분석 — 사용자가 명시적으로 인정한 실무자 의도 ②③④⑤
제외: ①(부킹 번호 chronological), ⑥(엑셀 sub-table) — `docs/HM-2nd-non-algorithmic-context.md` 참고

---

## 1. 인정된 실무자 의도 요약

- **②** 20FT = 작은 부킹 마감용 (작고 가벼운 화물 4건 묶기)
- **③** 두 40FT CBM 균형 (편차 작게)
- **④** 큰 화물끼리 한 컨에 몰리지 않게 분산
- **⑤** 무거운 화물 40FT 우선 (20FT 무게 한도 21t 부담)

→ 4 의도 → 2 룰로 통합 (Rule ⑥, Rule ⑦)

---

## 2. Rule ⑥ — 컨테이너 사이즈별 cargo 친화 매칭

**핵심 비유:** "큰 짐은 큰 트럭에, 작은 짐은 작은 트럭에"

### 적용 위치
- `lib/packing/algorithm.ts` → `candidatesFor(unit)` 함수
- 기존 `balanceSortSameType` 호출 직전에 사이즈 등급 기반 컨 그룹 우선순위 재배치

### Cargo 사이즈 분류 (lex priority, 점수 합산 X)

| 분류 | 조건 |
|---|---|
| **큰 화물** | about CBM ≥ 7 m³ **또는** 무게 합 ≥ 2500 kg |
| **작은 화물** | about CBM ≤ 4 m³ **AND** 무게 합 ≤ 1500 kg |
| **중간** | 그 외 |

### 후보 컨테이너 정렬 룰

혼종 컨 셋(40FT + 20FT 동시 존재)일 때만 활성:

| Cargo 분류 | 후보 순서 |
|---|---|
| 큰 화물 | 40FT 그룹 → 20FT |
| 작은 화물 | 20FT → 40FT 그룹 |
| 중간 | 기존 `balanceSortSameType` 순서 |

동종 컨 그룹 내부에서는 기존 룰(적재량 낮은 컨 우선) 유지.

### HM 2차 효과 시뮬

- 일라(12.24m³, 2693kg) → 큰 → 40FT 우선
- 리브유(10.08, 2937) → 큰 → 40FT 우선
- SD KOREA(9.45, 3910) → 큰 → 40FT 우선
- 화인써키트(1.55, 2332) → CBM 작지만 무게 ≥ 1500 → "중간" → 기존 순서

→ 큰 화물 자연스럽게 40FT 흘러감, 작은 부킹은 20FT 마감.

---

## 3. Rule ⑦ — 동종 컨 큰 화물 round-robin anchor

**핵심 비유:** "큰 짐 5 개를 트럭 2 대에 1 개씩 번갈아"

### 적용 위치
- `lib/packing/algorithm.ts` → `pack()` 진입 직후, decideContainers 결과 직후

### 발동 조건 (모두 만족)

- 동종 컨 ≥ 2 대 (예: 40FT × 2)
- 큰 화물 (Rule ⑥ 분류) ≥ 2 건

### 동작

1. 큰 화물을 about CBM 내림차순 정렬
2. 동종 컨 그룹의 컨테이너 인덱스 리스트를 round-robin 으로 cargo 에 매핑 → `bigCargoAnchor: Map<cargoId, containerIndex>`
3. 이후 placement 시 기존 `bookingAnchor` 와 동일 메커니즘으로 강제 (한 컨에 못 들어가면 unplaced — 쪼개기 금지 룰 자동 작동)

### HM 2차 효과 시뮬

큰 화물 (CBM 내림차순):
일라 12.24, 리브유 10.08, SD KOREA 9.45, 삼원절연 9.34, 중앙바이오텍 9.18, 파인파인비나 8.11, 스톰테크 8.08, 장안어패럴 8.0

40FT 두 대 round-robin:
- 40FT-A: 일라, SD KOREA, 중앙바이오텍, 스톰테크 = 38.95 m³
- 40FT-B: 리브유, 삼원절연, 파인파인비나, 장안어패럴 = 35.53 m³
- **편차 3.4 m³** (실무자 4.5 m³ 와 매우 유사)

---

## 4. 회귀 안전 가드

| 샘플 | Rule ⑥ | Rule ⑦ | 영향 |
|---|---|---|---|
| 2ST SG TOTAL | ❌ 동종 40FT × 2 (혼종 X) | ✅ 활성 | 회귀 가능성 — 검증 필수 |
| 1ST SG TOTAL | ✅ 활성 | ❌ 비활성 | Rule ⑥ 만 영향 |
| 1ST HM TOTAL | ✅ 활성 | ❌ 비활성 | Rule ⑥ 만 영향 |
| 2ST HM TOTAL | ✅ 활성 | ✅ 활성 | 실무자 분배에 가까워짐 |

**완화책:** Rule ⑦ 의 round-robin 결과는 anchor 일 뿐, 기존 swap 패스가 fix 가능. swap 패스 종료 조건을 "anchor 위반 시 실패" 로 명시해 anchor 우선.

---

## 5. 임계값 (제안 초기값)

| 항목 | 값 | 근거 |
|---|---|---|
| 큰 화물 CBM | ≥ 7 m³ | HM 2차 8 건 분류 |
| 큰 화물 무게 | ≥ 2500 kg | 무거운 화물 6 건 |
| 작은 화물 CBM | ≤ 4 m³ | 작은 부킹 8 건 |
| 작은 화물 무게 | ≤ 1500 kg | 가벼운 부킹 |

→ 4 샘플 기반 자동 캘리브레이션 가능.

---

## 6. 점수 합산 금지 룰 준수

모든 우선순위는 lex (사전순) 비교/필터/정렬로 구현:
- Rule ⑥ : 후보 리스트 순서 재배치 (3 그룹 lex)
- Rule ⑦ : pre-anchor 강제 (booking anchor 와 동일 메커니즘)

**가중치 점수 합산 절대 X.** ([feedback_no_score_rule.md](../../../.claude/projects/C--Users-napda/memory/feedback_no_score_rule.md) 참고)

---

## 7. 적용 결정 사항 (사용자 확인 후 진행)

- [ ] 임계값 (CBM 7/4, 무게 2500/1500) 이대로 vs 4 샘플 자동 캘리브레이션
- [ ] Rule ⑦ 기본 활성 vs 옵션 명시 (`autoBigCargoSpread`)
- [ ] 무게-only 큰 화물(화인써키트 등) round-robin 포함 여부
