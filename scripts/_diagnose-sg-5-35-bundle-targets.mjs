/* sg-5-35 — bundleTargets opt-in 시도. */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

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

function analyze(result) {
  const unplCids = [...new Set(result.unplaced.map((u) => u.cargoId).filter(Boolean))];
  const unplUnits = result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
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
  return { set: result.containers.map((c) => c.spec.type).join("+"), unplUnits, unplCids, cargoSplit: [...cargoCi.values()].filter((s) => s.size > 1).length, bookingSplit: [...bkCi.values()].filter((s) => s.size > 1).length, auditPass: audit.pass && audit.violations.length === 0, softCbm, hardCbm, weightOver };
}

const SAMPLE = { id: "sg-5", file: "data/samples/singapore-total-5.json" };
const rows = JSON.parse(fs.readFileSync(SAMPLE.file, "utf8")).rows;
const cargoes = build(rows, SAMPLE.id);

console.log("# sg-5 + residualMakeRoom.bundleTargets 옵션 시도");
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| config | unpl | cargoIds | cargoSplit | bookingSplit | audit | softCbm | hardCbm | wtOver | pack(s) |");
console.log("|---|---:|---|---:|---:|---|---:|---:|---:|---:|");

const CONFIGS = [
  { name: "baseline (no bundle)", opts: { enabled: true, maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 60_000 } },
  { name: "bundle ON", opts: { enabled: true, maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 90_000, bundleTargets: true } },
  { name: "bundle ON agg", opts: { enabled: true, maxRemoveCargoIds: 4, maxRemoveUnits: 16, maxTargetsPerCargo: 100, timeBudgetMs: 120_000, bundleTargets: true } },
];

for (const cfg of CONFIGS) {
  const t0 = Date.now();
  const r = pack(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "booking-cluster-first",
    residualMakeRoom: cfg.opts,
  });
  const dt = (Date.now() - t0) / 1000;
  const a = analyze(r);
  console.log(`| ${cfg.name} | ${a.unplUnits} | ${a.unplCids.join(",") || "-"} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.auditPass ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.weightOver} | ${dt.toFixed(1)} |`);
}
