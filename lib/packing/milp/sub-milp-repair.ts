/**
 * Sub-MILP repair (single-box placement) — HiGHS-js 기반.
 *
 * 동기:
 *   휴리스틱 (Stage 5.8 heavy rescue / 5.9 conflict-swap / 5.10 pin-and-repack) 이
 *   못 푼 미배치 unit 에 대해, 기존 placement 를 obstacle 로 두고 MILP 로 정확 풀이
 *   (x, y, z, faceIdx, supporter) 를 탐색.
 *
 * 절대 룰 준수:
 *   - 1.0 strict 무게 룰 (canStackOn pre-filter — supporter 후보에서 weight 위반 박스 제외)
 *   - 점수화 X — objective 는 feasibility 만 (변수 0 minimize)
 *   - 하드코딩 X — cargoId / shipper / sample 명 의존 X. 모든 placement 일반 처리
 *
 * MILP 변수 (per unplaced unit U):
 *   - x, y ∈ [0, innerW/innerL] (연속)
 *   - z 는 supporter 선택 binary 로 결정 (z=0 OR top of supporter j)
 *   - face_f for f in 0..5 (binary, Σ=1)
 *   - s_0 (z=0 placement) + s_j for each canStackOn-pass supporter (binary, Σ=1)
 *   - 각 obstacle Q 별 collision 분리 binary 6개 (a,b,c,d,e,g) — Σ ≥ 1
 *
 * 제약:
 *   - container bounds, doorHeight, weight limit (precondition)
 *   - supporter fit: U footprint 가 supporter footprint 안에
 *   - 충돌: AABB Big-M disjunction
 *
 * Objective: feasibility (minimize 0). HiGHS time_limit 5 초.
 */

import type { ContainerSpec } from "../../../types/container.ts";
import {
  allowedFaces,
  canStackOn,
  effectiveSizeFace,
  withinWeightLimit,
} from "../constraints.ts";
import type {
  ContainerPackState,
  Placement3D,
  UnitItem,
} from "../extreme-point.ts";
import { solveLp } from "./highs-adapter.ts";

const EPS = 0.01;

export interface SubMilpRepairResult {
  placed: boolean;
  reason?: string;
  faceIdx?: number;
  position?: { x: number; y: number; z: number };
  supporterUnitId?: string | null; // null = z=0
  solveTimeMs?: number;
}

/**
 * 단일 미배치 unit U 를 cont 의 기존 layout 에 배치 시도 (MILP 정확 풀이).
 *
 * @param u 미배치 unit
 * @param state 컨테이너 packState (obstacles + supporters)
 * @param spec 컨테이너 spec
 * @param timeLimitSec MILP 시간 제한 (기본 5초)
 * @returns SubMilpRepairResult — placed 면 적용 결과, 아니면 reason
 */
export async function subMilpPlaceSingle(
  u: UnitItem,
  state: ContainerPackState,
  spec: ContainerSpec,
  timeLimitSec = 5,
): Promise<SubMilpRepairResult> {
  // 1) precondition — weight limit
  if (!withinWeightLimit(state.totalWeight, u.weight, spec)) {
    return { placed: false, reason: "weight-limit-exceeded" };
  }

  // 최종 stack top 은 innerHeight (천장) 기준 — doorHeight 는 개별 unit 통과 한정
  const stackHmax = spec.innerHeight;

  // 2) face precompute — allowed faces 의 (eff_w, eff_l, eff_h)
  const allowedFaceList = allowedFaces({
    width: u.width,
    length: u.length,
    height: u.height,
    remarks: u.remarks,
  });
  const faceEffs = allowedFaceList.map((f) => ({
    f,
    ...effectiveSizeFace(
      { width: u.width, length: u.length, height: u.height },
      f,
    ),
  }));
  if (faceEffs.length === 0) {
    return { placed: false, reason: "no-allowed-face" };
  }

  // 3) supporter 후보 — z=0 + canStackOn 통과 placements
  // U 가 topOnly 면 z=0 X
  const supporters: Placement3D[] = state.placements.filter((p) =>
    canStackOn(
      { weightPerUnit: u.weight, remarks: u.remarks },
      { weightPerUnit: p.weight, remarks: p.remarks },
    ),
  );
  // z=0 가능 여부
  const allowZ0 = !u.remarks.topOnly;

  if (supporters.length === 0 && !allowZ0) {
    return { placed: false, reason: "no-legal-supporter-and-no-floor" };
  }

  // 4) MILP LP 문자열 빌드
  // 변수:
  //   x, y, z: continuous
  //   f0..fK: binary (face, K=faceEffs.length-1)
  //   s_floor: binary (z=0)
  //   s_j for each supporter j: binary
  //   For each obstacle Q (state.placements): a_Q, b_Q, c_Q, d_Q, e_Q, g_Q binary
  //
  // Constraints:
  //   Σ f_i = 1
  //   Σ s = 1 (s_floor + Σ s_j)
  //   container bounds (linear with face Σ)
  //   support fit (Big-M with s_j)
  //   collision Big-M (per Q)

  // 변수 이름은 HiGHS LP format 안전 (영문/숫자/_)
  const M = 100000; // Big-M (cm 단위 + 안전)
  const innerW = spec.innerWidth;
  const innerL = spec.innerLength;
  const innerH = spec.innerHeight;

  const lines: string[] = [];

  // --- Objective (feasibility — minimize x — irrelevant 값, 가용성만 확인)
  lines.push("Minimize");
  lines.push(" obj: x");
  lines.push("");

  // --- Subject to
  lines.push("Subject To");

  // Constraint 1: face sum = 1
  const faceTerms = faceEffs.map((_, i) => `f${i}`).join(" + ");
  lines.push(` face_sum: ${faceTerms} = 1`);

  // Constraint 2: supporter sum = 1
  const supTerms: string[] = [];
  if (allowZ0) supTerms.push("s_floor");
  supporters.forEach((_, j) => supTerms.push(`s_${j}`));
  if (supTerms.length === 0) {
    return { placed: false, reason: "no-spot-options" };
  }
  lines.push(` sup_sum: ${supTerms.join(" + ")} = 1`);

  // Constraint 3: eff sizes — eff_w = Σ (face_i * w_i), etc.
  // 여기선 직접 표현 X — 대신 각 (face, supporter) 조합별 단순화 어려움.
  // 대신 conservative big bound: x + max_eff_w ≤ innerW (unconditional).
  // 다중 face 처리는 다른 방식으로:
  //   각 face_i 가 active 일 때 x + eff_w_i ≤ innerW.
  //   Big-M: x + eff_w_i ≤ innerW + M*(1 - f_i)
  faceEffs.forEach((e, i) => {
    // boundW_${i}_active: x - M*nf_i <= innerW - eff_w (when nf_i=0, x <= innerW - eff_w; nf_i=1 inactive)
    lines.push(` boundW_${i}_active: x - ${M}.0 nf${i} <= ${innerW - e.width}`);
    lines.push(` boundL_${i}_active: y - ${M}.0 nf${i} <= ${innerL - e.length}`);
    lines.push(` boundZ_${i}_active: z - ${M}.0 nf${i} <= ${stackHmax - e.height}`);
  });
  // _f_i = 1 - f_i (helper). Encode via _f_i + f_i = 1.
  faceEffs.forEach((_, i) => {
    lines.push(` notf_${i}: f${i} + nf${i} = 1`);
  });

  // Constraint 4: z determination
  //   if s_floor = 1: z = 0
  //   if s_j = 1: z = P_j.position.z + P_j.size.height
  //   Big-M: z ≤ z_target_j + M*(1 - s_j) AND z ≥ z_target_j - M*(1 - s_j)
  if (allowZ0) {
    // zfloor_ub: z - M*ns_floor <= 0 (when ns_floor=0, z<=0; ns_floor=1 inactive)
    lines.push(` zfloor_ub: z - ${M}.0 ns_floor <= 0`);
    lines.push(` notsfloor: s_floor + ns_floor = 1`);
  }
  supporters.forEach((P, j) => {
    const targetZ = P.position.z + P.size.height;
    lines.push(` zsup_${j}_ub: z - ${M}.0 ns_${j} <= ${targetZ}`);
    lines.push(` zsup_${j}_lb: z + ${M}.0 ns_${j} >= ${targetZ}`);
    lines.push(` notssup_${j}: s_${j} + ns_${j} = 1`);
  });

  // Constraint 5: supporter fit — U footprint inside supporter footprint
  //   if s_j = 1 AND f_i = 1: x ≥ P_j.x AND x + eff_w_i ≤ P_j.x + P_j.w
  //   Big-M (AND): "x - M*ns_j - M*nf_i <= P.x + P.w - eff_w_i" (when both active)
  supporters.forEach((P, j) => {
    lines.push(` supX_${j}_lb: x + ${M}.0 ns_${j} >= ${P.position.x}`);
    faceEffs.forEach((e, i) => {
      lines.push(
        ` supX_${j}_${i}_ub: x - ${M}.0 ns_${j} - ${M}.0 nf${i} <= ${P.position.x + P.size.width - e.width}`,
      );
      lines.push(
        ` supY_${j}_${i}_ub: y - ${M}.0 ns_${j} - ${M}.0 nf${i} <= ${P.position.y + P.size.length - e.length}`,
      );
    });
    lines.push(` supY_${j}_lb: y + ${M}.0 ns_${j} >= ${P.position.y}`);
  });

  // Constraint 6: collision with each placement Q (AABB disjunction)
  state.placements.forEach((Q, q) => {
    const qx = Q.position.x;
    const qxe = qx + Q.size.width;
    const qy = Q.position.y;
    const qye = qy + Q.size.length;
    const qz = Q.position.z;
    const qze = qz + Q.size.height;
    // Disjunction binaries — at least one separation axis active
    lines.push(
      ` collDisj_${q}: a_${q} + b_${q} + c_${q} + d_${q} + e_${q} + g_${q} >= 1`,
    );
    // a_q = 1 AND f_i = 1: x + eff_w_i ≤ qx — Big-M (AND): x - M*na_q - M*nf_i <= qx - eff_w_i
    faceEffs.forEach((eff, i) => {
      lines.push(
        ` collA_${q}_${i}: x - ${M}.0 na_${q} - ${M}.0 nf${i} <= ${qx - eff.width}`,
      );
    });
    // b_q = 1: x ≥ qxe
    lines.push(` collB_${q}: x + ${M}.0 nb_${q} >= ${qxe}`);
    // c_q = 1 AND f_i = 1: y + eff_l_i ≤ qy
    faceEffs.forEach((eff, i) => {
      lines.push(
        ` collC_${q}_${i}: y - ${M}.0 nc_${q} - ${M}.0 nf${i} <= ${qy - eff.length}`,
      );
    });
    // d_q = 1: y ≥ qye
    lines.push(` collD_${q}: y + ${M}.0 nd_${q} >= ${qye}`);
    // e_q = 1 AND f_i = 1: z + eff_h_i ≤ qz
    faceEffs.forEach((eff, i) => {
      lines.push(
        ` collE_${q}_${i}: z - ${M}.0 ne_${q} - ${M}.0 nf${i} <= ${qz - eff.height}`,
      );
    });
    // g_q = 1: z ≥ qze
    lines.push(` collG_${q}: z + ${M}.0 ng_${q} >= ${qze}`);
    lines.push(` nota_${q}: a_${q} + na_${q} = 1`);
    lines.push(` notb_${q}: b_${q} + nb_${q} = 1`);
    lines.push(` notc_${q}: c_${q} + nc_${q} = 1`);
    lines.push(` notd_${q}: d_${q} + nd_${q} = 1`);
    lines.push(` note_${q}: e_${q} + ne_${q} = 1`);
    lines.push(` notg_${q}: g_${q} + ng_${q} = 1`);
  });

  lines.push("");
  // --- Bounds
  lines.push("Bounds");
  lines.push(` 0 <= x <= ${innerW}`);
  lines.push(` 0 <= y <= ${innerL}`);
  lines.push(` 0 <= z <= ${innerH}`);
  lines.push("");

  // --- Binary
  lines.push("Binary");
  faceEffs.forEach((_, i) => {
    lines.push(` f${i}`);
    lines.push(` nf${i}`);
  });
  if (allowZ0) {
    lines.push(" s_floor");
    lines.push(" ns_floor");
  }
  supporters.forEach((_, j) => {
    lines.push(` s_${j}`);
    lines.push(` ns_${j}`);
  });
  state.placements.forEach((_, q) => {
    [`a_${q}`, `b_${q}`, `c_${q}`, `d_${q}`, `e_${q}`, `g_${q}`].forEach((v) => {
      lines.push(` ${v}`);
      lines.push(` n${v}`);
    });
  });
  lines.push("");
  lines.push("End");

  const lpString = lines.join("\n");

  // Debug dump
  if (typeof process !== "undefined" && process.env && process.env.MILP_DUMP) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.MILP_DUMP, lpString);
  }

  // 5) Solve
  const t0 = Date.now();
  const sol = await solveLp(lpString, timeLimitSec);
  const solveTimeMs = Date.now() - t0;

  if (sol.Status !== "Optimal") {
    return {
      placed: false,
      reason: `MILP-${sol.Status}`,
      solveTimeMs,
    };
  }

  // 6) 결과 추출
  const xVal = sol.Columns.x?.Primal ?? 0;
  const yVal = sol.Columns.y?.Primal ?? 0;
  const zVal = sol.Columns.z?.Primal ?? 0;
  let chosenFace = -1;
  faceEffs.forEach((_, i) => {
    if ((sol.Columns[`f${i}`]?.Primal ?? 0) > 0.5) chosenFace = i;
  });
  if (chosenFace < 0) {
    return { placed: false, reason: "no-face-chosen", solveTimeMs };
  }
  let chosenSupporter: Placement3D | null = null;
  supporters.forEach((P, j) => {
    if ((sol.Columns[`s_${j}`]?.Primal ?? 0) > 0.5) chosenSupporter = P;
  });

  const eff = faceEffs[chosenFace];

  // 7) 결과 검증 — float 오차로 룰 위반 가능. EPS 안에 들어왔는지 재검증.
  if (xVal + eff.width > innerW + EPS) {
    return { placed: false, reason: "boundary-W-violation", solveTimeMs };
  }
  if (yVal + eff.length > innerL + EPS) {
    return { placed: false, reason: "boundary-L-violation", solveTimeMs };
  }
  if (zVal + eff.height > stackHmax + EPS) {
    return { placed: false, reason: "boundary-H-violation", solveTimeMs };
  }

  // 8) commit — placement push
  const newPlacement: Placement3D = {
    unitId: u.unitId,
    cargoId: u.cargoId,
    shipper: u.shipper,
    bookingNo: u.bookingNo,
    name: u.name,
    cargoType: u.cargoType,
    cfsCbm: u.cfsCbm,
    position: { x: xVal, y: yVal, z: zVal },
    size: { width: eff.width, length: eff.length, height: eff.height },
    faceIdx: eff.f,
    rotated: eff.width !== u.width || eff.length !== u.length,
    weight: u.weight,
    remarks: u.remarks,
    layer: zVal <= EPS ? "bottom" : "top",
  };
  state.placements.push(newPlacement);
  state.totalWeight += u.weight;
  state.visualCbm += (eff.width * eff.length * eff.height) / 1_000_000;
  state.candidates.push(
    { x: xVal + eff.width, y: yVal, z: zVal },
    { x: xVal, y: yVal + eff.length, z: zVal },
    { x: xVal, y: yVal, z: zVal + eff.height },
  );

  return {
    placed: true,
    faceIdx: eff.f,
    position: { x: xVal, y: yVal, z: zVal },
    supporterUnitId: chosenSupporter ? (chosenSupporter as Placement3D).unitId : null,
    solveTimeMs,
  };
}
