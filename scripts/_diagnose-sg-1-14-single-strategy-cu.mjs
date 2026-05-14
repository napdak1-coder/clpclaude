/* sg-1-14 해결 시도 — inline candidateUnion + singleStrategy + timeBudget (script-level).
 *
 * packBestWithCandidateUnion 의 multi-strategy matrix 우회.
 * algorithm.ts 수정 없음 — pack() 만 호출.
 */
import fs from "node:fs";
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;
const TIME_BUDGET_MS = 90_000; // 90s
const SAMPLE = { id: "sg-1", file: "data/samples/singapore-total.json" };

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

function analyze(result) {
  const unplCids = [...new Set(result.unplaced.map((u) => u.cargoId).filter(Boolean))];
  const unplUnits = result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  const cargoCi = new Map(), bkCi = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          const s = cargoCi.get(it.cargoId) ?? new Set();
          s.add(ci); cargoCi.set(it.cargoId, s);
        }
        if (it.bookingNo) {
          const s = bkCi.get(it.bookingNo) ?? new Set();
          s.add(ci); bkCi.set(it.bookingNo, s);
        }
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) {
        const s = cargoCi.get(b.cargoId) ?? new Set();
        s.add(ci); cargoCi.set(b.cargoId, s);
      }
      if (b.bookingNo) {
        const s = bkCi.get(b.bookingNo) ?? new Set();
        s.add(ci); bkCi.set(b.bookingNo, s);
      }
    }
  }
  const cargoSplit = [...cargoCi.values()].filter((s) => s.size > 1).length;
  const bookingSplit = [...bkCi.values()].filter((s) => s.size > 1).length;
  const audit = strictStackAudit(result);
  let softCbm = 0, hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  return { unplCids, unplUnits, cargoSplit, bookingSplit, auditPass: audit.pass && audit.violations.length === 0, softCbm, hardCbm, weightOver, set: result.containers.map((c) => c.spec.type).join("+") };
}

/** decideContainers 휴리스틱 — 운영 mode=auto, 컨 수 최소 우선 + 40FT 큰 셋 우선. */
function generateCandidateSets(totalCbm) {
  const sets = new Set();
  // 40FT 1대로 들어가면
  if (totalCbm <= 60 * SOFT + 0.001) sets.add(["40FT"].join("|"));
  // 20FT 1대로 들어가면
  if (totalCbm <= 28 * SOFT + 0.001) sets.add(["20FT"].join("|"));
  // 40FT+20FT
  if (totalCbm <= (60 + 28) * SOFT + 0.001) sets.add(["20FT", "40FT"].sort().join("|"));
  // 40FT × 2
  if (totalCbm <= 120 * SOFT + 0.001) sets.add(["40FT", "40FT"].join("|"));
  // 40FT × 2 + 20FT
  if (totalCbm <= 148 * SOFT + 0.001) sets.add(["20FT", "40FT", "40FT"].sort().join("|"));
  // 40FT × 3
  if (totalCbm <= 180 * SOFT + 0.001) sets.add(["40FT", "40FT", "40FT"].join("|"));
  return [...sets].map((k) => k.split("|"));
}

const rows = JSON.parse(fs.readFileSync(SAMPLE.file, "utf8")).rows;
const cargoes = build(rows, SAMPLE.id);

console.log("# sg-1-14 inline candidateUnion + singleStrategy + timeBudget 실험");
console.log(`date: ${new Date().toISOString()}`);
console.log(`timeBudgetMs: ${TIME_BUDGET_MS}, sortStrategy: booking-cluster-first`);
console.log("");

const start = Date.now();

// 1) initial pack — declared/physical 추출용 (sortStrategy='booking-cluster-first')
const initial = pack(cargoes, "auto", {
  strictVisualClassification: true,
  sortStrategy: "booking-cluster-first",
  attachDebug: true,
});
const initialA = analyze(initial);
const debug = initial.debug;
console.log(`## initial pack (sortStrategy='booking-cluster-first')`);
console.log(`- 컨 셋: ${initialA.set}`);
console.log(`- unplaced: ${initialA.unplUnits} unit, cargos: ${initialA.unplCids.join(",") || "-"}`);
console.log(`- pack 시간: ${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log("");

if (initialA.unplCids.length === 0) {
  console.log("✅ initial 에서 이미 unplaced 0 — candidateUnion 불필요");
  process.exit(0);
}

if (!debug) {
  console.log("⚠ debug 정보 없음 — 후보 union 시도 불가");
  process.exit(0);
}

console.log(`- declared CBM: ${debug.userDeclaredTotalCbm.toFixed(2)} m³`);
console.log(`- physical CBM: ${debug.physicalTotalCbm.toFixed(2)} m³`);
console.log("");

// 2) candidate sets 생성 (declared / physical 양쪽)
const candDeclared = generateCandidateSets(debug.userDeclaredTotalCbm);
const candPhysical = generateCandidateSets(debug.physicalTotalCbm);
const allCandKeys = new Set();
[...candDeclared, ...candPhysical].forEach((c) => allCandKeys.add(c.slice().sort().join("|")));
const candidates = [...allCandKeys].map((k) => k.split("|"));

// 컨 수 asc → capacity asc 정렬
const capacity = (cand) => cand.reduce((s, t) => s + (t === "40FT" ? 60 : 28), 0);
candidates.sort((a, b) => {
  if (a.length !== b.length) return a.length - b.length;
  return capacity(a) - capacity(b);
});

console.log(`## candidate sets 시도 (${candidates.length}개)`);
console.log("| candidate | unpl unit | cargoSplit | bookingSplit | audit | softCbm | hardCbm | wtOver | pack(s) | 결과 |");
console.log("|---|---:|---:|---:|---|---:|---:|---:|---:|---|");

const initialSet = initial.containers.map((c) => c.spec.type).slice().sort().join("|");
let bestResult = initial;
let bestAnalysis = initialA;

for (const cand of candidates) {
  if (Date.now() - start > TIME_BUDGET_MS) {
    console.log(`| (timeout) | — | — | — | — | — | — | — | — | budget 초과 |`);
    break;
  }
  const key = cand.slice().sort().join("|");
  const isInitial = key === initialSet;

  const t0 = Date.now();
  const r = isInitial ? initial : pack(cargoes, "auto", {
    strictVisualClassification: true,
    sortStrategy: "booking-cluster-first",
    fixedContainers: cand,
  });
  const packSec = (Date.now() - t0) / 1000;
  const a = analyze(r);

  const validUnpl0 = a.unplUnits === 0 && a.cargoSplit === 0 && a.bookingSplit === 0 && a.auditPass && a.hardCbm === 0 && a.weightOver === 0;
  console.log(
    `| ${cand.join("+")} | ${a.unplUnits} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.auditPass ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.weightOver} | ${packSec.toFixed(1)} | ${validUnpl0 ? "✅ 채택" : "—"} |`,
  );

  if (validUnpl0) {
    bestResult = r;
    bestAnalysis = a;
    break;
  }
  // best 비교 — 미배치 적은 순
  if (a.unplUnits < bestAnalysis.unplUnits) {
    bestResult = r;
    bestAnalysis = a;
  }
}

console.log("");
console.log("## 최종");
console.log(`- 컨 셋: ${bestAnalysis.set}`);
console.log(`- unplaced: ${bestAnalysis.unplUnits} unit (cargos: ${bestAnalysis.unplCids.join(",") || "-"})`);
console.log(`- 전체 시간: ${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log("");
console.log("## 결론");
if (bestAnalysis.unplUnits === 0) {
  console.log("✅ inline candidateUnion + booking-cluster + timeBudget 으로 sg-1-14 해결");
} else {
  console.log(`❌ 해결 안 됨 — 잔여: ${bestAnalysis.unplCids.join(",")}`);
}
