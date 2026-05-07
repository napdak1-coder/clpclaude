/**
 * 3ST SG TOTAL 컨2 30 unit 들어가는지 증명 실험
 * 시나리오:
 *   A. 부피 desc + LDF
 *   B. tall-first + volume desc + LDF
 *   C. 큰 박스 (FLOWBUS, KSB, ANC 큰거) pre-place + 나머지 LDF
 *   D. 100회 random shuffle + LDF
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

function expandUnits(rows) {
  const out = [];
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
          out.push({
            unitId: `${cargoId}-${i++}`, cargoId,
            shipper: r.actualShipperName, bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
            width: us.width, length: us.length, height: us.height, weight: w,
            remarks,
          });
        }
      }
    } else if (r.widthCm > 0 && r.lengthCm > 0 && r.heightCm > 0) {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        out.push({
          unitId: `${cargoId}-${i}`, cargoId,
          shipper: r.actualShipperName, bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
          width: r.widthCm, length: r.lengthCm, height: r.heightCm, weight: perUnit,
          remarks,
        });
      }
    }
  }
  return out;
}

const allUnits = expandUnits(sample.rows);
// 컨2 (row 20~35)
const c2Units = allUnits.filter(u => {
  const idx = parseInt(u.cargoId.replace("sg3-", "")) - 1;
  return idx >= 19;
});
const totalCbm = c2Units.reduce((s, u) => s + (u.width * u.length * u.height) / 1e6, 0);
console.log(`컨2 unit: ${c2Units.length}, 총 부피: ${totalCbm.toFixed(2)} m³ / 75.25 m³ (${(totalCbm/75.25*100).toFixed(1)}%)`);

function packPool(pool) {
  const state = makeContainerState();
  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { state, unplaced };
}

const VOL = (u) => u.width * u.length * u.height;
const MAXDIM = (u) => Math.max(u.width, u.length, u.height);

console.log("\n===== 시나리오 A: 부피 desc + LDF =====");
{
  const pool = [...c2Units].sort((a,b) => VOL(b) - VOL(a));
  const { unplaced } = packPool(pool);
  console.log(`미배치: ${unplaced.length}/${c2Units.length}`);
  if (unplaced.length > 0) for (const u of unplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

console.log("\n===== 시나리오 B: 막대>tall>부피 desc =====");
{
  const pool = [...c2Units].sort((a,b) => {
    const ar = MAXDIM(a) > 234 ? 0 : 1;
    const br = MAXDIM(b) > 234 ? 0 : 1;
    if (ar !== br) return ar - br;
    const at = a.height >= 100 ? 0 : 1;
    const bt = b.height >= 100 ? 0 : 1;
    if (at !== bt) return at - bt;
    return VOL(b) - VOL(a);
  });
  const { unplaced } = packPool(pool);
  console.log(`미배치: ${unplaced.length}/${c2Units.length}`);
  if (unplaced.length > 0) for (const u of unplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

console.log("\n===== 시나리오 C: 100회 random shuffle =====");
{
  let best = c2Units.length;
  let bestSeed = -1;
  let bestUnplaced = null;
  for (let s = 0; s < 100; s++) {
    let seed = s + 12345;
    const pool = [...c2Units];
    for (let i = pool.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const { unplaced } = packPool(pool);
    if (unplaced.length < best) {
      best = unplaced.length;
      bestSeed = s;
      bestUnplaced = unplaced;
    }
    if (best === 0) break;
  }
  console.log(`최저 미배치: ${best} (seed=${bestSeed})`);
  if (bestUnplaced && bestUnplaced.length > 0) for (const u of bestUnplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

console.log("\n===== 시나리오 D: 5개 정렬 비교 =====");
{
  const sorts = [
    ["height desc", (a,b) => b.height - a.height],
    ["length desc", (a,b) => Math.max(b.width, b.length) - Math.max(a.width, a.length)],
    ["footprint desc", (a,b) => (b.width * b.length) - (a.width * a.length)],
    ["height >= 100 first, then footprint", (a,b) => {
      const at = a.height >= 100 ? 0 : 1;
      const bt = b.height >= 100 ? 0 : 1;
      if (at !== bt) return at - bt;
      return (b.width * b.length) - (a.width * a.length);
    }],
    ["cargoId 묶음 우선 (같은 cargoId 연속)", (a,b) => {
      if (a.cargoId !== b.cargoId) return a.cargoId.localeCompare(b.cargoId);
      return VOL(b) - VOL(a);
    }],
  ];
  for (const [name, cmp] of sorts) {
    const pool = [...c2Units].sort(cmp);
    const { unplaced } = packPool(pool);
    console.log(`${name}: 미배치 ${unplaced.length}`);
  }
}
