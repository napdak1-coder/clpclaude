/**
 * 빠른 단독 검증 — 3ST SG TOTAL, footprintCluster ON, pack() 단일 호출.
 * packBest 의 strategy × seed 매트릭스 회피 → 5 초 안에 결과.
 *
 * 목표: 컨2 (40FT 두 번째) 의 미배치 박스 = 0 인지 확인.
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

console.log(`JSON 샘플: ${rows.length} 행`);

const t0 = Date.now();
// 단일 호출 — pack() 직접, AUTO 모드, footprintCluster 옵션 명시 활성
const result = pack(cargoes, "auto", {
  footprintCluster: { enabled: true },
});
const elapsed = Date.now() - t0;

console.log(`\n=== pack() 단일 호출 (footprintCluster ON) ===`);
console.log(`소요: ${elapsed}ms`);
console.log(
  `컨테이너: ${result.containers.length}대 — ${result.containers
    .map((c) => c.spec.type)
    .join(", ")}`,
);
console.log(`전체 unplaced: ${result.unplaced.length}`);

// 컨테이너별 시각 박스 수 + 미배치 화물 카운트 (해당 컨이 부족해서 못 들어간 분)
console.log(`\n--- 컨테이너별 박스 수 ---`);
result.containers.forEach((c, i) => {
  let visualBoxes = 0;
  for (const row of c.rows) {
    visualBoxes += row.bottomItems.length + row.topItems.length;
  }
  const bulkCount = (c.bulkItems ?? []).length;
  console.log(
    `[컨${i + 1}] ${c.spec.type} — 시각 박스 ${visualBoxes}개 / bulk(CT,입고완료) ${bulkCount}개 / totalCbm ${c.totalCbm.toFixed(3)}m³ / weight ${c.totalWeight.toFixed(0)}kg`,
  );
});

// 미배치 분류 — visual unit 만 카운트 (cargoType 기준)
const visualUnplaced = result.unplaced.filter((u) => u.group !== "ct" && u.group !== "completed");
console.log(`\n--- 미배치 (visual) ---`);
if (visualUnplaced.length === 0) {
  console.log(`(없음)`);
} else {
  for (const u of visualUnplaced) {
    console.log(
      `  - ${u.cargoId} (${u.shipper ?? "?"}) ${u.width}x${u.length}x${u.height} qty=${u.quantity ?? 1} reason=${u.reason}`,
    );
  }
}

// 컨2 미배치 = 0 확인 — pack() 의 unplaced 는 컨테이너 귀속이 명시 안 됨
// 핵심 판정: "전체 visual 미배치 0" 이면 모든 박스 들어간 것이므로 컨2 도 0 보장
const con2Achieved = visualUnplaced.length === 0;
console.log(`\n=== 종합 ===`);
console.log(`컨2 미배치 0 도달: ${con2Achieved ? "✅ Y" : "❌ N"}`);
console.log(`소요 시간: ${elapsed}ms (목표 < 5000ms)`);

// summary
console.log(`\n--- 요약 ---`);
console.log(`총 적재 CBM: ${result.summary.totalCbm.toFixed(3)} m³`);
console.log(`총 무게: ${result.summary.totalWeight.toFixed(0)} kg`);
console.log(`평균 적재율: ${(result.summary.avgFillRate * 100).toFixed(1)}%`);
if (result.summary.warnings.length) {
  console.log(`경고:`);
  for (const w of result.summary.warnings) console.log(`  - ${w}`);
}

process.exit(con2Achieved ? 0 : 1);
