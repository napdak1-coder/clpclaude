/**
 * 2ST SG TOTAL — packBest({lightMode:true}) 결과 B1(CBM 쪼개기) + B2(부킹 분산) 빠른 audit.
 * 56 매트릭스 75분 vs lightMode 12 매트릭스 1초 — 옵션 C + booking partial 보호 회귀 검증용.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/singapore-total-2.json"), "utf8"),
);
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg2-${idx + 1}`,
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

const t0 = Date.now();
const result = packBest(cargoes, undefined, { lightMode: true });
const ms = Date.now() - t0;

console.log(`pack 시간: ${ms}ms`);
console.log(`컨테이너: ${result.containers.length}대`);
console.log(`unplaced: ${result.unplaced.length}`);

// 모든 placement 펼치기 (visual + bulk)
const allItems = [];
result.containers.forEach((c, idx) => {
  for (const row of c.rows ?? []) {
    for (const it of row.bottomItems ?? []) allItems.push({ ...it, ci: idx + 1 });
    for (const it of row.topItems ?? []) allItems.push({ ...it, ci: idx + 1 });
  }
  for (const b of c.bulkItems ?? []) allItems.push({ ...b, ci: idx + 1 });
});

// B1 — cargoId 분산
const cargoToContainers = new Map();
for (const it of allItems) {
  if (!it.cargoId) continue;
  const set = cargoToContainers.get(it.cargoId) ?? new Set();
  set.add(it.ci);
  cargoToContainers.set(it.cargoId, set);
}
const b1Violations = [];
for (const [cid, set] of cargoToContainers) {
  if (set.size > 1) b1Violations.push(`${cid}→[${[...set].join(",")}]`);
}

// B2 — bookingNo 분산
const bookingToContainers = new Map();
for (const it of allItems) {
  if (!it.bookingNo) continue;
  const set = bookingToContainers.get(it.bookingNo) ?? new Set();
  set.add(it.ci);
  bookingToContainers.set(it.bookingNo, set);
}
const b2Violations = [];
for (const [bn, set] of bookingToContainers) {
  if (set.size > 1) b2Violations.push(`${bn}→[${[...set].join(",")}]`);
}

console.log(`\n=== B1 (CBM 쪼개기) ===`);
console.log(b1Violations.length === 0 ? "✅ 0 위반" : `❌ ${b1Violations.length} 위반: ${b1Violations.join(", ")}`);
console.log(`\n=== B2 (부킹 분산) ===`);
console.log(b2Violations.length === 0 ? "✅ 0 위반" : `❌ ${b2Violations.length} 위반: ${b2Violations.join(", ")}`);
console.log(`\n=== B3 (미배치) ===`);
console.log(result.unplaced.length === 0 ? "✅ 0" : `❌ ${result.unplaced.length}`);
