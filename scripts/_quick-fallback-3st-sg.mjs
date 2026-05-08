/**
 * 빠른 fallback 검증 — 3ST SG TOTAL 을 packBest 로 호출.
 * 일반 매트릭스 → 미배치 발생 시 longAxisAnchor: { enabled: true } 자동 fallback.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

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

console.log(`JSON 샘플: ${rows.length} 행 — packBest 호출 (fallback 자동)`);

const t0 = Date.now();
const result = packBest(cargoes, "auto");
const elapsed = Date.now() - t0;

const visualUnplaced = result.unplaced.filter(
  (u) => u.group !== "ct" && u.group !== "completed",
);
console.log(`\n=== 결과 ===`);
console.log(`소요: ${elapsed}ms`);
console.log(
  `컨테이너: ${result.containers.length}대 — ${result.containers
    .map((c) => c.spec.type)
    .join(", ")}`,
);
console.log(`visual unplaced: ${visualUnplaced.length}`);
if (visualUnplaced.length) {
  for (const u of visualUnplaced)
    console.log(
      `  - ${u.cargoId} (${u.shipper ?? "?"}) ${u.width}x${u.length}x${u.height} qty=${u.quantity ?? 1}`,
    );
}
process.exit(visualUnplaced.length === 0 ? 0 : 1);
