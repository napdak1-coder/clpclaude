/**
 * 4ST HM 의 40+40+20 후보가 왜 isValid6 실패하는지 진단.
 *
 * 절차:
 *   1) packBest 호출 (fixedContainers: [40FT, 40FT, 20FT], attachDebug: true)
 *   2) 결과를 isValid6 6 조건별로 분해 출력
 *   3) unplaced/audit violation/cbm overflow/weight overflow/cargo split/booking split 표
 *   4) 컨테이너별 cbm/weight/한도 비교
 */

import fs from "node:fs";
import { performance } from "node:perf_hooks";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const sample = JSON.parse(
  fs.readFileSync("data/samples/hochiminh-total-4.json", "utf8"),
);
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

console.log(`=== 4ST HM 40+40+20 후보 단독 시뮬 진단 ===`);
console.log(`총 화물: ${cargoes.length}`);

const t0 = performance.now();
const r = packBest(cargoes, "auto", {
  fixedContainers: ["40FT", "40FT", "20FT"],
  attachDebug: true,
});
const dt = performance.now() - t0;

console.log(`\npack 시간: ${(dt / 1000).toFixed(1)} 초`);
console.log(
  `컨테이너: ${r.containers.length} 대 — ${r.containers.map((c) => c.spec.type).join("+")}`,
);

// 1) unplaced
const unplaced = r.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
console.log(`\n[1] unplaced: ${unplaced} (행 ${r.unplaced.length} 종)`);
if (r.unplaced.length > 0) {
  for (const u of r.unplaced.slice(0, 10)) {
    console.log(
      `    - ${u.cargoId} ${u.actualShipperName ?? ""} qty=${u.quantity ?? 1} (W·L·H ${u.width ?? "?"}·${u.length ?? "?"}·${u.height ?? "?"})`,
    );
  }
}

// 2) strictStackAudit
const audit = strictStackAudit(r);
console.log(
  `\n[2] strictStackAudit: pass=${audit.pass}, violations=${audit.violations.length}`,
);
if (audit.violations.length > 0) {
  for (const v of audit.violations.slice(0, 5)) {
    console.log(`    - ${JSON.stringify(v)}`);
  }
}

// 3) 컨 별 cbm/weight 한도
console.log(`\n[3] 컨테이너별 한도 비교`);
console.log(`#  type  cbm/한도(m³)  weight/한도(kg)  overflow`);
let cbmOverflow = 0;
let weightOverflow = 0;
r.containers.forEach((c, i) => {
  const usedCbm = c.totalCbm + c.ctCbm + c.completedCbm;
  const cbmOver = usedCbm > c.spec.maxCbm + 0.001;
  const wtOver = c.totalWeight > c.spec.maxWeightKg + 0.001;
  if (cbmOver) cbmOverflow++;
  if (wtOver) weightOverflow++;
  console.log(
    `${i + 1}  ${c.spec.type}  ${usedCbm.toFixed(2)}/${c.spec.maxCbm}  ${c.totalWeight}/${c.spec.maxWeightKg}  ${cbmOver ? "CBM ❌" : ""}${wtOver ? " 중량 ❌" : ""}`.trim(),
  );
});
console.log(`cbmOverflow: ${cbmOverflow}, weightOverflow: ${weightOverflow}`);

// 4) cargo/booking split
const cargoCi = new Map();
const bkCi = new Map();
r.containers.forEach((c, ci) => {
  for (const row of c.rows ?? [])
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId) {
        const s = cargoCi.get(it.cargoId) ?? new Set();
        s.add(ci);
        cargoCi.set(it.cargoId, s);
      }
      if (it.bookingNo) {
        const s = bkCi.get(it.bookingNo) ?? new Set();
        s.add(ci);
        bkCi.set(it.bookingNo, s);
      }
    }
  for (const b of c.bulkItems ?? []) {
    if (b.cargoId) {
      const s = cargoCi.get(b.cargoId) ?? new Set();
      s.add(ci);
      cargoCi.set(b.cargoId, s);
    }
    if (b.bookingNo) {
      const s = bkCi.get(b.bookingNo) ?? new Set();
      s.add(ci);
      bkCi.set(b.bookingNo, s);
    }
  }
});
const cargoSplit = [...cargoCi.values()].filter((s) => s.size > 1).length;
const bookingSplit = [...bkCi.values()].filter((s) => s.size > 1).length;
console.log(`\n[4] cargoIdSplit: ${cargoSplit}, bookingSplit: ${bookingSplit}`);

// 5) isValid6 종합
const isValid =
  unplaced === 0 &&
  audit.pass &&
  audit.violations.length === 0 &&
  cbmOverflow === 0 &&
  weightOverflow === 0 &&
  cargoSplit === 0 &&
  bookingSplit === 0;
console.log(`\n=== isValid6: ${isValid ? "✅ valid" : "❌ INVALID"} ===`);

const failReasons = [];
if (unplaced > 0) failReasons.push(`unplaced=${unplaced}`);
if (!audit.pass || audit.violations.length > 0)
  failReasons.push(`audit fail (${audit.violations.length} violations)`);
if (cbmOverflow > 0) failReasons.push(`cbmOverflow=${cbmOverflow}`);
if (weightOverflow > 0) failReasons.push(`weightOverflow=${weightOverflow}`);
if (cargoSplit > 0) failReasons.push(`cargoSplit=${cargoSplit}`);
if (bookingSplit > 0) failReasons.push(`bookingSplit=${bookingSplit}`);
console.log(`failReasons: [${failReasons.join(", ") || "(없음)"}]`);
