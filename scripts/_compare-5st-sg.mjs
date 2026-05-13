/* 5ST SG TOTAL 시스템 vs 실무자 분배 비교 */
import fs from "node:fs";
const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync("data/samples/singapore-total-5.json", "utf8"),
);
const cargoes = sample.rows.map((r, i) => ({
  id: `sg5-${i + 1}`,
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

const PRACTITIONER = {
  "40FT-A": [
    "YKMC", "솔텍", "민서코팅", "아성플라스틱밸브", "TPG (티피지)", "더젬코리아",
    "베스프코리아", "카고러쉬", "나라켐", "태원니들", "베베푸드", "코리얼트레이딩스",
    "삼성전자", "DN 솔루션즈", "대현 ST", "KMS", "삼성전자",
  ],
  "40FT-B": [
    "유앤아이원", "낙천", "YKMC", "한도신소재", "YOKOHAMA **TS**", "MOJI **TS**",
    "SHIMIZU **TS**", "서울통신이앤지", "DGI", "JWE HOSE", "세웅플랜트",
    "JPTPUS26040003(T/S)", "하이브코리아", "세원", "서울통신이앤지", "덕산하이메탈",
    "아이마니", "KJF", "에프디씨바이오",
  ],
};

console.log("=== 5ST SG TOTAL 시스템 시뮬 ===");
console.log(`총 화물: ${cargoes.length}`);
const t0 = Date.now();
const result = packBest(cargoes, "auto");
const dt = Date.now() - t0;
console.log(`pack 시간: ${(dt / 1000).toFixed(1)}초`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map(c => c.spec.type).join(", ")}`);
console.log(`미배치: ${result.unplaced.length}건`);

// cargoId → 컨 인덱스
const containerOf = new Map();
result.containers.forEach((c, ci) => {
  for (const row of c.rows)
    for (const it of [...row.bottomItems, ...row.topItems])
      containerOf.set(it.cargoId, ci);
  for (const bi of c.bulkItems ?? [])
    if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
});

console.log(`\n--- 시스템 컨테이너별 실화주 ---`);
const systemByCont = result.containers.map((c, ci) => {
  const shippers = [];
  for (const cg of cargoes) {
    if (containerOf.get(cg.id) === ci) shippers.push(cg.actualShipperName);
  }
  console.log(`[${ci + 1}] ${c.spec.type} (${shippers.length}행): ${shippers.join(", ")}`);
  return { type: c.spec.type, shippers };
});

console.log(`\n--- 실무자 분배 ---`);
console.log(`[A] 40FT (${PRACTITIONER["40FT-A"].length}행): ${PRACTITIONER["40FT-A"].join(", ")}`);
console.log(`[B] 40FT (${PRACTITIONER["40FT-B"].length}행): ${PRACTITIONER["40FT-B"].join(", ")}`);

// 컨 셋 비교
const systemTypes = systemByCont.map(c => c.type).sort().join("+");
const practitionerTypes = ["40FT", "40FT"].sort().join("+");
console.log(`\n--- 컨 셋 비교 ---`);
console.log(`시스템: ${systemTypes}`);
console.log(`실무자: ${practitionerTypes}`);
console.log(`일치: ${systemTypes === practitionerTypes ? "✅" : "❌"}`);

// multiset 비교
function mset(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function intersectSize(a, b) {
  let s = 0;
  for (const [k, v] of a) s += Math.min(v, b.get(k) ?? 0);
  return s;
}
function diffMset(a, b) {
  const out = [];
  for (const [k, v] of a) {
    const cnt = v - (b.get(k) ?? 0);
    if (cnt > 0) out.push(`${k}×${cnt}`);
  }
  return out;
}

const practSets = [
  { label: "[A] 40FT", type: "40FT", items: PRACTITIONER["40FT-A"] },
  { label: "[B] 40FT", type: "40FT", items: PRACTITIONER["40FT-B"] },
];

console.log(`\n--- 컨별 multiset 비교 ---`);
let totalDiff = 0;
const usedPract = new Set();
for (let ci = 0; ci < systemByCont.length; ci++) {
  const s = systemByCont[ci];
  const sMset = mset(s.shippers);
  let best = null;
  for (let pi = 0; pi < practSets.length; pi++) {
    if (usedPract.has(pi)) continue;
    if (practSets[pi].type !== s.type) continue;
    const inter = intersectSize(sMset, mset(practSets[pi].items));
    if (best === null || inter > best.inter) best = { pi, inter };
  }
  if (!best) {
    console.log(`시스템[${ci + 1}] ${s.type} (${s.shippers.length}행) → 매칭 가능한 실무자 셋 없음 (extra container)`);
    totalDiff += s.shippers.length;
    continue;
  }
  usedPract.add(best.pi);
  const pMset = mset(practSets[best.pi].items);
  const missing = diffMset(pMset, sMset);
  const extra = diffMset(sMset, pMset);
  const diffN = missing.length + extra.length;
  totalDiff += diffN;
  const ok = diffN === 0;
  console.log(`시스템[${ci + 1}] ${s.type} ↔ 실무자${practSets[best.pi].label}: ${ok ? "✅ 일치" : "❌ 불일치"}`);
  if (!ok) {
    if (missing.length) console.log(`  실무자엔 있는데 시스템 누락: ${missing.join(", ")}`);
    if (extra.length) console.log(`  시스템엔 있는데 실무자 없음: ${extra.join(", ")}`);
  }
}

console.log(`\n=== 종합 ===`);
console.log(`AUTO 분배 일치 : ${totalDiff === 0 ? "✅" : `❌ mismatch ${totalDiff}`}`);
console.log(`컨 셋 동일      : ${systemTypes === practitionerTypes ? "✅" : "❌"}`);
console.log(`미배치          : ${result.unplaced.length === 0 ? "✅ 0" : `❌ ${result.unplaced.length}`}`);
