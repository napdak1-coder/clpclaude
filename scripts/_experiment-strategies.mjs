/**
 * 1ST SG TOTAL 17 cargo 39 unit (unitSizes 정확 반영) - 다양한 전략 비교
 *
 * 전략:
 *   - LDF (volume desc)
 *   - height-first
 *   - footprint-first
 *   - YKMC-first
 *   - long-item-first
 *   - small-last
 *   - random shuffle (100 seeds)
 *
 * 모든 전략에서 raw tryPlaceUnit + tryPlaceUnitBruteForce 사용.
 * 컨테이너: 40FT 1대.
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total.json", "utf8"));
const PRACT_40 = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

// algorithm.ts 의 expandToUnits 와 정확히 동일한 로직
function expandToUnits(rows) {
  const out = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (!r) continue;
    const cargoId = `sg1-${idx+1}`;
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
          out.push({
            unitId: `${cargoId}-${i++}`, cargoId,
            shipper: r.actualShipperName, bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
            width: us.width, length: us.length, height: us.height, weight: w,
            remarks, _hasUnitSizes: true,
          });
        }
      }
    } else {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        out.push({
          unitId: `${cargoId}-${i}`, cargoId,
          shipper: r.actualShipperName, bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
          width: r.widthCm, length: r.lengthCm, height: r.heightCm, weight: perUnit,
          remarks, _hasUnitSizes: false,
        });
      }
    }
  }
  return out;
}

const rows = PRACT_40.map(sh => sample.rows.find(x => x.actualShipperName === sh));
const allUnits = expandToUnits(rows);

console.log("===== 39 unit 목록 (unitSizes 정확 반영) =====");
console.log("idx  unitId      실화주             W   L   H   weight  unitSizes?");
for (let i = 0; i < allUnits.length; i++) {
  const u = allUnits[i];
  console.log(`${String(i+1).padStart(3)}  ${u.unitId.padEnd(11)} ${u.shipper.padEnd(20)} ${String(u.width).padStart(3)} ${String(u.length).padStart(3)} ${String(u.height).padStart(3)} ${u.weight.toFixed(0).padStart(6)}  ${u._hasUnitSizes ? '✓' : '-'}`);
}
console.log(`\n총 unit: ${allUnits.length}`);

// 정렬 전략들
const strategies = {
  "LDF (volume desc)": (us) => [...us].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height)),
  "height-first": (us) => [...us].sort((a, b) => b.height - a.height),
  "footprint-first": (us) => [...us].sort((a, b) => (b.width * b.length) - (a.width * a.length)),
  "max-side-first": (us) => [...us].sort((a, b) => Math.max(b.width, b.length, b.height) - Math.max(a.width, a.length, a.height)),
  "long-item-first": (us) => [...us].sort((a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length)),
  "weight-first": (us) => [...us].sort((a, b) => b.weight - a.weight),
  "small-last (asc)": (us) => [...us].sort((a, b) => (a.width * a.length * a.height) - (b.width * b.length * b.height)),
  "YKMC-first then LDF": (us) => {
    const ykmc = us.filter(u => u.shipper === "YKMC");
    const others = us.filter(u => u.shipper !== "YKMC").sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height));
    return [...ykmc, ...others];
  },
  "tall-first (h>=100 먼저)": (us) => [...us].sort((a, b) => {
    const aTall = a.height >= 100 ? 1 : 0;
    const bTall = b.height >= 100 ? 1 : 0;
    if (aTall !== bTall) return bTall - aTall;
    return (b.width * b.length * b.height) - (a.width * a.length * a.height);
  }),
};

// 결정적 PRNG (seed 기반)
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleSeed(arr, seed) {
  const a = [...arr];
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function packAll(units) {
  const state = makeContainerState();
  const unplaced = [];
  for (const u of units) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { placed: state.placements.length, unplaced };
}

console.log("\n===== 전략별 결과 =====");
console.log("strategy                       | placed | unplaced | unplaced 화주");
console.log("-------------------------------|--------|----------|---------------");
for (const [name, sortFn] of Object.entries(strategies)) {
  const sorted = sortFn(allUnits);
  const r = packAll(sorted);
  const unpStr = r.unplaced.map(u => `${u.shipper}(${u.unitId})`).join(", ");
  console.log(`${name.padEnd(30)} |   ${String(r.placed).padStart(3)}  |    ${String(r.unplaced.length).padStart(2)}    | ${unpStr}`);
}

console.log("\n===== 100 random shuffle =====");
let bestUnp = 99, bestSeed = -1, bestUnpDetail = "";
const seedResults = new Map();
for (let seed = 1; seed <= 100; seed++) {
  const sorted = shuffleSeed(allUnits, seed);
  const r = packAll(sorted);
  const k = r.unplaced.length;
  seedResults.set(k, (seedResults.get(k) ?? 0) + 1);
  if (k < bestUnp) {
    bestUnp = k;
    bestSeed = seed;
    bestUnpDetail = r.unplaced.map(u => `${u.shipper}(${u.unitId})`).join(", ");
  }
  if (k === 0) {
    console.log(`  ✨ seed=${seed} → 0 미배치!`);
    break;
  }
}
console.log(`\n100 shuffle 결과 분포:`);
for (const [unp, count] of [...seedResults].sort((a, b) => a[0] - b[0])) {
  console.log(`  미배치 ${unp}: ${count} seed`);
}
console.log(`최고: seed=${bestSeed} unp=${bestUnp} (${bestUnpDetail})`);
