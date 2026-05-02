import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const { expandCargoesToUnits, packExtremePoint } = await import("../lib/packing/extreme-point.ts");
const { computeDisplayRows } = await import("../lib/packing/display-rows.ts");
const { getContainerSpec } = await import("../lib/packing/containers.ts");

const samplePath = resolve(projectRoot, "data", "samples", "singapore-total.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

const cargoes = sample.rows
  .filter((r) => r.cargoType !== "CT")
  .map((r, i) => ({
    id: `c-${i}`,
    shipmentId: "mock",
    sortOrder: i,
    cargoType: r.cargoType,
    itemName: r.itemName,
    actualShipperName: r.actualShipperName,
    shipperName: r.shipperName,
    width: r.widthCm,
    length: r.lengthCm,
    height: r.heightCm,
    quantity: r.quantity,
    weightPerUnit: r.weightPerUnitKg,
    cbm: r.cbm ?? undefined,
    aboutCbm: r.aboutCbm ?? undefined,
    remarks: {
      noStacking: r.noStacking,
      topOnly: r.topOnly,
      orientation: r.orientation,
      heavierBelow: r.heavierBelow,
    },
  }));

const units = expandCargoesToUnits(cargoes);
const sorted = [...units].sort((a, b) => {
  const va = a.width * a.length * a.height;
  const vb = b.width * b.length * b.height;
  if (vb !== va) return vb - va;
  return b.weight - a.weight;
});

const spec = getContainerSpec("40FT");
const r = packExtremePoint(sorted, spec);
const rows = computeDisplayRows(r.placements, spec);

console.log(`Display rows: ${rows.length}`);
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  console.log(`\n=== Row ${i} (yStart=${row.yStart} yEnd=${row.yEnd} length=${row.yEnd - row.yStart}) ===`);
  console.log(`  bottoms (${row.bottomItems.length}):`);
  for (const b of row.bottomItems) {
    console.log(`    [${b.position.x.toFixed(0).padStart(3)}, ${b.position.y.toFixed(0).padStart(4)}] ${String(b.size.width).padStart(3)}×${String(b.size.length).padStart(3)} ${b.shipper}`);
  }
  console.log(`  tops (${row.topItems.length}):`);
  for (const t of row.topItems) {
    console.log(`    [${t.position.x.toFixed(0).padStart(3)}, ${t.position.y.toFixed(0).padStart(4)}] ${String(t.size.width).padStart(3)}×${String(t.size.length).padStart(3)} ${t.shipper}`);
  }
}
