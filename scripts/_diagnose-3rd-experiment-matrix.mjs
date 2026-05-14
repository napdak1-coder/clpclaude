/* 3차 단계 — E0/E1/E2 실험 매트릭스 자동 실행.
 *
 * 대상 4 샘플: 망작 SG / 1ST SG / 4ST SG / 5ST SG
 *
 * E0 baseline: strictVisualClassification=true, packBest, sortStrategy='ldf'
 * E1 big cargo pre-anchor: strictVisualClassification=true, packBest, sortStrategy='biggest-cargo-first'
 * E2 candidateUnion + E1: strictVisualClassification=true, packBestWithCandidateUnion, sortStrategy='biggest-cargo-first'
 *
 * 결과표 컬럼 (20개):
 *   sampleName, experimentId, containerSet, decisionMode, completedConsolidation,
 *   unplacedCount, unplacedCargoIds, cargoIdSplitCount, bookingSplitCount, strictAuditPass,
 *   softCbmOverflowCount, hardCbmOverflowCount, softCbmDetail, weightOverflow,
 *   noStackingViolation, supportViolation, orientationViolation, completedCargoSpread,
 *   packTime, changedPlacementCount
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { packBest, packBestWithCandidateUnion, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
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

function analyzeResult(cargoes, result, label, packSec, baselinePlacement) {
  // cargoId → 컨 인덱스
  const containerOf = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) containerOf.set(it.cargoId, ci);
      }
    }
    for (const bi of c.bulkItems ?? []) {
      if (bi.cargoId && !containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
    }
  }

  const unplacedSet = new Set();
  for (const u of result.unplaced) if (u.cargoId) unplacedSet.add(u.cargoId);

  // splits
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

  // audit
  const audit = strictStackAudit(result);

  // CBM overflow soft/hard
  let softCbm = 0;
  let hardCbm = 0;
  const softDetail = [];
  let weightOver = 0;
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
    if (total > softCap + 0.001) {
      hardCbm++;
      softDetail.push(`컨${ci + 1}=${total.toFixed(2)}m³ HARD(>${softCap.toFixed(2)})`);
    } else if (total > c.spec.maxCbm + 0.001) {
      softCbm++;
      softDetail.push(
        `컨${ci + 1}=${total.toFixed(2)}m³ SOFT(${c.spec.maxCbm}<x≤${softCap.toFixed(2)})`,
      );
    }
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }

  // changed placement count vs baseline
  let changed = 0;
  if (baselinePlacement) {
    for (const [cid, ci] of containerOf.entries()) {
      const baseCi = baselinePlacement.get(cid);
      if (baseCi !== ci) changed++;
    }
    // 미배치 변화도 changed 에 카운트
    for (const cid of unplacedSet) {
      if (baselinePlacement.has(cid)) changed++;
    }
  }

  const unplacedIds = [...unplacedSet];

  return {
    label,
    containerSet: result.containers.map((c) => c.spec.type).join("+"),
    unplacedCount: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplacedCargoIds: unplacedIds,
    cargoSplit,
    bookingSplit,
    auditPass: audit.pass,
    auditViolations: audit.violations.length,
    softCbm,
    hardCbm,
    softDetail,
    weightOver,
    packSec,
    placementMap: containerOf,
    changedPlacement: changed,
  };
}

function rowToMd(s, exp) {
  return `| ${s.id} | ${exp.label} | ${exp.containerSet} | ${exp.decisionMode} | ${exp.unplacedCount} | ${exp.cargoSplit} | ${exp.bookingSplit} | ${exp.auditPass ? "PASS" : `FAIL(${exp.auditViolations})`} | ${exp.softCbm} | ${exp.hardCbm} | ${exp.weightOver} | ${exp.packSec.toFixed(1)} | ${exp.changedPlacement} |`;
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 3차 E0/E1/E2 실험 매트릭스 ===");
log(`date: ${new Date().toISOString()}`);
log(`softCap ratio: ${SOFT_OVERFLOW}`);
log("");
log("| sample | exp | 컨 셋 | decisionMode | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | wtOver | pack(s) | changed |");
log("|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|");

const allResults = [];

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  // E0 baseline
  const t0 = Date.now();
  const r0 = packBest(cargoes, "auto", { strictVisualClassification: true });
  const a0 = analyzeResult(cargoes, r0, "E0", (Date.now() - t0) / 1000, null);
  a0.decisionMode = "packBest";
  log(rowToMd(s, a0));
  allResults.push({ sample: s.id, ...a0 });

  // E1 big cargo pre-anchor
  const t1 = Date.now();
  const r1 = packBest(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "biggest-cargo-first",
  });
  const a1 = analyzeResult(cargoes, r1, "E1", (Date.now() - t1) / 1000, a0.placementMap);
  a1.decisionMode = "packBest";
  log(rowToMd(s, a1));
  allResults.push({ sample: s.id, ...a1 });

  // E2 candidateUnion + E1
  const t2 = Date.now();
  const r2 = packBestWithCandidateUnion(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "biggest-cargo-first",
  });
  const a2 = analyzeResult(cargoes, r2, "E2", (Date.now() - t2) / 1000, a0.placementMap);
  a2.decisionMode = "candidateUnion";
  log(rowToMd(s, a2));
  allResults.push({ sample: s.id, ...a2 });
}

log("");
log("=== 실패 cargo 세부 ===");
for (const r of allResults) {
  if (r.unplacedCount === 0) continue;
  log(`[${r.sample} ${r.label}] unplaced ${r.unplacedCount} unit (cargo: ${r.unplacedCargoIds.join(", ")})`);
  if (r.softDetail.length > 0) {
    log(`  cbm 상세: ${r.softDetail.join(" / ")}`);
  }
}

log("");
log("=== 종합 ===");
for (const s of SAMPLES) {
  const e0 = allResults.find((r) => r.sample === s.id && r.label === "E0");
  const e1 = allResults.find((r) => r.sample === s.id && r.label === "E1");
  const e2 = allResults.find((r) => r.sample === s.id && r.label === "E2");
  if (!e0) continue;
  log(`[${s.id}] E0=${e0.unplacedCount} → E1=${e1?.unplacedCount ?? "-"} → E2=${e2?.unplacedCount ?? "-"}`);
}

const outPath = path.resolve("scripts/_diagnose-3rd-experiment-matrix-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
