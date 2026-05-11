/**
 * sg3-11 성안기계 (150×80×68, 750kg) 미배치 정밀 분석.
 *
 * 출력:
 *   1) 현재 lightMode 결과: sg3-11 placed/unplaced
 *   2) sg3-11 이 어디에 들어갈 수 있었나 — 모든 placement P 에 대해:
 *      - z=0 자리 후보 (free space)
 *      - z>0 (P 위에) 후보:
 *        - footprint 매칭 (150×80 ≤ P.size, 회전 포함)
 *        - container boundary 안
 *        - collision 없음 (다른 placement 와)
 *        - support 4모서리 (단순화: P 안에 들어가면 OK)
 *        - **weight 비교**: P.weight vs 750kg
 *          → 1.0 strict: 거부 (P.weight < 750)
 *          → 1.5: 통과 (P.weight × 1.5 ≥ 750 → P.weight ≥ 500)
 *   3) 분류:
 *      - 1.0 통과 후보: P.weight ≥ 750kg
 *      - 1.5 통과·1.0 거부 후보: 500 ≤ P.weight < 750
 *      - 1.5 도 거부: P.weight < 500
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0,
  length: r.lengthCm ?? 0,
  height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null,
  aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: {
    noStacking: !!r.noStacking,
    topOnly: !!r.topOnly,
    orientation: r.orientation || "free",
    heavierBelow: !!r.heavierBelow,
  },
}));

const r = packBest(cargoes, undefined, { lightMode: true });
console.log(`pack 결과: ${r.containers.length} 컨테이너, unplaced=${r.unplaced.length}`);

// sg3-11 위치 찾기
let sg11Placed = null;
for (const [ci, c] of r.containers.entries()) {
  for (const row of c.rows ?? []) {
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId === "sg3-11") {
        sg11Placed = { ...it, ci: ci + 1, z: it.position?.z ?? (row.bottomHeight ?? 0) };
      }
    }
  }
}

if (sg11Placed) {
  console.log(`\n=== sg3-11 배치됨 ===`);
  console.log(`  컨${sg11Placed.ci} (x=${sg11Placed.position.x}, y=${sg11Placed.position.y}, z=${sg11Placed.z})`);
  console.log(`  사이즈: ${sg11Placed.size.width}×${sg11Placed.size.length}×${sg11Placed.size.height} (faceIdx=${sg11Placed.faceIdx} rotated=${sg11Placed.rotated})`);
  console.log(`  무게: ${sg11Placed.weight} kg`);
} else {
  console.log(`\n=== sg3-11 미배치 ❌ ===`);
  // unplaced 객체 확인
  const u = r.unplaced.find((x) => x.cargoId === "sg3-11" || x.id === "sg3-11");
  if (u) console.log(`  unplaced 항목: ${JSON.stringify(u, null, 2)}`);

  // 컨테이너별 placement 모두 모음 (받침 후보 분석용)
  const allPlacements = [];
  for (const [ci, c] of r.containers.entries()) {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        allPlacements.push({ ...it, ci: ci + 1, z: it.position?.z ?? (row.bottomHeight ?? 0) });
      }
    }
  }

  console.log(`\n=== sg3-11 (150×80×68, 750kg) 받침 후보 분석 ===`);
  console.log(`전체 placement 수: ${allPlacements.length}`);

  // 컨테이너 사양
  const SPEC_40FT = { innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258 };

  const candidates = [];
  for (const P of allPlacements) {
    const topZ = (P.position.z ?? 0) + P.size.height;
    if (topZ + 68 > SPEC_40FT.doorHeight + 0.01) continue; // door 초과
    if (topZ + 68 > SPEC_40FT.innerHeight + 0.01) continue; // inner 초과
    // sg3-11 footprint 가 P 위에 들어가는지 (회전 포함: 150×80 또는 80×150)
    const fits = (
      (150 <= P.size.width + 0.01 && 80 <= P.size.length + 0.01) ||
      (80 <= P.size.width + 0.01 && 150 <= P.size.length + 0.01)
    );
    if (!fits) continue;

    // 충돌 검사 — 같은 컨, 같은 z 평면, sg3-11 placement 영역에 다른 박스 있나
    const sgW = (150 <= P.size.width + 0.01) ? 150 : 80;
    const sgL = (150 <= P.size.width + 0.01) ? 80 : 150;
    const sgX = P.position.x;
    const sgY = P.position.y;
    let collides = false;
    for (const Q of allPlacements) {
      if (Q === P) continue;
      if (Q.ci !== P.ci) continue;
      const qZ = Q.position.z ?? 0;
      const qZTop = qZ + Q.size.height;
      // z 겹침
      if (qZTop <= topZ + 0.01) continue;
      if (qZ >= topZ + 68 - 0.01) continue;
      // x/y 겹침
      const qX = Q.position.x;
      const qXEnd = qX + Q.size.width;
      const qY = Q.position.y;
      const qYEnd = qY + Q.size.length;
      if (sgX + sgW <= qX + 0.01 || sgX >= qXEnd - 0.01) continue;
      if (sgY + sgL <= qY + 0.01 || sgY >= qYEnd - 0.01) continue;
      collides = true;
      break;
    }
    if (collides) continue;

    candidates.push({
      P_cargoId: P.cargoId,
      P_shipper: P.shipper,
      P_ci: P.ci,
      P_pos: P.position,
      P_size: P.size,
      P_weight: P.weight,
      sg11_x: sgX,
      sg11_y: sgY,
      sg11_z: topZ,
      sg11_size: `${sgW}×${sgL}×68`,
      passes_1_0: P.weight >= 750,
      passes_1_5_only: P.weight >= 500 && P.weight < 750,
      fails_both: P.weight < 500,
    });
  }

  console.log(`\nP 위 sg3-11 적층 후보 (사이즈·충돌 통과): ${candidates.length}건`);
  const pass10 = candidates.filter((c) => c.passes_1_0);
  const pass15only = candidates.filter((c) => c.passes_1_5_only);
  const failBoth = candidates.filter((c) => c.fails_both);

  console.log(`  ✅ 1.0 strict 통과 (받침 ≥ 750kg): ${pass10.length}건`);
  for (const c of pass10) console.log(`    - 컨${c.P_ci} ${c.P_cargoId} ${c.P_shipper} (${c.P_size.width}×${c.P_size.length}×${c.P_size.height}) ${c.P_weight}kg → sg3-11 (${c.sg11_size}) at (${c.sg11_x}, ${c.sg11_y}, ${c.sg11_z})`);

  console.log(`  ⚠️ 1.5 통과·1.0 거부 (500 ≤ 받침 < 750): ${pass15only.length}건`);
  for (const c of pass15only.slice(0, 10)) console.log(`    - 컨${c.P_ci} ${c.P_cargoId} ${c.P_shipper} (${c.P_size.width}×${c.P_size.length}×${c.P_size.height}) ${c.P_weight}kg → 거부 (1.0)`);

  console.log(`  ❌ 1.5 도 거부 (받침 < 500): ${failBoth.length}건`);

  // z=0 빈 자리 분석 — extreme-point candidates 기반은 어려우므로, 컨테이너별 점유 영역 grid 로 본다
  console.log(`\n=== z=0 빈 자리 분석 ===`);
  for (const [ci, c] of r.containers.entries()) {
    const ctZ0 = allPlacements.filter((p) => p.ci === ci + 1 && (p.position.z ?? 0) <= 0.01);
    const ctZ0Total = ctZ0.reduce((s, p) => s + p.size.width * p.size.length, 0);
    const cap = c.spec.innerWidth * c.spec.innerLength;
    console.log(`  컨${ci + 1} z=0 점유: ${ctZ0.length}개 박스, 면적 ${ctZ0Total}/${cap} cm² (${((ctZ0Total/cap)*100).toFixed(1)}%)`);
  }
}
