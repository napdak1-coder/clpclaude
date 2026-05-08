/**
 * 3ST SG TOTAL 실무자 강제 분배 — 컨2 행별 잔여 공간 보고
 * 사용자가 "행 기준으로 빈 공간 보이게" 요청 → 시각적 출력.
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");
const { computeDisplayRows } = await import("../lib/packing/display-rows.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));

const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

const fixedAssignment = {};
cargoes.forEach((c, i) => { fixedAssignment[c.id] = i < 19 ? 1 : 2; });

const result = pack(cargoes, "auto", { fixedContainers: ["40FT", "40FT"], fixedAssignment });

console.log("=== 3ST SG TOTAL 컨2 — 행별 잔여 공간 ===");
console.log(`unplaced: ${result.unplaced.length}`);

const cont = result.containers[1]; // 컨2
const spec = cont.spec;
console.log(`컨테이너: ${spec.type} ${spec.innerWidth}×${spec.innerLength}×${spec.innerHeight} cm`);

console.log(`\n--- 컨2 행 구조 ---`);
let totalUsedArea = 0;
for (const row of cont.rows) {
  const rowLength = row.yEnd - row.yStart;
  const rowFloorArea = spec.innerWidth * rowLength;
  const usedFloorArea = row.bottomItems.reduce((s, b) => s + b.size.width * b.size.length, 0);
  const freeFloorArea = rowFloorArea - usedFloorArea;
  totalUsedArea += usedFloorArea;
  const stackH = row.bottomMaxHeight + row.topMaxHeight;
  console.log(`\n행 ${row.index} (y ${row.yStart}~${row.yEnd}, 길이 ${rowLength}cm)`);
  console.log(`  바닥 박스 ${row.bottomItems.length}개  상단 박스 ${row.topItems.length}개`);
  console.log(`  하단 높이: ${row.bottomMaxHeight}cm, 상단 높이: ${row.topMaxHeight}cm, 총 stack: ${stackH}cm`);
  console.log(`  ▲ 천장 여유: ${row.topClearance}cm  (innerHeight ${spec.innerHeight} - stack ${stackH})`);
  console.log(`  바닥 사용 면적: ${usedFloorArea.toFixed(0)}/${rowFloorArea} cm² (${(usedFloorArea/rowFloorArea*100).toFixed(0)}%)`);
  console.log(`  바닥 잔여 면적: ${freeFloorArea.toFixed(0)} cm²`);
  console.log(`  바닥 박스 목록:`);
  for (const b of row.bottomItems) {
    console.log(`    [${b.cargoId}] ${b.size.width}×${b.size.length}×${b.size.height} at x=${b.position.x}`);
  }
  if (row.topItems.length > 0) {
    console.log(`  상단 박스 목록:`);
    for (const t of row.topItems) {
      console.log(`    [${t.cargoId}] ${t.size.width}×${t.size.length}×${t.size.height} at x=${t.position.x}, y=${t.position.y}`);
    }
  }
}

const usedRowsLength = cont.rows.length > 0 ? Math.max(...cont.rows.map(r => r.yEnd)) : 0;
const tailFreeLength = spec.innerLength - usedRowsLength;
console.log(`\n--- 컨2 끝부분 (행 끝 ~ 컨테이너 끝) ---`);
console.log(`  사용된 길이: ${usedRowsLength}cm / 전체 ${spec.innerLength}cm`);
console.log(`  꼬리 빈 공간: ${tailFreeLength}cm × 폭 ${spec.innerWidth}cm × 높이 ${spec.innerHeight}cm`);
console.log(`  꼬리 부피: ${(tailFreeLength * spec.innerWidth * spec.innerHeight / 1e6).toFixed(2)} m³`);

console.log(`\n--- 미배치 박스 ---`);
for (const u of result.unplaced) {
  const cg = u.cargo ?? cargoes.find(c => c.id === u.cargoId);
  console.log(`  ${cg.actualShipperName} (${cg.id}) ${cg.unitSizes ? '복수' : `${cg.width}×${cg.length}×${cg.height}`}`);
  if (cg.unitSizes) for (const us of cg.unitSizes) console.log(`    ${us.width}×${us.length}×${us.height} ×${us.quantity}`);
}

console.log(`\n--- 어느 행에 미배치 박스 들어갈 수 있나 (천장 여유 + 바닥 잔여 면적 기준) ---`);
const candidates = result.unplaced.flatMap(u => {
  const cg = u.cargo ?? cargoes.find(c => c.id === u.cargoId);
  if (cg.unitSizes) {
    return cg.unitSizes.map(us => ({ shipper: cg.actualShipperName, w: us.width, l: us.length, h: us.height }));
  }
  return [{ shipper: cg.actualShipperName, w: cg.width, l: cg.length, h: cg.height }];
});
for (const box of candidates) {
  const minDim = Math.min(box.w, box.l, box.h);
  const maxFootprint = Math.max(box.w * box.l, box.l * box.h, box.w * box.h);
  console.log(`\n[${box.shipper}] ${box.w}×${box.l}×${box.h}`);
  for (const row of cont.rows) {
    const rowLength = row.yEnd - row.yStart;
    const usedFloorArea = row.bottomItems.reduce((s, b) => s + b.size.width * b.size.length, 0);
    const freeFloorArea = spec.innerWidth * rowLength - usedFloorArea;
    const fitsTop = row.topClearance >= minDim; // 상단에 박스 세로로라도 들어갈 수 있나
    const fitsBottom = freeFloorArea >= box.w * box.l; // 바닥에 footprint 들어가나 (정렬 고려 X 단순)
    const verdict = fitsTop || fitsBottom ? "⭕ 가능" : "❌ 안됨";
    console.log(`  행 ${row.index}: 천장여유 ${row.topClearance}cm (필요 ${minDim}+) / 바닥잔여 ${freeFloorArea.toFixed(0)}cm² (필요 ${box.w*box.l}+) → ${verdict}`);
  }
  if (tailFreeLength > 0) {
    const fitsTail = tailFreeLength >= Math.min(box.w, box.l, box.h);
    console.log(`  꼬리 빈공간 ${tailFreeLength}cm: ${fitsTail ? "⭕ 가능" : "❌ 안됨"}`);
  }
}
