import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Inline imports via tsx-like — we use --experimental-strip-types
const { expandCargoesToUnits, packExtremePoint } = await import(
  "../lib/packing/extreme-point.ts"
);
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

console.log(`Total placements: ${r.placements.length}`);
console.log(`Unplaced: ${r.unplaced.length}`);
console.log(`\nPlacement positions (sorted by y):`);
const sortedP = [...r.placements].sort((a, b) => a.position.y - b.position.y);
for (const p of sortedP) {
  console.log(
    `  y=${String(p.position.y).padStart(4)}..${String(p.position.y + p.size.length).padStart(4)} ` +
    `x=${String(p.position.x).padStart(3)}..${String(p.position.x + p.size.width).padStart(3)} ` +
    `z=${String(p.position.z).padStart(3)} L=${String(p.size.length).padStart(3)} W=${String(p.size.width).padStart(3)} H=${String(p.size.height).padStart(3)} ` +
    `${p.shipper}`
  );
}

const yStarts = [...new Set(sortedP.map((p) => p.position.y))].sort((a, b) => a - b);
console.log(`\nUnique y-starts (${yStarts.length}): ${yStarts.join(", ")}`);

console.log(`\nGaps between consecutive y-starts:`);
for (let i = 1; i < yStarts.length; i++) {
  console.log(`  ${yStarts[i - 1]} → ${yStarts[i]} (gap ${yStarts[i] - yStarts[i - 1]})`);
}
