/**
 * 컨2 floor-only first 전략:
 *  1단계: FLOWBUS 폭 병렬 (116+116) — 입구쪽 y=0~326
 *  2단계: SK GEO 회전 (115×135) ×2 옆나란히 + (115×137) ×1
 *  3단계: 나머지 화물 LDF (큰 부피 desc)
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

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
const cargoMap = new Map();
for (const r of sample.rows.slice(19)) cargoMap.set(`sg3-${sample.rows.indexOf(r)+1}`, r.actualShipperName);

function tryAt(unit, state, x, y, z, faceIdx) {
  const scoreFn = (c) => {
    const ex = Math.abs(c.x - x) < 0.5 && Math.abs(c.y - y) < 0.5 && Math.abs(c.z - z) < 0.5;
    return ex ? 0 : Number.POSITIVE_INFINITY;
  };
  const opts = faceIdx !== undefined ? { scoreFn, forceFaceIdx: faceIdx } : { scoreFn };
  return tryPlaceUnit(unit, state, spec, opts);
}

const state = makeContainerState();
console.log("=== 1단계: FLOWBUS 폭 병렬 (116+116=232) ===");

// FLOWBUS 박스 1: 116×326×110 (face 회전 시도)
let f1 = false;
for (let f = 0; f < 6; f++) {
  if (tryAt(flowbus[0], state, 0, 0, 0, f)) {
    const p = state.placements[state.placements.length - 1];
    if (p.size.width === 116 && p.size.length === 326 && p.size.height === 110) {
      console.log(`  FLOWBUS-1: ${p.size.width}×${p.size.length}×${p.size.height} at (0,0,0) ✅`);
      f1 = true;
      break;
    }
    // 면 안 맞으면 제거하고 다음 시도
    state.placements.pop();
    state.totalWeight -= flowbus[0].weight;
    state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
  }
}
if (!f1) console.log(`  FLOWBUS-1: 폭 116 면 못 찾음 ❌`);

// FLOWBUS 박스 2: 같은 face, x=116
let f2 = false;
for (let f = 0; f < 6; f++) {
  if (tryAt(flowbus[1], state, 116, 0, 0, f)) {
    const p = state.placements[state.placements.length - 1];
    if (p.size.width === 116 && p.size.length === 326 && p.size.height === 110) {
      console.log(`  FLOWBUS-2: ${p.size.width}×${p.size.length}×${p.size.height} at (116,0,0) ✅`);
      f2 = true;
      break;
    }
    state.placements.pop();
    state.totalWeight -= flowbus[1].weight;
    state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
  }
}
if (!f2) console.log(`  FLOWBUS-2: 실패 ❌`);

console.log(`\n=== 2단계: SK GEO 3박스 자동 (z=0 강제) ===`);

// SK GEO 자동 배치 — z=0 (바닥) 우선 scoreFn
const sgUnp = [];
for (const u of skGeo) {
  const okSg = tryPlaceUnit(u, state, spec, {
    scoreFn: (c) => c.z * 1e6 + c.y * 1e3 + c.x, // z=0 강제, 그 후 y → x
  }) || tryPlaceUnitBruteForce(u, state, spec);
  if (okSg) {
    const p = state.placements[state.placements.length - 1];
    console.log(`  SK GEO ${u.unitId}: ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x},${p.position.y},${p.position.z}) ✅`);
  } else {
    console.log(`  SK GEO ${u.unitId} 실패 ❌`);
    sgUnp.push(u);
  }
}

console.log(`\n=== 3단계: 나머지 ${others.length} unit LDF + stack 시도 ===`);

// 나머지 LDF (큰 부피 → 작은 부피, 키 큰 박스 우선)
const sortedOthers = [...others].sort((a, b) => {
  // 키 큰 (>=190h) 먼저
  const aT = a.height >= 190 ? -1 : 0;
  const bT = b.height >= 190 ? -1 : 0;
  if (aT !== bT) return aT - bT;
  return VOL(b) - VOL(a);
});

let ok = 0;
const unp = [...sgUnp]; // SK GEO 미배치 포함
for (const u of sortedOthers) {
  const placed = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
  if (placed) ok++;
  else unp.push(u);
}
console.log(`  나머지: ${ok}/${others.length}`);
console.log(`\n=== 종합 ===`);
console.log(`총 placed: ${state.placements.length}/${c2Units.length}`);
if (unp.length === 0) {
  console.log(`✅ 0 미배치 달성!`);
} else {
  console.log(`미배치 ${unp.length}개:`);
  for (const u of unp) {
    console.log(`  ${u.shipper.padEnd(20)} ${u.cargoId.padEnd(8)} ${u.width}×${u.length}×${u.height}cm ${u.weight}kg`);
  }
  // cargoId atomic 통째 빠짐 시뮬
  console.log(`\n=== "한 화물 통째 룰" 적용 시 ===`);
  const cargoIdsToRemove = new Set(unp.map(u => u.cargoId));
  const totalAtomicMissing = c2Units.filter(u => cargoIdsToRemove.has(u.cargoId)).length;
  console.log(`미배치 화물 cargoId: ${[...cargoIdsToRemove].join(", ")}`);
  console.log(`그 화물 통째로 빼면 미배치: ${totalAtomicMissing} 박스`);
  console.log(`(개별 박스 수: ${unp.length}, 통째로 빼면: ${totalAtomicMissing})`);
}
