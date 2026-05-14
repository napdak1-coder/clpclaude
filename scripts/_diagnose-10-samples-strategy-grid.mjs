/* 10 샘플 × 4 sortStrategy 매트릭스 — strict visual + residualMakeRoom 켜고. */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
  { id: "mangjak", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", file: "data/samples/singapore-total.json" },
  { id: "sg-2", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", file: "data/samples/singapore-total-5.json" },
  { id: "hm-1", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", file: "data/samples/hochiminh-total-4.json" },
];

const STRATEGIES = ["ldf", "booking-cluster-first", "biggest-cargo-first", "heaviest"];

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
    for (const row of c.rows ?? []) for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) if (it.cargoId) visualIds.add(it.cargoId);
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
  let hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    if (total > c.spec.maxCbm * SOFT + 0.001) hardCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplCids: [...unplIds],
    cargoSplit: [...cargoCi.values()].filter((s) => s.size > 1).length,
    bookingSplit: [...bkCi.values()].filter((s) => s.size > 1).length,
    auditPass: audit.pass && audit.violations.length === 0,
    hardCbm, weightOver,
  };
}

console.log("# 10 샘플 × 4 sortStrategy 매트릭스 (strict visual + residualMakeRoom)");
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| sample | strategy | 컨 셋 | unpl | unplCids | cargoSpl | bookSpl | audit | hardCbm | wtOver | pack(s) |");
console.log("|---|---|---|---:|---|---:|---:|---|---:|---:|---:|");

const baseOpts = {
  strictVisualClassification: true,
  residualMakeRoom: { enabled: true, maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 60_000, bundleTargets: true },
};

const bestPerSample = new Map();
for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const rows = JSON.parse(fs.readFileSync(s.file, "utf8")).rows;
  const cargoes = build(rows, s.id);
  for (const strat of STRATEGIES) {
    const t0 = Date.now();
    let result;
    try {
      result = pack(cargoes, "auto", { ...baseOpts, sortStrategy: strat });
    } catch (e) {
      console.log(`| ${s.id} | ${strat} | ERROR | — | ${e.message?.slice(0, 50)} | — | — | — | — | — | — |`);
      continue;
    }
    const dt = (Date.now() - t0) / 1000;
    const a = analyze(cargoes, result);
    console.log(`| ${s.id} | ${strat} | ${a.set} | ${a.unpl} | ${a.unplCids.join(",") || "-"} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.auditPass ? "P" : "F"} | ${a.hardCbm} | ${a.weightOver} | ${dt.toFixed(1)} |`);
    const valid = a.unpl === 0 && a.cargoSplit === 0 && a.bookingSplit === 0 && a.auditPass && a.hardCbm === 0 && a.weightOver === 0;
    if (valid && !bestPerSample.has(s.id)) bestPerSample.set(s.id, { strategy: strat, dt });
  }
}

console.log("");
console.log("## 각 샘플 최고 strategy (unplaced=0 + 절대 룰 통과 첫 번째)");
for (const s of SAMPLES) {
  const best = bestPerSample.get(s.id);
  if (best) console.log(`- ${s.id}: ${best.strategy} (${best.dt.toFixed(1)}s)`);
  else console.log(`- ${s.id}: ❌ 어떤 strategy 로도 unplaced 0 불가`);
}
