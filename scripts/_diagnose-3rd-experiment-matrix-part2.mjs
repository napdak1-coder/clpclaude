/* E0/E1/E2 매트릭스 — 4ST SG, 5ST SG 만 측정 (Part 1 에서 망작/1ST SG 완료). */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { packBest, packBestWithCandidateUnion, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
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
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    },
    itemRemark: r.itemRemark ?? "",
  }));
}

function analyze(cargoes, result, packSec) {
  const cargoCi = new Map();
  const bkCi = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          const s = cargoCi.get(it.cargoId) ?? new Set();
          s.add(ci);
          cargoCi.set(it.cargoId, s);
        }
        if (it.bookingNo) {
          const s = bkCi.get(it.bookingNo) ?? new Set();
          s.add(ci);
          bkCi.set(it.bookingNo, s);
        }
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) {
        const s = cargoCi.get(b.cargoId) ?? new Set();
        s.add(ci);
        cargoCi.set(b.cargoId, s);
      }
      if (b.bookingNo) {
        const s = bkCi.get(b.bookingNo) ?? new Set();
        s.add(ci);
        bkCi.set(b.bookingNo, s);
      }
    }
  }
  const cargoSplit = [...cargoCi.values()].filter((s) => s.size > 1).length;
  const bookingSplit = [...bkCi.values()].filter((s) => s.size > 1).length;
  const audit = strictStackAudit(result);

  let softCbm = 0, hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }

  const unplIds = new Set();
  for (const u of result.unplaced) if (u.cargoId) unplIds.add(u.cargoId);

  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplIds: [...unplIds],
    cargoSplit, bookingSplit,
    audit: audit.pass, auditV: audit.violations.length,
    softCbm, hardCbm, weightOver,
    packSec,
  };
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("=== Part 2 — 4ST SG / 5ST SG E0/E1/E2 ===");
log(`date: ${new Date().toISOString()}`);
log("");
log("| sample | exp | 컨 셋 | mode | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | pack(s) |");
log("|---|---|---|---|---:|---:|---:|---|---:|---:|---:|");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  // E0
  let t = Date.now();
  let r = packBest(cargoes, "auto", { strictVisualClassification: true });
  let a = analyze(cargoes, r, (Date.now() - t) / 1000);
  log(`| ${s.id} | E0 | ${a.set} | packBest | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.packSec.toFixed(1)} |`);
  if (a.unpl > 0) log(`  unplaced: ${a.unplIds.join(",")}`);

  // E1
  t = Date.now();
  r = packBest(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" });
  a = analyze(cargoes, r, (Date.now() - t) / 1000);
  log(`| ${s.id} | E1 | ${a.set} | packBest | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.packSec.toFixed(1)} |`);
  if (a.unpl > 0) log(`  unplaced: ${a.unplIds.join(",")}`);

  // E2 — skip 5ST SG candidateUnion (예상 너무 김)
  if (s.id === "sg-5") {
    log(`| ${s.id} | E2 | SKIP (시간 폭증 회피, 별도 측정) | candidateUnion | — | — | — | — | — | — | — |`);
    continue;
  }
  t = Date.now();
  r = packBestWithCandidateUnion(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" });
  a = analyze(cargoes, r, (Date.now() - t) / 1000);
  log(`| ${s.id} | E2 | ${a.set} | candidateUnion | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.packSec.toFixed(1)} |`);
  if (a.unpl > 0) log(`  unplaced: ${a.unplIds.join(",")}`);
}

const outPath = path.resolve("scripts/_diagnose-3rd-experiment-matrix-part2-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved ---`);
