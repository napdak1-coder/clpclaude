/**
 * 3ST SG TOTAL — 적층 컬럼 안에서 무거운 거 아래로 정렬되어 있는지 audit.
 * 같은 (x, y) 컬럼의 박스들 z 순으로 정렬 → weight 가 z 오름차순으로 desc 인지 확인.
 */
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

console.log(`unplaced: ${r.unplaced.length}\n`);

let violations = 0;
for (const [ci, c] of r.containers.entries()) {
  // 모든 placement 수집
  const placements = [];
  for (const row of c.rows ?? []) {
    for (const it of row.bottomItems ?? []) placements.push({ ...it, z: 0 });
    for (const it of row.topItems ?? []) placements.push({ ...it, z: row.bottomHeight ?? 0 });
  }
  // 같은 (x, y) 컬럼 묶기 — 30cm 토런스
  const cols = new Map();
  for (const p of placements) {
    const xkey = Math.round(p.position.x / 30) * 30;
    const ykey = Math.round(p.position.y / 30) * 30;
    const k = `${xkey},${ykey}`;
    const list = cols.get(k) ?? [];
    list.push(p);
    cols.set(k, list);
  }
  for (const [k, items] of cols) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.z - b.z); // z 오름차순 (바닥부터 꼭대기)
    let prevWt = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.weight > prevWt * 1.5 + 0.01) {
        console.log(`⚠️ 컨${ci+1} 컬럼(${k}): 위 ${it.cargoId} ${it.weight}kg z=${it.z} > 아래 ${prevWt}kg × 1.5`);
        violations++;
      }
      prevWt = it.weight;
    }
  }
}
console.log(`\n적층 무게 룰 위반: ${violations}건`);
