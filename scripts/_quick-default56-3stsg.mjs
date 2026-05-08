import fs from "node:fs"; import path from "node:path";
const { packBest } = await import("../lib/packing/algorithm.ts");
const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`, itemName: r.itemName||null, actualShipperName: r.actualShipperName??"", shipperName: r.shipperName??"",
  width: r.widthCm??0, length: r.lengthCm??0, height: r.heightCm??0, quantity: Math.max(1, r.quantity??1),
  weightPerUnit: r.weightPerUnitKg??0, cbm: r.cbm??null, aboutCbm: r.aboutCbm??null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"), bookingNo: r.bookingNo||undefined, unitSizes: r.unitSizes,
  remarks: { noStacking: !!r.noStacking, topOnly: !!r.topOnly, orientation: r.orientation||"free", heavierBelow: !!r.heavierBelow },
}));
const t0 = Date.now(); const r = packBest(cargoes, undefined, {});
const items = []; r.containers.forEach((c, idx) => { for (const row of c.rows ?? []) { for (const it of row.bottomItems ?? []) items.push({...it, ci: idx+1}); for (const it of row.topItems ?? []) items.push({...it, ci: idx+1}); } for (const b of c.bulkItems ?? []) items.push({...b, ci: idx+1}); });
const cset = new Map(), bset = new Map();
for (const it of items) { if (it.cargoId) { const s = cset.get(it.cargoId) ?? new Set(); s.add(it.ci); cset.set(it.cargoId, s); } if (it.bookingNo) { const s = bset.get(it.bookingNo) ?? new Set(); s.add(it.ci); bset.set(it.bookingNo, s); } }
const b1 = [...cset.values()].filter(s => s.size > 1).length;
const b2 = [...bset.values()].filter(s => s.size > 1).length;
console.log(`default 56: ${Date.now()-t0}ms unplaced=${r.unplaced.length} B1=${b1} B2=${b2}`);
