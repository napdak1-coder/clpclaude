/**
 * 룰 G 발동 검증 — SK GEO CENTRIC (FBSIN260431) sg3-35 cargo
 * 3ST SG TOTAL 샘플의 마지막 cargo 만 분리해서 packBest 한 후
 * 룰 G 발동 로그를 확인.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { __testables } = await import("../lib/packing/footprint-cluster.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;
const cargoes = rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0,
  length: r.lengthCm ?? 0,
  height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null,
  aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: {
    noStacking: r.noStacking ?? false,
    topOnly: r.topOnly ?? false,
    orientation: r.orientation ?? "free",
    heavierBelow: r.heavierBelow ?? false,
  },
  itemRemark: r.itemRemark ?? "",
}));

// FLOWBUS 우선
const flowbusIdx = cargoes.findIndex((c) => c.bookingNo === "FBSIN260417");
if (flowbusIdx > 0) cargoes.unshift(cargoes.splice(flowbusIdx, 1)[0]);

console.log(`총 cargo: ${cargoes.length}, SK GEO: ${cargoes.find((c) => c.id === "sg3-35")?.actualShipperName}`);

__testables.resetRowLaneDecision();
const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대, unplaced: ${result.unplaced.length}`);

const dec = __testables.lastRowLaneDecision;
console.log(`\n=== 룰 G 발동 로그 ===`);
if (dec) {
  console.log(`cargoId: ${dec.cargoId}`);
  console.log(`bookingNo: ${dec.bookingNo}`);
  console.log(`unitCount: ${dec.unitCount}`);
  console.log(`faceIdx: ${dec.faceIdx}`);
  console.log(`laneWidth: ${dec.laneWidth}`);
  console.log(`result: ${dec.result}`);
  console.log(`placedCount: ${dec.placedCount}`);
} else {
  console.log("(룰 G 발동 안 됨 — 다른 단계가 먼저 처리)");
}

// SK GEO sg3-35 의 모든 unit 어디에 갔나
console.log(`\n=== sg3-35 placement 위치 ===`);
result.containers.forEach((c, ci) => {
  for (const row of c.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      if (it.cargoId === "sg3-35") {
        console.log(`컨${ci + 1} ${c.spec.type}: ${it.unitId} pos=(${it.position?.x},${it.position?.y},${it.position?.z}) size=(${it.size?.width}x${it.size?.length}x${it.size?.height})`);
      }
    }
  }
  for (const bi of c.bulkItems ?? []) {
    if (bi.cargoId === "sg3-35") {
      console.log(`컨${ci + 1} bulk: ${bi.cargoId}`);
    }
  }
});
console.log(`\nunplaced 중 sg3-35: ${result.unplaced.filter((u) => u.cargoId === "sg3-35").length}`);
