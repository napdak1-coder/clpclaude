/**
 * 3ST SG TOTAL 컨2 — anchor-first / R-based row search (variant 2)
 *
 * 목표: 27박스 0 미배치 layout 자동 탐색
 *
 * 직전 best (search-3st-sg-best.txt): 1/27 미배치 — ANC-d (176×151×164) 못 박음
 * 원인 가설: ANC-d 가 폭 176/151 필요 → 다른 박스가 먼저 폭 234 를 분할해서 막음
 *
 * 새 전략 portfolio:
 *   1. anchor-first (A1~A8): FLOWBUS + ANC-d + ANC-b(117×113×194) + SKGEO 큰박스 먼저 박기
 *   2. R-based (R1~R6): 사용자 제안 행 순서 (FLOWBUS 326 → ANC-d 176 → ANC-e/c 199 → KSB 143 → ...)
 *
 * 한 anchor 그룹마다 나머지는 sortStrategies × seed shuffle 으로 시도
 * 0 미배치 발견 시 즉시 중단.
 *
 * timeout 8분, 출력: logs/search-3st-sg-anchor-best.{json,txt}
 */
import fs from "node:fs";
import path from "node:path";
import {
  makeContainerState,
  tryPlaceUnit,
  tryPlaceUnitBruteForce,
} from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(
  fs.readFileSync("data/samples/singapore-total-3.json", "utf8"),
);
const spec = {
  type: "40FT",
  innerWidth: 234,
  innerLength: 1200,
  innerHeight: 268,
  doorHeight: 258,
  maxWeightKg: 25000,
  maxCbm: 60,
};

const LOG_BEST_JSON = path.resolve("logs/search-3st-sg-anchor-best.json");
const LOG_BEST_TXT = path.resolve("logs/search-3st-sg-anchor-best.txt");
fs.mkdirSync(path.dirname(LOG_BEST_JSON), { recursive: true });

// === unit expand ===
function expandUnits(rows) {
  const units = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const cargoId = `sg3-${idx + 1}`;
    const remarks = {
      noStacking: r.noStacking ?? false,
      topOnly: r.topOnly ?? false,
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    };
    if (r.unitSizes && r.unitSizes.length > 0) {
      const totalUnits =
        r.unitSizes.reduce((s, u) => s + u.quantity, 0) || r.quantity;
      const fallbackW = totalUnits > 0 ? (r.weightPerUnitKg ?? 0) / totalUnits : 0;
      let i = 0;
      for (const us of r.unitSizes) {
        const w = us.weight && us.weight > 0 ? us.weight : fallbackW;
        for (let k = 0; k < us.quantity; k++) {
          units.push({
            unitId: `${cargoId}-${i++}`,
            cargoId,
            shipper: r.actualShipperName,
            bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL",
            cfsCbm: r.cbm ?? null,
            width: us.width,
            length: us.length,
            height: us.height,
            weight: w,
            remarks,
          });
        }
      }
    } else if (r.widthCm > 0 && r.lengthCm > 0 && r.heightCm > 0) {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        units.push({
          unitId: `${cargoId}-${i}`,
          cargoId,
          shipper: r.actualShipperName,
          bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL",
          cfsCbm: r.cbm ?? null,
          width: r.widthCm,
          length: r.lengthCm,
          height: r.heightCm,
          weight: perUnit,
          remarks,
        });
      }
    }
  }
  return units;
}

const allUnits = expandUnits(sample.rows);
const c2Units = allUnits.filter(
  (u) => parseInt(u.cargoId.replace("sg3-", "")) - 1 >= 19,
);

// 분류 헬퍼
const byCargo = (id) => c2Units.filter((u) => u.cargoId === id);
const byCargoSize = (id, w, l, h) =>
  c2Units.filter(
    (u) =>
      u.cargoId === id && u.width === w && u.length === l && u.height === h,
  );

// FLOWBUS 326×116×110 ×2
const flowbus = byCargo("sg3-30");
// SKGEO: 135×115×129 ×2 + 137×115×85 ×1 (noStack)
const skGeo = byCargo("sg3-35");
// ANC LOGISTICS 5박스 (각각 다른 사이즈)
const ancA = byCargoSize("sg3-26", 110, 110, 102); // 작은 정육면체
const ancB = byCargoSize("sg3-26", 117, 113, 194); // 길쭉이
const ancC = byCargoSize("sg3-26", 168, 87, 99);
const ancD = byCargoSize("sg3-26", 176, 151, 164); // ★ 못 박는 놈
const ancE = byCargoSize("sg3-26", 199, 87, 99);

// KSB 143×101×195
const ksb = byCargo("sg3-34");

const allAnc = [...ancA, ...ancB, ...ancC, ...ancD, ...ancE];
const allUsed = new Set([
  ...flowbus.map((u) => u.unitId),
  ...skGeo.map((u) => u.unitId),
  ...allAnc.map((u) => u.unitId),
  ...ksb.map((u) => u.unitId),
]);
const others = c2Units.filter((u) => !allUsed.has(u.unitId));

console.log(
  `c2Units=${c2Units.length}, flowbus=${flowbus.length}, skGeo=${skGeo.length}, anc=${allAnc.length}, ksb=${ksb.length}, others=${others.length}`,
);

const VOL = (u) => u.width * u.length * u.height;
const MAXDIM = (u) => Math.max(u.width, u.length, u.height);

// === 정렬 전략 ===
const sortStrategies = {
  "tall-first": (a, b) => b.height - a.height,
  ldf: (a, b) => VOL(b) - VOL(a),
  footprint: (a, b) => b.width * b.length - a.width * a.length,
  "long-item": (a, b) => MAXDIM(b) - MAXDIM(a),
  "vphi-first": (a, b) =>
    (a.shipper.includes("VPHI") ? 0 : 1) -
      (b.shipper.includes("VPHI") ? 0 : 1) || VOL(b) - VOL(a),
  "small-fill-last": (a, b) => VOL(a) - VOL(b),
  "tall-then-ldf": (a, b) => {
    const aT = a.height >= 100 ? 0 : 1;
    const bT = b.height >= 100 ? 0 : 1;
    if (aT !== bT) return aT - bT;
    return VOL(b) - VOL(a);
  },
  "footprint-then-tall": (a, b) => {
    const af = a.width * a.length;
    const bf = b.width * b.length;
    if (af !== bf) return bf - af;
    return b.height - a.height;
  },
};

// === placeAt: 강제 좌표 + face 회전 모두 시도 ===
function placeAt(state, unit, x, y, z) {
  for (let f = 0; f < 6; f++) {
    const r = tryPlaceUnit(unit, state, spec, {
      scoreFn: (c) =>
        Math.abs(c.x - x) + Math.abs(c.y - y) + Math.abs(c.z - z) < 0.5
          ? 0
          : Number.POSITIVE_INFINITY,
      forceFaceIdx: f,
    });
    if (r) {
      const p = state.placements[state.placements.length - 1];
      if (
        Math.abs(p.position.x - x) < 5 &&
        Math.abs(p.position.y - y) < 5 &&
        Math.abs(p.position.z - z) < 5
      ) {
        return true;
      }
      // 좌표 안 맞으면 제거
      state.placements.pop();
      state.totalWeight -= unit.weight;
      state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
    }
  }
  return false;
}

function placeAuto(state, unit) {
  return (
    tryPlaceUnit(unit, state, spec) || tryPlaceUnitBruteForce(unit, state, spec)
  );
}

// === Anchor scenarios ===
// A1: FLOWBUS 폭병렬(0,0)+(116,0) → ANC-d 길이방향 (0,326,0) face4 로 176×151 → SKGEO 3개 자동
function anchorA1(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  // ANC-d 176×151×164 — 폭 176, 길이 151
  if (!placeAt(state, ancD[0], 0, 326, 0)) {
    if (!placeAt(state, ancD[0], 58, 326, 0)) {
      if (!placeAuto(state, ancD[0])) return false;
    }
  }
  // SKGEO 3개 자동
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A2: FLOWBUS 폭병렬 → SKGEO 먼저 (입구쪽 326~556) → ANC-d 그 다음 (556~)
function anchorA2(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  if (!placeAuto(state, ancD[0])) return false;
  return true;
}

// A3: FLOWBUS 폭병렬 → ANC-d + ANC-b(117×113×194 길쭉이) 같이 박기
function anchorA3(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  // ANC-d 176×151×164 (폭 176)
  if (!placeAuto(state, ancD[0])) return false;
  // ANC-b 117×113×194 (높이 194) → topOnly 가까운 박스
  if (!placeAuto(state, ancB[0])) return false;
  // SKGEO 자동
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A4: FLOWBUS 길이방향 분리 (0,0)(0,874) → ANC-d 가운데
function anchorA4(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 0, 874, 0)
  )
    return false;
  if (!placeAuto(state, ancD[0])) return false;
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A5: ANC-d 가장 먼저 (anchor 진짜 최우선)
function anchorA5(state) {
  if (!placeAt(state, ancD[0], 0, 0, 0)) {
    if (!placeAuto(state, ancD[0])) return false;
  }
  // FLOWBUS — ANC-d 옆에 (176,0,0) 시도, 폭 234 안에 116 들어감 → (176, ?) 안 됨, ANC-d 위 ?
  if (
    !placeAt(state, flowbus[0], 0, 151, 0) ||
    !placeAt(state, flowbus[1], 116, 151, 0)
  ) {
    if (!placeAuto(state, flowbus[0])) return false;
    if (!placeAuto(state, flowbus[1])) return false;
  }
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A6: ANC-d + KSB(143×101×195) + ANC-b 같이 큰 박스 우선
function anchorA6(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  if (!placeAuto(state, ancD[0])) return false; // 176×151×164
  if (!placeAuto(state, ksb[0])) return false; // 143×101×195
  if (!placeAuto(state, ancB[0])) return false; // 117×113×194
  if (!placeAuto(state, ancE[0])) return false; // 199×87×99
  if (!placeAuto(state, ancC[0])) return false; // 168×87×99
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A7: ANC-d 를 face=2 (l=176, w=151) 로 박기 — 폭이 151 이면 옆에 81 남음
function anchorA7(state) {
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  // 폭 151, 길이 176 (face 회전): 234-151=83 옆에 약간 남음
  if (!placeAt(state, ancD[0], 0, 326, 0)) {
    if (!placeAuto(state, ancD[0])) return false;
  }
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// A8: FLOWBUS 안쪽 (D variant) → ANC-d 입구쪽 + 모든 큰 박스 입구쪽
function anchorA8(state) {
  if (
    !placeAt(state, flowbus[0], 0, 874, 0) ||
    !placeAt(state, flowbus[1], 116, 874, 0)
  )
    return false;
  if (!placeAuto(state, ancD[0])) return false;
  if (!placeAuto(state, ksb[0])) return false;
  if (!placeAuto(state, ancB[0])) return false;
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

// === R-based (사용자 제안 행 순서) ===
// R1=FLOWBUS(326), R2=ANC-d(176×151), R3=ANC-e/c(199×87, 168×87 같은 행),
// R4=KSB+한도, R5=SKGEO-c+ANC-b, R6=SKGEO-a/b
function anchorR1(state) {
  // R1: FLOWBUS y 0~326 (폭 병렬)
  if (
    !placeAt(state, flowbus[0], 0, 0, 0) ||
    !placeAt(state, flowbus[1], 116, 0, 0)
  )
    return false;
  // R2: ANC-d 176×151×164 at y 326 (길이 151)
  if (!placeAt(state, ancD[0], 0, 326, 0)) return false;
  // R3: ANC-e 199×87×99 + ANC-c 168×87×99 같은 행 y 477 (길이 87)
  if (!placeAt(state, ancE[0], 0, 477, 0)) return false;
  if (!placeAt(state, ancC[0], 0, 564, 0)) return false;
  // R4: KSB 143×101×195 + ANC-a 110×110×102 같은 행
  if (!placeAt(state, ksb[0], 0, 651, 0)) return false;
  if (!placeAuto(state, ancA[0])) return false;
  // R5: ANC-b 117×113×194 + SKGEO-c 137×115×85
  if (!placeAuto(state, ancB[0])) return false;
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  return true;
}

function anchorR2(state) {
  // R-순서 반대: FLOWBUS 안쪽
  if (
    !placeAt(state, flowbus[0], 0, 874, 0) ||
    !placeAt(state, flowbus[1], 116, 874, 0)
  )
    return false;
  if (!placeAt(state, ancD[0], 0, 0, 0)) return false;
  for (const u of skGeo) if (!placeAuto(state, u)) return false;
  if (!placeAuto(state, ancB[0])) return false;
  if (!placeAuto(state, ksb[0])) return false;
  if (!placeAuto(state, ancE[0])) return false;
  if (!placeAuto(state, ancC[0])) return false;
  if (!placeAuto(state, ancA[0])) return false;
  return true;
}

const anchorScenarios = {
  A1: anchorA1,
  A2: anchorA2,
  A3: anchorA3,
  A4: anchorA4,
  A5: anchorA5,
  A6: anchorA6,
  A7: anchorA7,
  A8: anchorA8,
  R1: anchorR1,
  R2: anchorR2,
};

// === seed shuffle ===
function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// === trial ===
function runTrial(scenarioName, sortName, sortFn, seed) {
  const state = makeContainerState();
  const scenario = anchorScenarios[scenarioName];
  if (!scenario(state)) {
    return {
      placed: state.placements.length,
      unplaced: [...c2Units].slice(state.placements.length),
      reason: `anchor ${scenarioName} 실패`,
      state,
    };
  }
  // 이미 anchor 단계서 박은 cargoId/unitId 추적
  const placedIds = new Set(state.placements.map((p) => p.unitId));
  // 나머지 — anchor 단계서 안 박은 모든 unit 모음
  const remainingAnchorBoxes = [
    ...flowbus,
    ...skGeo,
    ...allAnc,
    ...ksb,
  ].filter((u) => !placedIds.has(u.unitId));
  let pool = [...remainingAnchorBoxes, ...others].sort(sortFn);
  if (seed > 0) pool = shuffle(pool, seed);

  const unplaced = [];
  for (const u of pool) {
    if (!placeAuto(state, u)) unplaced.push(u);
  }
  return {
    placed: state.placements.length,
    unplaced,
    reason: unplaced.length === 0 ? "성공" : "나머지 미배치",
    state,
  };
}

// === checkpoint ===
let best = { unplacedCount: Number.POSITIVE_INFINITY, runtime: 0 };

function saveCheckpoint(result, scenarioName, sortName, seed, runtime) {
  const placements = result.state.placements.map((p) => ({
    cargoId: p.cargoId,
    shipper: p.shipper,
    x: p.position.x,
    y: p.position.y,
    z: p.position.z,
    w: p.size.width,
    l: p.size.length,
    h: p.size.height,
    rotated: p.rotated,
    faceIdx: p.faceIdx,
    weight: p.weight,
  }));
  const totalCbm = result.state.visualCbm;
  const totalWeight = result.state.totalWeight;
  const json = {
    seed,
    strategy: `${scenarioName}/${sortName}`,
    unplacedCount: result.unplaced.length,
    unplaced: result.unplaced.map((u) => ({
      cargoId: u.cargoId,
      shipper: u.shipper,
      w: u.width,
      l: u.length,
      h: u.height,
      weight: u.weight,
    })),
    reason: result.reason,
    runtime,
    totalCbm,
    totalWeight,
    placements,
  };
  fs.writeFileSync(LOG_BEST_JSON, JSON.stringify(json, null, 2));

  let txt = `=== 3ST SG TOTAL 컨2 anchor-search BEST ===\n`;
  txt += `전략: ${scenarioName} / ${sortName} / seed=${seed}\n`;
  txt += `미배치: ${result.unplaced.length}/${c2Units.length}\n`;
  txt += `런타임: ${runtime.toFixed(1)}s\n`;
  txt += `총 부피: ${totalCbm.toFixed(2)} m³\n`;
  txt += `총 무게: ${totalWeight.toFixed(0)} kg\n`;
  txt += `이유: ${result.reason}\n\n`;
  txt += `--- 배치 (${placements.length}개) ---\n`;
  for (const p of placements) {
    txt += `  [${p.cargoId}] ${p.shipper} ${p.w}×${p.l}×${p.h} at (${p.x},${p.y},${p.z}) face=${p.faceIdx} ${p.weight}kg\n`;
  }
  if (result.unplaced.length > 0) {
    txt += `\n--- 미배치 (${result.unplaced.length}개) ---\n`;
    for (const u of result.unplaced) {
      txt += `  [${u.cargoId}] ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg\n`;
    }
  }
  fs.writeFileSync(LOG_BEST_TXT, txt);
}

// === main loop ===
const scenarioNames = Object.keys(anchorScenarios);
const sortNames = Object.keys(sortStrategies);
const SEEDS_PER_COMBO = 25; // 10 scenarios × 8 sort × 25 seed = 2000 trials

const tStart = Date.now();
const TIME_LIMIT_MS = 8 * 60 * 1000; // 8분

console.log("=== 3ST SG TOTAL 컨2 anchor-first search ===");
console.log(
  `portfolio: ${scenarioNames.length} scenarios × ${sortNames.length} sort × ${SEEDS_PER_COMBO} seed = ${scenarioNames.length * sortNames.length * SEEDS_PER_COMBO} trials`,
);
console.log(`최대 시간: 8분\n`);

let trialCount = 0;
let lastReport = tStart;

outer: for (const scn of scenarioNames) {
  for (const sortName of sortNames) {
    for (let seedIdx = 0; seedIdx < SEEDS_PER_COMBO; seedIdx++) {
      if (Date.now() - tStart > TIME_LIMIT_MS) break outer;
      const seed = seedIdx === 0 ? 0 : (trialCount * 2654435761) >>> 0;
      const result = runTrial(scn, sortName, sortStrategies[sortName], seed);
      trialCount++;
      const runtime = (Date.now() - tStart) / 1000;
      if (result.unplaced.length < best.unplacedCount) {
        best = { unplacedCount: result.unplaced.length, runtime };
        saveCheckpoint(result, scn, sortName, seed, runtime);
        console.log(
          `[${runtime.toFixed(1)}s][trial ${trialCount}] ${scn}/${sortName}/seed=${seed} 미배치 ${result.unplaced.length} ⭐ best`,
        );
        if (result.unplaced.length === 0) {
          console.log(`\n0 미배치 발견! 즉시 중단.`);
          break outer;
        }
      }
      if (Date.now() - lastReport > 60000) {
        console.log(
          `[${runtime.toFixed(1)}s][trial ${trialCount}] 진행 중 — best 미배치 ${best.unplacedCount}`,
        );
        lastReport = Date.now();
      }
    }
  }
}

const totalRuntime = (Date.now() - tStart) / 1000;
console.log(`\n=== 종합 ===`);
console.log(`총 trial: ${trialCount}`);
console.log(`런타임: ${totalRuntime.toFixed(1)}s`);
console.log(`Best 미배치: ${best.unplacedCount}`);
console.log(`체크포인트: ${LOG_BEST_JSON}`);
console.log(`        ${LOG_BEST_TXT}`);
