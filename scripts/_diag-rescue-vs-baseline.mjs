/**
 * rescue vs baseline 차이 정밀 비교
 *
 * 두 케이스 모두:
 * 1) makeContainerState() 빈 컨테이너
 * 2) 39 unit unit-LDF 정렬
 * 3) tryPlaceUnit + tryPlaceUnitBruteForce
 *
 * 차이 없어야 하는데 baseline=0 unplaced, 실제 알고리즘=1 unplaced.
 * 이유 추적: 정확히 같은 unit 으로 같은 순서로 시도해서 진짜 다른지 검증.
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";
// algorithm.ts 의 expandToUnits 와 동일 로직
function expandToUnits(cargoes) {
  const out = [];
  for (const c of cargoes) {
    const shipperLabel = c.actualShipperName ?? c.shipperName ?? c.itemName ?? "";
    const remarks = { ...c.remarks };
    const perUnit = c.quantity > 0 ? (c.weightPerUnit ?? 0) / c.quantity : 0;
    for (let i = 0; i < c.quantity; i++) {
      out.push({
        unitId: `${c.id}-${i}`,
        cargoId: c.id,
        shipper: shipperLabel,
        bookingNo: c.bookingNo,
        name: c.itemName,
        cargoType: c.cargoType,
        cfsCbm: c.cbm ?? null,
        width: c.width,
        length: c.length,
        height: c.height,
        weight: perUnit,
        remarks,
      });
    }
  }
  return out;
}

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total.json", "utf8"));
const PRACT_40 = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, maxWeightKg: 25000 };

const rows = PRACT_40.map(sh => sample.rows.find(x => x.actualShipperName === sh));
const cargoes = rows.map((r, i) => ({
  id: `sg1-${i+1}`, itemName: null,
  actualShipperName: r.actualShipperName, shipperName: "",
  width: r.widthCm, length: r.lengthCm, height: r.heightCm,
  quantity: r.quantity,
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm, aboutCbm: r.aboutCbm,
  cargoType: r.cargoType ?? "PL",
  bookingNo: r.bookingNo, unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

// algorithm.ts 의 expandToUnits 사용
const algoUnits = expandToUnits(cargoes);
console.log(`algoUnits 수: ${algoUnits.length}`);
console.log(`algoUnits 첫 3:`);
for (let i = 0; i < 3; i++) {
  const u = algoUnits[i];
  console.log(`  ${u.unitId} cargoId=${u.cargoId} w=${u.width} l=${u.length} h=${u.height} weight=${u.weight}`);
}

// 정렬 — volume desc
const ldf = [...algoUnits].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height));
console.log(`\nldf 정렬 첫 5:`);
for (let i = 0; i < 5; i++) {
  const u = ldf[i];
  console.log(`  ${i}: ${u.unitId} ${u.shipper} ${u.width}×${u.length}×${u.height} v=${(u.width*u.length*u.height/1e6).toFixed(2)}`);
}
console.log(`ldf 마지막 5:`);
for (let i = ldf.length - 5; i < ldf.length; i++) {
  const u = ldf[i];
  console.log(`  ${i}: ${u.unitId} ${u.shipper} ${u.width}×${u.length}×${u.height} v=${(u.width*u.length*u.height/1e6).toFixed(2)}`);
}

// pack 시도
console.log(`\n===== unit-LDF pack =====`);
const state = makeContainerState();
let placed = 0, unplaced = 0;
for (let i = 0; i < ldf.length; i++) {
  const u = ldf[i];
  const okFast = tryPlaceUnit(u, state, spec);
  let okSlow = false;
  if (!okFast) okSlow = tryPlaceUnitBruteForce(u, state, spec);
  if (okFast || okSlow) {
    placed++;
  } else {
    unplaced++;
    console.log(`  미배치 #${i+1}: ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
  }
}
console.log(`결과: placed=${placed}, unplaced=${unplaced}`);
