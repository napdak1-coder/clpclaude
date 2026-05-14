/* 10 샘플 strict visual + candidateUnion + singleStrategy + timeBudget + residualMakeRoom.
 * mangjak-10 / sg-1-14 해결 검증 (container-set decision path).
 */
import fs from "node:fs";
const { packBestWithCandidateUnion, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
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

function evaluate(cargoes, result) {
  const cargoCi = new Map(), bkCi = new Map(), bulkIds = new Set();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId) { const s = cargoCi.get(it.cargoId) ?? new Set(); s.add(ci); cargoCi.set(it.cargoId, s); }
      if (it.bookingNo) { const s = bkCi.get(it.bookingNo) ?? new Set(); s.add(ci); bkCi.set(it.bookingNo, s); }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) { bulkIds.add(b.cargoId); const s = cargoCi.get(b.cargoId) ?? new Set(); s.add(ci); cargoCi.set(b.cargoId, s); }
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
  let sizedToBulk = 0;
  for (const cg of cargoes) {
    const hasMain = cg.width >= 1 && cg.length >= 1 && cg.height >= 1;
    const hasUnit = cg.unitSizes && cg.unitSizes.length > 0 && cg.unitSizes.every((u) => u.width >= 1 && u.length >= 1 && u.height >= 1);
    if ((hasMain || hasUnit) && bulkIds.has(cg.id)) sizedToBulk++;
  }
  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplCids: [...new Set(result.unplaced.map((u) => u.cargoId).filter(Boolean))],
    cargoSplit: [...cargoCi.values()].filter((s) => s.size > 1).length,
    bookingSplit: [...bkCi.values()].filter((s) => s.size > 1).length,
    auditPass: audit.pass && audit.violations.length === 0,
    hardCbm, weightOver, sizedToBulk,
  };
}

console.log("# 10 샘플 candidateUnion + singleStrategy + timeBudget + strict visual + residualMakeRoom");
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| sample | containerSet | strategy | unpl | unplaced | sizedToBulk | cargoSpl | bookSpl | audit | hardCbm | wtOver | pack(s) |");
console.log("|---|---|---|---:|---|---:|---:|---:|---|---:|---:|---:|");

// 각 샘플마다 booking-cluster-first 와 ldf 둘 다 시도, lex best
const STRATEGIES = ["booking-cluster-first", "ldf"];

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const rows = JSON.parse(fs.readFileSync(s.file, "utf8")).rows;
  const cargoes = build(rows, s.id);
  let best = null;
  let bestStrat = null;
  let totalDt = 0;
  for (const strat of STRATEGIES) {
    const t0 = Date.now();
    try {
      const r = packBestWithCandidateUnion(cargoes, "auto", {
        strictVisualClassification: true,
        candidateUnionExperimental: { singleStrategy: strat, timeBudgetMs: 120_000 },
        residualMakeRoom: { enabled: true, maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 60_000, bundleTargets: true },
      });
      const dt = (Date.now() - t0) / 1000;
      totalDt += dt;
      const e = evaluate(cargoes, r);
      // lex: unpl ↓ → audit ↓ → hardCbm ↓ → weightOver ↓
      const k = [e.unpl, e.auditPass ? 0 : 1, e.hardCbm, e.weightOver];
      if (!best || k[0] < best.key[0] || (k[0] === best.key[0] && k[1] < best.key[1])) {
        best = { ...e, key: k, strat };
        bestStrat = strat;
      }
      if (e.unpl === 0 && e.cargoSplit === 0 && e.bookingSplit === 0 && e.auditPass && e.hardCbm === 0 && e.weightOver === 0) break;
    } catch (e) {
      totalDt += (Date.now() - t0) / 1000;
    }
  }
  if (!best) continue;
  console.log(`| ${s.id} | ${best.set} | ${bestStrat} | ${best.unpl} | ${best.unplCids.join(",") || "-"} | ${best.sizedToBulk} | ${best.cargoSplit} | ${best.bookingSplit} | ${best.auditPass ? "P" : "F"} | ${best.hardCbm} | ${best.weightOver} | ${totalDt.toFixed(1)} |`);
}
