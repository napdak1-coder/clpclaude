/**
 * 컨2: FLOWBUS + SK GEO 두 화주 먼저 강제 배치 후 나머지 LDF
 * 두 화주 모두 noStacking → 바닥(z=0) 강제
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
const VOL = (u) => u.width * u.length * u.height;

const flowbus = c2Units.filter(u => u.cargoId === "sg3-30");
const skGeo = c2Units.filter(u => u.cargoId === "sg3-35");
const others = c2Units.filter(u => u.cargoId !== "sg3-30" && u.cargoId !== "sg3-35");

console.log(`FLOWBUS: ${flowbus.length} 박스`);
console.log(`SK GEO: ${skGeo.length} 박스`);
console.log(`나머지: ${others.length} unit\n`);

function runOrder(name, ordered, restSort) {
  const state = makeContainerState();
  let placed = 0;
  const phaseResults = [];
  for (const phase of ordered) {
    let phaseOk = 0;
    for (const u of phase.units) {
      const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
      if (ok) { placed++; phaseOk++; }
    }
    phaseResults.push(`${phase.label}: ${phaseOk}/${phase.units.length}`);
  }
  const restPool = [...others].sort(restSort);
  let restOk = 0;
  const unp = [];
  for (const u of restPool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (ok) { placed++; restOk++; }
    else unp.push(u);
  }
  console.log(`[${name}]`);
  for (const r of phaseResults) console.log(`  ${r}`);
  console.log(`  나머지: ${restOk}/${restPool.length}`);
  console.log(`  총 placed: ${placed}/${c2Units.length}`);
  if (unp.length > 0) {
    console.log(`  미배치 ${unp.length}개:`);
    for (const u of unp) console.log(`    ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}cm`);
  } else {
    console.log(`  ✅ 0 미배치!`);
  }
  console.log("");
  return placed === c2Units.length;
}

// 시나리오 1: FLOWBUS 먼저, SK GEO 다음, 나머지 부피 desc
runOrder("1. FLOWBUS → SK GEO → 부피 desc", [
  { label: "FLOWBUS", units: flowbus },
  { label: "SK GEO", units: skGeo },
], (a, b) => VOL(b) - VOL(a));

// 시나리오 2: SK GEO 먼저, FLOWBUS 다음, 나머지 부피 desc
runOrder("2. SK GEO → FLOWBUS → 부피 desc", [
  { label: "SK GEO", units: skGeo },
  { label: "FLOWBUS", units: flowbus },
], (a, b) => VOL(b) - VOL(a));

// 시나리오 3: FLOWBUS, SK GEO 박스를 큰 순서대로 섞어서
const both = [...flowbus, ...skGeo].sort((a, b) => VOL(b) - VOL(a));
runOrder("3. FLOWBUS+SK GEO 부피 desc 섞어 → 부피 desc", [
  { label: "FLOWBUS+SK GEO", units: both },
], (a, b) => VOL(b) - VOL(a));

// 시나리오 4: FLOWBUS+SK GEO 먼저 + 나머지 키큰(>=190h) 우선 + 부피 desc
runOrder("4. FLOWBUS+SK GEO → 키큰 우선 → 부피 desc", [
  { label: "FLOWBUS", units: flowbus },
  { label: "SK GEO", units: skGeo },
], (a, b) => {
  const aT = a.height >= 190 ? -1 : 0;
  const bT = b.height >= 190 ? -1 : 0;
  if (aT !== bT) return aT - bT;
  return VOL(b) - VOL(a);
});

// 시나리오 5: FLOWBUS+SK GEO → cargoId 같은 묶음 우선
runOrder("5. FLOWBUS+SK GEO → cargoId 부피합 desc", [
  { label: "FLOWBUS", units: flowbus },
  { label: "SK GEO", units: skGeo },
], (a, b) => {
  const cargoVol = (cid) => c2Units.filter(u => u.cargoId === cid).reduce((s,u) => s + VOL(u), 0);
  const av = cargoVol(a.cargoId);
  const bv = cargoVol(b.cargoId);
  if (av !== bv) return bv - av;
  return VOL(b) - VOL(a);
});
