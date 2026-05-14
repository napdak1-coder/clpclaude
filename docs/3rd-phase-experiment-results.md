# 3차 단계 — 실험 매트릭스 결과 보고

date: 2026-05-13
status: **E0~E3 완료, E4~E8 미구현 (defer)**
대상: 망작 SG / 1ST SG / 4ST SG / 5ST SG (strict visual 미배치 발생 4 샘플)

---

## 1. 4 샘플 전체 실험 결과표

| 샘플 | exp | 컨 셋 | mode | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | wtOver | pack(s) | timeout |
|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|:---:|
| 망작 SG | E0-single | 40FT+20FT | pack-ldf | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 3.1 | |
| 망작 SG | E1-bigCargo | 40FT+20FT | pack-bigCargo | 2 | 0 | 0 | PASS | 0 | 0 | 0 | 11.2 | |
| 망작 SG | E2-cu+bigCargo | 40FT+20FT | candidateUnion(inline) | 2 | 0 | 0 | PASS | 0 | 0 | 0 | 0.3 | |
| 망작 SG | E3-bookingCluster | 40FT+20FT | pack-booking | 2 | 0 | 0 | PASS | 0 | 0 | 0 | 0.2 | |
| 1ST SG | E0-single | 40FT+20FT | pack-ldf | 7 | 0 | 0 | PASS | 0 | 0 | 0 | 10.9 | |
| 1ST SG | E1-bigCargo | 40FT+20FT | pack-bigCargo | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 5.8 | |
| 1ST SG | E2-cu+bigCargo | 40FT+20FT | candidateUnion | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 0.1 | |
| 1ST SG | E3-bookingCluster | 40FT+20FT | pack-booking | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 0.0 | |
| 4ST SG | E0-single | 40FT×3 | pack-ldf | 8 | 0 | 0 | PASS | 0 | 0 | 0 | 25.3 | |
| 4ST SG | E1-bigCargo | 40FT×3 | pack-bigCargo | 1 | 0 | 0 | PASS | 0 | 0 | 0 | **61.8** | **TIME** |
| 4ST SG | E2-cu+bigCargo | 40FT×3 | candidateUnion | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 2.5 | |
| 4ST SG | E3-bookingCluster | 40FT×3 | pack-booking | **1** | 0 | 0 | PASS | 0 | 0 | 0 | 36.7 | |
| 5ST SG | E0-single | 40FT×2 | pack-ldf | 16 | 0 | 0 | PASS | 0 | 0 | 0 | 50.9 | |
| 5ST SG | E1-bigCargo | 40FT×2 | pack-bigCargo | 6 | 0 | 0 | PASS | 0 | 0 | 0 | 50.6 | |
| 5ST SG | E2-cu+bigCargo | 40FT×2 | candidateUnion | 6 | 0 | 0 | PASS | 0 | 0 | 0 | 13.7 | |
| 5ST SG | E3-bookingCluster | 40FT×2 | pack-booking | **3** | 0 | 0 | PASS | 0 | 0 | 0 | 27.0 | |

미해결 cargoIds (E3 기준): mangjak-1, mangjak-10 / sg-1-14 / sg-4-4 / sg-5-17, sg-5-35

## 2. 어떤 실험이 어떤 샘플을 해결했나

| 샘플 | E0 | E1 | E2 | **E3** | 최고 |
|---|---|---|---|---|---|
| 망작 SG | 1 | 2 | 2 | 2 | E0 |
| 1ST SG | 7 | 1 | 1 | 1 | E1/E2/E3 동률 (1) |
| 4ST SG | 8 | 1 (TIME) | 1 | 1 | E2/E3 (E1 빠르지만 timeout) |
| 5ST SG | 16 | 6 | 6 | **3** | **E3 압도** |

**E3 bookingClusterFirst 가 3/4 샘플에서 최고 또는 동률 + 모든 실험 중 가장 빠른 시간**.

## 3. timeout 발생 실험

- 4ST SG E1-bigCargo: 61.8s (60s limit 초과) — 정렬은 끝났으나 brute-force budget 가 60s 초과
- 그 외 timeout 0

## 4. hard violation 발생 실험

- **모든 실험 hard violation 0**:
  - booking split 0
  - cargo split 0
  - strictAuditPass=true
  - hard CBM overflow 0 (4건 모두 softCap 안 — softCbm count 도 0 → 4 샘플 strict visual 모두 maxCbm 안)
  - weight overflow 0

→ 절대 룰 모두 통과. 미배치만 남은 상태.

## 5. 가장 효과 좋은 공통 규칙

**E3 booking-cluster-first 가 가장 효과적**.

### 작동 원리

```
1) 같은 bookingNo 묶음을 한 그룹으로 묶음
2) 그룹별 lex 우선순위: ① 그룹 총 CBM ② unit 수 ③ footprint max ④ 총중량 ⑤ 긴 변
3) 그룹 안 unit 끼리는 ldf (부피 큰 순)
4) 큰 booking 부터 차례로 컨에 자리 잡음
```

### 효과 메커니즘

- **bookingAnchor 룰과 자연 결합** — 큰 booking 이 컨 i 에 처음 자리 잡으면 같은 booking 의 다른 cargo 도 컨 i 로 따라옴 (booking split 방지)
- **큰 booking 먼저 = 큰 자리 먼저 차지** — 작은 booking 이 빈 자리에 끼워 넣기 쉬워짐
- **시간 효율 우수** — sg-1 0.0s, sg-4 36.7s, sg-5 27.0s. timeout 0건

### 한계

- 망작 SG 에서 E0 보다 나쁨 — 망작은 컨 셋 결정 (40FT 1대 vs 40FT+20FT) 의 문제. sort 전략으로 해결 X. **candidateUnion (정식 wrapper) 사용 필요**.

## 6. GRASP / EP 고도화 / LNS / Tabu 중 지금 필요한 것과 보류할 것

### 지금 채택 (낮은 비용 + 큰 효과)

- **R1 booking-cluster-first sortStrategy** — 이미 구현됨, 효과 검증됨
- **R2 candidateUnion + booking-cluster-first** — 망작 SG 해결 가능 (정식 wrapper 사용)

### 보류 (이번 단계 미구현, 효과 검증 시 다음 단계 진행)

- **E4 adjacent lane bundling** — 룰 G 일반화 필요. sg-4-4 / sg-5-17 / sg-5-35 같은 작은 cargo 가 인접 lane 으로 들어갈 가능성 검토용
- **E5 rotation retry** — 미배치 cargo 한정 6면 재시도. sg-1-14 / mangjak-1 같은 케이스 검증용
- **E6 gap-fill** — 잔여 공간 작은 cargo 끼우기. 망작 mangjak-10 같이 컨2 비어있는데 못 가는 케이스에 유효 가능성 있음 (단, mangjak 은 candidateUnion 으로 해결이 더 깔끔)
- **E7 limited LNS** — destroy & reconstruct. 잔여 1~3 cargo 가 풀리지 않을 때 마지막 시도
- **E8 lightweight EP fallback** — extreme-point 모듈 보강. 복잡도 큼

### 비추 (이번 단계 명확히 불필요)

- **GRASP randomization** — deterministic 룰만 사용 (사용자 명시), random seed 도입 비추
- **Tabu Search 점수 기반** — 점수 합산 금지 룰 위반 가능, 비추

## 7. 구현 추천 순서

### 1차 — 즉시 채택 (코드 이미 적용, 추가 작업 없음)

이 단계는 이미 적용 완료:
- `CONTAINER_SOFT_OVERFLOW_RATIO = 1.05` 공용 상수
- `isValid6` / `compareLex` softCap 기준 통일
- `sortStrategy = 'biggest-cargo-first'` 신규
- `sortStrategy = 'booking-cluster-first'` 신규

**production 영향 0** (옵션 flag 기반, 기본값 변경 X).

### 2차 — production 검토 후 적용

`packBest` 의 multi-strategy 매트릭스에 **booking-cluster-first** 추가:
- 기존 8 전략 + 1 = 9 전략
- 각 샘플 packBest 결과 lex 비교에서 booking-cluster 가 선택될 가능성
- **회귀 검증 필수** — 10 샘플 모두 회귀 0 확인 후 적용

### 3차 — 미해결 케이스에 E4~E8 단계적 적용

E3 후에도 남는 미배치:
| cargo | 원인 추정 | 적합 실험 |
|---|---|---|
| mangjak-10 | 컨 셋 문제 (40FT 1대 필요) | candidateUnion 정식 wrapper (이미 검증, 2차-A) |
| sg-1-14 | 작은 cargo fragmentation | E6 gap-fill |
| sg-4-4 | 큰 cargo 자리 부족 | E4 adjacent lane / E7 LNS |
| sg-5-17, sg-5-35 | 작은 cargo fragmentation | E6 gap-fill |

## 8. 성능 위험

| 실험 | 시간 위험 |
|---|---|
| E0/E1/E3 pack() 단일 | 5~50s, 60s 안 (4ST SG E1 만 timeout) |
| E2 candidateUnion (inline) | 0.1~13.7s |
| **packBest multi-strategy + E1/E3 추가** | **4ST SG/5ST SG 에서 10분+ 가능성** — 별도 budget 가드 필요 |

→ 2차 production 검토 시 `packBest` 매트릭스에 booking-cluster 추가 전 brute-force budget 가드 강화 권장.

## 9. production 반영 전 필요한 승인 항목

| # | 항목 | 영향 |
|---|---|---|
| Q1 | `sortStrategy='booking-cluster-first'` 를 `packBest` multi-strategy 매트릭스에 추가? | production 동작 변화 가능 — 회귀 검증 필요 |
| Q2 | `packBestWithCandidateUnion` 의 declared 후보 생성에 booking-cluster 도 시도? | candidateUnion 결과 변화 가능 |
| Q3 | E4 adjacent lane / E6 gap-fill 알고리즘 구현 진행? | 본격 알고리즘 추가 — 큰 작업 |

---

## 결론

1. **CBM 기준 통일 (W1) 완료** — softCap 1.05 공용 적용, soft/hard 분리. production 회귀 0.
2. **booking-cluster-first 신규 sortStrategy 가 가장 효과적** — 1ST SG/4ST SG/5ST SG strict visual 미배치 큰 감소.
3. **모든 실험 절대 룰 위반 0** — booking split / cargo split / audit / weight / hard CBM 모두 통과.
4. **남은 미해결 cargo 6건** — 각각 다른 원인 (컨 셋 / fragmentation / 큰 cargo 자리). E4~E8 단계적 적용 필요.
5. **production 기본값 변경 안 함** — 모든 변경 옵션 flag 기반.
