/**
 * heavy-unplaced support rescue 가 sg3-11 을 못 박는 이유 진단.
 * 각 supporter 별로 tryPlaceUnit 의 어떤 검증이 거부하는지 찾는다.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { tryPlaceUnit, makeContainerState } = await import("../lib/packing/extreme-point.ts");
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

if (r.unplaced.length === 0) {
  console.log("✅ unplaced = 0 (heavy rescue 성공)");
  process.exit(0);
}

const u = r.unplaced[0];
console.log(`미배치: ${u.cargoId} ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg`);
console.log(`unplaced 객체 weight: ${u.weight} | reason: ${u.reason}`);

// containers 으로부터 placement 직접 검사 (display-rows 변환 X)
console.log(`\n컨테이너별 weight 합:`);
for (const c of r.containers) {
  console.log(`  컨${c.index} (${c.spec.type} 한도 ${c.spec.maxWeightKg}kg): 적재 ${c.totalWeight.toFixed(0)}kg`);
}

console.log(`\n컨테이너별 placements (weight ≥ 750kg + noStacking false):`);
for (const c of r.containers) {
  const supporters = (c.rows ?? []).flatMap((row) => [
    ...(row.bottomItems ?? []).map((it) => ({ ...it, z: 0 })),
    ...(row.topItems ?? []).map((it) => ({ ...it, z: row.bottomHeight ?? 0 })),
  ]);
  const validSup = supporters.filter((p) => (p.weight ?? 0) >= 750 && !(p.remarks?.noStacking));
  console.log(`  컨${c.index}: 받침 후보 ${validSup.length}건`);
  for (const P of validSup.slice(0, 5)) {
    console.log(`    - ${P.cargoId} ${P.shipper} (${P.size.width}×${P.size.length}×${P.size.height}) ${P.weight}kg z=${P.z} pos=(${P.position.x}, ${P.position.y})`);
  }
}
