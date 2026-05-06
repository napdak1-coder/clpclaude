/**
 * 2ST HM TOTAL 샘플 — 실무자 분배(40FT ×2 + 20FT ×1) 일치 검증.
 * data/samples/hochiminh-total-2.json (26행, 252 units, 126.93 m³) 기준.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/hochiminh-total-2.json");

/* expected 분배 — 사용자(실무자) 명시 */
const EXPECTED_40FT_1 = [
  "AMS","한국쎄미텍","유라","KIOSKIN","전영사",
  "SD KOREA","SJIT","일라","SJI","KFTS",
  "한성엔터프라이즈","이구산업","케이티엔테크놀러지",
];
const EXPECTED_40FT_2 = [
  "제임스텍","중앙바이오텍","리브유","파인 파인비나","블루오션",
  "파인비나","장안어패럴","디씨이메탈","스톰테크",
];
const EXPECTED_20FT_3 = [
  "효성","로제화장품","삼원절연","화인써키트",
];

/* 1) JSON 샘플 로드 */
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;
console.log(`JSON 샘플: ${rows.length} 행`);

/* 2) JSON 행 → CargoSpec[] 변환 */
const cargoes = rows.map((r, idx) => ({
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

console.log(`CargoSpec 생성: ${cargoes.length} 화물`);
console.log("\n실화주 / 사이즈 / cbm:");
cargoes.forEach((c, i) =>
  console.log(
    `  ${(i + 1).toString().padStart(2)}. ${c.actualShipperName.padEnd(22)} ` +
      `qty=${String(c.quantity).padStart(3)} cbm=${c.cbm ?? "-"} ` +
      `about=${c.aboutCbm ?? "-"} size=${c.width}×${c.length}×${c.height}`,
  ),
);

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
console.log(`[1] 40FT (${EXPECTED_40FT_1.length} 행): ${EXPECTED_40FT_1.join(", ")}`);
console.log(`[2] 40FT (${EXPECTED_40FT_2.length} 행): ${EXPECTED_40FT_2.join(", ")}`);
console.log(`[3] 20FT (${EXPECTED_20FT_3.length} 행): ${EXPECTED_20FT_3.join(", ")}`);

/* 5) Expected 와 multiset 비교 — 컨테이너 매칭은 best assignment */
console.log("\n=== Expected vs Actual (multiset 비교) ===");
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
const sumDiff = (t) => t.reduce((s, c) => s + c.missing.length + c.extra.length, 0);

// 시스템 컨테이너가 정확히 3개일 때만 best-permutation 시도; 아니면 set-of-sets 폴백
const expectedSets = [EXPECTED_40FT_1, EXPECTED_40FT_2, EXPECTED_20FT_3];
const expectedTypes = ["40FT", "40FT", "20FT"];
let bestDiff = null;
let bestPerm = null;
if (result.containers.length === expectedSets.length) {
  // 3! = 6 순열 모두 시도
  const perms = (arr) => {
    if (arr.length <= 1) return [arr];
    const res = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of perms(rest)) res.push([arr[i], ...p]);
    }
    return res;
  };
  for (const p of perms([0, 1, 2])) {
    const diffs = p.map((expIdx, sysIdx) => cmp(lists[sysIdx] ?? [], expectedSets[expIdx]));
    const total = sumDiff(diffs);
    if (bestDiff == null || total < sumDiff(bestDiff)) {
      bestDiff = diffs;
      bestPerm = p;
    }
  }
} else {
  console.log(`(컨테이너 개수 ${result.containers.length} ≠ 기대 ${expectedSets.length} — 폴백 비교)`);
  bestDiff = lists.map((l, i) => cmp(l, expectedSets[i] ?? []));
  bestPerm = expectedSets.map((_, i) => i);
}

let totalMismatch = 0;
bestDiff.forEach((diff, sysIdx) => {
  const expIdx = bestPerm[sysIdx];
  const expectedType = expectedTypes[expIdx] ?? "?";
  const sysType = result.containers[sysIdx]?.spec.type ?? "?";
  const ok = diff.missing.length === 0 && diff.extra.length === 0;
  console.log(
    `시스템[${sysIdx + 1}] ${sysType} ↔ 실무자[${expIdx + 1}] ${expectedType}: ${ok ? "✅ 일치" : "❌ 불일치"}`,
  );
  if (!ok) {
    if (diff.missing.length) console.log(`  실무자엔 있는데 시스템 누락: ${diff.missing.join(", ")}`);
    if (diff.extra.length) console.log(`  시스템엔 있는데 실무자 없음: ${diff.extra.join(", ")}`);
    totalMismatch += diff.missing.length + diff.extra.length;
  }
});

const allMatch = totalMismatch === 0 && unassigned.length === 0;
const expectedTypeMultiset = multiset(expectedTypes);
const sysTypeMultiset = multiset(result.containers.map((c) => c.spec.type));
const sameTypes =
  [...expectedTypeMultiset].every(([k, v]) => sysTypeMultiset.get(k) === v) &&
  [...sysTypeMultiset].every(([k, v]) => expectedTypeMultiset.get(k) === v);

console.log("\n=== 종합 ===");
console.log(`AUTO 분배 일치 : ${allMatch ? "✅" : `❌ mismatch ${totalMismatch}`}`);
console.log(
  `컨테이너 셋 = 40FT×2 + 20FT×1 : ${sameTypes ? "✅" : `❌ 실제 ${result.containers.map((c) => c.spec.type).join("+")}`}`,
);
console.log(`전체 : ${allMatch && sameTypes ? "✅ PASS" : "❌ FAIL"}`);

process.exit(allMatch && sameTypes ? 0 : 1);
