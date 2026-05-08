/**
 * 3ST SG TOTAL — 실무자 vs 시스템(pack auto + footprintCluster) 행 단위 비교.
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;

const cargoes = rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
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
const result = pack(cargoes, "auto", { footprintCluster: { enabled: true } });
const elapsed = Date.now() - t0;
console.log(`pack 시간: ${elapsed}ms`);
console.log(`컨테이너 개수: ${result.containers.length}`);
result.containers.forEach((c, i) =>
  console.log(`  컨${i + 1}: ${c.spec.type}`),
);
console.log(`unplaced: ${result.unplaced.length}`);

// 각 cargoId 가 어느 컨에 들어갔는지 매핑
const containerOf = new Map();
result.containers.forEach((c, ci) => {
  for (const row of c.rows ?? []) {
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      containerOf.set(it.cargoId, ci);
    }
  }
  for (const bi of c.bulkItems ?? []) {
    if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
  }
});
const unplacedIds = new Set(result.unplaced.map((u) => u.cargoId));

// 시스템 분배 컨테이너별 cargo id 리스트
const sysC1 = [];
const sysC2 = [];
const sysUnplaced = [];
for (const c of cargoes) {
  if (unplacedIds.has(c.id)) {
    sysUnplaced.push(c);
    continue;
  }
  const ci = containerOf.get(c.id);
  if (ci === 0) sysC1.push(c);
  else if (ci === 1) sysC2.push(c);
  else sysUnplaced.push(c);
}

// 실무자 분배: 1~19 → 컨1, 20~35 → 컨2
const expC1Ids = new Set(Array.from({ length: 19 }, (_, i) => `sg3-${i + 1}`));
const expC2Ids = new Set(Array.from({ length: 16 }, (_, i) => `sg3-${i + 20}`));

const sysC1Ids = new Set(sysC1.map((c) => c.id));
const sysC2Ids = new Set(sysC2.map((c) => c.id));

// 라벨 swap 판정 (시스템 컨1 = 실무자 컨2 일 수도)
const overlap = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};
const direct = overlap(sysC1Ids, expC1Ids) + overlap(sysC2Ids, expC2Ids);
const swap = overlap(sysC1Ids, expC2Ids) + overlap(sysC2Ids, expC1Ids);
const isSwap = swap > direct;

const mappedSysC1Ids = isSwap ? sysC2Ids : sysC1Ids;
const mappedSysC2Ids = isSwap ? sysC1Ids : sysC2Ids;
const mappedSysC1 = isSwap ? sysC2 : sysC1;
const mappedSysC2 = isSwap ? sysC1 : sysC2;

console.log(
  `\n[라벨 매핑] ${isSwap ? "시스템 컨1 ↔ 컨2 swap" : "직매핑"} (direct=${direct} swap=${swap})`,
);

// CBM/무게 합산 헬퍼
function cargoCbm(c) {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce(
      (s, u) => s + (u.width * u.length * u.height * u.quantity) / 1_000_000,
      0,
    );
  }
  if (c.cbm != null) return c.cbm;
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}
function cargoTotalWeight(c) {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce((s, u) => s + (u.weight ?? 0) * u.quantity, 0);
  }
  return c.weightPerUnit ?? 0;
}
const sumCbm = (arr) => arr.reduce((s, c) => s + cargoCbm(c), 0);
const sumW = (arr) => arr.reduce((s, c) => s + cargoTotalWeight(c), 0);

const expC1 = cargoes.filter((c) => expC1Ids.has(c.id));
const expC2 = cargoes.filter((c) => expC2Ids.has(c.id));

console.log("\n========================================================");
console.log("=== 컨1 (40FT) — 19행 vs 시스템 ===");
console.log("========================================================");
console.log(`row | ${"실무자".padEnd(28)} | ${"시스템 위치".padEnd(20)} | 일치`);
for (let i = 1; i <= 19; i++) {
  const id = `sg3-${i}`;
  const c = cargoes[i - 1];
  const name = (c.actualShipperName || c.shipperName || "?").trim();
  let where = "";
  let mark = "";
  if (mappedSysC1Ids.has(id)) {
    where = "컨1";
    mark = "✅ 일치";
  } else if (mappedSysC2Ids.has(id)) {
    where = "→ 시스템 컨2";
    mark = "✗ 컨2로 이동";
  } else {
    where = "미배치";
    mark = "✗ 미배치";
  }
  console.log(
    `${id.padEnd(6)} | ${name.padEnd(28)} | ${where.padEnd(20)} | ${mark}`,
  );
}

console.log("\n--- 시스템 컨1 에 추가로 들어온 화물 (실무자 컨2 → 시스템 컨1 이동) ---");
const movedToC1 = mappedSysC1.filter((c) => !expC1Ids.has(c.id));
if (movedToC1.length === 0) console.log("(없음)");
for (const c of movedToC1) {
  console.log(
    `  ${c.id.padEnd(6)} ${(c.actualShipperName || c.shipperName).trim()} (실무자 컨2 → 시스템 컨1)`,
  );
}

console.log("\n========================================================");
console.log("=== 컨2 (40FT) — 16행 vs 시스템 ===");
console.log("========================================================");
console.log(`row | ${"실무자".padEnd(28)} | ${"시스템 위치".padEnd(20)} | 일치`);
for (let i = 20; i <= 35; i++) {
  const id = `sg3-${i}`;
  const c = cargoes[i - 1];
  const name = (c.actualShipperName || c.shipperName || "?").trim();
  let where = "";
  let mark = "";
  if (mappedSysC2Ids.has(id)) {
    where = "컨2";
    mark = "✅ 일치";
  } else if (mappedSysC1Ids.has(id)) {
    where = "→ 시스템 컨1";
    mark = "✗ 컨1로 이동";
  } else {
    where = "미배치";
    mark = "✗ 미배치";
  }
  console.log(
    `${id.padEnd(6)} | ${name.padEnd(28)} | ${where.padEnd(20)} | ${mark}`,
  );
}

console.log("\n--- 시스템 컨2 에 추가로 들어온 화물 (실무자 컨1 → 시스템 컨2 이동) ---");
const movedToC2 = mappedSysC2.filter((c) => !expC2Ids.has(c.id));
if (movedToC2.length === 0) console.log("(없음)");
for (const c of movedToC2) {
  console.log(
    `  ${c.id.padEnd(6)} ${(c.actualShipperName || c.shipperName).trim()} (실무자 컨1 → 시스템 컨2)`,
  );
}

// 미배치 박스 (시스템)
console.log("\n========================================================");
console.log("=== 시스템 미배치 ===");
console.log("========================================================");
if (sysUnplaced.length === 0) {
  console.log("(없음)");
} else {
  for (const c of sysUnplaced) {
    const name = (c.actualShipperName || c.shipperName || "?").trim();
    console.log(
      `  ${c.id.padEnd(6)} ${name} ${c.width}×${c.length}×${c.height} qty=${c.quantity}`,
    );
  }
}
// unplaced units (개별 박스 차원에서)
console.log(`\n  unplaced units 총: ${result.unplaced.length}`);
for (const u of result.unplaced.slice(0, 20)) {
  console.log(
    `    cargoId=${u.cargoId} unitId=${u.unitId} ${u.width ?? "?"}×${u.length ?? "?"}×${u.height ?? "?"}`,
  );
}

// 요약 표
const expC1Cbm = sumCbm(expC1);
const expC2Cbm = sumCbm(expC2);
const expC1W = sumW(expC1);
const expC2W = sumW(expC2);
const sysC1CbmV = sumCbm(mappedSysC1);
const sysC2CbmV = sumCbm(mappedSysC2);
const sysC1W = sumW(mappedSysC1);
const sysC2W = sumW(mappedSysC2);

const matchedC1 = mappedSysC1.filter((c) => expC1Ids.has(c.id)).length;
const matchedC2 = mappedSysC2.filter((c) => expC2Ids.has(c.id)).length;
const matchedTotal = matchedC1 + matchedC2;

console.log("\n========================================================");
console.log("=== 요약 표 ===");
console.log("========================================================");
console.log(`| 측면         | 실무자        | 시스템        |`);
console.log(`|--------------|---------------|---------------|`);
console.log(`| 컨1 행 수    | 19            | ${String(mappedSysC1.length).padEnd(13)}|`);
console.log(`| 컨2 행 수    | 16            | ${String(mappedSysC2.length).padEnd(13)}|`);
console.log(
  `| 컨1 CBM      | ${expC1Cbm.toFixed(3).padEnd(13)} | ${sysC1CbmV.toFixed(3).padEnd(13)} |`,
);
console.log(
  `| 컨2 CBM      | ${expC2Cbm.toFixed(3).padEnd(13)} | ${sysC2CbmV.toFixed(3).padEnd(13)} |`,
);
console.log(
  `| 컨1 무게(kg) | ${expC1W.toFixed(0).padEnd(13)} | ${sysC1W.toFixed(0).padEnd(13)} |`,
);
console.log(
  `| 컨2 무게(kg) | ${expC2W.toFixed(0).padEnd(13)} | ${sysC2W.toFixed(0).padEnd(13)} |`,
);
console.log(`| 일치 화주    | -             | ${matchedTotal}/35           |`);
console.log(`| 미배치       | 0             | ${sysUnplaced.length}             |`);
