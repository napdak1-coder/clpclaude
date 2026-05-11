/**
 * heavy rescue 가 sg3-11 을 거부하는 이유 정밀 trace.
 * pack() 결과에서 광성텍/FLOWBUS supporter 별로 단계별 검증 통과/거부 출력.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { canStackOn, withinWeightLimit, allowedFaces, effectiveSizeFace } = await import("../lib/packing/constraints.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`, itemName: r.itemName||null, actualShipperName: r.actualShipperName ?? "", shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0, quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0, cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"), bookingNo: r.bookingNo || undefined, unitSizes: r.unitSizes,
  remarks: { noStacking: !!r.noStacking, topOnly: !!r.topOnly, orientation: r.orientation || "free", heavierBelow: !!r.heavierBelow },
}));

const r = packBest(cargoes, undefined, { lightMode: true });
console.log(`unplaced: ${r.unplaced.length}`);

if (r.unplaced.length === 0) {
  console.log("✅ 미배치 0 — 작업 완료");
  process.exit(0);
}

const u = r.unplaced[0];
console.log(`미배치 화물: ${u.cargoId} ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg cargoType=${u.cargoType}`);

// unit 객체 (rescue 가 사용하는 형태)
const unit = {
  unitId: `${u.cargoId}-0`, cargoId: u.cargoId, shipper: u.shipper,
  bookingNo: undefined, name: u.name, cargoType: u.cargoType, cfsCbm: u.cfsCbm,
  width: u.width, length: u.length, height: u.height, weight: u.weight,
  remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
};

// 각 컨테이너 별로 receivers 모두 모음
for (const c of r.containers) {
  console.log(`\n=== 컨${c.index} (${c.spec.type}) totalWeight=${c.totalWeight.toFixed(0)}kg / 한도 ${c.spec.maxWeightKg}kg ===`);
  // 모든 placements 모음
  const placements = [];
  for (const row of c.rows ?? []) {
    for (const it of row.bottomItems ?? []) placements.push({ ...it, layer: "bottom" });
    for (const it of row.topItems ?? []) placements.push({ ...it, layer: "top" });
  }
  const supporters = placements.filter((p) => (p.weight ?? 0) >= 750 && !(p.remarks?.noStacking));
  console.log(`  받침 후보 (weight ≥ 750, noStacking false): ${supporters.length}건`);

  for (const P of supporters) {
    const topZ = P.position.z + P.size.height;
    console.log(`\n  --- ${P.cargoId} ${P.shipper} (${P.size.width}×${P.size.length}×${P.size.height}) ${P.weight}kg pos=(${P.position.x}, ${P.position.y}, ${P.position.z}) topZ=${topZ} ---`);

    const faces = allowedFaces({
      width: unit.width, length: unit.length, height: unit.height, remarks: unit.remarks,
    });
    let anyFaceOk = false;
    for (const faceIdx of faces) {
      const eff = effectiveSizeFace(unit, faceIdx);
      const reasons = [];
      if (eff.width > P.size.width + 0.01) reasons.push(`u.W=${eff.width} > P.W=${P.size.width}`);
      if (eff.length > P.size.length + 0.01) reasons.push(`u.L=${eff.length} > P.L=${P.size.length}`);
      if (P.position.x + eff.width > c.spec.innerWidth + 0.01) reasons.push(`x+W > innerW`);
      if (P.position.y + eff.length > c.spec.innerLength + 0.01) reasons.push(`y+L=${P.position.y + eff.length} > innerL=${c.spec.innerLength}`);
      if (topZ + eff.height > c.spec.innerHeight + 0.01) reasons.push(`z+H > innerH`);
      const doorH = c.spec.doorHeight ?? c.spec.innerHeight;
      if (topZ + eff.height > doorH + 0.01) reasons.push(`z+H=${topZ + eff.height} > doorH=${doorH}`);
      if (!withinWeightLimit(c.totalWeight, unit.weight, c.spec))
        reasons.push(`weight ${c.totalWeight + unit.weight} ≥ ${c.spec.maxWeightKg}`);
      if (
        !canStackOn(
          { weightPerUnit: unit.weight, remarks: unit.remarks },
          { weightPerUnit: P.weight, remarks: P.remarks ?? { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false } },
        )
      )
        reasons.push(`canStackOn 거부 (${unit.weight}kg vs ${P.weight}kg)`);
      // 충돌
      let collides = false;
      let collQ = null;
      for (const Q of placements) {
        if (Q === P) continue;
        const qx = Q.position.x;
        const qxe = qx + Q.size.width;
        const qy = Q.position.y;
        const qye = qy + Q.size.length;
        const qz = Q.position.z;
        const qze = qz + Q.size.height;
        if (P.position.x + eff.width <= qx + 0.01) continue;
        if (P.position.x >= qxe - 0.01) continue;
        if (P.position.y + eff.length <= qy + 0.01) continue;
        if (P.position.y >= qye - 0.01) continue;
        if (topZ + eff.height <= qz + 0.01) continue;
        if (topZ >= qze - 0.01) continue;
        collides = true;
        collQ = Q;
        break;
      }
      if (collides) reasons.push(`충돌 with ${collQ.cargoId} ${collQ.shipper} pos=(${collQ.position.x},${collQ.position.y},${collQ.position.z})`);

      if (reasons.length === 0) {
        console.log(`    ✅ face${faceIdx} (${eff.width}×${eff.length}×${eff.height}) — 통과 가능`);
        anyFaceOk = true;
      } else {
        console.log(`    ❌ face${faceIdx} (${eff.width}×${eff.length}×${eff.height}) — ${reasons.join(", ")}`);
      }
    }
    if (!anyFaceOk) console.log(`    → 모든 face 거부`);
  }
}
