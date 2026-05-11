# CLP MILP / CP 형식화 — clpclaude 컨테이너 적재 (3D-BPP with Side Constraints)

> 목적: 현재 휴리스틱 (extreme-point + LDF + heaviest + footprint-cluster + heavy rescue + conflict-swap + pin-and-repack) 이 풀지 못하는 잔여 미배치(예: 3ST SG sg3-11 1박스)를 정확 해법(exact 또는 시간-제한 best-so-far)으로 보완하기 위한 수학적 형식화 + solver 통합 plan.
>
> 절대 룰 (코드 수정 시 반드시 유지):
>
> 1. 위 박스 무게 ≤ 아래 박스 무게 (1.0 strict, STACK_WEIGHT_TOLERANCE = 1.0, lib/packing/constraints.ts:124)
> 2. cargoId atomic — 한 cargoId 의 모든 unit 은 같은 컨테이너
> 3. bookingNo atomic — 한 booking 의 모든 cargo 는 같은 컨테이너
> 4. noStacking / heavierBelow / topOnly / orientation (free | long_along_length | fixed)
> 5. 충돌 금지(AABB), boundary, doorHeight, weight limit (ContainerSpec.maxWeightKg)
> 6. 점수화 금지 — lex comparator 만 (미배치 → B1 → B2 → 입고완료 → 충전률 → 균형)
> 7. 하드코딩 금지 — generic 모델, sample/cargoId/shipper 분기 X
>
> 작성: 2026-05-08, architect 에이전트.

---

## 1. 문제 분류 — 학술적 위치

이 문제는 **3D Bin Packing Problem (3D-BPP) with side constraints** 의 변형이다. 표준 3D-BPP 에는 없는 추가 사이드 제약:

| 제약 | 학술 명칭 | 영향 |
|---|---|---|
| 6면 회전 + orientation | Multi-orientation BPP | binary face 변수 6개 |
| 받침 (full support) | Stable / Non-floating BPP | 4 corner + center 5점 cover 제약 |
| 적재 무게 룰 (top ≤ bottom) | Load-bearing BPP | pairwise stacking constraint |
| 컨테이너 중량 한도 | Weighted BPP | linear sum |
| 도어 높이 | Access constraint | 입구 통과 조건 |
| cargoId atomic | Group / cluster constraint | "all units → same bin" |
| bookingNo atomic | 위와 동일, 한 단계 위 | "all cargoIds with same booking → same bin" |
| 미배치 허용 | Soft-feasible BPP | objective 에 placed-flag 도입 |

**복잡도**: 표준 3D-BPP 도 NP-hard. 여기에 회전·받침·중량룰까지 더해진 변형은 **strongly NP-hard**. 그러므로 exact MILP 는 작은 인스턴스(약 30 unit, 1~2 컨테이너)에서만 합리적 시간에 풀린다.

**시사점**: 전체를 MILP 로 푸는 건 비현실적. **휴리스틱 + MILP hybrid** (현재 휴리스틱이 깐 자리는 고정, 미배치만 sub-MILP) 가 유일하게 production 가능한 길.

---

## 2. 표기 (Notation)

### 2.1 인덱스 / 집합

- i ∈ I — unit 인덱스 (한 unit = 한 박스 한 개. expandToUnits() 출력. lib/packing/algorithm.ts:123)
- c ∈ C — cargoId. 각 unit i 는 정확히 한 cargoId c(i) 에 속한다.
- b ∈ B — bookingNo. 각 cargoId c 는 정확히 한 booking b(c) 에 속한다 (bookingNo 없으면 cargoId 자체가 1-원소 booking).
- k ∈ K — 컨테이너 인덱스 (1..N, decideContainers() 출력)
- f ∈ F = {0,1,2,3,4,5} — 6면 회전 (effectiveSizeFace(), lib/packing/constraints.ts:31)
- F_i ⊆ F — i 의 허용 면 (allowedFaces(item) 결과. orientation 제한 반영)

### 2.2 데이터 (상수)

- W_i, L_i, H_i — unit i 의 원본 사이즈 (cm)
- w_if, l_if, h_if — unit i 가 face f 일 때 effective 사이즈 (effectiveSizeFace)
- m_i — unit i 의 무게 (kg)
- V_i = W_i × L_i × H_i / 10^6 — m³
- IW_k, IL_k, IH_k, DH_k, MW_k — 컨테이너 k 의 innerWidth, innerLength, innerHeight, doorHeight, maxWeightKg (ContainerSpec)
- noStack_i, topOnly_i, heavierBelow_i — Remark flag

### 2.3 결정 변수 (Decision Variables)

#### Continuous (좌표)

- x_i, y_i, z_i ∈ R+ — unit i 의 (가로, 길이, 높이) 위치. 단위 cm.

#### Binary (분배 / 회전 / 순서)

- p_ik ∈ {0,1} — unit i 가 컨테이너 k 에 들어갔는가
- q_i ∈ {0,1} — unit i 가 어디든 들어갔는가 (= Σ_k p_ik). 미배치면 0.
- r_if ∈ {0,1} — unit i 가 face f 회전. Σ_{f∈F_i} r_if = q_i
- α_ij, β_ij, γ_ij, δ_ij, ε_ij, ζ_ij ∈ {0,1} — pair (i,j), i<j 의 6 방향 분리 (left, right, behind, front, below, above). 비충돌(non-overlap) Big-M 인코딩용.
- s_ij ∈ {0,1} — unit j 가 unit i 위에 직접 받쳐진다 (j supports i). 받침 제약용.

#### Container atomic 변수

- Pc_k ∈ {0,1} — cargoId c 가 컨테이너 k 에 들어갔는가
- Bb_k ∈ {0,1} — bookingNo b 가 컨테이너 k 에 들어갔는가

---

## 3. 제약 (Constraints)

### 3.1 분배 일관성

```
(C1)  Σ_{f ∈ F_i} r_if = q_i                  ∀i ∈ I
(C2)  q_i = Σ_{k ∈ K} p_ik                    ∀i ∈ I
(C3)  q_i ∈ {0,1}                              ∀i ∈ I
```

### 3.2 cargoId atomic (절대 룰 #2)

```
(C4)  p_ik = Pc_k                              ∀i ∈ I, k ∈ K, c = c(i)
(C5)  Σ_k Pc_k ≤ 1                             ∀c ∈ C
```

→ 한 cargo 의 모든 unit 은 같은 k. cargo 자체는 0 또는 1 컨테이너.

### 3.3 bookingNo atomic (절대 룰 #3)

```
(C6)  Pc_k = Bb_k                              ∀c, k, b = b(c)
(C7)  Σ_k Bb_k ≤ 1                             ∀b ∈ B
```

→ 같은 booking 의 모든 cargoId 가 같은 컨에. (미배치 허용 시 0 가능 — Σ ≤ 1)

### 3.4 컨테이너 boundary + 회전 사이즈

face f 가 선택되면 effective 사이즈 = (w_if, l_if, h_if). 각 차원에 대해:

```
(C8)   x_i + Σ_f r_if · w_if ≤ Σ_k p_ik · IW_k + (1 − q_i) · M_x
(C9)   y_i + Σ_f r_if · l_if ≤ Σ_k p_ik · IL_k + (1 − q_i) · M_y
(C10)  z_i + Σ_f r_if · h_if ≤ Σ_k p_ik · IH_k + (1 − q_i) · M_z
(C11)  x_i, y_i, z_i ≥ 0
```

→ 미배치(q_i=0)일 때는 좌표 의미 없음 (Big-M 으로 풀어줌).

### 3.5 도어 높이 (입구 통과)

box 의 top z 가 도어 높이 안에 들어가야 적재 가능. 보수적 형식화:

```
(C12)  z_i + Σ_f r_if · h_if ≤ Σ_k p_ik · DH_k + (1 − q_i) · M_z
```

(주: 현재 extreme-point.ts:222 의 tryPlaceUnit 은 innerHeight 만 체크. doorHeight 강제는 옵션 enforceDoorHeight: bool 로.)

### 3.6 컨테이너 중량 한도 (절대 룰 #5)

```
(C13)  Σ_i p_ik · m_i < MW_k                   ∀k ∈ K
```

(< 는 strict. MILP 는 strict 미지원 → Σ p_ik · m_i ≤ MW_k − ε, ε = 1 kg 권장. lib/packing/constraints.ts:160.)

### 3.7 비충돌 (Non-overlap, AABB pairwise — Chen-Lee-Shen 1995 형식)

unit i, j (i < j) 가 같은 컨테이너에 있을 때만 비충돌 강제. 6 방향 disjunction (둘 중 하나 = 1):

```
(C14a)  x_i + Σ_f r_if · w_if ≤ x_j + M·(1 − α_ij) + M·(2 − p_ik − p_jk)
(C14b)  x_j + Σ_f r_jf · w_jf ≤ x_i + M·(1 − β_ij) + M·(2 − p_ik − p_jk)
(C14c)  y_i + Σ_f r_if · l_if ≤ y_j + M·(1 − γ_ij) + M·(2 − p_ik − p_jk)
(C14d)  y_j + Σ_f r_jf · l_jf ≤ y_i + M·(1 − δ_ij) + M·(2 − p_ik − p_jk)
(C14e)  z_i + Σ_f r_if · h_if ≤ z_j + M·(1 − ε_ij) + M·(2 − p_ik − p_jk)
(C14f)  z_j + Σ_f r_jf · h_jf ≤ z_i + M·(1 − ζ_ij) + M·(2 − p_ik − p_jk)
(C14g)  α_ij + β_ij + γ_ij + δ_ij + ε_ij + ζ_ij ≥ 1   if p_ik = p_jk = 1
```

- M ≥ max{IW, IL, IH} (예: 1300 cm)
- 위 7 제약을 ∀ i<j ∈ I, ∀ k 에 대해 작성.

**비용**: |I|² × 6 binary + 7 inequality 제약. 60 unit 시 1770 pair × 7 ≈ 12K 제약. solver 에 부담.

### 3.7.1 도어-측 cargoId 인접성 (선택, Stage 4.6 long-axis-anchor 대체)

장축 막대형(311×15×15 같은) cargoId 가 컨테이너 안쪽 끝(y = innerLength − maxL) 에 박히도록 옵션 제약:

```
(C15)  y_i ≥ (IL_k − max_i Σ_f r_if · l_if) · p_ik   ∀i ∈ {long-axis cargoIds}
```

- long-axis cargoId 는 lib/packing/long-axis-anchor.ts 의 활성 조건 그대로:
  - 최대 변 ≥ 300 cm
  - 컨 길이 × 25% 이상
  - min/max ≤ 0.25 (slender rod)
- **하드코딩 회피**: cargoId 명시 X, 위 3 조건만 체크해서 long-axis cargoId 집합 자동 산출.

### 3.8 받침 (Support, 절대 룰 #4)

z > 0 인 unit 은 아래에 supporter 필요:

```
(C16)  z_i ≤ Σ_{j ≠ i} s_ji · (z_j + Σ_f r_jf · h_jf) + M · (1 − q_i)        ∀i, z_i > 0
(C17)  s_ji ⇒ "j 의 top z = i 의 bottom z" AND "(x,y) footprint 70% overlap"
(C18)  s_ji ≤ p_jk AND s_ji ≤ p_ik AND k(j)=k(i)
```

→ MILP 직접 인코딩 어려움 (footprint overlap 은 회전·좌표 모두 변수). **실무 권장**: 받침 제약은 CP 또는 lazy-constraint 로 분리.

### 3.9 Stack 무게 룰 (절대 룰 #1, STACK_WEIGHT_TOLERANCE = 1.0)

s_ji = 1 (j 가 i 를 받침) 이면 m_j ≥ m_i. 룰 #1 strict (등가 OK, 초과 금지):

```
(C19)  s_ji ≤ 0    if m_j < m_i                ∀i ≠ j
```

→ 무게 정보 누락(0) 일 때만 heavierBelow 플래그 폴백.

### 3.10 noStacking / topOnly

- noStacking_j = true ⇒ Σ_i s_ji = 0 (다단금지 박스 위에 아무도 못 옴)
- topOnly_i = true ⇒ z_i ≥ ε · q_i (바닥 z = 0 금지)

```
(C20)  Σ_i s_ji ≤ M · (1 − noStacking_j)       ∀j
(C21)  z_i ≥ ε · q_i                            ∀i with topOnly_i = true
```

### 3.11 Orientation

- orientation = "fixed" ⇒ r_i0 = q_i (오직 face 0)
- orientation = "long_along_length" ⇒ Σ_{f∈F_long} r_if = q_i (F_long = {f : l_if ≥ w_if})
- orientation = "free" ⇒ Σ_{f∈{0..5}} r_if = q_i (이미 (C1))

→ F_i 정의에 사전 흡수.

---

## 4. 목적 함수 — Lex Priority (절대 룰 #6, 점수 합산 금지)

**핵심**: 가중치 합산 점수 X. lex 우선순위 그대로 인코딩. 두 가지 옵션:

### 옵션 A — Hierarchical Solve (권장, 순수 lex)

5 라운드 순차 solve. 각 라운드에서 이전 라운드 최적값을 제약으로 고정.

```
Round 1: minimize  U  =  |I| − Σ_i q_i      (미배치 unit 수)
         → U* 도출
         add constraint:  |I| − Σ_i q_i = U*

Round 2: minimize  Σ B1 violations
         (B1 = cargoId 쪼개기. 모델 (C5) 가 Σ_k Pc_k ≤ 1 강제하므로 강제 0)
         → 모델 형식화상 (C5) 로 강제 0 보장 → 라운드 스킵 가능

Round 3: minimize  Σ B2 violations
         (B2 = booking 쪼개기. (C7) 에 의해 강제 0)
         → 라운드 스킵 가능

Round 4: minimize − Σ_i q_i · cfsCompleted_i
         (입고완료 화물 마감 우선)

Round 5: maximize Σ_k (visualCbm_k / maxCbm_k)  (충전률)
         또는 minimize (max_k Σ V_i p_ik − min_k Σ V_i p_ik)  (균형)
```

**장점**: 점수 합산 0 — 절대 룰 #6 완벽 준수.
**단점**: 다중 solve. 한 라운드 timeout 시 그 라운드 best-so-far 만 가지고 다음 라운드 진입.

### 옵션 B — Big-Lex Weight (사실상 lex, 절대 룰 충돌 위험 — 권장 X)

```
minimize  10^12 · U + 10^9 · B1 + 10^6 · B2 + 10^3 · (−completed) + (−fillRate)
```

**거부 사유**: 절대 룰 #6 (점수 합산 사용 금지) 직접 위반. 가중치가 극단적이라 수학적으로 lex 와 동치이지만, **사용자 룰 텍스트 문언 위반**. 옵션 A 채택.

---

## 5. CP (Constraint Programming) 형식화 — 대안

OR-Tools cp_model.CpModel 또는 IBM CP Optimizer.

### 5.1 핵심 변수

- face[i] ∈ IntVar(0..5) — face 인덱스
- cont[i] ∈ IntVar(0..N) — 컨테이너 인덱스 (0 = 미배치)
- x[i], y[i], z[i] ∈ IntVar(0..maxDim)
- wEff[i] = Element(face[i], [w_i^0..w_i^5])  (마찬가지로 lEff, hEff)

### 5.2 핵심 제약

**no_overlap_2d/3d (interval)**:

```python
x_int = [model.NewOptionalIntervalVar(x[i], wEff[i], x[i]+wEff[i], q_i) ...]
y_int = [...]
z_int = [...]
model.AddNoOverlap2D(x_int, y_int)
```

(주: OR-Tools AddNoOverlap2D 만 직접 지원. 3D 는 AddNoOverlap x3 + 분리 disjunction. 또는 reified Bool 로 직접 인코딩.)

**Cumulative (중량 한도)**:

```python
model.Add(sum(present[i,k] * m_i for i) <= MW_k - 1)
```

**Atomic group**:

```python
for c in C:
    units_in_c = [i for i in I if c(i) == c]
    target = model.NewIntVar(0, N, f"cont_c_{c}")
    for i in units_in_c:
        model.Add(cont[i] == target).OnlyEnforceIf(q_i_on)
```

### 5.3 Lex objective

OR-Tools CP-SAT 는 lex objective 직접 미지원. 동일하게 hierarchical solve. CP Optimizer 는 IloObjective lex 지원.

### 5.4 CP vs MILP — 이 문제에서

| 측면 | MILP | CP |
|---|---|---|
| Non-overlap | Big-M disjunction (느림) | no_overlap_2d native (**빠름**) |
| 회전 (face) | binary r_if + indicator | Element (직관적) |
| 받침 footprint overlap | 거의 인코딩 불가 | callback / lazy constraint 가능 |
| Atomic group | 자연스러움 | 자연스러움 |
| Lex objective | hierarchical | hierarchical |
| **결론** | 작은 인스턴스 + 정확해 | **큰 인스턴스 + 빠른 best-so-far** |

→ 권장: **CP (OR-Tools CP-SAT)** 가 이 문제에 더 적합. no_overlap_2d 가 pairwise Big-M 보다 propagation 강력.

---

## 6. Solver 후보 — 통합 가능성 매트릭스

### 6.1 매트릭스

| Solver | 라이선스 | JS/TS 바인딩 | 통합 방식 | non-overlap 2D/3D | 성능 (≤30 unit) | 권장도 |
|---|---|---|---|---|---|---|
| **OR-Tools CP-SAT** | Apache 2.0 | 직접 X | Python 자식 프로세스 / WASM (실험) | native | 5/5 | **5/5** |
| **OR-Tools MILP (CBC)** | Apache 2.0 | 직접 X | 위 동일 | Big-M 인코딩 | 3/5 | 3/5 |
| **HiGHS** | MIT | highs-js (WASM npm) | npm install | Big-M | 3/5 | 4/5 |
| **GLPK.js** | GPL | glpk.js (WASM npm) | npm install | Big-M | 2/5 | 2/5 |
| **javascript-lp-solver** | MIT | pure JS | npm install | Big-M, simplex | 1/5 | 1/5 |
| **SCIP** | Apache 2.0 | 없음 | spawn 자식 프로세스 | Big-M | 4/5 | 3/5 |
| **Gurobi** | Commercial | 없음 (REST API) | API + license | native lazy | 5/5 | 1/5 (license 비용) |
| **CPLEX** | Commercial | 없음 | API | native | 5/5 | 1/5 |
| **CP Optimizer (IBM)** | Commercial | 없음 | API | native lex | 5/5 | 1/5 |

### 6.2 Next.js 15 + TypeScript 통합 옵션

#### 옵션 P1 — HiGHS WASM (in-process, JS only, 즉시 가능)

- npm i highs (https://github.com/lovasoa/highs-js)
- WASM 로드 → MILP 모델 LP 형식 string 으로 만들어 풀이
- **장점**: 외부 의존성 0. Vercel/Edge 배포 가능. 추가 인프라 X.
- **단점**: SAT 풀이 약함, 약 30 binary 변수까지 합리적. 60+ unit 시 timeout 가능.
- **위치**: lib/packing/milp/highs-adapter.ts 신설.

#### 옵션 P2 — OR-Tools CP-SAT (Python 자식 프로세스)

- 서버 환경(Node.js, dev-machine)에 Python + ortools 설치
- TS 에서 child_process.spawn("python", ["solve.py"]) + JSON stdin/stdout
- **장점**: 이 문제의 가장 강력한 풀이. no_overlap_2d native.
- **단점**: 외부 런타임 (Vercel serverless 환경에선 동작 안 함 — 자체 서버나 별도 worker 필요).
- **위치**: scripts/cp-sat-pack.py + lib/packing/milp/cp-sat-adapter.ts.

#### 옵션 P3 — javascript-lp-solver (즉시, 약함)

- Pure JS, no WASM — 가장 빠른 통합
- **단점**: simplex 기반, B&B 약함. 50 binary 변수 timeout 흔함. **prototype 용으로만**.

#### 옵션 P4 — REST API (Gurobi cloud 등)

- 비용 + 데이터 송신 부담. **거부**.

### 6.3 권장

| 단계 | Solver | 이유 |
|---|---|---|
| **PoC (1주차)** | HiGHS (P1) | npm 한 줄, 즉시 실험. 작은 sub-MILP 검증. |
| **Production (2~4주차)** | CP-SAT (P2) | 자체 서버 환경에서만 운영. |
| **fallback** | 휴리스틱 단독 | solver timeout / Vercel 환경 |

---

## 7. 점진 도입 전략 (Hybrid)

### 7.1 핵심 철학

> 휴리스틱이 **대부분 이미 잘 풀고 있다**. MILP 는 "휴리스틱이 못 푼 마지막 1~2 박스" 만 정확 해법으로 보완. 전체를 MILP 로 푸는 건 비현실 (NP-hard).

### 7.2 4 단계 점진 도입

#### Stage 0 — 현 상태 (Baseline)

- 5 샘플 중 4 통과, 3ST SG 1박스 미배치. 그대로 유지.

#### Stage 1 — Sub-MILP Repair (1~2 주, 작게)

**언제 발동**: packBest() 결과가 unplaced.length > 0 인 케이스만.

**입력 축소** (모델 사이즈 제약):
- 미배치 unit U_unp 만 변수
- 그 unit 의 cargoId 와 같은 booking 에 속한 placed unit 들도 같이 (atomic 룰 풀이) U_anchor 로 추가
- 기타 placed unit 은 **fixed obstacle** (좌표·사이즈 상수 박스). 변수화 X.
- → 변수 갯수 기준: |U_unp| + |U_anchor| ≤ 30~50 권장.

**모델**:
- 컨테이너 전체에서 obstacle 와 충돌 없이 U_unp ∪ U_anchor 재배치
- 목적: 옵션 A round 1 — minimize unplaced count
- timeout: 30초 권장 (Vercel 환경이면 5초)
- best-so-far: timeout 시 부분 해 채택

**파일 위치**:
```
lib/packing/milp/
  ├─ sub-milp-repair.ts          (orchestrator)
  ├─ highs-adapter.ts            (P1 어댑터)
  ├─ model-builder.ts            (CargoSpec → MILP model)
  └─ obstacle-fixed-box.ts       (placed → fixed AABB)
```

**호출 위치 (algorithm.ts)**:
```
Stage 5.7 (row-residual fitting) 이후, Stage 6 (swap balance) 이전 hook.
조건: unplaced.length > 0 AND options.subMilpRepair.enabled (default false)
```

**왜 default off**: 절대 룰 #6 (점수 합산 금지) + 회귀 0건 보장 (절대 룰 #10) 때문. **회귀 테스트 통과 후** 점진 활성.

#### Stage 2 — Per-Container Tight Repack (2~4 주)

**언제 발동**: Stage 1 후에도 unplaced > 0 OR cbmFillRate < 80% 인 컨테이너가 있을 때.

**입력 축소**:
- **한 컨테이너만** 풀이. 그 컨에 들어간 unit 전체 (약 30~60)을 변수화.
- 다른 컨테이너는 건드리지 않음.

**목적**:
- Round 1: minimize unplaced
- Round 2 (옵션): maximize visualCbm (충전률)

**비용**: 한 컨 풀이 약 60 unit + 6 face × 60 ≈ 360 binary. CP-SAT 30 초 timeout 합리적.

#### Stage 3 — Cross-Container Re-balance (4~8 주, 실험적)

**언제 발동**: 사용자 명시 (options.milp.crossBalance: true). default off.

- 모든 unit 변수화. 컨 갯수 고정 (decideContainers 결과 그대로).
- 목적: round 1 → unplaced, round 2 → balance penalty.
- 비용: 200 unit × 6 face × N container = 수천 binary. timeout 5분.

#### Stage 4 — Decision Variables 확장 (8 주+, 가장 큰 변경)

- decideContainers() 자체를 MILP 화: 컨테이너 갯수 + 타입 (20FT/40FT) 도 변수.
- 목적 round 1 → 미배치, round 2 → 컨테이너 수, round 3 → safety margin.
- **YAGNI**: 현재 decideContainers lex comparator 가 잘 동작 중. 우선순위 낮음.

---

## 8. Timeout Guard / Best-so-far 패턴

```typescript
function runSubMilpWithBudget(
  model: MilpModel,
  budgetMs: number,
): MilpResult {
  const start = Date.now();
  const result = solver.solve(model, { timeoutMs: budgetMs });
  if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
    return result;
  }
  return { status: "ROLLBACK", placements: [] };
}
```

**핵심 가드**:
1. 시간 예산 초과 시 휴리스틱 결과를 절대 손상시키지 않음 (스냅샷 복원).
2. solver FEASIBLE (미배치 줄음) 만 commit, INFEASIBLE 또는 UNKNOWN 은 롤백.
3. lex round 도중 timeout 시 그 라운드 best-so-far 채택 후 다음 라운드 진입.
4. 회귀 0건 보장 (절대 룰 #10): MILP 활성/비활성 양쪽 회귀 매트릭스 통과 필수.

---

## 9. 절대 룰 검증 (Self-Audit)

| 절대 룰 | 모델 표현 | 검증 |
|---|---|---|
| #1 무게 룰 (top ≤ bottom × 1.0) | (C19) s_ji ⇒ m_j ≥ m_i | OK strict, tolerance 1.0 그대로 |
| #2 cargoId atomic | (C4) (C5) | OK Σ_k Pc_k ≤ 1 |
| #3 booking atomic | (C6) (C7) | OK Σ_k Bb_k ≤ 1 |
| #4 noStacking/heavierBelow/topOnly/orientation | (C20) (C21) F_i 흡수 (C19) | OK |
| #5 충돌·boundary·doorHeight·weight | (C8-C13) (C14) | OK doorHeight 옵션화 |
| #6 점수화 금지 | 옵션 A hierarchical solve | OK 옵션 B 거부 명시 |
| #7 하드코딩 금지 | cargoId/shipper/sample 분기 X. long-axis 식별은 3 조건 함수 | OK |

→ 7/7 통과.

---

## 10. 다음 구현 단계 (Concrete Roadmap)

### 10.1 Sprint 1 — 모델 빌더 + HiGHS adapter (1주)

- [ ] lib/packing/milp/model-builder.ts — CargoSpec[] + ContainerSpec[] → 추상 모델 (variables, constraints, objective).
- [ ] lib/packing/milp/highs-adapter.ts — npm highs 로 풀이.
- [ ] lib/packing/milp/model-builder.test.ts — 3 unit × 1 container 사이즈 0 충돌 검증.
- [ ] scripts/milp-poc-3st-sg.mjs — 3ST SG sg3-11 1박스 미배치 케이스만 sub-MILP 풀이.

### 10.2 Sprint 2 — 휴리스틱 hook + 회귀 가드 (1주)

- [ ] lib/packing/algorithm.ts Stage 5.7 직후 sub-MILP repair hook (default off).
- [ ] options.subMilpRepair.enabled 플래그.
- [ ] scripts/verify-*-with-milp.mjs — 5 샘플 회귀 매트릭스 (MILP on/off 양쪽).
- [ ] timeout guard + 롤백 검증.

### 10.3 Sprint 3 — CP-SAT (Python) 어댑터 (2주)

- [ ] scripts/cp-sat-pack.py — JSON stdin/stdout, OR-Tools CP-SAT.
- [ ] lib/packing/milp/cp-sat-adapter.ts — child_process.spawn.
- [ ] HiGHS 로 못 풀던 큰 sub-MILP (≥40 unit) CP-SAT 으로 재시도.
- [ ] 환경 가드: Python 미설치 시 silent fallback to HiGHS.

### 10.4 Sprint 4 — Per-container tight repack (Stage 2, 2주)

- [ ] 컨테이너 단위 sub-problem 빌더.
- [ ] cbmFillRate < 80% 트리거.
- [ ] 회귀 매트릭스 갱신.

### 10.5 Sprint 5 — 사용자 UI 옵션 (1주)

- [ ] 입력 폼에 "정확 풀이 (실험)" 토글.
- [ ] 결과 화면에 "MILP 보강 X 박스 회수" 통계.
- [ ] 한국어 비유: "기본 적재 후 빈 자리 정밀 채우기".

---

## 11. 위험 + 트레이드오프

| 항목 | 위험 | 완화 |
|---|---|---|
| MILP timeout | 큰 인스턴스에서 풀이 실패 | sub-MILP (입력 축소) + best-so-far + 롤백 |
| 외부 의존성 (Python, OR-Tools) | 배포 환경 (Vercel) 동작 X | HiGHS WASM 1차, CP-SAT 옵션화 |
| 회귀 발생 | 절대 룰 #10 위반 | default off + on/off 양쪽 회귀 매트릭스 |
| 절대 룰 #6 위반 | 점수 합산 옵션 B 사용 시 | 옵션 A (hierarchical) 만 채택 |
| 하드코딩 (절대 룰 #7) | sample/cargoId 분기 추가 위험 | 모델 빌더 generic, 활성 조건은 3 임계값 |
| 사용자 비개발자 | "MILP" 같은 영어 용어 | UI 라벨 "정확 풀이", "정밀 채우기" 한국어 |
| 점수 lex 우선순위 변동 | 외부 주입 어려움 | options 으로 노출 (round 순서 외부 주입) |

---

## 12. References (학술 + 코드)

### 학술

- Chen, C-S., Lee, S-M., Shen, Q-S. (1995). **An analytical model for the container loading problem**. EJOR. — pairwise Big-M non-overlap 형식 origin.
- Crainic, T. G., Perboli, G., Tadei, R. (2008). **Extreme Point-Based Heuristics for Three-Dimensional Bin Packing**. INFORMS JOC. — 현재 extreme-point.ts 의 학술 근거.
- Fasano, G. (2014). **Solving Non-standard Packing Problems by Global Optimization and Heuristics**. SpringerBriefs. — load-bearing + stability 형식화.
- Bortfeldt, A., Wäscher, G. (2013). **Constraints in container loading – A state-of-the-art review**. EJOR. — side-constraint 분류.

### 코드 (현재 프로젝트)

- lib/packing/algorithm.ts:123 — expandToUnits (unit 분해)
- lib/packing/algorithm.ts:packBest — 매트릭스 휴리스틱
- lib/packing/extreme-point.ts:222 — tryPlaceUnit (휴리스틱 본체)
- lib/packing/extreme-point.ts:510 — tryPlaceUnitBruteForce (5cm grid scan)
- lib/packing/constraints.ts:31 — effectiveSizeFace
- lib/packing/constraints.ts:62 — allowedFaces
- lib/packing/constraints.ts:124 — STACK_WEIGHT_TOLERANCE = 1.0
- lib/packing/constraints.ts:134 — canStackOn
- lib/packing/constraints.ts:160 — withinWeightLimit
- lib/packing/containers.ts:10 — CONTAINERS 스펙
- lib/packing/footprint-cluster.ts — 발바닥 사전 묶음 (Stage 4.5)
- lib/packing/long-axis-anchor.ts — 장축 막대형 (Stage 4.6)
- lib/packing/row-residual.ts — 행 잔여공간 (Stage 5.7)
- docs/algorithm-pipeline.md — 전체 파이프라인 한국어 문서

---

## 13. 결론 (한 줄)

> **HiGHS WASM 으로 sub-MILP 보강 PoC → 회귀 통과 후 CP-SAT 옵션 추가**. 전체 MILP 가 아닌 **휴리스틱이 못 푼 마지막 박스만** 풀이. lex objective 는 hierarchical solve (옵션 A) — 절대 룰 #6 (점수 합산 금지) 준수.
