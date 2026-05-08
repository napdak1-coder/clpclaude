/**
 * 컨2에 SK GEO 3박스 먼저 강제 배치 후 나머지 LDF — 0 미배치 가능 여부 확인.
 * SK GEO noStacking → 3박스 모두 바닥(z=0).
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

const skGeo = c2Units.filter(u => u.cargoId === "sg3-35");
const others = c2Units.filter(u => u.cargoId !== "sg3-35");
console.log(`SK GEO 3박스: ${skGeo.map(u => `${u.width}×${u.length}×${u.height}`).join(", ")}`);
console.log(`나머지 ${others.length} unit\n`);

function tryAt(unit, state, x, y, z, faceIdx) {
  const scoreFn = (c) => {
    const ex = Math.abs(c.x - x) < 0.5 && Math.abs(c.y - y) < 0.5 && Math.abs(c.z - z) < 0.5;
    return ex ? 0 : Number.POSITIVE_INFINITY;
  };
  const opts = faceIdx !== undefined ? { scoreFn, forceFaceIdx: faceIdx } : { scoreFn };
  return tryPlaceUnit(unit, state, spec, opts);
}

// 시나리오: SK GEO 3박스를 컨2 입구쪽 (y=0~) 에 회전해서 한 줄에 깔기
// 박스 1: 135×115×129 → 회전: 115×135×129 (폭 115)
// 박스 2: 135×115×129 → 회전: 115×135×129 (폭 115)
// 박스 3: 137×115×85 → 회전: 115×137×85 (폭 115)
//
// 배치:
//   박스 1 (115, 135) at x=0, y=0
//   박스 2 (115, 135) at x=115, y=0
//   박스 3 (115, 137) at x=0, y=135  ← 또는 x=115, y=135
//
// 회전 face: 6면 다 시도

console.log("===== 시나리오 1: SK GEO 3박스 회전(115폭) 입구쪽 깔기 =====");
{
  const state = makeContainerState();
  let placed = 0;

  // 박스 1: 135×115×129 → 회전해서 폭 115, 길이 135 인 face 찾아 (0,0,0) 에 배치
  for (let f = 0; f < 6; f++) {
    if (tryAt(skGeo[0], state, 0, 0, 0, f)) {
      const p = state.placements[state.placements.length - 1];
      console.log(`박스 1 placed: ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x}, ${p.position.y}, ${p.position.z})`);
      placed++;
      break;
    }
  }
  // 박스 2: 같은 위치 옆 (115, 0, 0)
  for (let f = 0; f < 6; f++) {
    if (tryAt(skGeo[1], state, 115, 0, 0, f)) {
      const p = state.placements[state.placements.length - 1];
      console.log(`박스 2 placed: ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x}, ${p.position.y}, ${p.position.z})`);
      placed++;
      break;
    }
  }
  // 박스 3 (137×115×85): 폭 115 기준 (0, 135, 0) 또는 (115, 135, 0)
  for (let f = 0; f < 6; f++) {
    if (tryAt(skGeo[2], state, 0, 135, 0, f)) {
      const p = state.placements[state.placements.length - 1];
      console.log(`박스 3 placed: ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x}, ${p.position.y}, ${p.position.z})`);
      placed++;
      break;
    }
  }
  console.log(`SK GEO placed: ${placed}/3`);

  // 나머지 LDF
  const rest = [...others].sort((a, b) => VOL(b) - VOL(a));
  let ok = 0;
  const unp = [];
  for (const u of rest) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) ok++;
    else unp.push(u);
  }
  console.log(`나머지 placed: ${ok}/${rest.length}`);
  console.log(`총 placed: ${state.placements.length}/27`);
  console.log(`미배치 ${unp.length}:`);
  for (const u of unp) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

// 시나리오 2: SK GEO 3박스를 한 줄로 (회전 X, 135×115)
console.log("\n===== 시나리오 2: SK GEO 회전 없이 (135폭) 길이방향 깔기 =====");
{
  const state = makeContainerState();
  // 박스 1: 135×115×129 → x=0, y=0 (135폭, 길이 115)
  // 박스 2: 135×115×129 → x=0, y=115 (같은 자리에서 length 다음)
  // 박스 3: 137×115×85 → x=0, y=230
  // 모두 폭 135~137 ≤ 234, 길이 115+115+115=345 사용
  let placed = 0;
  if (tryPlaceUnit(skGeo[0], state, spec)) placed++;
  if (tryPlaceUnit(skGeo[1], state, spec)) placed++;
  if (tryPlaceUnit(skGeo[2], state, spec)) placed++;
  console.log(`SK GEO placed: ${placed}/3 (그냥 LDF 시도)`);
  for (const p of state.placements) {
    console.log(`  ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x}, ${p.position.y}, ${p.position.z})`);
  }

  const rest = [...others].sort((a, b) => VOL(b) - VOL(a));
  let ok = 0;
  const unp = [];
  for (const u of rest) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) ok++;
    else unp.push(u);
  }
  console.log(`나머지 placed: ${ok}/${rest.length}`);
  console.log(`총 placed: ${state.placements.length}/27`);
  console.log(`미배치 ${unp.length}:`);
  for (const u of unp) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}

// 시나리오 3: SK GEO 3박스 + FLOWBUS 안쪽 + 큰 박스 + 나머지
console.log("\n===== 시나리오 3: SK GEO + FLOWBUS 안쪽 + 큰박스 + 나머지 =====");
{
  const state = makeContainerState();
  let placed = 0;

  // SK GEO 3박스 LDF
  for (const u of skGeo) {
    if (tryPlaceUnit(u, state, spec)) placed++;
  }
  console.log(`SK GEO placed: ${placed}/3`);

  // FLOWBUS 2박스 (다단금지, 큰 박스)
  const flowbus = others.filter(u => u.cargoId === "sg3-30");
  let f = 0;
  for (const u of flowbus) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) f++;
  }
  console.log(`FLOWBUS placed: ${f}/${flowbus.length}`);

  // 나머지 LDF (큰 거 부터)
  const rest = others.filter(u => u.cargoId !== "sg3-30").sort((a, b) => VOL(b) - VOL(a));
  let ok = 0;
  const unp = [];
  for (const u of rest) {
    if (tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec)) ok++;
    else unp.push(u);
  }
  console.log(`나머지 placed: ${ok}/${rest.length}`);
  console.log(`총 placed: ${state.placements.length}/27`);
  console.log(`미배치 ${unp.length}:`);
  for (const u of unp) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
}
