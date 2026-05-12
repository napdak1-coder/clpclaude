/* 룰 G 사전 묶음 승격 회귀 확인 — verify-*-total 스크립트 없는 샘플 4개 */
import fs from "node:fs";

const { packBest } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  "singapore-total-4",
  "singapore-mangjak-total",
  "hochiminh-total-3",
  "hochiminh-total-4",
];

function rowsToCargoes(rows, prefix) {
  return rows.map((r, idx) => ({
    id: `${prefix}-${idx + 1}`,
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
}

for (const name of SAMPLES) {
  const filePath = `data/samples/${name}.json`;
  if (!fs.existsSync(filePath)) {
    console.log(`=== ${name} === SKIP (파일 없음)`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const cargoes = rowsToCargoes(sample.rows, name);
  const t0 = Date.now();
  const result = packBest(cargoes, "auto");
  const dt = Date.now() - t0;
  const conTypes = result.containers.map((c) => c.spec.type).join(", ");
  console.log(
    `=== ${name} === cargoes=${cargoes.length} containers=${result.containers.length} (${conTypes}) unplaced=${result.unplaced.length} pack=${dt}ms`,
  );
  if (result.unplaced.length > 0) {
    for (const u of result.unplaced) {
      console.log(`  - unplaced: ${u.cargoId} ${u.actualShipperName ?? ""} (${u.width}×${u.length}×${u.height})`);
    }
  }
}
