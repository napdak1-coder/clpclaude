/* FLOWBUS 단독 적재 가능 여부 확인 */
import fs from "node:fs";
const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const flowbusRow = sample.rows.find((r) => r.bookingNo === "FBSIN260417");
console.log("FLOWBUS:", JSON.stringify(flowbusRow, null, 2));

const cargo = {
  id: "flowbus-only",
  itemName: flowbusRow.itemName || "FLOWBUS",
  actualShipperName: flowbusRow.actualShipperName ?? "",
  shipperName: flowbusRow.shipperName ?? "",
  width: flowbusRow.widthCm ?? 0,
  length: flowbusRow.lengthCm ?? 0,
  height: flowbusRow.heightCm ?? 0,
  quantity: Math.max(1, flowbusRow.quantity ?? 1),
  weightPerUnit: flowbusRow.weightPerUnitKg ?? 0,
  cbm: flowbusRow.cbm ?? null,
  aboutCbm: flowbusRow.aboutCbm ?? null,
  cargoType: flowbusRow.cargoType ?? "PL",
  bookingNo: flowbusRow.bookingNo,
  unitSizes: flowbusRow.unitSizes,
  remarks: {
    noStacking: flowbusRow.noStacking ?? false,
    topOnly: flowbusRow.topOnly ?? false,
    orientation: flowbusRow.orientation ?? "free",
    heavierBelow: flowbusRow.heavierBelow ?? false,
  },
  itemRemark: flowbusRow.itemRemark ?? "",
};

console.log("\n=== 단독 packBest ===");
const result = packBest([cargo], "auto");
console.log("컨테이너:", result.containers.length, "대");
console.log("미배치:", result.unplaced.length);
result.containers.forEach((c, i) => {
  console.log(`[${i + 1}] ${c.spec.type} - rows=${c.rows.length}, items=${c.rows.reduce((s, r) => s + r.bottomItems.length + r.topItems.length, 0)}, bulk=${(c.bulkItems ?? []).length}`);
  c.rows.forEach((r, ri) => {
    [...r.bottomItems, ...r.topItems].forEach((it) => {
      console.log(`  row${ri} item: pos=(${it.x},${it.y},${it.z}) size=(${it.width}x${it.length}x${it.height})`);
    });
  });
});
