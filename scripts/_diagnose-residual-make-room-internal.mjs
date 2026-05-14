/* Internal residual make-room opt-in diagnostic.
 *
 * This runner exercises algorithm.ts `residualMakeRoom.enabled`.
 * Production defaults are not changed.
 */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;
const SAMPLES = [
  { id: "sg-1", file: "data/samples/singapore-total.json" },
  { id: "sg-4", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", file: "data/samples/singapore-total-5.json" },
];

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
  const cargo = new Map();
  const booking = new Map();
  const add = (cargoId, bookingNo, ci) => {
    if (cargoId) {
      const set = cargo.get(cargoId) ?? new Set();
      set.add(ci);
      cargo.set(cargoId, set);
    }
    if (bookingNo) {
      const set = booking.get(bookingNo) ?? new Set();
      set.add(ci);
      booking.set(bookingNo, set);
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
    cargoSplit: [...cargo.values()].filter((set) => set.size > 1).length,
    bookingSplit: [...booking.values()].filter((set) => set.size > 1).length,
  };
}

function analyze(result) {
  const unplacedCargoIds = [...new Set(result.unplaced.map((u) => u.cargoId).filter(Boolean))];
  const splits = splitCounts(result);
  const audit = strictStackAudit(result);
  let softCbm = 0;
  let hardCbm = 0;
  let weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  return {
    unplacedCount: unplacedCargoIds.length,
    unplacedCargoIds,
    cargoSplit: splits.cargoSplit,
    bookingSplit: splits.bookingSplit,
    auditPass: audit.pass && audit.violations.length === 0,
    softCbm,
    hardCbm,
    weightOver,
  };
}

function diffIds(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    newlyPlaced: [...b].filter((id) => !a.has(id)),
    newlyUnplaced: [...a].filter((id) => !b.has(id)),
  };
}

console.log("# Internal residual make-room diagnostic");
console.log(`date: ${new Date().toISOString()}`);
console.log("| sample | baseUnplaced | repairUnplaced | newlyPlaced | newlyUnplaced | bookingSplit | cargoSplit | audit | softCbm | hardCbm | weightOver | packTime(s) |");
console.log("|---|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|");

for (const sample of SAMPLES) {
  if (!fs.existsSync(sample.file)) continue;
  const rows = JSON.parse(fs.readFileSync(sample.file, "utf8")).rows;
  const cargoes = build(rows, sample.id);

  const base = pack(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "booking-cluster-first",
  });
  const baseA = analyze(base);
  const start = Date.now();
  const repaired = pack(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "booking-cluster-first",
    residualMakeRoom: {
      enabled: true,
      maxRemoveCargoIds: 3,
      maxRemoveUnits: 12,
      maxTargetsPerCargo: 50,
      timeBudgetMs: 60_000,
    },
  });
  const packTime = (Date.now() - start) / 1000;
  const repA = analyze(repaired);
  const diff = diffIds(baseA.unplacedCargoIds, repA.unplacedCargoIds);
  console.log(
    `| ${sample.id} | ${baseA.unplacedCount} (${baseA.unplacedCargoIds.join(",") || "-"}) | ${repA.unplacedCount} (${repA.unplacedCargoIds.join(",") || "-"}) | ${diff.newlyPlaced.join(",") || "-"} | ${diff.newlyUnplaced.join(",") || "-"} | ${repA.bookingSplit} | ${repA.cargoSplit} | ${repA.auditPass ? "PASS" : "FAIL"} | ${repA.softCbm} | ${repA.hardCbm} | ${repA.weightOver} | ${packTime.toFixed(1)} |`,
  );
}
