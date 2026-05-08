/**
 * 3ST SG TOTAL 컨2 — VPHI + 한도신소재 확장 cluster 실험
 *
 * 가설: 한도신소재 110×110×93 (1박스, sg3-27) 을 VPHI 114×114×71 ×2단 위에
 * 강제 적층하면 마지막 1박스 미배치 잔존이 해소된다.
 *
 * 수학:
 *   VPHI 71 + 71 + 한도 93 = 235cm ≤ 258 (도어 높이) ✓
 *   바닥 footprint 110×110 / 받침 114×114 = 93.1% ≥ 70% ✓
 *
 * 4컬럼 베이스 (이전 실험과 동일):
 *   A: sg3-22 ×2 자체이단 (111×111×208) ─ 한도 못 올림 (104+104+93=301 > 258)
 *   B: sg3-25 ×3 자체삼단 (114×114×213) ─ 한도 못 올림 (213+93=306 > 258)
 *   C: sg3-23 ×2 + sg3-24 ×1 자체삼단 (114×114×213) ─ 한도 못 올림
 *   D: sg3-24 ×1 단층 (114×114×71) ─ 한도 OK (71+93=164)
 *
 * 한도 적층 후보:
 *   [D-top] sg3-24 위 1단 → 71+93=164cm (단순)
 *
 * 더 적극적: 컬럼 구성 자체를 재배치해 한도 자리 만들기
 *   [Recipe-1] B 를 ×2단 으로 줄임 (sg3-25 ×2 = 142) → 한도 위 적층 (142+93=235)
 *              → 남는 sg3-25 ×1 은 어디 둠? D 옆 단층 또는 C 위 (이미 3단)
 *   [Recipe-2] C 를 ×2단 (sg3-23 ×2 = 142) → 한도 위 (142+93=235)
 *              → 남는 sg3-24 ×1 은 D 옆 단층
 *   [Recipe-3] D 위 (71+93=164) — 가장 단순
 *
 * 결과: cluster 안에 한도 흡수 → 미배치 0 도달 시도
 */
import fs from "node:fs";
import path from "node:path";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

const LOG_BEST_TXT = path.resolve("logs/experiment-vphi-handO-best.txt");
const LOG_RESULTS_TXT = path.resolve("logs/experiment-vphi-handO-results.txt");
fs.mkdirSync(path.dirname(LOG_BEST_TXT), { recursive: true });

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
const vphi22 = c2Units.filter(u => u.cargoId === "sg3-22"); // 111×111×104 ×2
const vphi23 = c2Units.filter(u => u.cargoId === "sg3-23"); // 114×114×71 ×2
const vphi24 = c2Units.filter(u => u.cargoId === "sg3-24"); // 114×114×71 ×2
const vphi25 = c2Units.filter(u => u.cargoId === "sg3-25"); // 114×114×71 ×3
const handO  = c2Units.filter(u => u.cargoId === "sg3-27"); // 한도 110×110×93 ×1
const others = c2Units.filter(u =>
  !["sg3-30", "sg3-35", "sg3-22", "sg3-23", "sg3-24", "sg3-25", "sg3-27"].includes(u.cargoId)
);

console.log(`컨2 총 unit: ${c2Units.length}`);
console.log(`  FLOWBUS: ${flowbus.length}, SK GEO: ${skGeo.length}`);
console.log(`  VPHI: 9 (22:${vphi22.length} 23:${vphi23.length} 24:${vphi24.length} 25:${vphi25.length})`);
console.log(`  한도: ${handO.length}, 기타: ${others.length}\n`);

const VOL = (u) => u.width * u.length * u.height;

const sortStrategies = {
  "tall-first":  (a,b) => b.height - a.height,
  "ldf":         (a,b) => VOL(b) - VOL(a),
  "footprint":   (a,b) => (b.width*b.length) - (a.width*a.length),
  "long-item":   (a,b) => Math.max(b.width,b.length,b.height) - Math.max(a.width,a.length,a.height),
  "anc-first":   (a,b) => (a.shipper.includes("ANC") ? 0 : 1) - (b.shipper.includes("ANC") ? 0 : 1) || VOL(b) - VOL(a),
  "anc-tall":    (a,b) => (a.shipper.includes("ANC") ? 0 : 1) - (b.shipper.includes("ANC") ? 0 : 1) || b.height - a.height,
};

function effSize(c, faceIdx) {
  const W = c.width, L = c.length, H = c.height;
  switch (faceIdx) {
    case 0: return { width: W, length: L, height: H };
    case 1: return { width: L, length: W, height: H };
    case 2: return { width: W, length: H, height: L };
    case 3: return { width: H, length: L, height: W };
    case 4: return { width: L, length: H, height: W };
    case 5: return { width: H, length: W, height: L };
  }
}

function placeAt(state, unit, x, y, z, faceIdx) {
  const cargo = { width: unit.width, length: unit.length, height: unit.height, weightPerUnit: unit.weight, remarks: unit.remarks };
  const eff = effSize(cargo, faceIdx);
  if (x + eff.width > spec.innerWidth + 0.01) return false;
  if (y + eff.length > spec.innerLength + 0.01) return false;
  if (z + eff.height > spec.innerHeight + 0.01) return false;
  for (const p of state.placements) {
    const overlap =
      x + eff.width > p.position.x + 0.01 && x + 0.01 < p.position.x + p.size.width &&
      y + eff.length > p.position.y + 0.01 && y + 0.01 < p.position.y + p.size.length &&
      z + eff.height > p.position.z + 0.01 && z + 0.01 < p.position.z + p.size.height;
    if (overlap) return false;
  }
  if (state.totalWeight + unit.weight > spec.maxWeightKg) return false;
  if (z > 0.01) {
    const supporters = state.placements.filter(p => {
      const topZ = p.position.z + p.size.height;
      if (Math.abs(topZ - z) > 0.01) return false;
      return (
        x + eff.width > p.position.x + 0.01 && x + 0.01 < p.position.x + p.size.width &&
        y + eff.length > p.position.y + 0.01 && y + 0.01 < p.position.y + p.size.length
      );
    });
    if (supporters.length === 0) return false;
    const points = [
      { x: x + 0.01, y: y + 0.01 },
      { x: x + eff.width - 0.01, y: y + 0.01 },
      { x: x + 0.01, y: y + eff.length - 0.01 },
      { x: x + eff.width - 0.01, y: y + eff.length - 0.01 },
      { x: x + eff.width / 2, y: y + eff.length / 2 },
    ];
    const fullySup = points.every(pt =>
      supporters.some(s =>
        pt.x >= s.position.x - 0.01 && pt.x <= s.position.x + s.size.width + 0.01 &&
        pt.y >= s.position.y - 0.01 && pt.y <= s.position.y + s.size.length + 0.01
      )
    );
    if (!fullySup) return false;
  }
  state.placements.push({
    unitId: unit.unitId, cargoId: unit.cargoId, shipper: unit.shipper, bookingNo: unit.bookingNo,
    name: unit.name, cargoType: unit.cargoType, cfsCbm: unit.cfsCbm,
    position: { x, y, z }, size: { width: eff.width, length: eff.length, height: eff.height },
    faceIdx, rotated: eff.width !== unit.width || eff.length !== unit.length,
    weight: unit.weight, remarks: unit.remarks,
    layer: z <= 0.01 ? "bottom" : "top",
  });
  state.totalWeight += unit.weight;
  state.visualCbm += (eff.width * eff.length * eff.height) / 1e6;
  state.candidates.push(
    { x: x + eff.width, y, z },
    { x, y: y + eff.length, z },
    { x, y, z: z + eff.height },
  );
  return true;
}

function placeFlowbus(state) {
  return placeAt(state, flowbus[0], 0, 0, 0, 1) && placeAt(state, flowbus[1], 116, 0, 0, 1);
}

function placeSkGeo(state) {
  for (const u of [...skGeo]) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) return false;
  }
  return true;
}

// === Recipe 별 cluster 배치 ===
//   Recipe-1: B 를 ×2단 (sg3-25 ×2) + 한도 위 적층 (142+93=235), 남는 sg3-25 ×1 은 D 위
//             D = 71 → sg3-25 위 (71+71=142 ≤ 235 OK)
//   Recipe-2: C 를 ×2단 (sg3-23 ×2 = 142) + 한도 위 적층, 남는 sg3-24 ×1 은 D 옆 (D-2)
//   Recipe-3: D 위 (sg3-24 71 + 한도 93 = 164), 나머지 cluster 는 원래대로
//   Recipe-4: A 는 그대로 (208), B/C/D 자체로 한도 적층 후보
//             D 위에 한도 → 164, B/C 그대로 213
function placeVphiHandOCluster(state, recipe, ax, ay) {
  // 컬럼 A 항상 동일 — sg3-22 ×2 자체이단 (111×111×208)
  if (!placeAt(state, vphi22[0], ax + 0,   ay + 0,   0,   0)) return false;
  if (!placeAt(state, vphi22[1], ax + 0,   ay + 0,   104, 0)) return false;

  if (recipe === "R1") {
    // B 를 ×2단 (sg3-25 ×2 = 142) + 한도 위 (235)
    if (!placeAt(state, vphi25[0], ax + 111, ay + 0,   0,   0)) return false;
    if (!placeAt(state, vphi25[1], ax + 111, ay + 0,   71,  0)) return false;
    // 한도 110×110 위 (114×114 받침 위)
    if (!placeAt(state, handO[0], ax + 111, ay + 0, 142, 0)) return false;
    // C 자체삼단
    if (!placeAt(state, vphi23[0], ax + 0,   ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi23[1], ax + 0,   ay + 114, 71,  0)) return false;
    if (!placeAt(state, vphi24[0], ax + 0,   ay + 114, 142, 0)) return false;
    // D = sg3-24 단층 + 남은 sg3-25 ×1 위 적층 (71+71=142)
    if (!placeAt(state, vphi24[1], ax + 114, ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi25[2], ax + 114, ay + 114, 71,  0)) return false;
    return true;
  }

  if (recipe === "R2") {
    // B 자체삼단
    if (!placeAt(state, vphi25[0], ax + 111, ay + 0,   0,   0)) return false;
    if (!placeAt(state, vphi25[1], ax + 111, ay + 0,   71,  0)) return false;
    if (!placeAt(state, vphi25[2], ax + 111, ay + 0,   142, 0)) return false;
    // C 를 ×2단 (sg3-23 ×2 = 142) + 한도 위 (235)
    if (!placeAt(state, vphi23[0], ax + 0,   ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi23[1], ax + 0,   ay + 114, 71,  0)) return false;
    if (!placeAt(state, handO[0],  ax + 0,   ay + 114, 142, 0)) return false;
    // D = sg3-24 ×1 + sg3-24 ×1 위 (71+71=142)
    if (!placeAt(state, vphi24[0], ax + 114, ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi24[1], ax + 114, ay + 114, 71,  0)) return false;
    return true;
  }

  if (recipe === "R3") {
    // B 자체삼단
    if (!placeAt(state, vphi25[0], ax + 111, ay + 0,   0,   0)) return false;
    if (!placeAt(state, vphi25[1], ax + 111, ay + 0,   71,  0)) return false;
    if (!placeAt(state, vphi25[2], ax + 111, ay + 0,   142, 0)) return false;
    // C 자체삼단
    if (!placeAt(state, vphi23[0], ax + 0,   ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi23[1], ax + 0,   ay + 114, 71,  0)) return false;
    if (!placeAt(state, vphi24[0], ax + 0,   ay + 114, 142, 0)) return false;
    // D = sg3-24 + 한도 (71+93=164)
    if (!placeAt(state, vphi24[1], ax + 114, ay + 114, 0,   0)) return false;
    if (!placeAt(state, handO[0],  ax + 114, ay + 114, 71,  0)) return false;
    return true;
  }

  if (recipe === "R4") {
    // R2 변형: C×2단+한도, B 자체삼단, D 단층 → 남은 sg3-24 ×1 은 D 위
    if (!placeAt(state, vphi25[0], ax + 111, ay + 0,   0,   0)) return false;
    if (!placeAt(state, vphi25[1], ax + 111, ay + 0,   71,  0)) return false;
    if (!placeAt(state, vphi25[2], ax + 111, ay + 0,   142, 0)) return false;
    if (!placeAt(state, vphi23[0], ax + 0,   ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi23[1], ax + 0,   ay + 114, 71,  0)) return false;
    if (!placeAt(state, handO[0],  ax + 0,   ay + 114, 142, 0)) return false;
    // D 컬럼: sg3-24 ×2 자체이단
    if (!placeAt(state, vphi24[0], ax + 114, ay + 114, 0,   0)) return false;
    if (!placeAt(state, vphi24[1], ax + 114, ay + 114, 71,  0)) return false;
    return true;
  }
  return false;
}

const vphiAnchors = [
  { x: 0, y: 326, label: "vphi-326" },
  { x: 0, y: 360, label: "vphi-360" },
  { x: 0, y: 441, label: "vphi-441" },
  { x: 0, y: 502, label: "vphi-502" },
  { x: 0, y: 670, label: "vphi-670" },
  { x: 0, y: 874, label: "vphi-874" },
  { x: 0, y: 972, label: "vphi-972" },
];
const recipes = ["R1", "R2", "R3", "R4"];

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

function runTrial(recipe, anchor, sortName, sortFn, seed) {
  const state = makeContainerState();
  if (!placeFlowbus(state)) return { unplaced: c2Units.length, reason: "FB실패", state, unplacedItems: [...c2Units] };
  if (!placeVphiHandOCluster(state, recipe, anchor.x, anchor.y)) {
    return { unplaced: 25, reason: `cluster ${recipe}@${anchor.label}실패`, state, unplacedItems: [] };
  }
  if (!placeSkGeo(state)) return { unplaced: 13, reason: "SG실패", state, unplacedItems: [...skGeo, ...others] };
  let pool = [...others].sort(sortFn);
  if (seed > 0) pool = shuffle(pool, seed);
  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { unplaced: unplaced.length, reason: unplaced.length === 0 ? "성공" : "기타미배치", state, unplacedItems: unplaced };
}

const sortNames = Object.keys(sortStrategies);
const seedsPerCombo = 30;
const tStart = Date.now();
let trialCount = 0;

const results = [];
let best = { unplaced: Infinity, label: "", state: null, unplacedItems: [] };

outer:
for (const recipe of recipes) {
  for (const anchor of vphiAnchors) {
    for (const sortName of sortNames) {
      let comboBest = Infinity;
      for (let seedIdx = 0; seedIdx < seedsPerCombo; seedIdx++) {
        const seed = seedIdx === 0 ? 0 : (trialCount * 2654435761) >>> 0;
        const r = runTrial(recipe, anchor, sortName, sortStrategies[sortName], seed);
        trialCount++;
        if (r.unplaced < comboBest) comboBest = r.unplaced;
        if (r.unplaced < best.unplaced) {
          best = { unplaced: r.unplaced, label: `${recipe}/${anchor.label}/${sortName}/seed=${seed}`, state: r.state, unplacedItems: r.unplacedItems };
          if (r.unplaced === 0) break outer;
        }
      }
      results.push({ recipe, anchor: anchor.label, sort: sortName, bestUnplaced: comboBest });
    }
  }
}

const totalRuntime = (Date.now() - tStart) / 1000;
console.log(`\n=== VPHI+한도 cluster 실험 결과 ===`);
console.log(`총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s`);

// recipe × anchor 표 (모든 sort 묶어서 min)
console.log("\nRecipe × anchor best 미배치 (모든 정렬 묶어 min):");
const summary = {};
for (const r of results) {
  const k = `${r.recipe}|${r.anchor}`;
  if (!(k in summary) || r.bestUnplaced < summary[k]) summary[k] = r.bestUnplaced;
}
console.log("recipe".padEnd(8) + vphiAnchors.map(a => a.label.padEnd(11)).join(""));
for (const recipe of recipes) {
  let line = recipe.padEnd(8);
  for (const anchor of vphiAnchors) {
    const v = summary[`${recipe}|${anchor.label}`];
    line += String(v ?? "-").padEnd(11);
  }
  console.log(line);
}

console.log(`\n--- BEST: ${best.label} → 미배치 ${best.unplaced}/${c2Units.length} ---`);
if (best.unplacedItems.length > 0) {
  for (const u of best.unplacedItems) {
    console.log(`  [${u.cargoId}] ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg`);
  }
}

let txt = `=== 3ST SG TOTAL 컨2 — VPHI+한도 cluster 실험 BEST ===\n`;
txt += `시나리오: ${best.label}\n`;
txt += `미배치: ${best.unplaced}/${c2Units.length}\n`;
txt += `총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s\n`;
if (best.state) {
  txt += `총 부피: ${best.state.visualCbm.toFixed(2)} m³\n`;
  txt += `총 무게: ${best.state.totalWeight.toFixed(0)} kg\n\n`;
  txt += `--- 배치 (${best.state.placements.length}개) ---\n`;
  for (const p of best.state.placements) {
    txt += `  [${p.cargoId}] ${p.shipper} ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x},${p.position.y},${p.position.z}) face=${p.faceIdx} ${p.weight}kg\n`;
  }
}
if (best.unplacedItems.length > 0) {
  txt += `\n--- 미배치 (${best.unplacedItems.length}개) ---\n`;
  for (const u of best.unplacedItems) {
    txt += `  [${u.cargoId}] ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg\n`;
  }
}
fs.writeFileSync(LOG_BEST_TXT, txt);

let resTxt = `=== VPHI+한도 cluster — 전체 시나리오 ===\n`;
resTxt += `총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s\n\n`;
resTxt += "recipe".padEnd(8) + "anchor".padEnd(12) + "sort".padEnd(14) + "best미배치\n";
for (const r of results) {
  resTxt += r.recipe.padEnd(8) + r.anchor.padEnd(12) + r.sort.padEnd(14) + r.bestUnplaced + "\n";
}
fs.writeFileSync(LOG_RESULTS_TXT, resTxt);
console.log(`\n저장: ${LOG_BEST_TXT}\n     ${LOG_RESULTS_TXT}`);
