/* 3차 E4~E8 — E3 base 위에서 combination 실험.
 *
 * 중요 발견 — 기존 알고리즘에 이미 있는 메커니즘:
 *   - reposition (`repositionUnplaced`, algorithm.ts:969) = E7 limited LNS 구현
 *   - brute force placement (`tryPlaceUnitBruteForce`) = E4 rotation retry + E6 gap-fill 부분 구현
 *   - Rule G `preClusterRowLane` = E5 adjacent lane (특정 조건만)
 *
 * → E4~E8 specification 과 기존 코드가 상당 부분 중복.
 *
 * 이번 실험: 기존 코드의 다른 옵션 조합으로 E3 잔여 미배치 해결 가능한지 검증.
 *
 * 실험 세트:
 *   E3 baseline                         : sortStrategy='booking-cluster-first'
 *   E4-containerOrderSmall              : E3 + containerOrder='smallest-first'
 *   E5-bigCargoFallback                 : E3 + biggest-cargo-first 시도 (다른 시작 순서)
 *   E6-heaviestFirst                    : 무거운 cargo 먼저
 *   E7-multiTry                         : E3 → 실패 시 E1/heaviest 자동 fallback (script-level)
 *   E8-candidateUnionAll                : packBestWithCandidateUnion 정식 wrapper (모든 전략 매트릭스)
 *     → 4ST SG / 5ST SG 시간 폭증 위험, 60s timeout 가드
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, packBestWithCandidateUnion, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
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

function analyze(result, packSec, label) {
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
    label,
    set: result.containers.map((c) => c.spec.type).join("+"),
    unpl: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
    unplIds,
    cargoSplit, bookingSplit,
    audit: audit.pass, auditV: audit.violations.length,
    softCbm, hardCbm, weightOver,
    packSec,
  };
}

function row(s, a) {
  return `| ${s.id} | ${a.label} | ${a.set} | ${a.unpl} | ${a.cargoSplit} | ${a.bookingSplit} | ${a.audit ? "P" : "F"} | ${a.softCbm} | ${a.hardCbm} | ${a.packSec.toFixed(1)} |`;
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("=== 3차 E4~E8 — E3 base + combinations ===");
log(`date: ${new Date().toISOString()}`);
log("");
log("**기존 알고리즘 메커니즘 (이미 구현됨)**:");
log("- repositionUnplaced (algorithm.ts:969) = E7 limited LNS 핵심 (cargoId 통째 제거 → 미배치 시도 → 다시 배치)");
log("- tryPlaceUnitBruteForce = E4 rotation retry + E6 gap-fill 핵심 (모든 회전 × 좌표 시도)");
log("- Rule G preClusterRowLane = E5 adjacent lane (조건: noStacking + variable unitSizes)");
log("");
log("→ E4~E8 specification 과 기존 코드 상당 부분 중복. 이번 실험은 옵션/sortStrategy 조합 시도.");
log("");
log("| sample | exp | 컨 셋 | unpl | cargoSpl | bookSpl | audit | softCbm | hardCbm | pack(s) |");
log("|---|---|---|---:|---:|---:|---|---:|---:|---:|");

const allResults = [];
const TIMEOUT_S = 60;

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  const experiments = [
    {
      id: "E3-base",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" }),
    },
    {
      id: "E4-bookSmall",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first", containerOrder: "smallest-first" }),
    },
    {
      id: "E5-bigCargoSmall",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "biggest-cargo-first", containerOrder: "smallest-first" }),
    },
    {
      id: "E6-heaviest",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "heaviest" }),
    },
    {
      id: "E7-tallestThenBook",
      run: () => pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "tallest" }),
    },
    {
      id: "E8-cu+bookCluster",
      run: () => packBestWithCandidateUnion(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" }),
    },
  ];

  for (const exp of experiments) {
    const t = Date.now();
    let result, packSec, errored = false, timedOut = false;
    try {
      result = exp.run();
      packSec = (Date.now() - t) / 1000;
      if (packSec > TIMEOUT_S) timedOut = true;
    } catch (e) {
      packSec = (Date.now() - t) / 1000;
      errored = true;
      log(`| ${s.id} | ${exp.id} | ERROR | — | — | — | — | — | — | ${packSec.toFixed(1)} |`);
      log(`  error: ${e.message?.slice(0, 100)}`);
      continue;
    }
    const a = analyze(result, packSec, exp.id);
    log(row(s, a) + (timedOut ? " ⚠ TIME" : ""));
    if (a.unpl > 0) log(`  unplaced: ${a.unplIds.join(",")}`);
    allResults.push({ sample: s.id, exp: exp.id, ...a, timedOut });

    // Auto branch: unplaced 0 이면 다음 실험 생략
    if (a.unpl === 0 && a.hardCbm === 0 && a.weightOver === 0 && a.cargoSplit === 0 && a.bookingSplit === 0) {
      log(`  ✅ unplaced 0 + 절대 룰 통과 — 후속 실험 생략`);
      break;
    }
  }
  log("");
}

log("=== 종합 (샘플별 가장 좋은 결과) ===");
for (const s of SAMPLES) {
  const sampleResults = allResults.filter((r) => r.sample === s.id);
  if (sampleResults.length === 0) continue;
  sampleResults.sort((a, b) => {
    if (a.unpl !== b.unpl) return a.unpl - b.unpl;
    if (a.hardCbm !== b.hardCbm) return a.hardCbm - b.hardCbm;
    return a.packSec - b.packSec;
  });
  const best = sampleResults[0];
  log(`[${s.id}] best: ${best.label} unpl=${best.unpl} pack=${best.packSec.toFixed(1)}s ${best.unplIds.length > 0 ? "unplIds=" + best.unplIds.join(",") : ""}`);
}

log("");
log("=== 분석 ===");
log("- 기존 brute-force + reposition + Rule G 가 이미 E4~E8 의 일부를 수행");
log("- sortStrategy / containerOrder 조합만으로 추가 해결 안 되면, 진정한 E4~E8 은 새 코드 필요:");
log("  E4 rotation retry (post-pack pass) — 기존 brute force 와 중복, 효과 불확실");
log("  E5 adjacent lane bundling 일반화 — Rule G 일반화, 큰 코드 변경");
log("  E6 gap-fill (post-pack pass) — 기존 brute force 와 중복");
log("  E7 limited LNS (다중 cargo 제거) — 기존 repositionUnplaced 확장, 큰 변경");
log("  E8 lightweight EP fallback — extreme-point 모듈 보강, 큰 변경");

const outPath = path.resolve("scripts/_diagnose-3rd-e4e8-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
