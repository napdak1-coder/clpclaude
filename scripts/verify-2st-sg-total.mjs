/**
 * 2ST SG TOTAL 샘플 — 실무자 분배(40FT ×2) 100% 일치 검증.
 * data/samples/singapore-total-2.json (23행, 세광하이테크 추가 부킹 포함) 기준.
 */
import fs from "node:fs";
import path from "node:path";

const { pack, packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-2.json");

/* expected 분배 */
const EXPECTED_40FT_1 = [
  "동양켐텍","광명산업","웨스코 일렉트로드","한국특수잉크","효림네트",
  "YKMC","YKMC","TO THE RAFFLES","한국기술","오리스","글로벌마린","세광하이테크","PTI",
];
const EXPECTED_40FT_2 = [
  "나라켐","지덕산업","트리온","세영교역","삼영 SAMYUNG ENC",
  "한국선재","HD","리만","ECTA","현대에버다임",
];

/* 1) JSON 샘플 로드 (23행, 세광하이테크 포함) */
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;
console.log(`JSON 샘플: ${rows.length} 행`);

/* 2) JSON 행 → CargoSpec[] 변환 */
const cargoes = rows.map((r, idx) => ({
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
  remarks: {
    noStacking: r.noStacking ?? false,
    topOnly: r.topOnly ?? false,
    orientation: r.orientation ?? "free",
    heavierBelow: r.heavierBelow ?? false,
  },
  itemRemark: r.itemRemark ?? "",
}));

console.log(`CargoSpec 생성: ${cargoes.length} 화물`);
console.log("\n실화주 / 사이즈 / cbm:");
cargoes.forEach((c, i) =>
  console.log(
    `  ${(i + 1).toString().padStart(2)}. ${c.actualShipperName.padEnd(22)} ` +
      `qty=${String(c.quantity).padStart(3)} cbm=${c.cbm ?? "-"} ` +
      `about=${c.aboutCbm ?? "-"} size=${c.width}×${c.length}×${c.height}`,
  ),
);

/* 4) AUTO 모드 packBest */
console.log("\n=== AUTO 모드 packBest ===");
const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map((c) => c.spec.type).join(", ")}`);
console.log(`unplaced: ${result.unplaced.length}`);

/* 5) row-by-row 비교 */
const containerOf = new Map(); // cargoId → container index (1-based)
result.containers.forEach((c, ci) => {
  for (const row of c.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      containerOf.set(it.cargoId, ci);
    }
  }
  for (const bi of c.bulkItems ?? []) {
    if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
  }
});

// 컨테이너별 실화주 list (input order 유지)
const lists = result.containers.map(() => []);
const unassigned = [];
for (const c of cargoes) {
  const idx = containerOf.get(c.id);
  if (idx == null) unassigned.push(c.actualShipperName);
  else lists[idx].push(c.actualShipperName);
}

console.log("\n--- 컨테이너별 실화주 ---");
result.containers.forEach((c, i) => {
  console.log(`[${i + 1}] ${c.spec.type} (${lists[i].length} 행): ${lists[i].join(", ")}`);
});
if (unassigned.length) console.log(`UNASSIGNED (${unassigned.length}): ${unassigned.join(", ")}`);

/* 6) Expected 와 비교 (set 기반: 컨테이너 라벨 무관, 순서 무관) */
console.log("\n=== Expected vs Actual (set 비교) ===");
const multiset = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
const cmp = (a, b) => {
  const ma = multiset(a),
    mb = multiset(b);
  const missing = [...mb].filter(([k, v]) => (ma.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (ma.get(k) ?? 0)}`);
  const extra = [...ma].filter(([k, v]) => (mb.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (mb.get(k) ?? 0)}`);
  return { missing, extra };
};
// 두 가지 매핑 시도: lists[0]→expected#1 + lists[1]→expected#2,  또는 swap
const try1 = [cmp(lists[0] ?? [], EXPECTED_40FT_1), cmp(lists[1] ?? [], EXPECTED_40FT_2)];
const try2 = [cmp(lists[0] ?? [], EXPECTED_40FT_2), cmp(lists[1] ?? [], EXPECTED_40FT_1)];
const sumDiff = (t) => t.reduce((s, c) => s + c.missing.length + c.extra.length, 0);
const better = sumDiff(try1) <= sumDiff(try2) ? try1 : try2;
const swapped = better === try2;
console.log(swapped ? "(컨테이너 라벨 swap 매핑)" : "(직매핑)");

let totalMismatch = 0;
better.forEach((diff, i) => {
  const ok = diff.missing.length === 0 && diff.extra.length === 0;
  console.log(`40FT set #${i + 1}: ${ok ? "✅ 일치" : "❌ 불일치"}`);
  if (!ok) {
    if (diff.missing.length) console.log(`  missing: ${diff.missing.join(", ")}`);
    if (diff.extra.length) console.log(`  extra:   ${diff.extra.join(", ")}`);
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
