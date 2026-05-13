/* 4ST HM 시스템 시뮬레이션 vs 실무자 분배 비교 */
import fs from "node:fs";
const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync("data/samples/hochiminh-total-4.json", "utf8"));
const cargoes = sample.rows.map((r, i) => ({
  id: `hm4-${i + 1}`,
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

// 실무자 분배 (사용자 메시지)
const PRACTITIONER = {
  "40FT-A": ["카고러쉬", "동해산업", "한성정밀", "엘엔와이무역", "영천항운", "보광캡",
    "비바상사", "비바상사", "우양통상", "한일", "성진아이앤씨", "성진 레더뱅크",
    "이로실업 (C&H VINA)", "반석인더스트리즈", "TMS KOREA", "서우트리밍", "글로텍"],
  "40FT-B": ["HK PMC", "팍스모리", "대명물산", "레이어", "지브이", "지브이", "지브이",
    "에이펙스 (APEX)", "에이펙스", "윤하", "윤하", "KOS LIMITED", "KOS LIMITED",
    "롯데케미칼", "한국베이스프", "HP&C", "FTN", "FTN", "FTN", "한국코코", "효성"],
  "20FT": ["후지쿠라(한큐한신)**최상단적재**", "대양테크", "노브랜드"],
};

const t0 = Date.now();
const result = packBest(cargoes, "auto");
const dt = Date.now() - t0;

console.log(`=== 4ST HM 시스템 시뮬레이션 ===`);
console.log(`총 화물: ${cargoes.length}`);
console.log(`pack 시간: ${dt}ms`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map(c => c.spec.type).join(", ")}`);
console.log(`미배치: ${result.unplaced.length}건`);

// cargoId → 컨 인덱스 매핑 (verify-3st-sg-total.mjs 패턴)
const containerOf = new Map();
result.containers.forEach((c, ci) => {
  for (const row of c.rows)
    for (const it of [...row.bottomItems, ...row.topItems])
      containerOf.set(it.cargoId, ci);
  for (const bi of c.bulkItems ?? [])
    if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
});

console.log(`\n--- 시스템 컨테이너별 실화주 (원본 cargo 라벨로 채집) ---`);
const systemByCont = result.containers.map((c, ci) => {
  const shippers = [];
  for (const cg of cargoes) {
    if (containerOf.get(cg.id) === ci) shippers.push(cg.actualShipperName);
  }
  console.log(`[${ci + 1}] ${c.spec.type} (${shippers.length}행): ${shippers.join(", ")}`);
  return { type: c.spec.type, shippers };
});

console.log(`\n--- 실무자 분배 ---`);
console.log(`[A] 40FT (17행): ${PRACTITIONER["40FT-A"].join(", ")}`);
console.log(`[B] 40FT (21행): ${PRACTITIONER["40FT-B"].join(", ")}`);
console.log(`[C] 20FT (3행): ${PRACTITIONER["20FT"].join(", ")}`);

// 컨 타입 셋 비교
const systemTypes = systemByCont.map(c => c.type).sort().join("+");
const practitionerTypes = ["40FT", "40FT", "20FT"].sort().join("+");
console.log(`\n--- 컨테이너 셋 비교 ---`);
console.log(`시스템: ${systemTypes}`);
console.log(`실무자: ${practitionerTypes}`);
console.log(`일치: ${systemTypes === practitionerTypes ? "✅" : "❌"}`);

// 최적 라벨 매핑 — 시스템 컨을 실무자 컨에 매칭 (multiset 교집합 최대)
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
  { label: "[C] 20FT", type: "20FT", items: PRACTITIONER["20FT"] },
];

// system 컨 각각 best-matching practitioner 셋 (같은 타입 우선)
console.log(`\n--- 컨테이너별 비교 (multiset, best match by intersection) ---`);
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
    console.log(`시스템[${ci + 1}] ${s.type} (${s.shippers.length}행) → 매칭 가능한 실무자 셋 없음`);
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
console.log(`컨테이너 셋 동일 : ${systemTypes === practitionerTypes ? "✅" : "❌"}`);
console.log(`미배치 : ${result.unplaced.length === 0 ? "✅ 0" : `❌ ${result.unplaced.length}`}`);
