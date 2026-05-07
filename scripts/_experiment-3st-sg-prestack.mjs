/**
 * 3ST SG TOTAL — 세아특수강 막대형 화물 pre-place 실험
 *
 * 사용자 의도:
 *   1) B형 (322×42×41) 7 박스를 상하단으로 먼저 깔기
 *   2) 그 위에 A형 (311×15×15) 1 박스 올림
 *   3) B형 옆자리에 다른 화물 깔기
 *   4) 그 위에 나머지 화물 쌓기
 *
 * 컨테이너: 40FT (234×1200×268)
 * 회전: 322 길이축에 정렬 (faceIdx: 322가 length 가 되도록)
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

// expandToUnits 와 동일 (unitSizes 정확 반영)
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
    } else {
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
console.log(`총 unit: ${allUnits.length}`);

// 컨1 의 cargo 만 (실무자 분배 row 1~19)
const c1Units = allUnits.filter(u => {
  const idx = parseInt(u.cargoId.replace("sg3-", "")) - 1;
  return idx < 19;
});
console.log(`컨1 unit: ${c1Units.length}`);

// 세아특수강 unit 분리
const seahUnits = c1Units.filter(u => u.shipper === "세아특수강");
const seahA = seahUnits.filter(u => u.height === 15); // 311×15×15
const seahB = seahUnits.filter(u => u.height === 41); // 322×42×41
console.log(`세아특수강 A형 (311×15×15): ${seahA.length}, B형 (322×42×41): ${seahB.length}`);

// 외 cargos
const otherUnits = c1Units.filter(u => u.shipper !== "세아특수강");
console.log(`그 외 unit: ${otherUnits.length}`);

// 실험: 다양한 pre-place 시도
function tryPlaceAt(unit, state, x, y, z, faceIdx) {
  const scoreFn = (c) => {
    const ex = Math.abs(c.x - x) < 0.5 && Math.abs(c.y - y) < 0.5 && Math.abs(c.z - z) < 0.5;
    return ex ? 0 : Number.POSITIVE_INFINITY;
  };
  if (faceIdx !== undefined) return tryPlaceUnit(unit, state, spec, { scoreFn, forceFaceIdx: faceIdx });
  return tryPlaceUnit(unit, state, spec, { scoreFn });
}

function packRest(state, unitsLDF) {
  const unplaced = [];
  for (const u of unitsLDF) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return unplaced;
}

console.log("\n===== 시나리오 1: B형 2단 stack (3+3) + 1 박스 위 (3단) + A형 위 =====");
{
  const state = makeContainerState();
  // B형 322×42×41 — faceIdx 결정 필요. 기본 면 (W=322, L=42, H=41) 은 W=322 > 234 라 안 됨.
  // 회전: W=42, L=322, H=41 면이 필요. 어떤 faceIdx 인지 시도.
  let face = -1;
  for (let f = 0; f < 6; f++) {
    if (tryPlaceUnit(seahB[0], state, spec, { forceFaceIdx: f, scoreFn: () => 0 })) {
      const p = state.placements[state.placements.length - 1];
      // W=42, L=322 인지
      if (p.size.width === 42 && p.size.length === 322 && p.size.height === 41) {
        face = f;
        break;
      }
      // remove last placement
      state.placements.pop();
      state.totalWeight -= seahB[0].weight;
      state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
    }
  }
  console.log(`B형 회전 faceIdx (W=42, L=322, H=41): ${face}`);

  // 다시 깨끗한 state
  const s2 = makeContainerState();
  // 6 박스 = 2단 stack × 3 column
  // Layer 1: (0, 0, 0), (0, 322, 0), (0, 644, 0) — width 42, length 322
  // Layer 2: (0, 0, 41), (0, 322, 41), (0, 644, 41)
  // Layer 3: (0, 0, 82) — 7번째 박스
  let placed = 0;
  for (let i = 0; i < 7; i++) {
    const u = seahB[i];
    let z, x, y;
    if (i < 3) { z = 0; x = 0; y = i * 322; }
    else if (i < 6) { z = 41; x = 0; y = (i - 3) * 322; }
    else { z = 82; x = 0; y = 0; }
    const ok = tryPlaceAt(u, s2, x, y, z, face);
    if (ok) placed++;
    else console.log(`  B형 #${i+1} pre-place 실패 at (${x},${y},${z})`);
  }
  console.log(`B형 placed: ${placed}/7`);

  // A형 1 박스 위에 올리기 — z=82+41=123 위치
  const okA = tryPlaceAt(seahA[0], s2, 0, 0, 123);
  console.log(`A형 ${okA ? "✓ 위에 올림" : "✗ 실패"}`);

  // 나머지 cargos LDF
  const rest = [...otherUnits].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height));
  const unp = packRest(s2, rest);
  console.log(`나머지 placed: ${rest.length - unp.length}/${rest.length}`);
  console.log(`총 미배치: ${unp.length}`);
  if (unp.length > 0) {
    console.log("미배치 화물:");
    for (const u of unp) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
  }
  const totalCbm = s2.placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  console.log(`충전률: ${(totalCbm / 75.25 * 100).toFixed(1)}%`);
}

console.log("\n===== 시나리오 2: B형 4단 stack (column 1: 4박스, column 2: 3박스) + A형 위 =====");
{
  const state = makeContainerState();
  let face = -1;
  for (let f = 0; f < 6; f++) {
    const ok = tryPlaceUnit(seahB[0], state, spec, { forceFaceIdx: f, scoreFn: () => 0 });
    if (ok) {
      const p = state.placements[state.placements.length - 1];
      if (p.size.width === 42 && p.size.length === 322 && p.size.height === 41) { face = f; break; }
      state.placements.pop();
      state.totalWeight -= seahB[0].weight;
      state.visualCbm -= (p.size.width * p.size.length * p.size.height) / 1e6;
    }
  }
  const s2 = makeContainerState();
  // 4단 stack 2 columns: 4+3 = 7
  // Column 1: (0, 0, 0), (0, 0, 41), (0, 0, 82), (0, 0, 123) — 4 박스
  // Column 2: (0, 322, 0), (0, 322, 41), (0, 322, 82) — 3 박스
  for (let i = 0; i < 7; i++) {
    const u = seahB[i];
    let x, y, z;
    if (i < 4) { x = 0; y = 0; z = i * 41; }
    else { x = 0; y = 322; z = (i - 4) * 41; }
    const ok = tryPlaceAt(u, s2, x, y, z, face);
    if (!ok) console.log(`  B형 #${i+1} 실패 (${x},${y},${z})`);
  }
  // A형 위에 (column 1 위)
  tryPlaceAt(seahA[0], s2, 0, 0, 164);
  // 나머지
  const rest = [...otherUnits].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height));
  const unp = packRest(s2, rest);
  console.log(`총 미배치: ${unp.length}`);
  if (unp.length > 0) {
    console.log("미배치 화물:");
    for (const u of unp) console.log(`  ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
  }
  const totalCbm = s2.placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  console.log(`충전률: ${(totalCbm / 75.25 * 100).toFixed(1)}%`);
}
