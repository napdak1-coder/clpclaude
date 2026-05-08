/**
 * 빠른 비교 — 3ST SG TOTAL 컨1 (40FT 첫째) 화주 목록 추출.
 * pack() 단독, footprintCluster ON.
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;

const cargoes = rows.map((r, idx) => ({
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
    noStacking: r.noStacking ?? false,
    topOnly: r.topOnly ?? false,
    orientation: r.orientation ?? "free",
    heavierBelow: r.heavierBelow ?? false,
  },
  itemRemark: r.itemRemark ?? "",
}));

// id -> shipper 매핑
const idToShipper = new Map();
const idToRowNum = new Map();
cargoes.forEach((c, idx) => {
  idToShipper.set(c.id, c.actualShipperName || c.shipperName || "(unknown)");
  idToRowNum.set(c.id, idx + 1);
});

const t0 = Date.now();
const result = pack(cargoes, "auto", {
  footprintCluster: { enabled: true },
});
const elapsed = Date.now() - t0;

console.log(`pack() 소요 ${elapsed}ms, 컨테이너 ${result.containers.length}대`);
console.log(`컨테이너 type: ${result.containers.map((c) => c.spec.type).join(", ")}`);

// 각 컨테이너에 들어간 cargoId Set 추출
result.containers.forEach((c, i) => {
  const ids = new Set();
  for (const row of c.rows) {
    for (const item of row.bottomItems) ids.add(item.cargoId);
    for (const item of row.topItems) ids.add(item.cargoId);
  }
  for (const b of c.bulkItems ?? []) ids.add(b.cargoId);

  const sortedIds = [...ids].sort((a, b) => {
    const na = parseInt(a.replace("sg3-", ""), 10);
    const nb = parseInt(b.replace("sg3-", ""), 10);
    return na - nb;
  });

  console.log(`\n=== 컨${i + 1} (${c.spec.type}) — ${sortedIds.length}개 화물 행 ===`);
  for (const id of sortedIds) {
    const rowNum = idToRowNum.get(id);
    const shipper = idToShipper.get(id);
    console.log(`  ${id} (행${rowNum}) — ${shipper}`);
  }
});

// 실무자 컨1 = sg3-1 ~ sg3-19
const workerCon1Ids = new Set(Array.from({ length: 19 }, (_, i) => `sg3-${i + 1}`));
const workerCon2Ids = new Set(Array.from({ length: 16 }, (_, i) => `sg3-${i + 20}`));

const sysCon1 = result.containers[0];
const sysCon1Ids = new Set();
for (const row of sysCon1.rows) {
  for (const item of row.bottomItems) sysCon1Ids.add(item.cargoId);
  for (const item of row.topItems) sysCon1Ids.add(item.cargoId);
}
for (const b of sysCon1.bulkItems ?? []) sysCon1Ids.add(b.cargoId);

const matched = [...workerCon1Ids].filter((id) => sysCon1Ids.has(id));
const workerOnly = [...workerCon1Ids].filter((id) => !sysCon1Ids.has(id));
const sysOnly = [...sysCon1Ids].filter((id) => !workerCon1Ids.has(id));

console.log(`\n=== 비교 결과 ===`);
console.log(`일치 ${matched.length}/19`);
console.log(`\n[일치 화주]`);
for (const id of matched.sort((a, b) => parseInt(a.replace("sg3-", ""), 10) - parseInt(b.replace("sg3-", ""), 10))) {
  console.log(`  ${id} (행${idToRowNum.get(id)}) — ${idToShipper.get(id)}`);
}
console.log(`\n[실무자 컨1 → 시스템 컨2 (실무자에만 컨1)]`);
for (const id of workerOnly.sort((a, b) => parseInt(a.replace("sg3-", ""), 10) - parseInt(b.replace("sg3-", ""), 10))) {
  console.log(`  ${id} (행${idToRowNum.get(id)}) — ${idToShipper.get(id)}`);
}
console.log(`\n[시스템 컨1 → 실무자 컨2 (시스템에만 컨1)]`);
for (const id of sysOnly.sort((a, b) => parseInt(a.replace("sg3-", ""), 10) - parseInt(b.replace("sg3-", ""), 10))) {
  console.log(`  ${id} (행${idToRowNum.get(id)}) — ${idToShipper.get(id)}`);
}
