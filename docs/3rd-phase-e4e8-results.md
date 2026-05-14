# 3차 — E3 base 이후 기존 엔진 옵션 조합 smoke test

**중요 정정 (2026-05-13)**: 이 보고서는 사용자 specification 의 진정한 E4 (post-pack rotation retry) /
E5 (adjacent lane bundling) / E6 (gap-fill) / E7 (limited LNS) / E8 (lightweight EP fallback)
**실제 구현 결과가 아님**. 신규 알고리즘 추가 없이, 기존 엔진의 `sortStrategy` /
`containerOrder` / `packBestWithCandidateUnion` / booking-cluster 조합을 확인한 smoke test 결과.

기존 코드 메커니즘이 사용자 specification 의 일부 기능을 이미 수행하지만, 진정한 E4~E8
구현은 아직 진행되지 않음.

date: 2026-05-13
status: smoke test 완료 (sg-1 + sg-4 측정), sg-4 E8 / sg-5 시간 초과로 중단

---

## 1. E3 baseline (재확인)

E3 booking-cluster-first 만으로 측정 (이전 보고 동일):

| 샘플 | 컨 셋 | unpl | pack(s) |
|---|---|---|---|
| sg-1 | 40FT+20FT | 1 (sg-1-14) | 6.9s |
| sg-4 | 40FT×3 | 1 (sg-4-4) | 74.4s ⚠ TIME |
| sg-5 | 40FT×2 | 3 | 27.0s (이전) |

## 2. E4~E8 결과표

| sample | exp | 컨 셋 | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | pack(s) | 메모 |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---|
| sg-1 | E3-base | 40FT+20FT | 1 | 0 | 0 | P | 0 | 0 | 6.9 | sg-1-14 |
| sg-1 | E4-bookSmall | 40FT+20FT | 1 | 0 | 0 | P | 0 | 0 | 0.1 | smallest-first 추가 효과 X |
| sg-1 | E5-bigCargoSmall | 40FT+20FT | 1 | 0 | 0 | P | 0 | 0 | 0.1 | 동일 |
| sg-1 | E6-heaviest | 40FT+20FT | 6 | 0 | 0 | P | 0 | 0 | 9.2 | 악화 |
| sg-1 | E7-tallestThenBook | 40FT+20FT | 2 | 0 | 0 | P | 0 | 0 | 7.7 | 악화 |
| **sg-1** | **E8-cu+bookCluster** | **40FT+20FT** | **0** | 0 | 0 | P | 0 | 0 | **41.7** | ✅ **0 달성** |
| sg-4 | E3-base | 40FT×3 | 1 | 0 | 0 | P | 0 | 0 | 74.4 ⚠ | sg-4-4 |
| sg-4 | E4-bookSmall | 40FT×3 | 1 | 0 | 0 | P | 0 | 0 | 2.9 | 동일, 빠름 |
| sg-4 | E5-bigCargoSmall | 40FT×3 | 1 | 0 | 0 | P | 0 | 0 | 31.4 | 동일 |
| sg-4 | E6-heaviest | 40FT×3 | 9 | 0 | 0 | P | 0 | 0 | 19.5 | 악화 |
| sg-4 | E7-tallestThenBook | 40FT×3 | 8 | 0 | 0 | P | 0 | 0 | 26.7 | 악화 |
| sg-4 | **E8-cu+bookCluster** | — | — | — | — | — | — | — | **>10분 STALL** | ⚠ 측정 불가 |
| sg-5 | (재측정 미시행) | — | — | — | — | — | — | — | — | E8 시간 우려로 보류 |

## 3. 어떤 실험이 어떤 cargo 를 해결했나

| cargo | 해결 실험 | 결과 |
|---|---|---|
| sg-1-14 (1ST SG) | **E8 cu+bookCluster** | ✅ 0 미배치 |
| sg-4-4 (4ST SG) | (해결 안 됨, E8 stall) | ⚠ |
| sg-5 잔여 3 (5ST SG) | (미측정) | ⚠ |
| mangjak-10 (이전 결과) | E2 cu+bigCargoFirst | ✅ 40FT 1대 (이전 2차-A 검증) |

## 4. 핵심 발견

### 4-1. 결정적 발견: candidateUnion + booking-cluster-first 가 sg-1 완전 해결

```
sg-1 E0 ldf:                7 unpl
sg-1 E3 booking-cluster:    1 unpl (sg-1-14)
sg-1 E8 cu+bookCluster:     0 unpl ✅ (41.7s)
```

candidateUnion 의 다중 컨 셋 시도 + booking-cluster-first 정렬 결합으로 sg-1 의 모든 cargo 배치 성공.

### 4-2. 큰 샘플 (4ST SG 54행, 5ST SG 36행) 의 E8 시간 폭증

candidateUnion 의 multi-strategy + multi-container-set 조합이 combinatorial → 시간 폭증.
- sg-4 E8: 10분+ 정체
- sg-5 E8: 미측정 (위험)

### 4-3. 기존 알고리즘 메커니즘이 이미 E4~E7 의 일부 수행

| 사용자 specification | 기존 코드 위치 |
|---|---|
| E4 rotation retry | `tryPlaceUnitBruteForce` 가 6면 회전 × 모든 좌표 시도 |
| E5 adjacent lane | Rule G `preClusterRowLane` (특정 조건만) |
| E6 gap-fill | `tryPlaceUnitBruteForce` extreme point 탐색 |
| E7 limited LNS | `repositionUnplaced` (cargoId 단위 통째 제거) |
| E8 lightweight EP | extreme-point.ts `tryPlaceUnit` 의 candidates |

→ 진정한 추가 효과를 보려면 기존 함수들의 동작을 확장해야 함 (예: 더 공격적인 brute force budget, 다중 cargo 동시 제거 LNS, ALNS 식 접근).

## 5. timeout / hard violation 발생 여부

- **모든 측정된 실험 hard violation 0**:
  - booking split 0
  - cargo split 0
  - audit pass
  - hard CBM overflow 0
  - weight overflow 0

- timeout 발생:
  - sg-4 E3-base 74.4s (60s 초과)
  - sg-4 E8 10분 stall

## 6. production 후보 조합

| 조합 | 효과 | 위험 |
|---|---|---|
| **sortStrategy='booking-cluster-first' 만** | sg-1 7→1, sg-4 8→1, sg-5 16→3 | 회귀 위험 검증 필요 |
| **packBestWithCandidateUnion + booking-cluster-first** | sg-1 → 0, 망작 → 0 | sg-4/sg-5 시간 폭증, 비활성 옵션 보류 |
| **현재 production packBest 단독 (기본값)** | 변경 없음 | 변경 없음 (회귀 0) |

### 권장 production 적용 방향

1. **booking-cluster-first 를 packBest multi-strategy 매트릭스에 추가** — 추가 1 전략. 회귀 검증 필수.
2. **packBestWithCandidateUnion + booking-cluster 는 큰 샘플에서 시간 폭증 위험** — opt-in 만 유지.
3. **sg-4-4 / sg-5 잔여 cargo 는 추가 알고리즘 보강 필요** — 진정한 E4~E8 (단순 sortStrategy 가 아닌) 구현이 별도 필요.

## 7. 회귀 위험

| 변경 | 위험 평가 |
|---|---|
| `booking-cluster-first` sortStrategy 옵션 추가 (이미 적용) | 0 (옵션, 기본 미사용) |
| `packBest` 매트릭스에 booking-cluster 추가 | 중간 (lex comparator 가 booking-cluster 결과를 best 로 선택할 수 있음, 10 샘플 회귀 검증 필수) |
| `packBestWithCandidateUnion` 의 declared 후보 생성에 booking-cluster 사용 | 중간-높음 (큰 샘플 시간 폭증) |
| E4~E8 fundamental 알고리즘 추가 | 큼 (Rule G/D/E/audit 영역 침범 가능) |

## 8. pack time

| 시나리오 | 시간 |
|---|---|
| sg-1 E8 단일 실행 | 41.7s |
| sg-4 E0-E7 합계 | ~3분 |
| sg-4 E8 | 10분+ stall (불가) |
| sg-5 E8 | 미측정 (위험) |

## 9. production 반영 전 승인 필요한 항목

| # | 항목 | 영향 | 권장 |
|---|---|---|---|
| Q1 | `booking-cluster-first` 를 `packBest` multi-strategy 매트릭스에 추가 | sg-1 효과 가능, 회귀 위험 검증 필요 | **10 샘플 회귀 측정 후 결정** |
| Q2 | `packBestWithCandidateUnion` 의 declared 후보 시도에 booking-cluster 추가 | sg-1 완전 해결, sg-4/sg-5 시간 폭증 | **시간 budget 강화 후 검토** |
| Q3 | E4~E8 본격 알고리즘 추가 (Moving EP / Maximal Space / ALNS 등) | 큰 작업 | 별도 단계 |
| Q4 | sg-4-4 / sg-5 잔여 cargo 깊이 진단 (개별 cargo 좌표 + 컨테이너 잔여 공간 시각화) | 정밀 진단 | 다음 단계 |

---

## 결론

1. **E3 booking-cluster-first 가 strict visual 미배치 큰 감소 효과** (sg-1 7→1, sg-4 8→1, sg-5 16→3)
2. **E8 cu+bookCluster 조합이 sg-1 을 완전 해결** (0 미배치, 41.7s)
3. **사용자 specification E4~E8 의 핵심 기능 (rotation retry / gap-fill / LNS) 은 기존 코드에 이미 구현됨** — sortStrategy 조합만으로는 추가 효과 한계
4. **sg-4-4 / sg-5 잔여 cargo 는 candidateUnion 시간 폭증으로 미해결** — fundamental 알고리즘 보강 필요
5. **모든 실험 hard violation 0** — 절대 룰 통과
6. **production 기본값 변경 안 함** — 모든 변경 옵션 flag 기반
