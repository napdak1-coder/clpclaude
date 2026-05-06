/**
 * 1ST SG TOTAL 샘플 — 실무자 분배(40FT × 1 + 20FT × 1) 일치 검증.
 * data/samples/singapore-total.json (22행) 기준.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total.json");

/* expected 분배 — 사용자(실무자) 명시 */
const EXPECTED_40FT = [
  "메가젠임플란트", "데코론", "YKMC", "보현석재", "에이제이테크",
  "카페봄봄", "EXCELERATE ENERGY", "VISCOSMO", "더블유티 스프레이",
  "리만", "대한정밀공업", "선진뷰티사이언스", "SUNGBO INDUSTRIA",
  "제일기공", "웨스코", "디에스콘", "티케이테크",
];
const EXPECTED_20FT = [
  "AWOT", "대원산업", "씨에스에프", "HD현대건설기계", "포컴퍼니",
];

/* 1) JSON 샘플 로드 */
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;
console.log(`JSON 샘플: ${rows.length} 행`);

/* 2) JSON 행 → CargoSpec[] 변환 */
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

/* 3) AUTO 모드 packBest */
console.log("\n=== AUTO 모드 packBest ===");
const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map((c) => c.spec.type).join(", ")}`);
console.log(`unplaced: ${result.unplaced.length}`);

/* 4) row-by-row 매핑 */
const containerOf = new Map();
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

const lists = result.containers.map(() => []);
const unassigned = [];
for (const c of cargoes) {
  const idx = containerOf.get(c.id);
  if (idx == null) unassigned.push(c.actualShipperName);
  else lists[idx].push(c.actualShipperName);
}

console.log("\n--- 컨테이너별 실화주 (시스템 분배) ---");
result.containers.forEach((c, i) => {
  console.log(`[${i + 1}] ${c.spec.type} (${lists[i].length} 행): ${lists[i].join(", ")}`);
});
if (unassigned.length) console.log(`UNASSIGNED (${unassigned.length}): ${unassigned.join(", ")}`);

console.log("\n--- 컨테이너별 실화주 (실무자 분배) ---");
console.log(`[1] 40FT (${EXPECTED_40FT.length} 행): ${EXPECTED_40FT.join(", ")}`);
console.log(`[2] 20FT (${EXPECTED_20FT.length} 행): ${EXPECTED_20FT.join(", ")}`);

/* 5) Multiset 비교 — 컨테이너 type 기준 매칭 */
console.log("\n=== Expected vs Actual (type 기반 비교) ===");
const multiset = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
const cmp = (a, b) => {
  const ma = multiset(a), mb = multiset(b);
  const missing = [...mb].filter(([k, v]) => (ma.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (ma.get(k) ?? 0)}`);
  const extra = [...ma].filter(([k, v]) => (mb.get(k) ?? 0) < v).map(([k, v]) => `${k}×${v - (mb.get(k) ?? 0)}`);
  return { missing, extra };
};

const sys40Idx = result.containers.findIndex((c) => c.spec.type === "40FT");
const sys20Idx = result.containers.findIndex((c) => c.spec.type === "20FT");
const sys40 = sys40Idx >= 0 ? lists[sys40Idx] : [];
const sys20 = sys20Idx >= 0 ? lists[sys20Idx] : [];

const diff40 = cmp(sys40, EXPECTED_40FT);
const diff20 = cmp(sys20, EXPECTED_20FT);

console.log(`\n40FT (시스템 ${sys40.length}행 vs 실무자 ${EXPECTED_40FT.length}행):`);
const ok40 = diff40.missing.length === 0 && diff40.extra.length === 0;
console.log(`  ${ok40 ? "✅ 일치" : "❌ 불일치"}`);
if (!ok40) {
  if (diff40.missing.length) console.log(`  실무자엔 있는데 시스템 누락: ${diff40.missing.join(", ")}`);
  if (diff40.extra.length) console.log(`  시스템엔 있는데 실무자 없음: ${diff40.extra.join(", ")}`);
}

console.log(`\n20FT (시스템 ${sys20.length}행 vs 실무자 ${EXPECTED_20FT.length}행):`);
const ok20 = diff20.missing.length === 0 && diff20.extra.length === 0;
console.log(`  ${ok20 ? "✅ 일치" : "❌ 불일치"}`);
if (!ok20) {
  if (diff20.missing.length) console.log(`  실무자엔 있는데 시스템 누락: ${diff20.missing.join(", ")}`);
  if (diff20.extra.length) console.log(`  시스템엔 있는데 실무자 없음: ${diff20.extra.join(", ")}`);
}

const totalMismatch = diff40.missing.length + diff40.extra.length + diff20.missing.length + diff20.extra.length;
const containerSetOk = result.containers.length === 2 &&
  result.containers.some((c) => c.spec.type === "40FT") &&
  result.containers.some((c) => c.spec.type === "20FT");

console.log("\n=== 종합 ===");
console.log(`AUTO 분배 일치 : ${totalMismatch === 0 ? "✅" : `❌ mismatch ${totalMismatch}`}`);
console.log(`컨테이너 셋 = 1×40FT + 1×20FT : ${containerSetOk ? "✅" : `❌ 실제 ${result.containers.map((c) => c.spec.type).join("+")}`}`);
console.log(`전체 : ${totalMismatch === 0 && containerSetOk ? "✅ PASS" : "❌ FAIL"}`);

process.exit(totalMismatch === 0 && containerSetOk ? 0 : 1);
