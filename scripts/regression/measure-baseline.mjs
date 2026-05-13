/**
 * 9 샘플 baseline 실측 러너.
 *
 * 실행:
 *   node --experimental-strip-types scripts/regression/measure-baseline.mjs
 *
 * 출력:
 *   data/regression/baseline-2026-05-12-v1.json  (zod 검증 통과)
 *   docs/regression-baseline-2026-05-12-v1.md    (별도 헬퍼로 생성)
 *
 * 절차 (샘플당):
 *   1. JSON 파일 sha256 hash
 *   2. cargoes 빌드
 *   3. packBest(attachDebug: true) × 4 (워밍업 1 + 측정 3)
 *   4. 결과 동일성 검증
 *   5. strictStackAudit 호출
 *   6. BaselineSample 객체 생성
 *   7. zod 검증 후 baseline.json 저장
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const { packBest } = await import("../../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../../lib/packing/audit.ts");
const { BaselineSnapshotSchema } = await import(
  "../lib/regression-baseline-schema.ts"
);

const SAMPLES = [
  { id: "sg-mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json", expected: "PASS", mismatchSource: "none", mismatch: null },
  { id: "sg-1", name: "1ST SG TOTAL", file: "data/samples/singapore-total.json", expected: "KNOWN_MISMATCH", mismatchSource: "verify-script", mismatch: 8 },
  { id: "sg-2", name: "2ST SG TOTAL", file: "data/samples/singapore-total-2.json", expected: "PASS", mismatchSource: "verify-script", mismatch: 0 },
  { id: "sg-3", name: "3ST SG TOTAL", file: "data/samples/singapore-total-3.json", expected: "KNOWN_MISMATCH", mismatchSource: "verify-script", mismatch: 28 },
  { id: "sg-4", name: "4ST SG TOTAL", file: "data/samples/singapore-total-4.json", expected: "PASS", mismatchSource: "none", mismatch: null },
  { id: "hm-1", name: "1ST HM TOTAL", file: "data/samples/hochiminh-total.json", expected: "PASS", mismatchSource: "verify-script", mismatch: 0 },
  { id: "hm-2", name: "2ST HM TOTAL", file: "data/samples/hochiminh-total-2.json", expected: "KNOWN_MISMATCH", mismatchSource: "verify-script", mismatch: 28 },
  { id: "hm-3", name: "3ST HM TOTAL", file: "data/samples/hochiminh-total-3.json", expected: "PASS", mismatchSource: "none", mismatch: null },
  { id: "hm-4", name: "4ST HM TOTAL", file: "data/samples/hochiminh-total-4.json", expected: "KNOWN_MISMATCH", mismatchSource: "manual", mismatch: 29 },
];

function buildCargoes(rows, prefix) {
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

function summarizePlacement(r) {
  return JSON.stringify({
    containerCount: r.containers.length,
    types: r.containers.map((c) => c.spec.type),
    unplaced: r.unplaced.length,
    placements: r.containers.map((c) =>
      [
        c.rows?.length ?? 0,
        c.totalCbm.toFixed(3),
        c.totalWeight,
      ].join(":"),
    ),
  });
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function countCbmOverflow(r) {
  let n = 0;
  for (const c of r.containers) {
    if (c.totalCbm + c.ctCbm > c.spec.maxCbm + 0.001) n++;
  }
  return n;
}

function countWeightOverflow(r) {
  let n = 0;
  for (const c of r.containers) {
    if (c.totalWeight > c.spec.maxWeightKg + 0.001) n++;
  }
  return n;
}

function countCargoIdSplit(r) {
  const cargoCi = new Map();
  const collect = (cargoId, ci) => {
    if (!cargoId) return;
    const s = cargoCi.get(cargoId) ?? new Set();
    s.add(ci);
    cargoCi.set(cargoId, s);
  };
  r.containers.forEach((c, ci) => {
    for (const row of c.rows ?? [])
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])])
        collect(it.cargoId, ci);
    for (const b of c.bulkItems ?? []) collect(b.cargoId, ci);
  });
  let n = 0;
  for (const s of cargoCi.values()) if (s.size > 1) n++;
  return n;
}

function countBookingSplit(r) {
  const bkCi = new Map();
  const collect = (bk, ci) => {
    if (!bk) return;
    const s = bkCi.get(bk) ?? new Set();
    s.add(ci);
    bkCi.set(bk, s);
  };
  r.containers.forEach((c, ci) => {
    for (const row of c.rows ?? [])
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])])
        collect(it.bookingNo, ci);
    for (const b of c.bulkItems ?? []) collect(b.bookingNo, ci);
  });
  let n = 0;
  for (const s of bkCi.values()) if (s.size > 1) n++;
  return n;
}

async function measure(sample) {
  const wallT0 = performance.now();
  console.log(`[${sample.id}] ${sample.name} 측정 시작`);

  const filePath = path.resolve(sample.file);
  const fileBuf = fs.readFileSync(filePath);
  const inputFileHash =
    "sha256:" + createHash("sha256").update(fileBuf).digest("hex").slice(0, 16);

  const sampleJson = JSON.parse(fileBuf.toString("utf8"));
  const cargoes = buildCargoes(sampleJson.rows, sample.id);

  // 워밍업
  packBest(cargoes, "auto", { attachDebug: true });

  // 측정 3 회
  const times = [];
  let last = null;
  let firstSig = null;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = packBest(cargoes, "auto", { attachDebug: true });
    const dt = performance.now() - t0;
    times.push(dt);
    const sig = summarizePlacement(r);
    if (firstSig === null) firstSig = sig;
    else if (sig !== firstSig) {
      throw new Error(`[${sample.id}] 결과 비결정 — 측정 ${i + 1} 회차가 1 회차와 다름`);
    }
    last = r;
  }

  const debug = last.debug;
  if (!debug) throw new Error(`[${sample.id}] result.debug 없음 (attachDebug 미작동)`);

  // strict audit
  const audit = strictStackAudit(last);

  // unplaced cargoIds
  const unplacedCargoIds = Array.from(
    new Set(last.unplaced.map((u) => u.cargoId).filter(Boolean)),
  );
  const unplacedCount = last.unplaced.reduce(
    (s, u) => s + (u.quantity ?? 1),
    0,
  );
  const placedCount = debug.inputUnitTotalCount - unplacedCount;

  // 컨테이너 capacity
  const containerCapacityCbmList = last.containers.map((c) => c.spec.maxCbm);
  const totalCapacityCbm = containerCapacityCbmList.reduce((s, v) => s + v, 0);

  const inputTotalWeightKg = cargoes.reduce(
    (s, c) =>
      s +
      (c.unitSizes?.length
        ? c.unitSizes.reduce((u, x) => u + (x.weight ?? 0) * (x.quantity ?? 1), 0)
        : (c.weightPerUnit ?? 0) * (c.quantity ?? 1)),
    0,
  );

  const wallClockMs = performance.now() - wallT0;

  /** @type {import("../lib/regression-baseline-types.ts").BaselineSample} */
  const out = {
    sampleId: sample.id,
    sampleName: sample.name,
    sampleFile: sample.file,
    inputFileHash,
    expectedStatus: sample.expected,
    mode: "auto",
    inputCargoRowCount: cargoes.length,
    inputUnitTotalCount: debug.inputUnitTotalCount,
    inputTotalWeightKg,
    lightModeUsed: debug.lightModeUsed,
    containerSet: last.containers.map((c) => c.spec.type),
    containerCount: last.containers.length,
    containerCapacityCbmList,
    totalCapacityCbm,
    cbmBasis: debug.cbmBasis,
    userOverride: debug.userOverride,
    placedCount,
    unplacedCount,
    unplacedCargoIds,
    cargoIdSplitCount: countCargoIdSplit(last),
    bookingSplitCount: countBookingSplit(last),
    hardViolationCount: audit.violations.length,
    cbmOverflowCount: countCbmOverflow(last),
    weightOverflowCount: countWeightOverflow(last),
    strictAuditPass: audit.pass,
    userDeclaredTotalCbm: Math.round(debug.userDeclaredTotalCbm * 100) / 100,
    physicalTotalCbm: Math.round(debug.physicalTotalCbm * 100) / 100,
    legacyDecisionTotalCbm: Math.round(debug.legacyDecisionTotalCbm * 100) / 100,
    decidedVsRunnerUpDeltaCbm: 0,
    candidatesEvaluated: debug.candidatesEvaluated.map((a) => ({
      ...a,
      packTimeMs: Math.round(times[0]),
    })),
    practitionerMismatchCount: sample.mismatch,
    practitionerMismatchSource: sample.mismatchSource,
    packTimeMs: Math.round(times[0]),
    packTimeMedianOf3: Math.round(median(times)),
    wallClockMs: Math.round(wallClockMs),
    notes: `${sample.expected === "KNOWN_MISMATCH" && sample.mismatch != null ? `실무자 ${sample.mismatch}건 차이 · ` : ""}결정: ${debug.cbmBasis}`,
  };

  console.log(
    `[${sample.id}] 컨 ${out.containerSet.join("+")} · 미배치 ${unplacedCount} · audit ${audit.pass ? "✅" : "❌"} · ${Math.round(times[0])}ms`,
  );
  return out;
}

async function main() {
  console.log("=== 9 샘플 baseline 실측 시작 ===");
  const samples = [];
  for (const s of SAMPLES) {
    try {
      const m = await measure(s);
      samples.push(m);
    } catch (e) {
      console.error(`[${s.id}] 측정 실패:`, e.message);
      throw e;
    }
  }

  const snapshot = {
    schemaVersion: "1.0.0",
    dataVersion: "2026-05-12-v1",
    algorithmVersion: "rule-g-precluster + attachDebug (d6787fc+)",
    generatedAt: new Date().toISOString(),
    git: { commit: process.env.GIT_COMMIT || "d6787fc", branch: "master" },
    host: { node: process.version, platform: process.platform },
    ruleSetSnapshot: {
      decideContainers: "safety buffer 제거 상태",
      ruleG: "사전 묶음 승격 (bc07383)",
      candidateUnion: "미적용 (baseline 시점)",
    },
    thresholds: {
      cbmDiffAbs: 0.3,
      cbmDiffRel: 0.01,
      packTimeWarnRatio: 1.5,
      candidateMaxRunMs: 60000,
    },
    samples,
  };

  const parsed = BaselineSnapshotSchema.parse(snapshot);

  const outPath = path.resolve("data/regression/baseline-2026-05-12-v1.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
  console.log(`\n=== baseline 저장 완료: ${outPath} ===`);
  console.log(`총 샘플 ${samples.length}, zod 검증 통과 ✅`);
}

await main();
