// 컨테이너별 화주 분포만 추출 (요청 분배와 일치 확인용)
import fs from "node:fs";
import path from "node:path";
const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/hochiminh-total-2.json"), "utf8"),
);
const cargoes = sample.rows.map((r, idx) => ({
  id: `hm2-${idx + 1}`,
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
const cargoById = new Map(cargoes.map((c) => [c.id, c]));

const result = packBest(cargoes, "auto");

for (const cont of result.containers) {
  const ids = new Set();
  for (const row of cont.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) ids.add(it.cargoId);
  }
  for (const b of cont.bulkItems ?? []) ids.add(b.cargoId);
  const shippers = new Map();
  for (const id of ids) {
    const cg = cargoById.get(id);
    const key = cg?.actualShipperName || cg?.shipperName || "(unknown)";
    shippers.set(key, (shippers.get(key) ?? 0) + 1);
  }
  console.log(`[${cont.index}] ${cont.spec.type}  화주 ${shippers.size}곳, cargo ${ids.size}건`);
  for (const [name, n] of shippers) console.log(`    - ${name}  (${n}건)`);
}
