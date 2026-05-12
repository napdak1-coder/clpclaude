/**
 * 3ST SG TOTAL 샘플 — 실무자 분배(40FT × 2) 일치 검증.
 * data/samples/singapore-total-3.json (35 cargo) 기준.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");

/* expected 분배 — 사용자(실무자) 명시: row 1~19 → 컨1, row 20~35 → 컨2 */
const EXPECTED_40FT_1_INDEXES = Array.from({ length: 19 }, (_, i) => i + 1); // sg3-1..19
const EXPECTED_40FT_2_INDEXES = Array.from({ length: 16 }, (_, i) => i + 20); // sg3-20..35

const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;
console.log(`JSON 샘플: ${rows.length} 행`);

const cargoes = rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

const expectedC1 = EXPECTED_40FT_1_INDEXES.map((i) => cargoes[i - 1]?.actualShipperName ?? "?");
const expectedC2 = EXPECTED_40FT_2_INDEXES.map((i) => cargoes[i - 1]?.actualShipperName ?? "?");

// FLOWBUS (326cm 막대형) 우선 — 자리 먼저 잡아야 다른 화물도 적재 가능
const flowbusIdx = cargoes.findIndex((c) => c.bookingNo === "FBSIN260417");
if (flowbusIdx > 0) {
  const flowbus = cargoes.splice(flowbusIdx, 1)[0];
  cargoes.unshift(flowbus);
  console.log(`FLOWBUS 우선 배치 (idx ${flowbusIdx} → 0)`);
}

console.log("\n=== AUTO 모드 packBest ===");
const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map((c) => c.spec.type).join(", ")}`);
console.log(`unplaced: ${result.unplaced.length}`);

const containerOf = new Map();
result.containers.forEach((c, ci) => {
  for (const row of c.rows) for (const it of [...row.bottomItems, ...row.topItems]) containerOf.set(it.cargoId, ci);
  for (const bi of c.bulkItems ?? []) if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
});
const lists = result.containers.map(() => []);
const unassigned = [];
for (const c of cargoes) {
  const idx = containerOf.get(c.id);
  if (idx == null) unassigned.push(c.actualShipperName);
  else lists[idx].push(c.actualShipperName);
}
console.log("\n--- 컨테이너별 실화주 (시스템 AUTO) ---");
result.containers.forEach((c, i) => console.log(`[${i + 1}] ${c.spec.type} (${lists[i].length} 행): ${lists[i].join(", ")}`));
if (unassigned.length) console.log(`UNASSIGNED (${unassigned.length}): ${unassigned.join(", ")}`);

console.log("\n--- 컨테이너별 실화주 (실무자) ---");
console.log(`[1] 40FT (${expectedC1.length} 행): ${expectedC1.join(", ")}`);
console.log(`[2] 40FT (${expectedC2.length} 행): ${expectedC2.join(", ")}`);

const multiset = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const cmp = (a, b) => {
  const ma = multiset(a), mb = multiset(b);
  const missing = [...mb].filter(([k, v]) => (ma.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (ma.get(k) ?? 0)}`);
  const extra = [...ma].filter(([k, v]) => (mb.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (mb.get(k) ?? 0)}`);
  return { missing, extra };
};
const try1 = [cmp(lists[0] ?? [], expectedC1), cmp(lists[1] ?? [], expectedC2)];
const try2 = [cmp(lists[0] ?? [], expectedC2), cmp(lists[1] ?? [], expectedC1)];
const sumDiff = (t) => t.reduce((s, c) => s + c.missing.length + c.extra.length, 0);
const better = sumDiff(try1) <= sumDiff(try2) ? try1 : try2;
const swapped = better === try2;
console.log("\n=== Expected vs Actual (set 비교) ===");
console.log(swapped ? "(컨테이너 라벨 swap 매핑)" : "(직매핑)");
let totalMismatch = 0;
better.forEach((diff, i) => {
  const ok = diff.missing.length === 0 && diff.extra.length === 0;
  console.log(`40FT set #${i + 1}: ${ok ? "✅ 일치" : "❌ 불일치"}`);
  if (!ok) {
    if (diff.missing.length) console.log(`  실무자엔 있는데 시스템 누락: ${diff.missing.join(", ")}`);
    if (diff.extra.length) console.log(`  시스템엔 있는데 실무자 없음: ${diff.extra.join(", ")}`);
    totalMismatch += diff.missing.length + diff.extra.length;
  }
});
const allMatch = totalMismatch === 0 && unassigned.length === 0;
const allCt40 = result.containers.length === 2 && result.containers.every((c) => c.spec.type === "40FT");
console.log("\n=== 종합 ===");
console.log(`AUTO 분배 일치 : ${allMatch ? "✅" : `❌ mismatch ${totalMismatch}`}`);
console.log(`컨테이너 = 2×40FT : ${allCt40 ? "✅" : `❌ 실제 ${result.containers.map((c) => c.spec.type).join("+")}`}`);
console.log(`전체 : ${allMatch && allCt40 ? "✅ PASS" : "❌ FAIL"}`);
process.exit(allMatch && allCt40 ? 0 : 1);
