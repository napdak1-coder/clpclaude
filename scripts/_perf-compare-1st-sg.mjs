/**
 * 1ST SG TOTAL 성능 비교 — default 매트릭스 vs lightMode.
 *
 * 측정:
 *  - pack 시간 (ms)
 *  - 미배치 (unplaced)
 *  - 컨테이너 셋
 *  - 분배 (실화주별)
 *
 * 둘 다 미배치·물리·B1 통과 + 분배가 같으면 lightMode 가 안전한 단축.
 * 분배가 달라지면 lightMode 가 best 를 놓치는 케이스 → 단축 X.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total.json");
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;

const cargoes = rows.map((r, idx) => ({
  id: `sg1-${idx + 1}`,
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

console.log(`샘플 행 수: ${rows.length}`);

function summarize(label, t0, result) {
  const ms = Date.now() - t0;
  const types = result.containers.map((c) => c.spec.type).join(", ");
  console.log(`\n=== ${label} ===`);
  console.log(`pack 시간: ${ms}ms (${(ms / 1000).toFixed(1)}초)`);
  console.log(`컨테이너: ${result.containers.length}대 — ${types}`);
  console.log(`unplaced: ${result.unplaced.length}`);
  for (const c of result.containers) {
    const shippers = [];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.shipper) shippers.push(it.shipper);
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.shipper) shippers.push(b.shipper);
    }
    const dedup = [...new Set(shippers)];
    console.log(`  [${c.index}] ${c.spec.type} (${dedup.length} 행): ${dedup.join(", ")}`);
  }
  return { ms, result };
}

console.log("\n[1] default (64 매트릭스) 측정 중...");
const t1 = Date.now();
const r1 = packBest(cargoes, "auto");
const sumDefault = summarize("default (64 시도)", t1, r1);

console.log("\n[2] lightMode (3 매트릭스) 측정 중...");
const t2 = Date.now();
const r2 = packBest(cargoes, "auto", { lightMode: true });
const sumLight = summarize("lightMode (3 시도)", t2, r2);

console.log("\n=== 비교 ===");
console.log(`시간 단축: ${sumDefault.ms}ms → ${sumLight.ms}ms (${((1 - sumLight.ms / sumDefault.ms) * 100).toFixed(1)}% 단축)`);
console.log(`미배치 동일: ${r1.unplaced.length === r2.unplaced.length ? "✅" : `❌ ${r1.unplaced.length} → ${r2.unplaced.length}`}`);

const types1 = r1.containers.map((c) => c.spec.type).sort().join(",");
const types2 = r2.containers.map((c) => c.spec.type).sort().join(",");
console.log(`컨 셋 동일: ${types1 === types2 ? "✅" : `❌ ${types1} vs ${types2}`}`);

// 컨테이너별 실화주 set 동일성
function shippersByContainer(r) {
  return r.containers.map((c) => {
    const set = new Set();
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.shipper) set.add(it.shipper);
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.shipper) set.add(b.shipper);
    }
    return [...set].sort();
  });
}
const s1 = shippersByContainer(r1);
const s2 = shippersByContainer(r2);
const sameDist = s1.length === s2.length && s1.every((arr, i) => {
  const j = s2.findIndex((arr2) => arr2.length === arr.length && arr2.every((x, k) => x === arr[k]));
  return j !== -1;
});
console.log(`분배 동일: ${sameDist ? "✅" : "❌"}`);
