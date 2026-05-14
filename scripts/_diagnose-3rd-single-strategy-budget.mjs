/* 3차 — singleStrategy + time budget 실험 (제한된 진단 runner).
 *
 * 목표:
 *   1. sg-4 E8 stall 원인 분리:
 *      - candidateUnion 자체 폭증 (n candidate sets × pack)
 *      - packBest multi-strategy matrix 폭증 (8 strategies × pack)
 *      - cargo brute-force 폭증 (단일 pack 안 시간)
 *   2. sg-4-4 / sg-5 잔여 cargo 가 singleStrategy 별 어떻게 동작하는지
 *   3. sg-5 E3 base 잔여 cargo 정확한 개수 (cargoId vs unit 구분)
 *
 * 실험 (모두 pack() 단독, multi-strategy matrix 우회):
 *   E9 pack-booking-cluster (단일)
 *   E10 pack-biggest-cargo (단일)
 *   E11 inline candidateUnion + booking-cluster (단일) — 각 candidate set 시도
 *   E12 inline candidateUnion + biggest-cargo (단일)
 *
 * 각 실험 60s timeout (Date.now() 가드).
 *
 * read-only — production / algorithm / packer 수정 없음.
 * (decideContainers 가 export 안 됨 — candidate set 은 후보 union 휴리스틱으로 생성)
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;
const TIMEOUT_S = 60;

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
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    },
    itemRemark: r.itemRemark ?? "",
  }));
}

function analyze(cargoes, result, packSec, timedOut) {
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

  // unplaced cargoId 별 unit 수 집계
  const unplPerCargo = new Map();
  for (const u of result.unplaced) {
    if (!u.cargoId) continue;
    unplPerCargo.set(u.cargoId, (unplPerCargo.get(u.cargoId) ?? 0) + (u.quantity ?? 1));
  }
  const unplCargoIds = [...unplPerCargo.entries()].map(([cid, n]) => `${cid}×${n}`);

  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplCargoCount: unplPerCargo.size,
    unplCargoIds,
    cargoSplit, bookingSplit,
    audit: audit.pass, auditV: audit.violations.length,
    softCbm, hardCbm, weightOver,
    packSec,
    timedOut,
  };
}

/** 단일 전략 candidateUnion 휴리스틱 — decideContainers export X 라 단순 후보 시도 */
function runInlineCandidateUnion(cargoes, mode, opts, t0, deadlineMs) {
  // 1) initial pack with attachDebug
  const initial = pack(cargoes, mode, { ...opts, attachDebug: true });
  if (Date.now() - t0 > deadlineMs) return initial;
  const debug = initial.debug;
  if (!debug) return initial;

  // 2) candidate sets — initial + 작은 셋 (40FT 1대 / 20FT 1대 / 40FT × 1+) 시도
  const physical = debug.physicalTotalCbm;
  const declared = debug.userDeclaredTotalCbm;
  const initialSet = initial.containers.map((c) => c.spec.type);
  const candidates = [initialSet];
  if (physical > 0 && physical <= 60 * SOFT_OVERFLOW) candidates.push(["40FT"]);
  if (physical > 0 && physical <= 28 * SOFT_OVERFLOW) candidates.push(["20FT"]);
  // 작은 셋 우선 정렬
  candidates.sort((a, b) => a.length - b.length);

  const seen = new Set();
  let best = initial;
  let bestUnpl = initial.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  for (const cand of candidates) {
    if (Date.now() - t0 > deadlineMs) break;
    const key = cand.slice().sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const r = pack(cargoes, mode, { ...opts, fixedContainers: cand });
    const unpl = r.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
    // valid (softCap) 검사
    let hardOver = 0;
    for (const c of r.containers) {
      const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
      if ((c.totalCbm ?? 0) + (c.ctCbm ?? 0) > softCap + 0.001) hardOver++;
    }
    if (unpl === 0 && hardOver === 0) {
      return r; // 단락 채택
    }
    if (unpl < bestUnpl) {
      best = r;
      bestUnpl = unpl;
    }
  }
  return best;
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("# 3차 — singleStrategy + time budget 실험");
log(`date: ${new Date().toISOString()}`);
log(`timeout: ${TIMEOUT_S}s/실험, softCap=${SOFT_OVERFLOW}`);
log("");
log("## 실험: pack() 단일 전략 + 인라인 candidateUnion (multi-strategy matrix 우회)");
log("");
log("| sample | exp | 컨 셋 | unpl unit | unpl cargo | cargoIds | cargoSpl | bookSpl | audit | softCbm | hardCbm | pack(s) | timeout |");
log("|---|---|---|---:|---:|---|---:|---:|---|---:|---:|---:|:---:|");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  const experiments = [
    {
      id: "E9-pack-bookCluster",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" }),
    },
    {
      id: "E10-pack-bigCargo",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" }),
    },
    {
      id: "E11-cu+bookCluster",
      run: (t0, deadline) =>
        runInlineCandidateUnion(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" }, t0, deadline),
    },
    {
      id: "E12-cu+bigCargo",
      run: (t0, deadline) =>
        runInlineCandidateUnion(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" }, t0, deadline),
    },
  ];

  for (const exp of experiments) {
    const t0 = Date.now();
    const deadline = TIMEOUT_S * 1000;
    let result;
    try {
      result = exp.run(t0, deadline);
    } catch (e) {
      const packSec = (Date.now() - t0) / 1000;
      log(`| ${s.id} | ${exp.id} | ERROR | — | — | — | — | — | — | — | — | ${packSec.toFixed(1)} | — |`);
      log(`  error: ${e.message?.slice(0, 100)}`);
      continue;
    }
    const packSec = (Date.now() - t0) / 1000;
    const timedOut = packSec > TIMEOUT_S;
    const a = analyze(cargoes, result, packSec, timedOut);
    log(
      `| ${s.id} | ${exp.id} | ${a.set} | ${a.unpl} | ${a.unplCargoCount} | ${a.unplCargoIds.join(",") || "—"} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.packSec.toFixed(1)} | ${a.timedOut ? "TIME" : ""} |`,
    );

    // unplaced 0 + valid 이면 후속 생략 (성공)
    if (a.unpl === 0 && a.hardCbm === 0 && a.weightOver === 0 && a.cargoSplit === 0 && a.bookingSplit === 0) {
      log(`  ✅ unplaced 0 + 절대 룰 통과 — 후속 실험 생략`);
      break;
    }
  }
  log("");
}

log("## sg-4 E8 stall 원인 분리");
log("- E9 pack-bookCluster (단일 전략): sg-4 = ${밑 결과 확인}");
log("- E11 cu+bookCluster (단일 전략 + candidate sets): sg-4 = ${밑 결과 확인}");
log("- 만약 E11 도 stall 가능성 시: candidateUnion 자체 폭증");
log("- E11 빠르고 packBest 8 strategy 우회만 stall 회피 시: multi-strategy matrix 폭증");
log("- E9 자체 stall 시: cargo brute-force 폭증 (단일 pack 안)");
log("");
log("## sg-5 잔여 cargo 개수 정확 보고");
log("- E9 결과의 unplCargoIds 컬럼이 cargoId × unit 수 형식 (예: sg-5-35×2 → cargoId 1개, unit 2개)");
log("- 이전 보고에서 \"sg-5 잔여 3 cargo\" 는 사실 \"3 unit\" 의 잘못된 표현 가능성 — 본 실험 결과로 확정");

const outPath = path.resolve("scripts/_diagnose-3rd-single-strategy-budget-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
