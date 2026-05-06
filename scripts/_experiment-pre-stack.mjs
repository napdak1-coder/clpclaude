/**
 * 1ST SG TOTAL — pre-place column stack 실험 (synthetic block 안 만듦)
 *
 * 가설:
 *   원래 unit 그대로 유지 (cargoId 유지, sizes 유지) +
 *   같은 cargo 의 unit 들을 같은 (x, y) 의 다른 z 로 강제 배치 →
 *   다른 cargo 자리 확보.
 *
 * 방식:
 *   1) 빈 packState 만들고
 *   2) 데코론·YKMC 등 stack 가능한 cargo 의 unit 을 직접 (x, y, z) 강제 배치
 *      tryPlaceUnit(scoreFn = exact match) 사용
 *   3) 나머지 unit 은 normal tryPlaceUnit / tryPlaceUnitBruteForce
 *   4) 미배치 / 충전률 비교
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total.json", "utf8"));
const PRACT_40 = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];

const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, maxWeightKg: 25000 };

// 17 cargo 의 unit 들 expand
function expandUnits(rows) {
  const units = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const perUnit = (r.weightPerUnitKg ?? 0) / r.quantity;
    for (let i = 0; i < r.quantity; i++) {
      units.push({
        unitId: `sg1-${idx + 1}-${i}`,
        cargoId: `sg1-${idx + 1}`,
        shipper: r.actualShipperName,
        bookingNo: r.bookingNo,
        name: null,
        cargoType: r.cargoType ?? "PL",
        cfsCbm: r.cbm ?? null,
        width: r.widthCm,
        length: r.lengthCm,
        height: r.heightCm,
        weight: perUnit,
        remarks: {
          noStacking: r.noStacking ?? false,
          topOnly: r.topOnly ?? false,
          orientation: r.orientation ?? "free",
          heavierBelow: r.heavierBelow ?? false,
        },
      });
    }
  }
  return units;
}

const rows = PRACT_40.map(sh => sample.rows.find(x => x.actualShipperName === sh));
const allUnits = expandUnits(rows);
console.log(`총 unit: ${allUnits.length}`);

// LDF 정렬 (큰 부피 먼저) — 각 cargoId 별 unit 순서는 unit-index 순
function sortLDF(units) {
  return [...units].sort((a, b) => {
    const va = a.width * a.length * a.height;
    const vb = b.width * b.length * b.height;
    return vb - va;
  });
}

// 실험: pre-place 정의 방식
// preStacks = [{ cargoId, x, y, faceIdx, units: [unit, unit, ...] }, ...]
// 각 unit 을 z 좌표 누적으로 배치
function tryPlaceAt(unit, state, x, y, z, faceIdx) {
  const scoreFn = (c) => {
    const ex = Math.abs(c.x - x) < 0.5 && Math.abs(c.y - y) < 0.5 && Math.abs(c.z - z) < 0.5;
    return ex ? 0 : Number.POSITIVE_INFINITY;
  };
  return tryPlaceUnit(unit, state, spec, { scoreFn, forceFaceIdx: faceIdx });
}

function runExperiment(label, preStacks) {
  console.log(`\n===== ${label} =====`);
  const state = makeContainerState();
  const usedIds = new Set();

  // 1) pre-place
  let preFail = false;
  for (const ps of preStacks) {
    let z = 0;
    for (let i = 0; i < ps.units.length; i++) {
      const u = ps.units[i];
      const ok = tryPlaceAt(u, state, ps.x, ps.y, z, ps.faceIdx);
      if (!ok) {
        console.log(`   pre-place FAIL: ${u.shipper} #${i} at (${ps.x},${ps.y},${z})`);
        preFail = true;
        break;
      }
      usedIds.add(u.unitId);
      const lastP = state.placements[state.placements.length - 1];
      z += lastP.size.height;
    }
    if (preFail) break;
  }
  if (preFail) {
    console.log("   ⚠ pre-place 실패");
    return;
  }
  console.log(`   pre-place: ${state.placements.length} unit`);

  // 2) 나머지 unit normal pack (LDF)
  const remaining = sortLDF(allUnits.filter(u => !usedIds.has(u.unitId)));
  let placed = 0;
  const unplaced = [];
  for (const u of remaining) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (ok) placed++;
    else unplaced.push(u);
  }

  const totalCbm = state.placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  const cap = (spec.innerWidth * spec.innerLength * spec.innerHeight) / 1e6;
  console.log(`   normal placed: ${placed}, unplaced: ${unplaced.length}`);
  console.log(`   미배치 화물 (unit 단위):`);
  const byCargo = new Map();
  for (const u of unplaced) {
    byCargo.set(u.shipper, (byCargo.get(u.shipper) ?? 0) + 1);
  }
  for (const [sh, n] of byCargo) console.log(`     - ${sh}: ${n} unit`);
  console.log(`   충전률: ${(totalCbm / cap * 100).toFixed(1)}%`);
  console.log(`   weight: ${state.totalWeight.toFixed(0)} / ${spec.maxWeightKg} kg`);
}

// === 시나리오 ===
const dekoUnits = allUnits.filter(u => u.shipper === "데코론");
const ykmcUnits = allUnits.filter(u => u.shipper === "YKMC");

// faceIdx: 0=원본 (W×L×H), 1=W↔L 회전 등. 데코론 247×129×46 → 회전 필수 (W=247>234)
//   faceIdx=1 → 129×247×46 (W=129 OK)
// YKMC 118×114×59 → 원본 (faceIdx=0) OK
// 정확한 face index 는 extreme-point allowedFaces 결과에 따라 다름. 시도해보자.

// 1. baseline (no pre-stack)
runExperiment("baseline (no pre-place)", []);

// 2. 데코론 only — (0, 0, 0) 와 (0, 0, 46) 에 강제
runExperiment("데코론 pre-stack only (faceIdx=1, 129×247×46)", [
  { cargoId: dekoUnits[0].cargoId, x: 0, y: 0, faceIdx: 1, units: dekoUnits },
]);

// 3. YKMC 4-stack + 2-stack 묶음 (faceIdx=0, 118×114×59)
runExperiment("YKMC pre-stack only (4+2 split, faceIdx=0)", [
  { cargoId: ykmcUnits[0].cargoId, x: 0, y: 0, faceIdx: 0, units: ykmcUnits.slice(0, 4) },
  { cargoId: ykmcUnits[0].cargoId, x: 118, y: 0, faceIdx: 0, units: ykmcUnits.slice(4) },
]);

// 4. YKMC 3+3 split
runExperiment("YKMC pre-stack only (3+3 split)", [
  { cargoId: ykmcUnits[0].cargoId, x: 0, y: 0, faceIdx: 0, units: ykmcUnits.slice(0, 3) },
  { cargoId: ykmcUnits[0].cargoId, x: 118, y: 0, faceIdx: 0, units: ykmcUnits.slice(3) },
]);

// 5. YKMC 2+2+2 split
runExperiment("YKMC pre-stack only (2+2+2 split)", [
  { cargoId: ykmcUnits[0].cargoId, x: 0, y: 0, faceIdx: 0, units: ykmcUnits.slice(0, 2) },
  { cargoId: ykmcUnits[0].cargoId, x: 118, y: 0, faceIdx: 0, units: ykmcUnits.slice(2, 4) },
  { cargoId: ykmcUnits[0].cargoId, x: 0, y: 114, faceIdx: 0, units: ykmcUnits.slice(4) },
]);

// 6. 데코론 + YKMC (4+2)
runExperiment("데코론 + YKMC pre-stack (4+2)", [
  { cargoId: dekoUnits[0].cargoId, x: 0, y: 0, faceIdx: 1, units: dekoUnits },
  { cargoId: ykmcUnits[0].cargoId, x: 129, y: 0, faceIdx: 0, units: ykmcUnits.slice(0, 4) },
  { cargoId: ykmcUnits[0].cargoId, x: 0, y: 247, faceIdx: 0, units: ykmcUnits.slice(4) },
]);
