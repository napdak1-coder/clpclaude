/**
 * 1ST SG TOTAL — block-building 실험 (algorithm.ts 안 건드림)
 *
 * 가설:
 *   같은 cargoId + 같은 규격 + stack 가능 + 높이 합 ≤ 268 인 unit 들을
 *   "column block" 으로 묶어 한 unit 처럼 처리하면 바닥 점유 절반 → 다른 cargo 자리 확보.
 *
 * 블록 분할 룰:
 *   - qty 박스를 [maxStack, maxStack, ..., remainder] 로 분할
 *   - 각 블록은 단일 tall unit (W × L × stackHeight)
 *   - 블록 자체는 다단금지 (위에 쌓지 못함)
 */
import fs from "node:fs";
import { pack } from "../lib/packing/algorithm.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total.json", "utf8"));
const PRACT_40 = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];
const CONTAINER_INNER_H = 268;

console.log("===== 1ST SG TOTAL 40FT 17 cargo row + unit =====");
const rows = [];
for (let idx = 0; idx < PRACT_40.length; idx++) {
  const sh = PRACT_40[idx];
  const r = sample.rows.find(x => x.actualShipperName === sh);
  if (!r) continue;
  rows.push({ idx: idx+1, sh, w: r.widthCm, l: r.lengthCm, h: r.heightCm, q: r.quantity, wPer: r.weightPerUnitKg ?? 0, stackOk: !r.noStacking, orient: r.orientation ?? "free", raw: r });
}
console.log(`총 cargo row: ${rows.length}, 총 unit: ${rows.reduce((s, r) => s + r.q, 0)}`);

console.log("\n===== column block 후보 (보수적 분할: 2-stack 우선) =====");
// blocks: array of { shipper, splits: [{stackN, height}, ...] }
// 보수적으로 2-stack 만 적용 (height 너무 커지지 않게)
const TARGET_STACK_N = 2; // 2단으로 묶음 — 컨테이너 위에 다른 cargo 올릴 여유 보존
const blockMap = new Map(); // shipper → splits
for (const r of rows) {
  if (!r.stackOk || r.q < 2) continue;
  const maxStack = Math.floor(CONTAINER_INNER_H / r.h);
  if (maxStack < 2) {
    console.log(`  ${r.sh.padEnd(20)} qty=${r.q} h=${r.h} → 단독 (스택 불가)`);
    continue;
  }
  const stackN = Math.min(maxStack, TARGET_STACK_N);
  const splits = [];
  let remaining = r.q;
  while (remaining > 0) {
    const useN = Math.min(remaining, stackN);
    splits.push({ stackN: useN, height: useN * r.h });
    remaining -= useN;
  }
  blockMap.set(r.sh, splits);
  console.log(`  ${r.sh.padEnd(20)} qty=${r.q} h=${r.h} → 2-stack 묶음`);
  console.log(`     splits: ${splits.map(s => `${s.stackN}-stack(${r.w}×${r.l}×${s.height})`).join(", ")}`);
}

// 원본 packing
console.log("\n===== 원본 packing (baseline) =====");
const cargoesBase = rows.map((r, i) => ({
  id: `sg1-${i+1}`, itemName: null,
  actualShipperName: r.sh, shipperName: "",
  width: r.w, length: r.l, height: r.h, quantity: r.q,
  weightPerUnit: r.wPer, cbm: r.raw.cbm, aboutCbm: r.raw.aboutCbm,
  cargoType: r.raw.cargoType ?? "PL",
  bookingNo: r.raw.bookingNo, unitSizes: r.raw.unitSizes,
  remarks: { noStacking: r.raw.noStacking ?? false, topOnly: r.raw.topOnly ?? false, orientation: r.orient, heavierBelow: r.raw.heavierBelow ?? false },
  itemRemark: "",
}));
const fixedAssignment = {};
for (const c of cargoesBase) fixedAssignment[c.id] = 1;
const baseResult = pack(cargoesBase, "auto", { fixedContainers: ["40FT"], fixedAssignment });
const baseUnp = baseResult.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
console.log(`unit 미배치: ${baseUnp}`);
for (const u of baseResult.unplaced) {
  const cg = cargoesBase.find(c => c.id === u.cargoId);
  console.log(`   - ${cg?.actualShipperName} qty=${u.quantity ?? 1}`);
}

// block-applied
console.log("\n===== block-applied packing =====");
const cargoesBlock = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const splits = blockMap.get(r.sh);
  if (!splits) {
    cargoesBlock.push({ ...cargoesBase[i] });
    continue;
  }
  for (let si = 0; si < splits.length; si++) {
    const s = splits[si];
    cargoesBlock.push({
      id: `sg1-${i+1}-blk${si}`, itemName: null,
      actualShipperName: `${r.sh}#${si+1}(${s.stackN}-stack)`,
      shipperName: "",
      width: r.w, length: r.l, height: s.height, quantity: 1,
      weightPerUnit: r.wPer * s.stackN,
      cbm: null, aboutCbm: null,
      cargoType: r.raw.cargoType ?? "PL",
      bookingNo: r.raw.bookingNo,
      unitSizes: undefined,
      remarks: { noStacking: false, topOnly: false, orientation: r.orient, heavierBelow: false }, // block 위에 다른 cargo 올림 OK
      itemRemark: "",
    });
  }
}
const fixedAssignment2 = {};
for (const c of cargoesBlock) fixedAssignment2[c.id] = 1;
console.log(`block-applied cargo 수: ${cargoesBlock.length}`);

const blockResult = pack(cargoesBlock, "auto", { fixedContainers: ["40FT"], fixedAssignment: fixedAssignment2 });
const blockUnp = blockResult.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
console.log(`block 미배치: ${blockUnp}`);
let realBoxesUnp = 0;
for (const u of blockResult.unplaced) {
  const cg = cargoesBlock.find(c => c.id === u.cargoId);
  // 미배치 block 의 실제 박스 수 추정 (block 의 height 가 원본 박스 height 의 N배)
  const origRow = rows.find(rr => cg?.actualShipperName.startsWith(rr.sh));
  const origH = origRow?.h ?? cg?.height ?? 1;
  const stackN = Math.round((cg?.height ?? 0) / origH);
  console.log(`   - ${cg?.actualShipperName} (실 박스: ${stackN}개)`);
  realBoxesUnp += stackN;
}

console.log("\n===== 비교 요약 =====");
console.log(`baseline: unit 미배치 = ${baseUnp} (실제 박스 수)`);
console.log(`block 적용: 미배치 = ${blockUnp} block, 실제 박스 = ${realBoxesUnp}`);
console.log(`충전률: 원본 ${baseResult.containers[0]?.cbmFillRate.toFixed(1)}% → block ${blockResult.containers[0]?.cbmFillRate.toFixed(1)}%`);

// YKMC 특별 분석
console.log("\n===== YKMC 분석 =====");
const ykmcBlockEntries = blockResult.unplaced.filter(u => {
  const cg = cargoesBlock.find(c => c.id === u.cargoId);
  return cg?.actualShipperName.startsWith("YKMC");
});
console.log(`YKMC 미배치 block: ${ykmcBlockEntries.length}`);
for (const u of ykmcBlockEntries) {
  const cg = cargoesBlock.find(c => c.id === u.cargoId);
  console.log(`   - ${cg?.actualShipperName} (${cg?.width}×${cg?.length}×${cg?.height})`);
}
