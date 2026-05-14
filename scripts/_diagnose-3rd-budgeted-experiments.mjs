/* 3차 단계 — budgeted single-strategy experiment runner.
 *
 * full packBest 8전략 매트릭스 사용 안 함. pack() 직접 호출 (단일 전략).
 * 각 실험 60초 timeout 가드 (pack 내부 brute-force budget 의존).
 *
 * 실험 (현재 구현 가능 범위):
 *   E0-single                    : pack() default ldf
 *   E1-bigCargoFirst             : pack() sortStrategy='biggest-cargo-first'
 *   E2-candidateUnion+E1         : custom inline candidate union + pack() biggest-cargo-first
 *   E3-bookingClusterFirst       : pack() sortStrategy='booking-cluster-first'
 *
 * 미구현 (별도 알고리즘 작업 필요 — defer):
 *   E4 adjacent lane (기존 룰 G 가 같은 cargoId noStacking + variable unitSizes 대상으로만 동작 — 일반화 X)
 *   E5 rotation retry (실패 cargo 한정 6면 재시도 — 별도 fallback 함수 필요)
 *   E6 gap-fill (잔여 공간 탐색 + 끼우기 패스 — 별도 함수 필요)
 *   E7 LNS (destroy & reconstruct — placeQueue 외부 큰 변경)
 *   E8 lightweight EP fallback (extreme-point 모듈 보강 — 별도 작업)
 *
 * 4 샘플 × 4 실험 = 16 runs. 각 ~5~60s. 전체 ~10~15분 예상.
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");
const { decideContainersFromCbm } = await (async () => {
  // decideContainers 가 export 안 됨 — 우회: pack 결과 후보 셋 분석
  return {};
})();

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;
const TIMEOUT_MS = 60000;

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

  const unplIds = [...new Set(result.unplaced.filter((u) => u.cargoId).map((u) => u.cargoId))];

  return {
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplIds,
    cargoSplit, bookingSplit,
    audit: audit.pass, auditV: audit.violations.length,
    softCbm, hardCbm, weightOver,
    packSec,
    timedOut,
    containerOf: cargoCi,
  };
}

/** custom candidateUnion using pack() (single strategy) */
function runCandidateUnion(cargoes, mode, opts) {
  // initial pack — declared/physical 추출용
  const initial = pack(cargoes, mode, { ...opts, attachDebug: true });
  const debug = initial.debug;
  if (!debug) return initial;

  // 후보 union 후보 셋 추출 (decideContainers 가 export 안돼서 initial 결과만 사용)
  // 단순화: physical/declared 각각으로 pack 호출. 작은 셋이 valid 면 그것 채택.
  // 우선 initial 셋 + 더 작은 셋 시도 (망작: 40FT 1대)
  const initialSet = initial.containers.map((c) => c.spec.type);
  // 망작 케이스: declared 60.032 → 40FT 1대 시도
  // 일반화: 시스템 CBM 보다 작은 단일 컨 셋 시도
  const physical = debug.physicalTotalCbm;
  const candidates = [initialSet];
  if (physical > 0 && physical <= 60) candidates.push(["40FT"]);
  if (physical > 0 && physical <= 28) candidates.push(["20FT"]);

  // 작은 셋 우선 시도
  candidates.sort((a, b) => a.length - b.length);
  let best = initial;
  for (const cand of candidates) {
    const key = cand.slice().sort().join("|");
    const initKey = initialSet.slice().sort().join("|");
    if (key === initKey) continue; // 이미 시도
    const r = pack(cargoes, mode, { ...opts, fixedContainers: cand });
    const unpl = r.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
    if (unpl === 0) {
      // softCap 검사
      let hardOver = 0;
      for (const c of r.containers) {
        const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
        if ((c.totalCbm ?? 0) + (c.ctCbm ?? 0) > softCap + 0.001) hardOver++;
      }
      if (hardOver === 0) {
        best = r;
        break; // 단락 채택
      }
    }
  }
  return best;
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("=== 3차 budgeted single-strategy experiment matrix ===");
log(`date: ${new Date().toISOString()}`);
log(`timeout: ${TIMEOUT_MS / 1000}s/실험, softCap=${SOFT_OVERFLOW}`);
log("");
log("| sample | exp | 컨 셋 | mode | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | wtOver | pack(s) | timeout |");
log("|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|:---:|");

const allResults = [];

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  const experiments = [
    { id: "E0-single", run: () => pack(cargoes, "auto", { strictVisualClassification: true }), mode: "pack-ldf" },
    { id: "E1-bigCargo", run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" }), mode: "pack-bigCargo" },
    { id: "E2-cu+bigCargo", run: () => runCandidateUnion(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first" }), mode: "candidateUnion" },
    { id: "E3-bookingCluster", run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" }), mode: "pack-booking" },
  ];

  for (const exp of experiments) {
    const t = Date.now();
    let result, packSec, timedOut = false, errored = false;
    try {
      result = exp.run();
      packSec = (Date.now() - t) / 1000;
      if (packSec > TIMEOUT_MS / 1000) timedOut = true;
    } catch (e) {
      packSec = (Date.now() - t) / 1000;
      errored = true;
      log(`| ${s.id} | ${exp.id} | ERROR | ${exp.mode} | — | — | — | — | — | — | — | ${packSec.toFixed(1)} | — |`);
      log(`  error: ${e.message?.slice(0, 100)}`);
      continue;
    }
    const a = analyze(cargoes, result, packSec, timedOut);
    log(
      `| ${s.id} | ${exp.id} | ${a.set} | ${exp.mode} | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.weightOver} | ${a.packSec.toFixed(1)} | ${a.timedOut ? "TIME" : ""} |`,
    );
    if (a.unpl > 0) log(`  unplaced: ${a.unplIds.join(",")}`);
    allResults.push({ sample: s.id, exp: exp.id, ...a });
  }
}

log("");
log("=== 종합 (샘플별 미배치 추이) ===");
for (const s of SAMPLES) {
  const cells = ["E0-single", "E1-bigCargo", "E2-cu+bigCargo", "E3-bookingCluster"].map((expId) => {
    const r = allResults.find((x) => x.sample === s.id && x.exp === expId);
    if (!r) return "—";
    return `${r.unpl}${r.timedOut ? "(T)" : ""}${r.hardCbm > 0 ? "(HARD)" : ""}`;
  });
  log(`[${s.id}] E0=${cells[0]} → E1=${cells[1]} → E2=${cells[2]} → E3=${cells[3]}`);
}

log("");
log("=== 미구현 실험 (별도 알고리즘 작업 필요) ===");
log("- E4 adjacent lane (기존 룰 G 부분 동작, 일반화 X)");
log("- E5 rotation retry (실패 cargo 한정 6면 재시도 fallback)");
log("- E6 gap-fill (잔여 공간 탐색 패스)");
log("- E7 limited LNS (destroy & reconstruct)");
log("- E8 lightweight EP fallback (Moving EP / Maximal Space)");

const outPath = path.resolve("scripts/_diagnose-3rd-budgeted-experiments-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
