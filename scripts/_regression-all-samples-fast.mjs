/* 9 샘플 packBest 단독 시뮬 — 빠른 결과 (candidateUnion X) */
import fs from "node:fs";
const { packBest } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  { id: "sg-mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG TOTAL", file: "data/samples/singapore-total.json" },
  { id: "sg-2", name: "2ST SG TOTAL", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", name: "3ST SG TOTAL", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", name: "4ST SG TOTAL", file: "data/samples/singapore-total-4.json" },
  { id: "hm-1", name: "1ST HM TOTAL", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", name: "2ST HM TOTAL", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", name: "3ST HM TOTAL", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", name: "4ST HM TOTAL", file: "data/samples/hochiminh-total-4.json" },
];

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
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

console.log("=== 9 샘플 packBest 단독 (DB 최신 데이터) ===");
console.log("id          | name          | 컨 셋             | 미배치 | pack 시간");
console.log("---");
for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    console.log(`${s.id} | SKIP`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const t0 = Date.now();
  const r = packBest(cargoes, "auto");
  const dt = Date.now() - t0;
  const set = r.containers.map((c) => c.spec.type).join("+");
  const unplaced = r.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
  console.log(
    `${s.id.padEnd(11)} | ${s.name.padEnd(13)} | ${set.padEnd(17)} | ${unplaced.toString().padStart(3)} | ${(dt / 1000).toFixed(1).padStart(6)}초`,
  );
}
console.log("---");
