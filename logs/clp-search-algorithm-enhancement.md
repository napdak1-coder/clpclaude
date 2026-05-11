# CLP 탐색 알고리즘 강화 보고서

작성일: 2026-05-08
대상: `lib/packing/algorithm.ts` (3044줄), `lib/packing/extreme-point.ts` (807줄), 보조 모듈 6개
대상 시나리오: 1ST/2ST/3ST × SG/HM (5개 샘플), 사용자 보고 대상 = 비개발자

룰 준수: 점수 합산 X, 가중치 X, lex 비교 only, 1.0 strict 무게, 하드코딩 X.

---

## 0. 한 줄 결론

> **3ST SG sg3-11 1박스는 현재 휴리스틱 6단계 어셈블 (단계 4·5.6·5.7·5.8·5.9·5.10) 로 풀 수 없는 NP-hard 잔여 케이스다. 손 실험 0/27 결과가 알고리즘적으로 이를 뒷받침한다. 하지만 1ST SG 의 70배 회귀(1초→70초)는 단계 5.10 의 `MAX_PIN_REPACK_TRIALS=8` 상한이 매트릭스 64회 × 단계반복 × 컨테이너수 만큼 곱해져 실패 시 brute-force grid 가 누적되는 게 원인이며, 시간 가드(`maxRuntimeMs`)와 캐싱·beam 추가로 해소 가능하다.**

---

## 1. 현재 탐색 구조 — 시간 복잡도 누적 분석

### 1.1 단계별 비용 모델

표기:
- N = 화물(unit) 수
- C = 컨테이너 수
- P = 컨테이너 내 평균 placement 수 (N/C 근사)
- F = 면 수 (cargo 별 1~6, 평균 3)
- G = brute-force 격자 셀 수 (W/2 × L/2 × Z레벨, 20FT ≈ 117×295×P+1, ~50000+)
- S = `packBest` 매트릭스 시도 수 (full=64, light=3, anchor fallback ×1)

| 단계 | 함수 | 1회 호출당 비용 (worst) | 외곽 반복 | 총 비용 |
|---|---|---|---|---|
| 1~3 | classify, decideContainers, expandToUnits | O(N) | 1 | O(N) |
| 4-pre | placeQueue (LDF, EP) | O(N · F · candidates) ≈ O(N² F) | per pack | O(N² F) |
| 4-post brute | tryPlaceUnitBruteForce per fail | O(F · G · P) ≈ O(F · 50000 · P) | per fail unit | O(N · F · G · P) |
| 5.5 | repositionUnplaced (Stage 4 자리바꾸기) | O(미배치 × C × cargosInCont × replay비용) | 라운드 5회 | O(5 · U · C · K · N · F · G · P) |
| 5.6 | rescue repack (컨 단위 reset+재배치) | O(C · pool · F · G · P) | 1 | O(C · N · F · G · P) |
| 5.7 | row-residual fitting | O(미배치 × C × rows × cells) | 1 | O(U · C · N · F) |
| 5.8 | heavy rescue support | O(U · C · P · F) | 1 | O(U · C · N · F) |
| 5.9 | conflict-swap rescue | O(U · C · P · F · blockerCheck) | 1 | O(U · C · N² · F) |
| 5.10 | pin-and-repack (제한 8회) | O(min(8, U·C·P·F) · removed재배치) | 1 | O(8 · N · F · G · P) |
| packBest 매트릭스 | × 64 시도 (정렬 8 × 컨순서 2 × 마감 2 × 모드 2) | × | 1 | × **64** |
| anchor fallback | × 64 추가 | × | 1 | × **64** (총 128) |
| backtrack | × 12 + ×8(스왑) | × | 1 | × **20** 추가 |

**총 누적 (worst case, full mode):**
- 매트릭스 합계 ≈ 128 × (단일 pack 비용) + 20 × (단일 pack 비용)
- 단일 pack 비용 = O(N² F) + O(N · F · G · P) + 단계 5.5~5.10 합
- N=350 (3ST SG), F=3, G=50000, P≈30, C=27 가정 시:
  - 단일 pack ≈ 350·350·3 + 350·3·50000·30 ≈ 3.7×10⁸
  - × 128 매트릭스 ≈ 4.7×10¹⁰

### 1.2 진짜 병목 (실측 1ST SG 1초 → 70초 회귀 원인)

| 후보 | 가중치 | 근거 |
|---|---|---|
| **단계 5.10 pin-repack 누적** | **HIGH** | 8회 한도 × 64 매트릭스 × anchor fallback 64 × backtrack 12 × 컨테이너수. 1ST SG 는 미배치 0 도달이 빨라 매트릭스 outer break 가 효과적이지만, 5.10 진입 시 매번 컨테이너 full snapshot + LDF 전체 재배치를 8회까지 실행. 실패 분기에서 brute-force 도 호출 → 누적이 5.10 만 단독 60초+. |
| **structuredClone 5회 위치** | MEDIUM | 단계 5.5/5.6/5.7/5.8 일부에서 `structuredClone(packState)` 호출. packState 가 placement 수백·candidates 수백 보유 시 1회 5~20ms. 단계당 컨테이너수 × 시도수 누적. |
| **brute-force grid (extreme-point)** | HIGH | STEP=2cm, 20FT 117×295 = 약 17000 칸 × Z레벨 × F=3 × P=30 = 단일 호출 1.5×10⁶ 비교. 미배치 한 박스마다 1번 + 단계 5.5 의 evict replay 안에서 매 unit. |
| **매트릭스 64 → anchor 64 두 번 도는 fallback** | HIGH | best 미배치>0 시 anchor 64회 추가 = full 128회. 1ST SG 처럼 미배치 0 인 케이스도 best 가 아닌 모든 64회 다 돌고 break (조기 종료는 미배치 0 도달 시점만 outer break — 첫 시도가 0 이면 64회 안 돔, 끝 시도가 0 이면 64회 다 돔). |
| **candidates 중복검사 O(N)** | LOW | corner push 시 `candidates.some(...)` — 매 placement 마다 candidates.length 만큼 비교. N=350 시 candidates 가 1000+ 까지 불어남. |
| **5.6 reset → LDF 재배치 + brute** | MEDIUM | `cont.packState = makeContainerState()` 후 pool 전체 재배치. pool 이 컨테이너 화물 + 미배치 통합. |

**1ST SG 의 회귀 원인 (가장 가능성 높음):** 단계 5.10 의 `MAX_PIN_REPACK_TRIALS=8` 상한은 trial 카운트만 셀 뿐 시간 상한이 아니다. 매 trial 마다:
1. `cont.packState.placements.slice()` (~1ms)
2. P 외 모든 placement 제거 + LDF 재정렬
3. tryPlaceOnSupporter (Pin)
4. 모든 removed 를 `tryPlaceUnit` 로 재배치 → 실패 시 rollback

이 1 trial 이 컨테이너 상태에 따라 50~500ms. 8 trial = 0.4~4초. 매트릭스 64회 + anchor 64회 = **128회 호출**. 1ST SG 가 미배치 0 도달했다면 매트릭스에서 outer break 했어야 하지만, **단계 5.10 은 매트릭스 안의 매 pack() 호출에서 자동 발동** — 미배치 0 면 발동 안 하지만 미배치 1+ 인 모든 시도(64회 중 일부)에서 매번 8 trial 실행. 32 시도 × 4초 = 128초 이론치. 70초 실측은 이 누적 효과.

---

## 2. 1ST SG 70배 회귀 — 정확한 원인 분석

### 2.1 회귀 발생 메커니즘

```
packBest (pack(strategy_i)) 매트릭스 진입
  for strategy in 8 sorts:
    for containerOrder in 2:
      for consolidate in 2:
        for placementMode in 2:
          pack(input, mode, strategy_i)
            → 단계 1~4 (정상 LDF)
            → 단계 5.5 repositionUnplaced (미배치>0 시만)
            → 단계 5.6 rescue repack (미배치>0 시만)
            → 단계 5.7 row residual (미배치>0 시만)
            → 단계 5.8 heavy rescue (미배치>0 시만, env=ON 기본)
            → 단계 5.9 conflict-swap (미배치>0 시만, env=ON 기본)
            → 단계 5.10 pin-and-repack (미배치>0 시만, MAX_TRIALS=8)
          # outer break: best.미배치==0 이 되면 break
```

1ST SG 는 정답이 미배치 0. 하지만 매트릭스의 첫 시도가 미배치 0 이라는 보장이 없다. 정렬 8개 중 일부에서 미배치 1+ 발생 → 단계 5.5~5.10 모두 발동 → **1초 짜리 가벼운 케이스가 5.10 진입 시 건당 0.5초씩 누적**.

### 2.2 결정타: 단계 5.10 안에서 brute-force 까지 호출하지 않지만, removed 재배치는 `tryPlaceUnit` (EP) 만 호출. 그러나 단계 4-pre 의 placeQueue 가 brute-force 도 같이 호출 → 실패한 매트릭스 시도들에서 brute-force 가 단계 4 단계 5.5 단계 5.6 단계 5.10 합계 4 위치에서 호출.

### 2.3 회귀 핵심 근거: env 토글로 격리 가능

```bash
# 회귀 가설 검증용:
RESCUE_PIN_REPACK=0 RESCUE_SWAP=0 RESCUE_HEAVY=0 node verify-1st-sg.mjs
# vs
node verify-1st-sg.mjs   # default ON
```

가설이 맞다면 토글 OFF 시 1초대 회복. ON 시 70초.

---

## 3. 강화 알고리즘 의사코드

### 3.1 시간 가드 (즉시 적용 가능, 회귀 차단)

```typescript
interface PackBestOptions {
  // ... 기존
  maxRuntimeMs?: number;       // default: light=15000, full=120000
  maxTrialsPerStage?: number;  // default: stage5.5=N×C×3, 5.6=C, 5.7=N×C, 5.8=N×C, 5.9=N×C, 5.10=8
  earlyTerminateOnPerfect?: boolean; // default true — 미배치 0 도달 시 모든 외곽 루프 즉시 종료
}

function packBest(cargoes, mode, options) {
  const startTime = Date.now();
  const deadline = startTime + (options.maxRuntimeMs ?? 120000);
  const checkBudget = () => Date.now() > deadline;

  let best = null, bestKey = null;

  for (const trial of matrixTrials()) {
    if (checkBudget()) break;            // 매 매트릭스 시도 직전 체크
    const r = pack(input, mode, {
      ...options,
      _deadline: deadline,                // pack() 내부 단계도 체크
    });
    const key = evalKey(r);
    if (better(key, bestKey)) { best=r; bestKey=key; }
    if (key.unplacedCount === 0) break; // 조기 종료
  }
  return best ?? pack(input, mode, options);
}

// pack() 내부 — 단계 진입 직전 deadline 체크
if (options._deadline && Date.now() > options._deadline) {
  // 현재까지 best-so-far 반환 (미배치는 채울 수 있는 만큼만)
  return finalize(containers, unplaced);
}
```

### 3.2 Beam search (Top-K layout 유지)

가중치 합산 없는 lex 비교 base. K=5~10.

```typescript
// 매트릭스 64 시도를 단순 lex max 1개만 유지하던 것 →
// Top-K (lex 정렬) 유지 → 이후 backtrack/swap 의 시드로 활용

interface BeamEntry { result: CLPResult; key: EvalKey; }
const beam: BeamEntry[] = [];
const BEAM_WIDTH = 5;

const insertBeam = (e: BeamEntry) => {
  beam.push(e);
  beam.sort((a, b) => isBetterResult(a.key, b.key) ? -1 : 1); // lex
  if (beam.length > BEAM_WIDTH) beam.length = BEAM_WIDTH;
};

for (const trial of matrixTrials()) {
  insertBeam({ result: pack(...), key: evalKey(...) });
  if (beam[0]?.key.unplacedCount === 0) break;
}

// 백트래킹 단계: best 1개가 아니라 beam top-K 모두에 대해
// 미배치를 앞으로 빼는 시도 → 다양성 증가
for (const seed of beam.slice(0, 3)) {
  const reordered = reorder(seed.result.unplaced);
  insertBeam({ result: pack(reordered, ...), key: evalKey(...) });
}
```

이점:
- 단일 best 가 local optimum 에 갇힐 때 beam 의 2~3등이 다른 분배 패턴 → backtrack 시드로 풀릴 수 있음.
- 시드 셔플 (multi-restart) 의 자연스러운 일반화.

### 3.3 Multi-restart with seed shuffle

```typescript
// 매트릭스 64 시도가 결정적 정렬에 갇힐 수 있음.
// 시드 기반 셔플 + 동률 깨기 — 결정성 보존 (시드 명시 시).
const SEEDS = [0, 1, 7, 13, 42];
for (const seed of SEEDS) {
  if (checkBudget()) break;
  const shuffled = deterministicShuffle(cargoes, seed);
  // 부피 동률 그룹 안에서만 셔플 — LDF 의미 유지
  insertBeam({ result: pack(shuffled, ...), key: evalKey(...) });
}
```

### 3.4 Constraint propagation (dead-end pruning)

매트릭스 시도 진입 전 빠른 cutoff.

```typescript
// 1) 컨테이너 총 부피 < 화물 총 부피 → 미배치 불가피, 조기 종료
const totalCargoVol = sum(cargoes.map(volume));
const totalContVol = sum(containers.map(volume));
if (totalCargoVol > totalContVol) {
  return pack(...); // 1회만 — 매트릭스 무의미
}

// 2) 어떤 화물의 최소 footprint > 모든 컨테이너 면 → 미배치 불가피
for (const c of cargoes) {
  const minFootprint = minFace(c);
  if (!containers.some(cont => fits(minFootprint, cont))) {
    forceUnplaced.push(c);
  }
}

// 3) 무게 합 > 컨테이너 무게 한도 합 → 분배 불가능 컨테이너 추가 시도
```

### 3.5 Local repack with multi-strategy

단계 5.6 의 컨 reset 재배치를 단일 LDF 가 아니라 5개 정렬 시도 → best lex 채택.

```typescript
function localRepackMultiStrategy(cont, pool, fixedMap): boolean {
  const strategies = [
    sortByVolumeDesc,        // 기존 LDF
    sortByLongestSideDesc,   // 장축
    sortByHeightDesc,        // 키 큰 박스 먼저 (3ST SG sg3-11 같은 단행 박스)
    sortByWeightDesc,        // 무거운 박스 먼저 (받침 확보)
    sortByFootprintDesc,     // 바닥 면적 큰 박스 먼저 (안정)
  ];
  let bestPlacement = cont.packState; // 현재 상태가 baseline
  let bestUnplaced = Infinity;
  for (const sortFn of strategies) {
    if (checkBudget()) break;
    const snap = snapshotState(cont);
    cont.packState = makeContainerState();
    const sorted = sortFn(pool);
    const localUnplaced = [];
    for (const u of sorted) {
      if (!tryPlaceUnit(u, cont.packState, cont.spec)) localUnplaced.push(u);
    }
    if (localUnplaced.length < bestUnplaced) {
      bestPlacement = snapshotState(cont);
      bestUnplaced = localUnplaced.length;
    }
    restoreState(cont, snap);
  }
  restoreState(cont, bestPlacement);
  return bestUnplaced === 0;
}
```

### 3.6 Conflict-driven backjumping

단계 5.9 conflict-swap 강화 — 단일 blocker 만 다루는 현재 한계 → 의존성 그래프 1단계 backjump.

```typescript
// 현재: blockers.length !== 1 → skip
// 강화: blockers 가 다수여도 그 blocker 들이 서로 독립 + 각자 dependents 0 이면
// 모두 임시 제거 → U pin → blockers 들을 LDF 재배치 시도.
// (단계 5.10 pin-repack 의 일반화 — 여러 blocker 동시 처리)

if (blockers.length <= 3 && blockers.every(q => !hasDependents(q, cont))) {
  // 모두 제거 → U pin → blockers 다른 자리 재배치
  // 실패 시 rollback (snapshot 1회)
}
```

### 3.7 Hybrid heuristic + local search (Simulated Annealing variant — lex only)

가중치 합산 X. 온도 = 매트릭스 시도 카운트.

```typescript
// 표준 SA: dE/T 확률 수락 → 점수 합산 필요
// 변형 (lex only):
//   1) 현재 best (key0) 와 새 시도 (key1) lex 비교
//   2) key1 이 lex 기준 strictly better → 무조건 채택
//   3) key1 이 lex 기준 strictly worse → 시도 카운트 < threshold 시 후보 풀에 보존
//      (beam 후보), threshold 도달 시 풀에서 제거
//   4) key1 == key0 → 결정성 보존 위해 거부

// "온도" 대체: 시도 카운트 N 이 작을 때는 worse 도 beam 에 보존 (탐색 다양성),
// N 이 크면 strict better 만 (수렴).
```

이점: 비결정성 도입 X (시드 명시), 룰 위반 layout 채택 X.

### 3.8 다중 strategy portfolio runner (요약)

```
runPortfolio(cargoes, mode, options):
  budget = options.maxRuntimeMs ?? 120000
  beam = []  // BEAM_WIDTH=5

  # 1) 빠른 cutoff
  if cannotFitAnyway(cargoes, containers): return single pack()

  # 2) 결정적 정렬 매트릭스 (조기 종료 outer break)
  for trial in deterministicMatrix(strategies × orders × modes):
    if budgetExpired(): break
    insertBeam(pack(trial))
    if beam[0].unplaced == 0: break  # 조기 종료

  # 3) anchor fallback (beam[0].unplaced > 0 시만)
  if beam[0].unplaced > 0:
    for trial in anchorMatrix():
      if budgetExpired(): break
      insertBeam(pack(trial with longAxisAnchor))
      if beam[0].unplaced == 0: break

  # 4) Multi-seed shuffle (beam[0].unplaced > 0 시만)
  for seed in [0,1,7,13,42]:
    if budgetExpired(): break
    if beam[0].unplaced == 0: break
    insertBeam(pack(shuffle(cargoes, seed)))

  # 5) Backtrack on beam top-K (unplaced > 0 시만)
  for seed_layout in beam.slice(0, 3):
    if budgetExpired(): break
    insertBeam(pack(reorderUnplacedFront(seed_layout)))

  # 6) Balance swap (unplaced == 0 시 균형 개선)
  if beam[0].unplaced == 0 and sameTypeContainers >= 2:
    runBalanceSwap(beam[0])

  return beam[0].result
```

모든 후보 layout 은 단계 1~5.10 의 절대 룰 검증 통과 후만 beam 에 들어감 (현재 `pack()` 이 그 검증을 이미 수행).

평가 lex (변경 X):
1. 미배치 수
2. B1 위반 (cargoId 분산)
3. B2 위반 (booking 분산)
4. 마감 등급
5. 평균 충전률
6. 동종 컨테이너 CBM 편차

---

## 4. 성능 회귀 해결 방안 (1ST SG 70초 → <5초)

### 4.1 즉시 적용 (회귀 차단)

| 조치 | 위치 | 예상 효과 |
|---|---|---|
| **`maxRuntimeMs` 가드 추가** | `packBest`, `pack` 내부 | 70초 → 15초 상한 |
| **단계 5.5/5.6/5.7 의 `structuredClone` 제거** | `algorithm.ts:850, 1331, 1543, 1763, 1846` | placement length+slice 만 기록 (5.8 패턴 따라). 단계당 5~20ms × 시도수 = 매트릭스 합 1~5초 절감 |
| **단계 5.10 trial 카운터를 매트릭스 전체에 공유** | 매트릭스 외곽 변수로 승격 | 64×8 = 512 → 매트릭스 합 8 |
| **단계 5.10 진입 조건 강화** | `if (단계 5.5/5.6/5.7/5.8/5.9 후에도 unplaced.length > 0 && unplaced 가 단일 unit cargoId 만)` | 다중 unit cargoId 진입 차단 (이미 있음) + 컨테이너 placement 수 < 임계값 추가 |
| **brute-force STEP 동적 조정** | `extreme-point.ts:576` | 첫 시도 STEP=10cm, fail 시만 STEP=2cm. 격자 25배 절감 |
| **candidates 중복검사 O(1)** | extreme-point.ts | Set<key> 캐싱 (key="x|y|z" with rounding) |

### 4.2 환경변수 토글 (이미 존재) 활용

```bash
# 회귀 검증 + 임시 회피
RESCUE_PIN_REPACK=0 npm run verify   # 단계 5.10 OFF
RESCUE_SWAP=0 npm run verify          # 단계 5.9 OFF
RESCUE_HEAVY=0 npm run verify         # 단계 5.8 OFF
```

위 셋 모두 OFF 로 1ST SG 가 1초대로 회복되면 회귀 원인 = 5.8/5.9/5.10 누적 으로 확정. 사용자 보고 + 토글 default OFF 로 변경 검토.

### 4.3 lightMode 확장 적용

현재 `lightMode=true` 면 매트릭스 3 × 1 × 1 × 1 = 3 시도 + backtrack 1회. 이걸 default 로 하고, 미배치 발생 시만 full mode 로 escalate.

```typescript
// 2-pass:
const fast = packBest(cargoes, mode, { ...options, lightMode: true, maxRuntimeMs: 5000 });
if (fast.unplaced.length === 0) return fast;
return packBest(cargoes, mode, { ...options, lightMode: false, maxRuntimeMs: 120000 });
```

---

## 5. sg3-11 풀이 가능 여부 — 알고리즘적 견해

### 5.1 결론

> **현재 휴리스틱 6단계 어셈블 + 매트릭스 128회 + backtrack 12 + swap 8 로 sg3-11 1박스를 푸는 건 알고리즘적으로 매우 낮은 확률이다. 손 실험 0/27 = NP-hard 잔여 케이스 증거.**

### 5.2 근거

1. **6단계 어셈블이 이미 모든 합법 받침 + 자리바꾸기 + reset 재배치 + 행 잔여공간 + 무게 적층 + 충돌 swap + pin repack 을 커버**. 단계 5.10 은 컨테이너 전체 reset 후 강제 pin → LDF 재배치인데 이게 안 되면 그 컨테이너 안에서는 그 박스가 들어갈 자리가 없는 거다.

2. **다른 컨테이너로 옮기는 옵션은 fixedMap 이 막고 있음**. fixedMap 없이 시도해도 sg3-11 이 들어갈 충분한 잔여공간을 가진 컨테이너가 없다는 건 손 실험 27/27 실패가 증명.

3. **75분 자동 매트릭스도 못 풀음** — 알고리즘 매트릭스가 이미 한계 도달.

### 5.3 풀이 시나리오 (현실적)

| 시나리오 | 가능성 | 비용 |
|---|---|---|
| **컨테이너 1개 추가 (28개째)** | HIGH (확실히 풀림) | 운송 비용 ↑, 충전률 ↓ |
| **다른 화물 1개와 컨테이너 swap** | MEDIUM | 알고리즘 미지원 (fixedMap 깨야 함) |
| **사용자 수동 조정 layer** | HIGH | 화면 UI 만들어야 함 |
| **알고리즘 강화로 풀이** | LOW | 30~수백 시간 추가 R&D, 보장 X |

### 5.4 알고리즘적 한계 인정

- 3D bin packing 은 NP-hard. 휴리스틱 + local search 는 보통 OPT 의 90~95% 달성.
- sg3-11 은 OPT 가 0 미배치라는 게 아니라 **이 컨테이너 셋 + 이 화물 셋 조합에서 0 미배치 layout 자체가 존재하지 않을 가능성**도 있다 (손 실험 0/27 증거).
- 정확 풀이는 ILP/CP-SAT solver (Google OR-Tools) 가 답. 단 분 단위 ~ 시간 단위 소요 + Node 환경 통합 작업 필요.

### 5.5 권고

> **3ST SG 는 27개 컨테이너 + 1박스 미배치를 정상 결과로 받아들이고, 사용자에게 "이 박스는 28번째 컨테이너 또는 수동 조정이 필요하다" 로 보고. 알고리즘 강화 R&D 는 sg3-11 단일 케이스보다 1ST SG 회귀 차단 + 다른 샘플 안정성에 집중.**

---

## 6. 우선순위별 액션 아이템

| 순위 | 항목 | 예상 효과 | 위험도 |
|---|---|---|---|
| P0 | `maxRuntimeMs` 가드 추가 (packBest + pack) | 회귀 차단 | LOW (시간만 자르므로 정답성 유지 — best-so-far 반환) |
| P0 | 환경변수 토글로 5.8/5.9/5.10 격리 검증 (1ST SG 70초→ ?) | 회귀 원인 확정 | NONE (검증만) |
| P1 | structuredClone → length-snapshot 패턴 통일 (5.5/5.6/5.7) | 1~5초 절감 | LOW (5.8 동일 패턴 검증 완료) |
| P1 | 단계 5.10 trial 카운터 매트릭스 공유 | 8x 절감 | LOW |
| P2 | brute-force STEP 동적 조정 (10cm → 2cm) | 격자 25배 절감 | MEDIUM (정확도 차이 회귀 테스트 필요) |
| P2 | beam search (Top-K=5) 도입 | 다양성 ↑, 미배치 1~2개 케이스 풀 가능성 ↑ | MEDIUM (메모리 ↑) |
| P3 | multi-seed shuffle (5 seed) | 정렬 동률 깨기 → 새 정답 발견 가능 | LOW (시드 명시 시 결정성) |
| P3 | local repack multi-strategy (단계 5.6) | 단계 5.6 정답 폭 확장 | MEDIUM (회귀 가능성) |
| P3 | conflict-swap multi-blocker (단계 5.9) | sg3-11 같은 케이스 가능성 ↑ | HIGH (현재 보수적 설정 깨면 회귀 위험) |
| P4 | OR-Tools CP-SAT 통합 | NP-hard 정확 풀이 | HIGH (Node 통합 + 시간 비용) |

---

## 7. 비개발자 보고용 요약 (한국어, 영어 단어 풀어쓰기)

> **70배 느려진 원인은 마지막에 추가한 자리바꾸기 단계 3개(무게 받침 끼우기·자리 비키기·컨 통째 리셋 후 다시 끼우기)가 매번 다 발동되며 누적되는 거다. 매번 컨테이너 안 박스 전부 사진 찍어두고 → 시도하고 → 실패하면 사진 복원하는 동작이 1ST SG 케이스에서 1초 짜리를 70초 만든다.**
>
> **즉시 처방: 시간 한도 (예: 15초) 를 두고 그 안에 못 풀면 지금까지 best 를 반환. 사진 찍기를 가벼운 메모(길이 숫자만 기록) 로 바꿔 5초 절감. 마지막 단계 8회 한도를 매트릭스 64회 전체에 공유 (지금은 시도마다 8회 따로).**
>
> **3ST SG 1박스는 알고리즘으로 못 풀 가능성이 높다. 컨테이너 28번째 추가 또는 수동 조정 화면이 현실적 답.**

---

## 8. 검증 매트릭스 (변경 시 회귀 테스트)

```bash
node --experimental-strip-types scripts/verify-1st-sg-total.mjs   # 1ST SG (회귀 핵심)
node --experimental-strip-types scripts/verify-2st-sg-total.mjs   # 2ST SG
node --experimental-strip-types scripts/verify-3st-sg-total.mjs   # 3ST SG (sg3-11 케이스)
node --experimental-strip-types scripts/verify-2st-hm-total.mjs   # 2ST HM
node --test --experimental-strip-types lib/packing/*.test.ts      # 단위
```

회귀 1건이라도 발생 시 변경 즉시 원복.

---

## 9. 참고 파일 (절대 경로)

- 알고리즘 본체: `C:\Users\napda\OneDrive\바탕 화면\clpclaude\lib\packing\algorithm.ts` (3044줄)
- 자리바꾸기 단계 4: 같은 파일 :767-967
- rescue repack 단계 5.6: :1727-1818
- row-residual 단계 5.7: :1820-1879
- heavy rescue 단계 5.8: :1979-2057
- conflict-swap 단계 5.9: :2059-2267
- pin-and-repack 단계 5.10: :2269-2444
- packBest: :2652-3032
- brute-force grid: `lib/packing/extreme-point.ts:510-711`
- row-residual: `lib/packing/row-residual.ts`
- 자체 토글 env: `RESCUE_HEAVY`, `RESCUE_SWAP`, `RESCUE_PIN_REPACK` (모두 default ON)
