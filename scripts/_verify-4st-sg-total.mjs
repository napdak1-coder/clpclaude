/**
 * 4ST SG TOTAL 시스템 vs 실무자 분배 비교 (사이즈 수정본 기반).
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit, formatViolations } = await import(
  "../lib/packing/audit.ts"
);

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/singapore-total-4.json"), "utf8"),
);

console.log(`샘플 행: ${sample.rows.length}`);

const cargoes = sample.rows.map((r, i) => ({
  id: `sg4-${i + 1}`,
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

const totalCbm = cargoes.reduce(
  (s, c) => s + (c.cbm ?? c.aboutCbm ?? 0),
  0,
);
console.log(`총 CBM: ${totalCbm.toFixed(2)}`);

const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(
  `컨테이너: ${result.containers.length}대 — ${result.containers.map((c) => c.spec.type).join(", ")}`,
);
console.log(`unplaced: ${result.unplaced.length}`);

console.log("\n=== 시스템 분배 ===");
const sysContainers = result.containers.map((c) => {
  const list = [];
  for (const row of c.rows ?? []) {
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.shipper) list.push(it.shipper);
    }
  }
  for (const b of c.bulkItems ?? []) {
    if (b.shipper) list.push(b.shipper);
  }
  return { type: c.spec.type, list };
});
for (let i = 0; i < sysContainers.length; i++) {
  const c = sysContainers[i];
  console.log(`[${i + 1}] ${c.type} (${c.list.length}행): ${c.list.join(", ")}`);
}

// 실무자 분배
const EXPECTED_40FT_1 = [
  "나토", "CNS", "무등", "수일", "YKMC", "삼화전기", "직방", "KPF",
  "에어뱅크", "대풍건설", "코스모신소재", "나은이앤지", "KUK DONG HOIST",
  "TP(코리아실크로드)", "세방에스비", "위너스마린", "맥테크", "워터피이", "SY INT'L",
];
const EXPECTED_40FT_2 = [
  "삼성전자", "삼성전자", "삼성전자", "삼성전자", "삼성전자",
  "삼성전자", "삼성전자", "삼성전자",
  "LS BUILDWIN LTD.", "MNCI **반송**", "위너스마린",
  "YKMC", "베베쿡", "IPIA COSMETICS", "훌루테크", "광명산업",
  "DSR WIRE CORP", "DSR WIRE CORP", "동방기계", "위너스마린",
];
const EXPECTED_40FT_3 = [
  "나토", "CMOS 청강", "CMOS 호성이레테", "CMOS 대림바스",
  "CMOS 삼화정밀", "CMOS CDC", "코오롱(SUPERTRAIN)", "나토상사",
  "반도텍", "나라켐", "동아베스텍", "디에스상사",
  "서울금속(한큐한신)*상단/작업주의*", "삼성전자", "스킨렉스",
];
const expectedSets = [EXPECTED_40FT_1, EXPECTED_40FT_2, EXPECTED_40FT_3];

console.log("\n=== 실무자 분배 ===");
expectedSets.forEach((s, i) =>
  console.log(`[${i + 1}] 40FT (${s.length}행): ${s.join(", ")}`),
);

// multiset 비교
function multiset(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function diff(a, b) {
  const ma = multiset(a),
    mb = multiset(b);
  const onlyA = [],
    onlyB = [];
  for (const [k, v] of ma) {
    const vb = mb.get(k) ?? 0;
    if (v > vb) onlyA.push(`${k}×${v - vb}`);
  }
  for (const [k, v] of mb) {
    const va = ma.get(k) ?? 0;
    if (v > va) onlyB.push(`${k}×${v - va}`);
  }
  return { onlyA, onlyB };
}

// 시스템 컨테이너 중 40FT 만 필터 + 실무자 셋과 best 매칭
const sys40 = sysContainers.filter((c) => c.type === "40FT");
console.log("\n=== 비교 ===");
if (sys40.length === 3) {
  // 모든 순열로 best 매칭 찾기
  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permutations(rest)) out.push([arr[i], ...p]);
    }
    return out;
  }
  let bestPerm = null;
  let bestMismatch = Infinity;
  for (const perm of permutations([0, 1, 2])) {
    let mismatch = 0;
    for (let i = 0; i < 3; i++) {
      const d = diff(sys40[i].list, expectedSets[perm[i]]);
      mismatch += d.onlyA.length + d.onlyB.length;
    }
    if (mismatch < bestMismatch) {
      bestMismatch = mismatch;
      bestPerm = perm;
    }
  }
  for (let i = 0; i < 3; i++) {
    const d = diff(sys40[i].list, expectedSets[bestPerm[i]]);
    if (d.onlyA.length === 0 && d.onlyB.length === 0) {
      console.log(`시스템[${i + 1}] ↔ 실무자[${bestPerm[i] + 1}]: ✅ 일치`);
    } else {
      console.log(`시스템[${i + 1}] ↔ 실무자[${bestPerm[i] + 1}]: ❌ 불일치`);
      if (d.onlyB.length > 0)
        console.log(`  실무자엔 있는데 시스템 누락: ${d.onlyB.join(", ")}`);
      if (d.onlyA.length > 0)
        console.log(`  시스템엔 있는데 실무자 없음: ${d.onlyA.join(", ")}`);
    }
  }
  console.log(`\n총 mismatch: ${bestMismatch}`);
} else {
  console.log(
    `⚠️ 시스템 40FT ${sys40.length}대 vs 실무자 3대 — 트럭 수 차이`,
  );
}

console.log("\n=== 무게 적층 룰 audit ===");
const audit = strictStackAudit(result);
console.log(formatViolations(audit));

console.log("\n=== alternative (더 작은 트럭 셋) ===");
if (result.alternative) {
  console.log(`✅ alternative: ${result.alternative.description}`);
} else {
  console.log("alternative 없음");
}

console.log("\n=== 종합 ===");
console.log(`미배치: ${result.unplaced.length}`);
console.log(`audit: ${audit.pass ? "✅ pass" : "❌ fail"}`);
