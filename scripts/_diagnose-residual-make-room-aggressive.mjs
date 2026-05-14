/* residualMakeRoom 더 공격적인 config 시도 — sg-5-35 해결 목표.
 * runner config 만 변경, algorithm.ts 수정 없음.
 */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
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
      bottomOnly: r.bottomOnly ?? false,
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    },
    itemRemark: r.itemRemark ?? "",
  }));
}

function splitCounts(result) {
  const cargo = new Map(), booking = new Map();
  const add = (cargoId, bookingNo, ci) => {
    if (cargoId) {
      const s = cargo.get(cargoId) ?? new Set();
      s.add(ci);
      cargo.set(cargoId, s);
    }
    if (bookingNo) {
      const s = booking.get(bookingNo) ?? new Set();
      s.add(ci);
      booking.set(bookingNo, s);
    }
  };
  result.containers.forEach((c, ci) => {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        add(it.cargoId, it.bookingNo, ci);
      }
    }
    for (const b of c.bulkItems ?? []) add(b.cargoId, b.bookingNo, ci);
  });
  return {
    cargoSplit: [...cargo.values()].filter((s) => s.size > 1).length,
    bookingSplit: [...booking.values()].filter((s) => s.size > 1).length,
  };
}

function analyze(result) {
  const unplacedCargoIds = [...new Set(result.unplaced.map((u) => u.cargoId).filter(Boolean))];
  const splits = splitCounts(result);
  const audit = strictStackAudit(result);
  let softCbm = 0, hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  return { unplacedCount: unplacedCargoIds.length, unplacedCargoIds, cargoSplit: splits.cargoSplit, bookingSplit: splits.bookingSplit, auditPass: audit.pass && audit.violations.length === 0, softCbm, hardCbm, weightOver };
}

const SAMPLE = { id: "sg-5", file: "data/samples/singapore-total-5.json" };
if (!fs.existsSync(SAMPLE.file)) {
  console.log("sample not found");
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(SAMPLE.file, "utf8")).rows;
const cargoes = build(rows, SAMPLE.id);

console.log(`# residualMakeRoom 공격적 config — sg-5 sg-5-35 해결 시도`);
console.log(`date: ${new Date().toISOString()}`);
console.log("");
console.log("| config | unplaced | unplaced cargo | bookingSplit | cargoSplit | audit | hardCbm | weightOver | pack(s) |");
console.log("|---|---:|---|---:|---:|---|---:|---:|---:|");

const CONFIGS = [
  { name: "base (3/12/50/60s)", opts: { maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 50, timeBudgetMs: 60_000 } },
  { name: "agg-A (4/16/80/120s)", opts: { maxRemoveCargoIds: 4, maxRemoveUnits: 16, maxTargetsPerCargo: 80, timeBudgetMs: 120_000 } },
  { name: "agg-B (5/20/120/180s)", opts: { maxRemoveCargoIds: 5, maxRemoveUnits: 20, maxTargetsPerCargo: 120, timeBudgetMs: 180_000 } },
  { name: "agg-C (3/12/200/180s)", opts: { maxRemoveCargoIds: 3, maxRemoveUnits: 12, maxTargetsPerCargo: 200, timeBudgetMs: 180_000 } },
];

for (const cfg of CONFIGS) {
  const start = Date.now();
  let result;
  try {
    result = pack(cargoes, "auto", {
      strictVisualClassification: true,
      sortStrategy: "booking-cluster-first",
      residualMakeRoom: { enabled: true, ...cfg.opts },
    });
  } catch (e) {
    console.log(`| ${cfg.name} | ERROR | ${e.message?.slice(0, 50)} | — | — | — | — | — | — |`);
    continue;
  }
  const packTime = (Date.now() - start) / 1000;
  const a = analyze(result);
  console.log(
    `| ${cfg.name} | ${a.unplacedCount} | ${a.unplacedCargoIds.join(",") || "-"} | ${a.bookingSplit} | ${a.cargoSplit} | ${a.auditPass ? "PASS" : "FAIL"} | ${a.hardCbm} | ${a.weightOver} | ${packTime.toFixed(1)} |`,
  );
}
