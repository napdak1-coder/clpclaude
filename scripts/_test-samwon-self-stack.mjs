/**
 * 삼원절연 자체 적층 테스트
 *
 * 가설: 삼원절연 6박스 (4개 116×55×74 + 2개 110×110×143) 만 빈 40FT 에 배치하면
 *       자체 2단 적층 가능? (둘 다 0kg 이라 무게 비교 무의미 → 적층 룰 통과)
 *
 * 결과 확인: placement 좌표 + 적층 페어 + 같은 화주끼리만 stack 인지.
 */
import fs from "node:fs";
import path from "node:path";

const { packExtremePoint, expandCargoesToUnits } = await import(
  "../lib/packing/extreme-point.ts"
);
const { getContainerSpec } = await import("../lib/packing/containers.ts");

const JSON_PATH = path.resolve("data/samples/hochiminh-total-2.json");
const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const samwon = data.rows[24]; // 25번째 = hm2-25

console.log("=== 삼원절연 자체 적층 시뮬 ===\n");
console.log(`샘플 행: 25번째 (${samwon.actualShipperName})`);
console.log(`수량: ${samwon.quantity}개, 무게: ${samwon.weightPerUnitKg}kg, CBM: ${samwon.cbm}m³`);
console.log(`unitSizes:`);
samwon.unitSizes.forEach((u, i) => {
  console.log(`  [${i + 1}] ${u.width}×${u.length}×${u.height} cm  무게 ${u.weight}kg`);
});

const cargo = {
  id: "samwon",
  itemName: null,
  actualShipperName: samwon.actualShipperName,
  shipperName: samwon.shipperName,
  width: samwon.widthCm ?? 0,
  length: samwon.lengthCm ?? 0,
  height: samwon.heightCm ?? 0,
  quantity: Math.max(1, samwon.quantity ?? 1),
  weightPerUnit: samwon.weightPerUnitKg ?? 0,
  cbm: samwon.cbm ?? null,
  aboutCbm: samwon.aboutCbm ?? null,
  cargoType: samwon.cargoType ?? "PL",
  bookingNo: samwon.bookingNo || undefined,
  unitSizes: samwon.unitSizes,
  remarks: {
    noStacking: samwon.noStacking ?? false,
    topOnly: samwon.topOnly ?? false,
    orientation: samwon.orientation ?? "free",
    heavierBelow: samwon.heavierBelow ?? false,
  },
  itemRemark: samwon.itemRemark ?? "",
};

const units = expandCargoesToUnits([cargo]);
console.log(`\nexpand → ${units.length} units`);

const spec = getContainerSpec("40FT");
const result = packExtremePoint(units, spec);

console.log(`\n=== 빈 40FT 단독 packExtremePoint ===`);
console.log(`unplaced: ${result.unplaced.length}`);
console.log(`placements: ${result.placements.length}\n`);

result.placements.forEach((p, i) => {
  console.log(
    `[${i + 1}] ${p.unitId}  pos=(${p.position.x.toFixed(0)},${p.position.y.toFixed(0)},${p.position.z.toFixed(0)})  size=${p.size.width}×${p.size.length}×${p.size.height}  layer=${p.layer}`,
  );
});

// 적층 페어 확인
const EPS = 0.5;
console.log(`\n=== 적층 페어 (자체) ===`);
let pairs = 0;
for (const p of result.placements) {
  const topZ = p.position.z + p.size.height;
  for (const q of result.placements) {
    if (q === p) continue;
    if (Math.abs(q.position.z - topZ) > EPS) continue;
    const ox =
      Math.min(p.position.x + p.size.width, q.position.x + q.size.width) -
      Math.max(p.position.x, q.position.x);
    const oy =
      Math.min(p.position.y + p.size.length, q.position.y + q.size.length) -
      Math.max(p.position.y, q.position.y);
    if (ox > EPS && oy > EPS) {
      pairs++;
      console.log(
        `  ${p.unitId} (z ${p.position.z.toFixed(0)}..${topZ.toFixed(0)}) ← ${q.unitId} (z ${q.position.z.toFixed(0)}..)`,
      );
    }
  }
}
console.log(`\n총 적층 페어: ${pairs}건 (모두 같은 화주 = 삼원절연 자체)`);
