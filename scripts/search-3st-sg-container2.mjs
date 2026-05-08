/**
 * 3ST SG TOTAL 컨2 — long-running portfolio search
 *
 * 목표: 27박스 + 5벌크 0 미배치 조합 자동 탐색
 *
 * 전략 portfolio:
 *   - FLOWBUS placement: A/B/C/D
 *   - SK GEO ordering: A/B/C/D/E/F
 *   - 나머지 정렬: 10종
 *   - seed 반복: 매 조합마다 random shuffle 50개
 *
 * 체크포인트 저장: logs/search-3st-sg-best.json + .txt
 * 0 미배치 발견 시 즉시 중단 + layout 출력.
 * 최대 실행 1시간 (3600초).
 */
import fs from "node:fs";
import path from "node:path";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

const LOG_BEST_JSON = path.resolve("logs/search-3st-sg-best.json");
const LOG_BEST_TXT = path.resolve("logs/search-3st-sg-best.txt");
fs.mkdirSync(path.dirname(LOG_BEST_JSON), { recursive: true });

// === 데이터 expand (unitSizes 정확 반영) ===
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
      const totalUnits = r.unitSizes.reduce((s, u) => s + u.quantity, 0) || r.quantity;
      const fallbackW = totalUnits > 0 ? (r.weightPerUnitKg ?? 0) / totalUnits : 0;
      let i = 0;
      for (const us of r.unitSizes) {
        const w = us.weight && us.weight > 0 ? us.weight : fallbackW;
        for (let k = 0; k < us.quantity; k++) {
          units.push({ unitId: `${cargoId}-${i++}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
            width: us.width, length: us.length, height: us.height, weight: w, remarks });
        }
      }
    } else if (r.widthCm > 0 && r.lengthCm > 0 && r.heightCm > 0) {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        units.push({ unitId: `${cargoId}-${i}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
          width: r.widthCm, length: r.lengthCm, height: r.heightCm, weight: perUnit, remarks });
      }
    }
  }
  return units;
}

const allUnits = expandUnits(sample.rows);
const c2Units = allUnits.filter(u => parseInt(u.cargoId.replace("sg3-", "")) - 1 >= 19);

const flowbus = c2Units.filter(u => u.cargoId === "sg3-30");
const skGeo = c2Units.filter(u => u.cargoId === "sg3-35");
const others = c2Units.filter(u => u.cargoId !== "sg3-30" && u.cargoId !== "sg3-35");

const VOL = (u) => u.width * u.length * u.height;
const MAXDIM = (u) => Math.max(u.width, u.length, u.height);

// === 정렬 전략들 ===
const sortStrategies = {
  "tall-first":     (a,b) => (b.height) - (a.height),
  "ldf":            (a,b) => VOL(b) - VOL(a),
  "footprint":      (a,b) => (b.width*b.length) - (a.width*a.length),
  "long-item":      (a,b) => MAXDIM(b) - MAXDIM(a),
  "heavy-first":    (a,b) => (b.weight ?? 0) - (a.weight ?? 0),
  "stackable":      (a,b) => (a.remarks.noStacking ? 1 : 0) - (b.remarks.noStacking ? 1 : 0),
  "vphi-first":     (a,b) => (a.shipper.includes("VPHI") ? 0 : 1) - (b.shipper.includes("VPHI") ? 0 : 1) || VOL(b) - VOL(a),
  "anc-first":      (a,b) => (a.shipper.includes("ANC") ? 0 : 1) - (b.shipper.includes("ANC") ? 0 : 1) || VOL(b) - VOL(a),
  "small-fill-last":(a,b) => VOL(a) - VOL(b),
  "tall-then-ldf":  (a,b) => {
    const aT = a.height >= 100 ? 0 : 1;
    const bT = b.height >= 100 ? 0 : 1;
    if (aT !== bT) return aT - bT;
    return VOL(b) - VOL(a);
  },
};

// === FLOWBUS 배치 후보 (4종) ===
function placeFlowbus(state, variant, rng) {
  const fb = [...flowbus];
  switch (variant) {
    case "A": // 폭 병렬 (116+116=232) 입구쪽
      return placeAt(state, fb[0], 0, 0, 0) && placeAt(state, fb[1], 116, 0, 0);
    case "B": // 길이방향 분리: 1박스 입구쪽, 1박스 안쪽
      return placeAt(state, fb[0], 0, 0, 0) && placeAt(state, fb[1], 0, 874, 0);
    case "C": // 문쪽 (입구) — A 와 동일하지만 회전 검증
      return placeAt(state, fb[0], 0, 0, 0) && placeAt(state, fb[1], 116, 0, 0);
    case "D": // 안쪽 (length 끝)
      return placeAt(state, fb[0], 0, 874, 0) && placeAt(state, fb[1], 116, 874, 0);
  }
  return false;
}

// === SK GEO 배치 후보 (6종) — 모두 floorOnly z=0 ===
function placeSkGeo(state, variant, rng) {
  const sg = [...skGeo]; // [135×115×129, 135×115×129, 137×115×85]
  const sgFreeOrder = (state) => {
    const ok = [];
    for (const u of sg) {
      const r = tryPlaceUnit(u, state, spec, { scoreFn: (c) => c.z * 1e6 + c.y * 1e3 + c.x });
      if (!r) {
        const r2 = tryPlaceUnitBruteForce(u, state, spec);
        if (!r2) return false;
      }
      ok.push(true);
    }
    return ok.length === sg.length;
  };
  switch (variant) {
    case "A": return sgFreeOrder(state); // 자동 z=0 우선
    case "B": // FLOWBUS 앞쪽 (y < FLOWBUS y)
      return placeAt(state, sg[0], 0, 326, 0) && placeAt(state, sg[1], 0, 441, 0) && placeAt(state, sg[2], 135, 326, 0);
    case "C": // FLOWBUS 뒤쪽
      return sgFreeOrder(state); // FLOWBUS variant D 일 때 알아서 앞쪽 (y < 874) 잡힘
    case "D": // 폭 좌우 분산
      return placeAt(state, sg[0], 0, 326, 0) && placeAt(state, sg[1], 119, 326, 0) && placeAt(state, sg[2], 0, 461, 0);
    case "E": // 137×115×85 먼저
      return placeAt(state, sg[2], 0, 326, 0) && placeAt(state, sg[0], 137, 326, 0) && placeAt(state, sg[1], 0, 411, 0);
    case "F": // 135×115×129 2개 먼저
      return placeAt(state, sg[0], 0, 326, 0) && placeAt(state, sg[1], 0, 441, 0) && placeAt(state, sg[2], 0, 556, 0);
  }
  return false;
}

function placeAt(state, unit, x, y, z) {
  const before = state.placements.length;
  for (let f = 0; f < 6; f++) {
    const r = tryPlaceUnit(unit, state, spec, {
      scoreFn: (c) => Math.abs(c.x - x) + Math.abs(c.y - y) + Math.abs(c.z - z) < 0.5 ? 0 : Number.POSITIVE_INFINITY,
      forceFaceIdx: f,
    });
    if (r) {
      const p = state.placements[state.placements.length - 1];
      // 좌표 일치 확인 (5cm 이내)
      if (Math.abs(p.position.x - x) < 5 && Math.abs(p.position.y - y) < 5 && Math.abs(p.position.z - z) < 5) {
        return true;
      }
      // 좌표 안 맞으면 pop
      state.placements.pop();
      state.totalWeight -= unit.weight;
      state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
    }
  }
  // 강제 좌표 실패 — 자동 배치
  return tryPlaceUnit(unit, state, spec) || tryPlaceUnitBruteForce(unit, state, spec);
}

// === seed 기반 random shuffle ===
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

// === 한 조합 trial ===
function runTrial(fbVariant, sgVariant, sortName, sortFn, seed) {
  const state = makeContainerState();

  // 1. FLOWBUS
  const fbOk = placeFlowbus(state, fbVariant);
  if (!fbOk) return { placed: 0, unplaced: [...c2Units], reason: "FLOWBUS 배치 실패", state };

  // 2. SK GEO
  const sgOk = placeSkGeo(state, sgVariant);
  if (!sgOk) return { placed: state.placements.length, unplaced: [...skGeo, ...others], reason: "SK GEO 배치 실패", state };

  // 3. 나머지 — 정렬 후 seed 셔플 옵션
  let pool = [...others].sort(sortFn);
  if (seed > 0) pool = shuffle(pool, seed);

  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { placed: state.placements.length, unplaced, reason: unplaced.length === 0 ? "성공" : "나머지 미배치", state };
}

// === best checkpoint ===
let best = { unplacedCount: Number.POSITIVE_INFINITY, runtime: 0 };

function saveCheckpoint(result, fbVariant, sgVariant, sortName, seed, runtime) {
  const placements = result.state.placements.map(p => ({
    cargoId: p.cargoId,
    shipper: p.shipper,
    x: p.position.x, y: p.position.y, z: p.position.z,
    w: p.size.width, l: p.size.length, h: p.size.height,
    rotated: p.rotated,
    faceIdx: p.faceIdx,
    weight: p.weight,
  }));
  const totalCbm = result.state.visualCbm;
  const totalWeight = result.state.totalWeight;
  const json = {
    seed, strategy: `FB-${fbVariant}/SG-${sgVariant}/${sortName}`,
    unplacedCount: result.unplaced.length,
    unplaced: result.unplaced.map(u => ({ cargoId: u.cargoId, shipper: u.shipper, w: u.width, l: u.length, h: u.height, weight: u.weight })),
    reason: result.reason,
    runtime,
    totalCbm, totalWeight,
    placements,
  };
  fs.writeFileSync(LOG_BEST_JSON, JSON.stringify(json, null, 2));

  let txt = `=== 3ST SG TOTAL 컨2 search BEST ===\n`;
  txt += `전략: FB-${fbVariant} / SG-${sgVariant} / ${sortName} / seed=${seed}\n`;
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
const fbVariants = ["A", "B", "C", "D"];
const sgVariants = ["A", "B", "C", "D", "E", "F"];
const sortNames = Object.keys(sortStrategies);
const seedsPerCombo = 50;

const tStart = Date.now();
const TIME_LIMIT_MS = 60 * 60 * 1000; // 1시간

console.log("=== 3ST SG TOTAL 컨2 portfolio search ===");
console.log(`목표: 0 미배치 layout 발견 (실무자가 실제 배치했음)`);
console.log(`portfolio: ${fbVariants.length} FB × ${sgVariants.length} SG × ${sortNames.length} sort × ${seedsPerCombo} seed = ${fbVariants.length * sgVariants.length * sortNames.length * seedsPerCombo} trials`);
console.log(`최대 시간: 1시간\n`);

let trialCount = 0;
let lastReportTime = tStart;

outer:
for (const fbV of fbVariants) {
  for (const sgV of sgVariants) {
    for (const sortName of sortNames) {
      for (let seedIdx = 0; seedIdx < seedsPerCombo; seedIdx++) {
        const elapsed = Date.now() - tStart;
        if (elapsed > TIME_LIMIT_MS) break outer;

        const seed = seedIdx === 0 ? 0 : (trialCount * 2654435761) >>> 0;
        const result = runTrial(fbV, sgV, sortName, sortStrategies[sortName], seed);
        trialCount++;

        const runtime = (Date.now() - tStart) / 1000;
        if (result.unplaced.length < best.unplacedCount) {
          best = { unplacedCount: result.unplaced.length, runtime };
          saveCheckpoint(result, fbV, sgV, sortName, seed, runtime);
          console.log(`[${runtime.toFixed(1)}s][trial ${trialCount}] FB-${fbV}/SG-${sgV}/${sortName}/seed=${seed} 미배치 ${result.unplaced.length} ⭐ best`);
          if (result.unplaced.length === 0) {
            console.log(`\n🎉 0 미배치 발견! 즉시 중단.`);
            break outer;
          }
        }

        // 60초마다 진행 보고
        if (Date.now() - lastReportTime > 60000) {
          console.log(`[${runtime.toFixed(1)}s][trial ${trialCount}] 진행 중 — best 미배치 ${best.unplacedCount}`);
          lastReportTime = Date.now();
        }
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
