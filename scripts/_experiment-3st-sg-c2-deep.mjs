/**
 * 3ST SG TOTAL 컨2 미배치 0 찾기 — 1000회 셔플 + 큰 박스 pre-place 다양 조합
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
          out.push({ unitId: `${cargoId}-${i++}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
            width: us.width, length: us.length, height: us.height, weight: w, remarks });
        }
      }
    } else if (r.widthCm > 0 && r.lengthCm > 0 && r.heightCm > 0) {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        out.push({ unitId: `${cargoId}-${i}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
          width: r.widthCm, length: r.lengthCm, height: r.heightCm, weight: perUnit, remarks });
      }
    }
  }
  return out;
}

const allUnits = expandUnits(sample.rows);
const c2Units = allUnits.filter(u => parseInt(u.cargoId.replace("sg3-", "")) - 1 >= 19);

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

console.log(`컨2 unit: ${c2Units.length}, 총 부피: ${(c2Units.reduce((s,u)=>s+VOL(u),0)/1e6).toFixed(2)} m³`);

// 1000회 셔플
console.log("\n===== 1000회 random shuffle =====");
{
  let best = c2Units.length;
  let bestSeed = -1;
  let bestUnplaced = null;
  let zeroCount = 0;
  for (let s = 0; s < 1000; s++) {
    let seed = s + 1;
    const pool = [...c2Units];
    for (let i = pool.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const { unplaced } = packPool(pool);
    if (unplaced.length < best) { best = unplaced.length; bestSeed = s; bestUnplaced = unplaced; }
    if (unplaced.length === 0) zeroCount++;
  }
  console.log(`최저 미배치: ${best} (seed=${bestSeed}), 0 미배치 횟수: ${zeroCount}/1000`);
  if (bestUnplaced && bestUnplaced.length > 0) for (const u of bestUnplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

// FLOWBUS 옆 118cm 빈자리 활용 — FLOWBUS 먼저 깔고 옆에 SK GEO 박스 강제 배치
console.log("\n===== 시나리오 E: FLOWBUS pre-place + 옆에 SK GEO + LDF =====");
{
  const state = makeContainerState();
  const flowbus = c2Units.filter(u => u.shipper === "FLOWBUS");
  const skGeo = c2Units.filter(u => u.shipper === "SK GEO CENTRIC");
  const jeil = c2Units.filter(u => u.shipper === "제일기공");
  const others = c2Units.filter(u => u.shipper !== "FLOWBUS" && u.shipper !== "SK GEO CENTRIC" && u.shipper !== "제일기공");

  // FLOWBUS 326×116×110 — 길이축 정렬
  let placedF = 0;
  for (const u of flowbus) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) placedF++;
  }
  console.log(`FLOWBUS: ${placedF}/${flowbus.length}`);

  // 큰 박스 부피 desc
  const big = others.filter(u => VOL(u) > 1.5e6).sort((a,b) => VOL(b) - VOL(a));
  let placedBig = 0;
  for (const u of big) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) placedBig++;
  }
  console.log(`큰 박스 (>1.5m³): ${placedBig}/${big.length}`);

  // SK GEO 3박스 (같은 cargoId)
  let placedSK = 0;
  for (const u of skGeo) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) placedSK++;
  }
  console.log(`SK GEO: ${placedSK}/${skGeo.length}`);

  // 제일기공
  let placedJ = 0;
  for (const u of jeil) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) placedJ++;
  }
  console.log(`제일기공: ${placedJ}/${jeil.length}`);

  // 나머지
  const rest = others.filter(u => VOL(u) <= 1.5e6).sort((a,b) => VOL(b) - VOL(a));
  let placedR = 0;
  for (const u of rest) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) placedR++;
  }
  console.log(`나머지 작은 박스: ${placedR}/${rest.length}`);
  console.log(`총 placed: ${state.placements.length}/${c2Units.length}`);
}

// 시나리오 F: SK GEO 먼저 (cargoId 묶음 통째로 깔고 시작)
console.log("\n===== 시나리오 F: SK GEO + 제일기공 먼저 깔고 + 큰박스 + 나머지 =====");
{
  const state = makeContainerState();
  const order = [
    ...c2Units.filter(u => u.shipper === "SK GEO CENTRIC"),
    ...c2Units.filter(u => u.shipper === "제일기공"),
    ...c2Units.filter(u => u.shipper === "FLOWBUS"),
    ...c2Units.filter(u => !["SK GEO CENTRIC","제일기공","FLOWBUS"].includes(u.shipper))
      .sort((a,b) => VOL(b) - VOL(a)),
  ];
  let placed = 0;
  const unplaced = [];
  for (const u of order) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (ok) placed++;
    else unplaced.push(u);
  }
  console.log(`총 placed: ${placed}/${c2Units.length}`);
  if (unplaced.length > 0) for (const u of unplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

// 시나리오 G: 작은 박스 먼저 (역LDF) — 큰 박스가 빈틈 채우게
console.log("\n===== 시나리오 G: 작은 박스 먼저 =====");
{
  const pool = [...c2Units].sort((a,b) => VOL(a) - VOL(b));
  const { unplaced } = packPool(pool);
  console.log(`미배치: ${unplaced.length}`);
}

// 시나리오 H: 같은 cargoId 묶음 우선 + cargoId 안에서 부피 desc
console.log("\n===== 시나리오 H: cargoId 묶음 + 묶음 부피 desc =====");
{
  const cargoMap = new Map();
  for (const u of c2Units) {
    if (!cargoMap.has(u.cargoId)) cargoMap.set(u.cargoId, []);
    cargoMap.get(u.cargoId).push(u);
  }
  const groups = [...cargoMap.entries()].sort((a,b) => {
    const va = a[1].reduce((s,u) => s + VOL(u), 0);
    const vb = b[1].reduce((s,u) => s + VOL(u), 0);
    return vb - va;
  });
  const pool = [];
  for (const [, units] of groups) {
    const sorted = [...units].sort((a,b) => VOL(b) - VOL(a));
    pool.push(...sorted);
  }
  const { unplaced } = packPool(pool);
  console.log(`미배치: ${unplaced.length}`);
  if (unplaced.length > 0) for (const u of unplaced) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}
