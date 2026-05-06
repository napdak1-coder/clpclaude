/**
 * 싱가폴(SG) / 호치민(HM) 샘플 행별 적재 좌표·CBM 상세 보고
 *
 * - 시각 화물 (사이즈 있음): 컨테이너 / layer (bottom/top) / 위치(x,y,z) / 사이즈(w,l,h)
 * - CT 벌크 (사이즈 없음): 컨테이너 / 적용 CBM / 누적
 */

import fs from "node:fs";
import path from "node:path";

const { parseExcelFile, parseDimensionsFromText } = await import("../lib/excel.ts");
const { pack, packBest } = await import("../lib/packing/algorithm.ts");
const { getShipment } = await import("../lib/repositories/shipments.ts");

/* =========================================================================
 * 1) 싱가폴 (SG TOTAL) — DB 의 shipment 사용
 * ========================================================================= */

console.log("\n" + "=".repeat(75));
console.log("  싱가폴 (SG TOTAL) — 22 행 행별 적재 좌표");
console.log("=".repeat(75));

const SG_ID = "bbd2cece-976f-4665-b207-175aa2751b77";
const sgShip = await getShipment(SG_ID);
const sgResult = packBest(sgShip.items, "auto");

console.log(`총 화물 ${sgShip.items.length} 행 → 컨테이너 ${sgResult.containers.length}대, unplaced ${sgResult.unplaced.length}\n`);

// 컨테이너별 row 단위 좌표 (bottomItems/topItems)
sgResult.containers.forEach((c) => {
  console.log(`\n[${c.spec.type}] (내부: ${c.spec.innerWidth}×${c.spec.innerLength}×${c.spec.innerHeight}cm, 한도 ${c.spec.maxCbm}m³)`);
  console.log(`충전률 ${c.cbmFillRate.toFixed(1)}%, 무게 ${c.totalWeightKg ?? c.totalWeight}kg / ${c.spec.maxWeightKg}kg`);
  console.log("─".repeat(75));

  c.rows.forEach((r) => {
    console.log(`Row ${r.index} (y=${r.yStart.toFixed(0)}~${r.yEnd.toFixed(0)}cm)`);
    const all = [];
    for (const it of r.bottomItems) all.push({ ...it, layer: "BOTTOM" });
    for (const it of r.topItems) all.push({ ...it, layer: "TOP" });
    all.sort((a, b) => a.position.x - b.position.x);
    for (const it of all) {
      const shipper = sgShip.items.find((c) => c.id === it.cargoId)?.actualShipperName ?? "?";
      const sz = `${it.size.width}×${it.size.length}×${it.size.height}cm`;
      const pos = `(x=${it.position.x.toFixed(0)},y=${it.position.y.toFixed(0)})`;
      console.log(`  ${it.layer.padEnd(7)} ${shipper.padEnd(22)} ${sz.padEnd(20)} pos${pos}`);
    }
  });
});

/* =========================================================================
 * 2) 호치민 (HM TOTAL) — xlsx 직접 파싱
 * ========================================================================= */

console.log("\n\n" + "=".repeat(75));
console.log("  호치민 (HM TOTAL) — 34 행 행별 적재 (CT 벌크)");
console.log("=".repeat(75));

const buf = fs.readFileSync(path.resolve("public/samples/hochiminh-total.xlsx"));
const fakeFile = {
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};
const parsed = await parseExcelFile(fakeFile);

const FIELD_BY_HEADER_LOWER = new Map([
  ["house b/l", "houseBlNo"],
  ["booking no", "bookingNo"],
  ["dest", "destination"],
  ["실화주", "itemActualShipperName"],
  ["화주", "itemShipperName"],
  ["q'ty", "quantity"],
  ["g. w/t", "weightPerUnitKg"],
  ["g.w/t", "weightPerUnitKg"],
  ["cfs cbm", "cbm"],
  ["remark", "itemRemark"],
]);
const mapping = {};
for (const h of parsed.headers) {
  if (!h) continue;
  const lower = String(h).toLowerCase().trim();
  for (const [key, field] of FIELD_BY_HEADER_LOWER) {
    if (lower.includes(key)) {
      mapping[h] = field;
      break;
    }
  }
}

function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const cargoes = [];
parsed.rows.forEach((row, idx) => {
  let actualShipperName = "", shipperName = "", bookingNo = "";
  let quantity = 1, weightPerUnitKg = 0, cbm = null, aboutCbm = null;
  for (const [header, field] of Object.entries(mapping)) {
    const v = row[header];
    if (field === "itemActualShipperName") actualShipperName = String(v ?? "").trim();
    if (field === "itemShipperName") shipperName = String(v ?? "").trim();
    if (field === "bookingNo") bookingNo = String(v ?? "").trim();
    if (field === "quantity") quantity = Math.max(1, Math.round(toNum(v)));
    if (field === "weightPerUnitKg") weightPerUnitKg = toNum(v);
    if (field === "cbm") cbm = toNum(v) || null;
  }
  const aboutHeader = parsed.headers.find((h) => String(h).toLowerCase().trim() === "about");
  if (aboutHeader) aboutCbm = toNum(row[aboutHeader]) || null;

  if ((cbm ?? 0) === 0 && (aboutCbm ?? 0) === 0 && !actualShipperName) return;

  cargoes.push({
    id: `hm-${idx + 1}`,
    rowNo: idx + 1,
    actualShipperName,
    shipperName,
    width: 0, length: 0, height: 0, // 사이즈 없음 → CT 벌크
    quantity,
    weightPerUnit: weightPerUnitKg,
    cbm,
    aboutCbm,
    cargoType: "CT",
    bookingNo: bookingNo || undefined,
    remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
    itemRemark: "",
  });
});

const hmResult = packBest(cargoes, "auto");

console.log(`총 화물 ${cargoes.length} 행 → 컨테이너 ${hmResult.containers.length}대, unplaced ${hmResult.unplaced.length}\n`);

const cargoMap = new Map(cargoes.map((c) => [c.id, c]));

hmResult.containers.forEach((c) => {
  console.log(`\n[${c.spec.type}] (한도 ${c.spec.maxCbm}m³, soft ${(c.spec.maxCbm * 1.05).toFixed(1)}m³)`);
  console.log(`적재 CBM ${c.ctCbm.toFixed(3)}m³, 충전률 ${c.cbmFillRate.toFixed(1)}%`);
  console.log("─".repeat(75));

  let cumCbm = 0;
  for (const bi of c.bulkItems ?? []) {
    const cg = cargoMap.get(bi.cargoId);
    if (!cg) continue;
    cumCbm += bi.cbm;
    const rowLabel = `Row ${cg.rowNo}`.padEnd(7);
    const shipper = cg.actualShipperName.padEnd(25);
    const booking = (cg.bookingNo ?? "-").padEnd(14);
    const cbmInfo = `${bi.cbm.toFixed(3)}m³ / 누적 ${cumCbm.toFixed(3)}m³`;
    const qty = `qty=${cg.quantity}`.padEnd(10);
    console.log(`  ${rowLabel} ${shipper} ${booking} ${qty} ${cbmInfo}`);
  }
});

if (hmResult.unplaced.length > 0) {
  console.log("\n=== UNPLACED ===");
  for (const u of hmResult.unplaced) {
    console.log(`  ${u.shipperName ?? u.actualShipperName ?? "?"} (cargoId=${u.cargoId})`);
  }
}

console.log("\n" + "=".repeat(75));
console.log("  보고 끝");
console.log("=".repeat(75) + "\n");
