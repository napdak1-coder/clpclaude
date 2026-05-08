import fs from "node:fs";
import path from "node:path";
const { packBest } = await import("../lib/packing/algorithm.ts");
const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`, itemName: r.itemName||null, actualShipperName: r.actualShipperName??"", shipperName: r.shipperName??"",
  width: r.widthCm??0, length: r.lengthCm??0, height: r.heightCm??0, quantity: Math.max(1, r.quantity??1),
  weightPerUnit: r.weightPerUnitKg??0, cbm: r.cbm??null, aboutCbm: r.aboutCbm??null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"), bookingNo: r.bookingNo||undefined, unitSizes: r.unitSizes,
  remarks: { noStacking: !!r.noStacking, topOnly: !!r.topOnly, orientation: r.orientation||"free", heavierBelow: !!r.heavierBelow },
}));
const r = packBest(cargoes, undefined, { lightMode: true });
console.log(`unplaced: ${r.unplaced.length}`);
for (const u of r.unplaced) {
  console.log(`  - ${u.cargoId} ${u.shipper||u.actualShipperName} ${u.width}×${u.length}×${u.height} qty=${u.quantity} wt=${u.weightPerUnit}kg`);
}
console.log(`\n각 컨테이너 상위 박스 무게 vs 하단 무게 검사:`);
r.containers.forEach((c, idx) => {
  for (const row of c.rows ?? []) {
    for (const it of row.topItems ?? []) {
      // 같은 row 의 bottomItems 중 면적 겹치는 박스 찾기
      let supportWt = 0;
      for (const b of row.bottomItems ?? []) {
        if (b.position && it.position) {
          const xOverlap = Math.max(0, Math.min(it.position.x + it.size.width, b.position.x + b.size.width) - Math.max(it.position.x, b.position.x));
          const yOverlap = Math.max(0, Math.min(it.position.y + it.size.length, b.position.y + b.size.length) - Math.max(it.position.y, b.position.y));
          if (xOverlap > 0 && yOverlap > 0) supportWt = Math.max(supportWt, b.weight ?? 0);
        }
      }
      if ((it.weight ?? 0) > supportWt && supportWt > 0) {
        console.log(`  컨${idx+1} ⚠️ 위 ${it.cargoId} ${it.weight}kg > 아래 max ${supportWt}kg`);
      }
    }
  }
});
