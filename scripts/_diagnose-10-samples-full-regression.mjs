/* 10 샘플 종합 회귀 — strictVisualClassification + residualMakeRoom + bundleTargets + booking-cluster-first.
 *
 * 목표: 모든 10 샘플 적재배치도에 사이즈 cargo 박스 그림으로 들어가는지.
 * pack() 단독 호출 (multi-strategy matrix 우회) — 시간 안전.
 */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-2", name: "2ST SG", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", name: "3ST SG", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
  { id: "hm-1", name: "1ST HM", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", name: "2ST HM", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", name: "3ST HM", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", name: "4ST HM", file: "data/samples/hochiminh-total-4.json" },
];

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`, itemName: r.itemName || null,
    actualShipperName: r.actualShipperName ?? "", shipperName: r.shipperName ?? "",
    width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
    quantity: Math.max(1, r.quantity ?? 1), weightPerUnit: r.weightPerUnitKg ?? 0,
    cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
    cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
    bookingNo: r.bookingNo || undefined, unitSizes: r.unitSizes,
    remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, bottomOnly: r.bottomOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
    itemRemark: r.itemRemark ?? "",
  }));
}

function analyze(cargoes, result) {
  const visualIds = new Set(), bulkIds = new Set(), unplIds = new Set();
  for (const c of result.containers) {
    for (const row of c.rows ?? []) for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId) visualIds.add(it.cargoId);
    }
    for (const b of c.bulkItems ?? []) if (b.cargoId) bulkIds.add(b.cargoId);
  }
  for (const u of result.unplaced) if (u.cargoId) unplIds.add(u.cargoId);
  const cargoCi = new Map(), bkCi = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId) { const s = cargoCi.get(it.cargoId) ?? new Set(); s.add(ci); cargoCi.set(it.cargoId, s); }
      if (it.bookingNo) { const s = bkCi.get(it.bookingNo) ?? new Set(); s.add(ci); bkCi.set(it.bookingNo, s); }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) { const s = cargoCi.get(b.cargoId) ?? new Set(); s.add(ci); cargoCi.set(b.cargoId, s); }
      if (b.bookingNo) { const s = bkCi.get(b.bookingNo) ?? new Set(); s.add(ci); bkCi.set(b.bookingNo, s); }
    }
  }
  const audit = strictStackAudit(result);
  let softCbm = 0, hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  // 사이즈 있는데 부피 합산 트랙 으로 간 cargo
  const sizedToBulk = [];
  for (const cg of cargoes) {
    const hasMainSize = cg.width >= 1 && cg.length >= 1 && cg.height >= 1;
    const hasUnit = cg.unitSizes && cg.unitSizes.length > 0 && cg.unitSizes.every((u) => u.width >= 1 && u.length >= 1 && u.height >= 1);
    if ((hasMainSize || hasUnit) && bulkIds.has(cg.id)) sizedToBulk.push(cg.id);
  }
  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplCids: [...unplIds],
    visualCount: visualIds.size, bulkCount: bulkIds.size,
    sizedToBulkCount: sizedToBulk.length, sizedToBulkIds: sizedToBulk,
    cargoSplit: [...cargoCi.values()].filter((s) => s.size > 1).length,
    bookingSplit: [...bkCi.values()].filter((s) => s.size > 1).length,
    auditPass: audit.pass && audit.violations.length === 0,
    softCbm, hardCbm, weightOver,
  };
}

console.log("# 10 샘플 종합 회귀 — strict visual + residualMakeRoom + bundleTargets + booking-cluster");
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| sample | 컨 셋 | visual | bulk | size→bulk | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | wtOver | pack(s) | 결과 |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|");

const PACK_OPTS = {
  strictVisualClassification: true,
  sortStrategy: "booking-cluster-first",
  residualMakeRoom: {
    enabled: true,
    maxRemoveCargoIds: 3,
    maxRemoveUnits: 12,
    maxTargetsPerCargo: 50,
    timeBudgetMs: 60_000,
    // bundleTargets 끄고 회귀 확인
    bundleTargets: false,
  },
};

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const rows = JSON.parse(fs.readFileSync(s.file, "utf8")).rows;
  const cargoes = build(rows, s.id);
  const t0 = Date.now();
  let result;
  try {
    result = pack(cargoes, "auto", PACK_OPTS);
  } catch (e) {
    console.log(`| ${s.id} | ERROR | — | — | — | — | — | — | — | — | — | — | — | ${e.message?.slice(0, 50)} |`);
    continue;
  }
  const dt = (Date.now() - t0) / 1000;
  const a = analyze(cargoes, result);
  const pass = a.unpl === 0 && a.cargoSplit === 0 && a.bookingSplit === 0 && a.auditPass && a.hardCbm === 0 && a.weightOver === 0 && a.sizedToBulkCount === 0;
  console.log(`| ${s.id} | ${a.set} | ${a.visualCount} | ${a.bulkCount} | ${a.sizedToBulkCount} | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.auditPass ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.weightOver} | ${dt.toFixed(1)} | ${pass ? "✅" : "❌"} |`);
  if (a.unpl > 0) console.log(`  unplaced: ${a.unplCids.join(",")}`);
  if (a.sizedToBulkCount > 0) console.log(`  사이즈→bulk: ${a.sizedToBulkIds.slice(0, 5).join(",")}${a.sizedToBulkIds.length > 5 ? "..." : ""}`);
}
