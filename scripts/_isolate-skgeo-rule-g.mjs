/* SK GEO 단독 Rule G 격리 진단 */
import fs from "node:fs";

const { preClusterRowLane, __testables } = await import("../lib/packing/footprint-cluster.ts");

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const skgeo = sample.rows.find((r) => r.bookingNo === "FBSIN260431");
console.log("SK GEO:", skgeo.actualShipperName, "qty=", skgeo.quantity, "wpu=", skgeo.weightPerUnitKg);

// expandToUnits 와 동일 패턴 (algorithm.ts:137)
let unitIdx = 0;
const cargoId = "sg3-35";
const units = [];
for (const us of skgeo.unitSizes) {
  for (let i = 0; i < us.quantity; i++) {
    units.push({
      unitId: `u-${cargoId}-${unitIdx++}`,
      cargoId,
      bookingNo: "FBSIN260431",
      width: us.width,
      length: us.length,
      height: us.height,
      weight: us.weight ?? 0,
      remarks: {
        noStacking: true,
        topOnly: false,
        orientation: "free",
        heavierBelow: false,
      },
      cargoType: "PL",
    });
  }
}
console.log("Units:", units.map((u) => `${u.unitId}: ${u.width}×${u.length}×${u.height}`).join("\n  "));

// 빈 40FT 컨테이너
const SPEC_40FT = {
  type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, maxWeightKg: 26500,
};
const containerLike = {
  index: 0,
  spec: SPEC_40FT,
  packState: {
    placements: [],
    candidates: [{ x: 0, y: 0, z: 0 }],
    totalWeight: 0,
    visualCbm: 0,
  },
};

console.log("\n=== preClusterRowLane 직접 호출 ===");
__testables.resetRowLaneDecision();
const placed = preClusterRowLane(containerLike, units);
console.log("placed.size:", placed.size, "/ expected 3");
console.log("packState.placements.length:", containerLike.packState.placements.length);
console.log("lastDecision:", __testables.lastRowLaneDecision);
if (containerLike.packState.placements.length > 0) {
  for (const p of containerLike.packState.placements) {
    console.log(`  ${p.unitId}: pos=(${p.position.x},${p.position.y},${p.position.z}) size=(${p.size.width}×${p.size.length}×${p.size.height})`);
  }
}
