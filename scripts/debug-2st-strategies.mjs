/**
 * 2ST SG 의 모든 (strategy × containerOrder × placementMode × consolidate) 조합 결과 출력
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-2.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg2-${idx + 1}`,
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
  remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
  itemRemark: r.itemRemark ?? "",
}));

const strategies = ["ldf", "longest-side", "tallest", "widest", "input", "shortest", "shortest-height"];
const orders = ["biggest-first", "smallest-first"];
const modes = ["wrapper", "pure"];

const wantsHyundae1 = (r) => {
  const c1Has = r.containers[0].rows.some(row =>
    [...row.bottomItems, ...row.topItems].some(it => it.shipper === "현대에버다임")
  ) || (r.containers[0].bulkItems ?? []).some(b => b.shipper === "현대에버다임");
  return c1Has;
};

const labelByContainer = (r) => {
  return r.containers.map((c, ci) => {
    const shippers = new Set();
    for (const row of c.rows) for (const it of [...row.bottomItems, ...row.topItems]) shippers.add(it.shipper);
    for (const b of (c.bulkItems ?? [])) shippers.add(b.shipper);
    return `[${ci+1}](${shippers.size}) ${[...shippers].join(", ")}`;
  });
};

console.log("strategy/order/mode | hyundae | cbm-balance | distribution");
console.log("-".repeat(90));
for (const s of strategies) {
  for (const o of orders) {
    for (const m of modes) {
      const r = pack(cargoes, "auto", { sortStrategy: s, containerOrder: o, placementMode: m });
      const cbm0 = r.containers[0].totalCbm + r.containers[0].ctCbm;
      const cbm1 = r.containers[1] ? r.containers[1].totalCbm + r.containers[1].ctCbm : 0;
      const has1 = wantsHyundae1(r);
      const tag = `${s.padEnd(15)} ${o.padEnd(15)} ${m.padEnd(8)}`;
      const balance = Math.abs(cbm0 - cbm1).toFixed(1);
      const cnt = r.containers.length;
      const unp = r.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
      console.log(`${tag} | hyundae#1=${has1?"Y":"N"} | unp=${unp} | balance=${balance} | ${cnt}컨 [${cbm0.toFixed(1)}/${cbm1.toFixed(1)}]`);
    }
  }
}
