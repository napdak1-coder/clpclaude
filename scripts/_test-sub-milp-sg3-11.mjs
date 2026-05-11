/**
 * Sub-MILP repair 테스트 — 3ST SG sg3-11 미배치 unit 을 MILP 로 풀이 시도.
 *
 * 동작:
 *   1) pack(ldf) 호출 → sg3-11 미배치 상태 만듦
 *   2) globalThis.__lastPackContainers 에서 raw packState 추출
 *   3) sg3-11 unit + 컨테이너 1·2 의 packState 으로 subMilpPlaceSingle 호출
 *   4) 결과 출력 (placed / reason / 시간)
 */
import fs from "node:fs";
import path from "node:path";

process.env.DEBUG_RAW_PLACEMENTS = "1";

const { pack } = await import("../lib/packing/algorithm.ts");
const { subMilpPlaceSingle } = await import("../lib/packing/milp/sub-milp-repair.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
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
    noStacking: !!r.noStacking,
    topOnly: !!r.topOnly,
    orientation: r.orientation || "free",
    heavierBelow: !!r.heavierBelow,
  },
}));

console.log("pack(ldf) 호출 — sg3-11 미배치 상태 만듦...");
const r = pack(cargoes, undefined, {
  sortStrategy: "ldf",
  containerOrder: "biggest-first",
  autoConsolidateCompleted: true,
  placementMode: "wrapper",
});
console.log(`pack 결과: ${r.containers.length} 컨테이너, unplaced=${r.unplaced.length}`);

if (r.unplaced.length === 0) {
  console.log("미배치 0 — sub-MILP 시도 불필요");
  process.exit(0);
}

const u0Cargo = r.unplaced[0];
console.log(`미배치 unit: ${u0Cargo.cargoId} ${u0Cargo.shipper} ${u0Cargo.width}×${u0Cargo.length}×${u0Cargo.height} ${u0Cargo.weight}kg`);

// raw containers 에서 packState 추출
const raw = globalThis.__lastPackContainers;
if (!raw) {
  console.log("__lastPackContainers 없음. DEBUG_RAW_PLACEMENTS 미작동");
  process.exit(1);
}

// UnitItem 구성 (raw cargo → unit)
const u0 = {
  unitId: `${u0Cargo.cargoId}-0`,
  cargoId: u0Cargo.cargoId,
  shipper: u0Cargo.shipper,
  bookingNo: undefined,
  name: u0Cargo.name,
  cargoType: u0Cargo.cargoType,
  cfsCbm: u0Cargo.cfsCbm,
  width: u0Cargo.width,
  length: u0Cargo.length,
  height: u0Cargo.height,
  weight: u0Cargo.weight,
  remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
};

// 각 컨테이너 시도
for (const c of raw) {
  const packState = {
    placements: c.placements.map((p) => ({ ...p })),
    candidates: [{ x: 0, y: 0, z: 0 }],
    totalWeight: c.totalWeight,
    visualCbm: 0, // 단순화
  };
  console.log(`\n--- 컨${c.index} (${c.spec.type}) placements=${packState.placements.length} totalWeight=${packState.totalWeight}kg ---`);
  console.log(`Sub-MILP 호출 (timeout 15초)...`);
  const result = await subMilpPlaceSingle(u0, packState, c.spec, 15);
  console.log(`결과: placed=${result.placed} reason=${result.reason ?? "(none)"} time=${result.solveTimeMs}ms`);
  if (result.placed) {
    console.log(`  → pos=(${result.position.x.toFixed(1)}, ${result.position.y.toFixed(1)}, ${result.position.z.toFixed(1)}) face=${result.faceIdx} supporter=${result.supporterUnitId ?? "FLOOR"}`);
    console.log(`✅ MILP 성공 — sg3-11 풀이 발견 (컨${c.index})`);
    process.exit(0);
  }
}

console.log("\n❌ 모든 컨테이너에서 MILP 풀이 실패");
