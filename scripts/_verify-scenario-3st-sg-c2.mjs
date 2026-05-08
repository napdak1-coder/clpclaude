/**
 * 3ST SG TOTAL 컨2 — 다양한 pre-place 시나리오 0 미배치 검증
 * 에이전트가 추천한 시나리오 B/C/D/E를 실제로 돌려서 0 미배치 가능 여부 확정.
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

console.log(`컨2 unit: ${c2Units.length}, 총 부피: ${(c2Units.reduce((s,u)=>s+VOL(u),0)/1e6).toFixed(2)} m³`);
console.log("");

function packPool(pool) {
  const state = makeContainerState();
  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { state, unplaced };
}

// 시나리오별 정렬
function runScenario(name, sortFn) {
  const pool = [...c2Units].sort(sortFn);
  const { state, unplaced } = packPool(pool);
  const cbmPlaced = state.placements.reduce((s,p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  console.log(`[${name}]`);
  console.log(`  배치: ${state.placements.length}/${c2Units.length}, 충전률 ${(cbmPlaced/75.25*100).toFixed(1)}%`);
  if (unplaced.length > 0) {
    console.log(`  미배치 ${unplaced.length}개:`);
    for (const u of unplaced) console.log(`    ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}cm`);
  } else {
    console.log(`  ✅ 0 미배치!`);
  }
  console.log("");
  return { name, placed: state.placements.length, unplaced: unplaced.length };
}

const results = [];

// 시나리오 B: ANC 최대 박스 (176×151×164) 우선, 그 외 부피 desc
results.push(runScenario("B: ANC 176×151×164 최우선 + 부피 desc", (a, b) => {
  const aMax = a.cargoId === "sg3-26" && a.width === 176 ? -1 : 0;
  const bMax = b.cargoId === "sg3-26" && b.width === 176 ? -1 : 0;
  if (aMax !== bMax) return aMax - bMax;
  return VOL(b) - VOL(a);
}));

// 시나리오 C: KSB(195) + ANC(194) 키큰 박스 우선, 그 외 부피 desc
results.push(runScenario("C: KSB 195h + ANC 194h 우선 + 부피 desc", (a, b) => {
  const aTall = (a.height === 195 && a.cargoId === "sg3-34") || (a.height === 194 && a.cargoId === "sg3-26") ? -1 : 0;
  const bTall = (b.height === 195 && b.cargoId === "sg3-34") || (b.height === 194 && b.cargoId === "sg3-26") ? -1 : 0;
  if (aTall !== bTall) return aTall - bTall;
  return VOL(b) - VOL(a);
}));

// 시나리오 D: FLOWBUS 안쪽 우선, 그 외 부피 desc
results.push(runScenario("D: FLOWBUS 326cm 우선 + 부피 desc", (a, b) => {
  const aF = a.cargoId === "sg3-30" ? -1 : 0;
  const bF = b.cargoId === "sg3-30" ? -1 : 0;
  if (aF !== bF) return aF - bF;
  return VOL(b) - VOL(a);
}));

// 시나리오 E: SK GEO column stack 우선, 그 외 부피 desc
results.push(runScenario("E: SK GEO 우선 + 부피 desc", (a, b) => {
  const aS = a.cargoId === "sg3-35" ? -1 : 0;
  const bS = b.cargoId === "sg3-35" ? -1 : 0;
  if (aS !== bS) return aS - bS;
  return VOL(b) - VOL(a);
}));

// 시나리오 G: 막대형(>234) 우선, 그 다음 키큰(>=190h) 우선, 그 다음 부피 desc
results.push(runScenario("G: 막대형>234 + 키큰>=190h + 부피 desc", (a, b) => {
  const aR = Math.max(a.width, a.length, a.height) > 234 ? -1 : 0;
  const bR = Math.max(b.width, b.length, b.height) > 234 ? -1 : 0;
  if (aR !== bR) return aR - bR;
  const aT = a.height >= 190 ? -1 : 0;
  const bT = b.height >= 190 ? -1 : 0;
  if (aT !== bT) return aT - bT;
  return VOL(b) - VOL(a);
}));

// 시나리오 H: 부피 큰 box 1개씩 (사이즈별 큰 거 1개씩 우선)
results.push(runScenario("H: cargoId 부피합 desc + 부피 desc", (a, b) => {
  const cargoVol = (cid) => c2Units.filter(u => u.cargoId === cid).reduce((s,u) => s + VOL(u), 0);
  const av = cargoVol(a.cargoId);
  const bv = cargoVol(b.cargoId);
  if (av !== bv) return bv - av;
  return VOL(b) - VOL(a);
}));

console.log("===== 종합 =====");
for (const r of results) console.log(`  ${r.name.padEnd(50)} 미배치 ${r.unplaced}`);
const minUnp = Math.min(...results.map(r => r.unplaced));
console.log(`\n최저 미배치: ${minUnp}`);
if (minUnp === 0) {
  console.log("0 미배치 발견 시나리오:");
  for (const r of results) if (r.unplaced === 0) console.log(`  ⭐ ${r.name}`);
}
