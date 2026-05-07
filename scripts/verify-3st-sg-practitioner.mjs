/**
 * 3ST SG TOTAL — 실무자 분배 강제 후 물리·룰 검증.
 * row 1~19 → 컨1, row 20~35 → 컨2 (실무자 명시 순서).
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"),
);

// row 1~19 → 컨1, row 20~35 → 컨2
const PRACT = { 1: [], 2: [] };
sample.rows.forEach((r, i) => {
  if (i < 19) PRACT[1].push(r.actualShipperName);
  else PRACT[2].push(r.actualShipperName);
});

const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

// 직접 row index 로 fixedAssignment 매핑 (중복 화주 안전)
const fixedAssignment = {};
cargoes.forEach((c, i) => { fixedAssignment[c.id] = i < 19 ? 1 : 2; });

const fixedContainers = ["40FT", "40FT"];

console.log("=== 3ST SG TOTAL — 실무자 분배 물리 검증 ===");
console.log(`fixedContainers: ${fixedContainers.join(", ")}`);
console.log(`fixedAssignment: ${cargoes.length} cargo → 컨1=${PRACT[1].length}, 컨2=${PRACT[2].length}`);

const result = pack(cargoes, "auto", { fixedContainers, fixedAssignment });
console.log(`\n컨테이너: ${result.containers.length}대 (${result.containers.map((c) => c.spec.type).join(" + ")})`);
console.log(`unplaced: ${result.unplaced.length}\n`);

if (result.unplaced.length > 0) {
  console.log("⚠ unplaced 상세:");
  for (const u of result.unplaced) {
    const cg = u.cargo ?? cargoes.find((c) => c.id === u.cargoId);
    console.log(`   - ${cg?.actualShipperName ?? "?"} (id=${cg?.id ?? "?"}, qty=${u.quantity ?? 1}, size=${cg?.width}×${cg?.length}×${cg?.height}, cbm=${cg?.aboutCbm ?? cg?.cbm ?? "?"}, weight=${(cg?.weightPerUnit ?? 0)}kg)`);
  }
  console.log("");
}

const SOFT_OVERFLOW = 1.05;
const EPS = 0.5;
const cargoById = new Map(cargoes.map((c) => [c.id, c]));
const overall = { pass: 0, fail: 0 };
const reportCheck = (label, ok, detail = "") => {
  console.log(`    ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (ok) overall.pass++;
  else overall.fail++;
};
const px = (p) => p.position.x, py = (p) => p.position.y;
const pw = (p) => p.size.width, pl = (p) => p.size.length, ph = (p) => p.size.height;

for (const cont of result.containers) {
  console.log(`────────────────────────────────────────`);
  console.log(`[${cont.index}] ${cont.spec.type}  (inner ${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight} cm)`);
  console.log(`  실무자 배정 화주: ${PRACT[cont.index].join(", ")}`);

  const placements = [];
  for (const row of cont.rows) {
    for (const it of row.bottomItems) placements.push({ ...it, layer: "bottom", z: 0 });
    for (const it of row.topItems) placements.push({ ...it, layer: "top", z: row.bottomHeight ?? 0 });
  }
  const bulks = cont.bulkItems ?? [];
  console.log(`  visual placements: ${placements.length}, bulk items: ${bulks.length}`);

  const wMax = cont.spec.innerWidth + EPS;
  const hMax = cont.spec.innerHeight + EPS;
  const oobW = placements.filter((p) => px(p) + pw(p) > wMax);
  const oobH = placements.filter((p) => p.z + ph(p) > hMax);
  reportCheck("A1a. bounding width (≤ innerWidth)", oobW.length === 0, oobW.length ? `OOB-W ${oobW.length}` : "");
  reportCheck("A1b. bounding height (≤ innerHeight)", oobH.length === 0, oobH.length ? `OOB-H ${oobH.length}` : "");

  const wt = placements.reduce((s, p) => s + (p.weight ?? 0), 0)
    + bulks.reduce((s, b) => s + (b.weightPerUnit ?? 0), 0);
  reportCheck("A2. weight 합 ≤ 한도", wt <= cont.spec.maxWeightKg + EPS,
    `${wt.toFixed(1)}/${cont.spec.maxWeightKg} kg (${((wt/cont.spec.maxWeightKg)*100).toFixed(1)}%)`);

  const visualCbm = placements.reduce((s, p) => s + (pw(p) * pl(p) * ph(p)) / 1e6, 0);
  const ctCbm = bulks.reduce((s, b) => s + (b.cbm ?? 0), 0);
  const totalCbm = visualCbm + ctCbm;
  const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
  reportCheck("A3. cbm 합 ≤ cap × 1.05", totalCbm <= maxCbm * SOFT_OVERFLOW + EPS,
    `${totalCbm.toFixed(2)}/${maxCbm.toFixed(2)} m³ (${((totalCbm/maxCbm)*100).toFixed(1)}%)`);

  let collisions = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      const overlap =
        px(a) < px(b) + pw(b) - EPS && px(b) < px(a) + pw(a) - EPS &&
        py(a) < py(b) + pl(b) - EPS && py(b) < py(a) + pl(a) - EPS &&
        a.z < b.z + ph(b) - EPS && b.z < a.z + ph(a) - EPS;
      if (overlap) collisions++;
    }
  }
  reportCheck("A4. 충돌 0", collisions === 0, collisions ? `${collisions}쌍` : "");

  let unsupported = 0;
  for (const p of placements) {
    if (p.z <= EPS) continue;
    const baseArea = pw(p) * pl(p);
    let coveredArea = 0;
    for (const q of placements) {
      if (q === p) continue;
      const qTop = q.z + ph(q);
      if (Math.abs(qTop - p.z) > EPS) continue;
      const ox = Math.max(0, Math.min(px(p) + pw(p), px(q) + pw(q)) - Math.max(px(p), px(q)));
      const oy = Math.max(0, Math.min(py(p) + pl(p), py(q) + pl(q)) - Math.max(py(p), py(q)));
      coveredArea += ox * oy;
    }
    if (coveredArea < baseArea * 0.7) unsupported++;
  }
  reportCheck("A5. full support (≥70%)", unsupported === 0, unsupported ? `${unsupported}` : "");
}

console.log(`\n────────────────────────────────────────`);
console.log(`[전역] 룰`);
const cargoToCont = new Map();
for (const c of result.containers) {
  for (const row of c.rows) for (const it of [...row.bottomItems, ...row.topItems]) {
    const set = cargoToCont.get(it.cargoId) ?? new Set();
    set.add(c.index);
    cargoToCont.set(it.cargoId, set);
  }
  for (const b of c.bulkItems ?? []) {
    const set = cargoToCont.get(b.cargoId) ?? new Set();
    set.add(c.index);
    cargoToCont.set(b.cargoId, set);
  }
}
const split = [...cargoToCont].filter(([, s]) => s.size > 1);
reportCheck("B1. cargoId 분산 0", split.length === 0,
  split.length ? split.map(([id, s]) => `${id}→[${[...s].join(",")}]`).join(", ") : "");
const unp = result.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
reportCheck("B3. 미배치 0", unp === 0, unp ? `${unp} units` : "");

console.log(`\n=== 종합: ${overall.pass} pass / ${overall.fail} fail ===`);
process.exit(overall.fail > 0 ? 1 : 0);
