/**
 * 1ST SG TOTAL — baseline vs 현재 알고리즘 layout 비교
 *
 * baseline: 단순 unit-LDF (raw tryPlaceUnit + bruteForce)
 * 현재 알고리즘: pack() + fixedAssignment + cargo-atomic + unit-LDF interleave
 *
 * 둘 다 39 unit 펴고 결과 비교 — YKMC 위치, 다른 cargo 위치 차이
 */
import fs from "node:fs";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";
import { pack } from "../lib/packing/algorithm.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total.json", "utf8"));
const PRACT_40 = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, maxWeightKg: 25000 };

const rows = PRACT_40.map(sh => sample.rows.find(x => x.actualShipperName === sh));

function makeUnits() {
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
        remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
      });
    }
  }
  return units;
}

// baseline — raw unit-LDF
console.log("===== baseline (raw unit-LDF) =====");
{
  const state = makeContainerState();
  const units = makeUnits();
  const ldf = [...units].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height));
  const layout = [];
  for (const u of ldf) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (ok) {
      const p = state.placements[state.placements.length - 1];
      layout.push({ unitId: u.unitId, shipper: u.shipper, x: p.position.x, y: p.position.y, z: p.position.z, w: p.size.width, l: p.size.length, h: p.size.height, faceIdx: p.faceIdx });
    } else {
      layout.push({ unitId: u.unitId, shipper: u.shipper, UNPLACED: true });
    }
  }
  fs.writeFileSync("scripts/_baseline-layout.json", JSON.stringify(layout, null, 2));
  console.log(`  placed: ${state.placements.length} / ${units.length}`);
  console.log(`  layout 저장: scripts/_baseline-layout.json`);
}

// 현재 알고리즘 — pack() with fixedAssignment
console.log("\n===== 현재 알고리즘 (pack with fixedAssignment) =====");
{
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
  const fixedAssignment = {};
  for (const c of cargoes) fixedAssignment[c.id] = 1;
  const result = pack(cargoes, "auto", { fixedContainers: ["40FT"], fixedAssignment });
  const layout = [];
  for (const cont of result.containers) {
    for (const row of cont.rows) {
      for (const it of [...row.bottomItems, ...row.topItems]) {
        const cg = cargoes.find(c => c.id === it.cargoId);
        layout.push({ unitId: it.unitId, shipper: cg?.actualShipperName, x: it.position.x, y: it.position.y, z: it.layer === "top" ? "TOP" : 0, w: it.size.width, l: it.size.length, h: it.size.height, layer: it.layer });
      }
    }
  }
  for (const u of result.unplaced) {
    const cg = cargoes.find(c => c.id === u.cargoId);
    for (let i = 0; i < (u.quantity ?? 1); i++) layout.push({ unitId: u.cargoId + "-?", shipper: cg?.actualShipperName, UNPLACED: true });
  }
  fs.writeFileSync("scripts/_current-layout.json", JSON.stringify(layout, null, 2));
  console.log(`  placed: ${layout.filter(l => !l.UNPLACED).length}, unplaced: ${result.unplaced.reduce((s,u)=>s+(u.quantity??1),0)}`);
  console.log(`  layout 저장: scripts/_current-layout.json`);
}

// 비교 — YKMC 위치
console.log("\n===== YKMC 비교 =====");
const baseline = JSON.parse(fs.readFileSync("scripts/_baseline-layout.json", "utf8"));
const current = JSON.parse(fs.readFileSync("scripts/_current-layout.json", "utf8"));
const baseYKMC = baseline.filter(l => l.shipper === "YKMC");
const currYKMC = current.filter(l => l.shipper === "YKMC");
console.log("baseline YKMC:");
for (const y of baseYKMC) console.log(`  ${y.UNPLACED ? 'UNPLACED' : `(${y.x},${y.y},${y.z}) ${y.w}×${y.l}×${y.h}`}`);
console.log("\n현재 알고리즘 YKMC:");
for (const y of currYKMC) console.log(`  ${y.UNPLACED ? 'UNPLACED' : `(${y.x},${y.y},${y.z}) ${y.w}×${y.l}×${y.h} layer=${y.layer}`}`);
