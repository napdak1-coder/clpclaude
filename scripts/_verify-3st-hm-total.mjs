/**
 * 3ST HM TOTAL 시스템 시뮬레이션 vs 실무자 분배 비교 (1회용 임시).
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit, formatViolations } = await import("../lib/packing/audit.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/hochiminh-total-3.json"), "utf8"),
);

console.log(`샘플 행: ${sample.rows.length}`);

const cargoes = sample.rows.map((r, i) => ({
  id: `hm3-${i + 1}`,
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

const t0 = Date.now();
const result = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대 — ${result.containers.map(c => c.spec.type).join(", ")}`);
console.log(`unplaced: ${result.unplaced.length}`);

console.log("\n=== 시스템 분배 ===");
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
  console.log(`[${c.index}] ${c.spec.type} (${shippers.length}행): ${shippers.join(", ")}`);
}

// 실무자 분배 (사용자 입력)
const EXPECTED_40FT = [
  "한화솔루션", "한국기능공사", "고려제강", "DAEDAL INDUSTRIAL", "한화솔루션",
  "마스터플랜", "SEOKYOUNG APPAREL", "레오캡", "노브랜드", "노브랜드",
  "삼일", "삼일", "켐스코", "삼성전자", "오리콘", "보성아이엔디",
];
const EXPECTED_20FT = ["대영러버", "대영러버", "LSTM"];

console.log("\n=== 실무자 분배 ===");
console.log(`[40FT] (${EXPECTED_40FT.length}행): ${EXPECTED_40FT.join(", ")}`);
console.log(`[20FT] (${EXPECTED_20FT.length}행): ${EXPECTED_20FT.join(", ")}`);

// multiset 비교
function multiset(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function diff(a, b) {
  const ma = multiset(a), mb = multiset(b);
  const onlyA = [], onlyB = [];
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

console.log("\n=== 비교 ===");
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

// 컨테이너 타입별 매핑
const sys40 = sysContainers.find((c) => c.type === "40FT")?.list ?? [];
const sys20 = sysContainers.find((c) => c.type === "20FT")?.list ?? [];

const d40 = diff(sys40, EXPECTED_40FT);
const d20 = diff(sys20, EXPECTED_20FT);

console.log(`40FT 시스템 ${sys40.length}행 vs 실무자 ${EXPECTED_40FT.length}행:`);
if (d40.onlyA.length === 0 && d40.onlyB.length === 0) {
  console.log("  ✅ 일치");
} else {
  console.log(`  실무자엔 있는데 시스템 누락: ${d40.onlyB.join(", ") || "없음"}`);
  console.log(`  시스템엔 있는데 실무자 없음: ${d40.onlyA.join(", ") || "없음"}`);
}

console.log(`20FT 시스템 ${sys20.length}행 vs 실무자 ${EXPECTED_20FT.length}행:`);
if (d20.onlyA.length === 0 && d20.onlyB.length === 0) {
  console.log("  ✅ 일치");
} else {
  console.log(`  실무자엔 있는데 시스템 누락: ${d20.onlyB.join(", ") || "없음"}`);
  console.log(`  시스템엔 있는데 실무자 없음: ${d20.onlyA.join(", ") || "없음"}`);
}

const totalMismatch = d40.onlyA.length + d40.onlyB.length + d20.onlyA.length + d20.onlyB.length;

console.log("\n=== audit ===");
const audit = strictStackAudit(result);
console.log(formatViolations(audit));

console.log("\n=== 종합 ===");
console.log(`미배치: ${result.unplaced.length}`);
console.log(`mismatch: ${totalMismatch}`);
console.log(`audit: ${audit.pass ? "✅ pass" : "❌ fail"}`);
