/* 10 샘플 × 4 strategy 자동 best 선택 (script-level multi-strategy).
 * 각 샘플에 대해 모든 strategy 시도 후 unplaced 가장 적은 결과 채택.
 * strict visual + residualMakeRoom 옵션 켜고.
 */
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

function evaluate(cargoes, result) {
  const visualIds = new Set(), bulkIds = new Set();
  const cargoCi = new Map(), bkCi = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId) { visualIds.add(it.cargoId); const s = cargoCi.get(it.cargoId) ?? new Set(); s.add(ci); cargoCi.set(it.cargoId, s); }
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
  // 사이즈→bulk 카운트
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

function lexKey(a) {
  // lex: ① unpl ↓ ② audit fail ↓ ③ hardCbm ↓ ④ weightOver ↓ ⑤ cargoSplit ↓ ⑥ bookingSplit ↓
  return [a.unpl, a.auditPass ? 0 : 1, a.hardCbm, a.weightOver, a.cargoSplit, a.bookingSplit];
}
function lexLess(ka, kb) {
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i];
  return false;
}

console.log("# 10 샘플 multi-strategy best 자동 선택 (strict visual + residualMakeRoom)");
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| sample | best strategy | 컨 셋 | unpl | unplCids | cargoSpl | bookSpl | audit | hardCbm | wtOver | sizedToBulk | pack(s) | 결과 |");
console.log("|---|---|---|---:|---|---:|---:|---|---:|---:|---:|---:|---|");

const baseOpts = {
  strictVisualClassification: true,
  residualMakeRoom: { enabled: true, maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 60_000, bundleTargets: true },
};

const finalResults = [];
for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const rows = JSON.parse(fs.readFileSync(s.file, "utf8")).rows;
  const cargoes = build(rows, s.id);
  let best = null;
  let bestStrategy = null;
  let totalDt = 0;
  for (const strat of STRATEGIES) {
    const t0 = Date.now();
    try {
      const r = pack(cargoes, "auto", { ...baseOpts, sortStrategy: strat });
      const dt = (Date.now() - t0) / 1000;
      totalDt += dt;
      const e = evaluate(cargoes, r);
      const k = lexKey(e);
      if (!best || lexLess(k, lexKey(best))) {
        best = e;
        bestStrategy = strat;
      }
      // 0 unpl + 절대 룰 통과 시 단락
      if (e.unpl === 0 && e.cargoSplit === 0 && e.bookingSplit === 0 && e.auditPass && e.hardCbm === 0 && e.weightOver === 0) break;
    } catch (e) {
      totalDt += (Date.now() - t0) / 1000;
    }
  }
  if (!best) continue;
  const pass = best.unpl === 0 && best.cargoSplit === 0 && best.bookingSplit === 0 && best.auditPass && best.hardCbm === 0 && best.weightOver === 0;
  console.log(`| ${s.id} | ${bestStrategy} | ${best.set} | ${best.unpl} | ${best.unplCids.join(",") || "-"} | ${best.cargoSplit} | ${best.bookingSplit} | ${best.auditPass ? "P" : "F"} | ${best.hardCbm} | ${best.weightOver} | ${best.sizedToBulk} | ${totalDt.toFixed(1)} | ${pass ? "✅" : "❌"} |`);
  finalResults.push({ id: s.id, strategy: bestStrategy, pass, unpl: best.unpl, unplCids: best.unplCids });
}

console.log("");
console.log("## 종합");
const passCount = finalResults.filter((r) => r.pass).length;
console.log(`- 통과: ${passCount}/${finalResults.length}`);
const failedRows = finalResults.filter((r) => !r.pass);
if (failedRows.length > 0) {
  console.log("- 잔여:");
  for (const r of failedRows) console.log(`    ${r.id} (${r.strategy}): unpl=${r.unpl} cargos=${r.unplCids.join(",")}`);
}
