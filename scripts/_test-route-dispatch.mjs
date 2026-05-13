/* /api/pack route 의 useCandidateUnion 분기 동작 시뮬레이션.
 *
 * 망작 SG 샘플로 두 경로 (default packBest vs useCandidateUnion=true) 결과 비교.
 *
 * 검증:
 *   - default → packBest, decisionMode='packBest', 망작 40FT+20FT
 *   - useCandidateUnion=true → packBestWithCandidateUnion, decisionMode='candidateUnion', 망작 40FT 1대
 */
import fs from "node:fs";
const algo = await import("../lib/packing/algorithm.ts");
const { packBest, packBestWithCandidateUnion } = algo;

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
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
}

// route 의 dispatch 로직과 동일 (useCandidateUnion 분기)
function simulateRoute(items, mode, useCandidateUnion) {
  const decisionMode = useCandidateUnion ? "candidateUnion" : "packBest";
  const result = useCandidateUnion
    ? packBestWithCandidateUnion(items, mode)
    : packBest(items, mode);
  return { result, decisionMode };
}

const samplePath = "data/samples/singapore-mangjak-total.json";
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const items = build(sample.rows, "mangjak");

console.log("=== /api/pack route useCandidateUnion 분기 검증 ===");
console.log("");

// 1) 기본 (useCandidateUnion 없거나 false) — 기존 packBest
console.log("--- 1) default (useCandidateUnion=false) ---");
const t1 = Date.now();
const r1 = simulateRoute(items, "auto", false);
const dt1 = (Date.now() - t1) / 1000;
const set1 = r1.result.containers.map((c) => c.spec.type).join("+");
console.log(`decisionMode: ${r1.decisionMode}`);
console.log(`컨 셋:        ${set1}`);
console.log(`bulk:         ${r1.result.containers.reduce((a, c) => a + (c.bulkItems?.length ?? 0), 0)}`);
console.log(`unplaced:     ${r1.result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0)}`);
console.log(`pack:         ${dt1.toFixed(1)}s`);
console.log(`기대: decisionMode='packBest', 컨='40FT+20FT'`);

// 2) useCandidateUnion=true — wrapper
console.log("");
console.log("--- 2) useCandidateUnion=true ---");
const t2 = Date.now();
const r2 = simulateRoute(items, "auto", true);
const dt2 = (Date.now() - t2) / 1000;
const set2 = r2.result.containers.map((c) => c.spec.type).join("+");
console.log(`decisionMode: ${r2.decisionMode}`);
console.log(`컨 셋:        ${set2}`);
console.log(`bulk:         ${r2.result.containers.reduce((a, c) => a + (c.bulkItems?.length ?? 0), 0)}`);
console.log(`unplaced:     ${r2.result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0)}`);
console.log(`pack:         ${dt2.toFixed(1)}s`);
console.log(`기대: decisionMode='candidateUnion', 컨='40FT' (단락 채택)`);

// 검증
console.log("");
console.log("=== 검증 ===");
const pass1 = r1.decisionMode === "packBest" && set1 === "40FT+20FT";
const pass2 = r2.decisionMode === "candidateUnion" && set2 === "40FT";
console.log(`default packBest 보존:   ${pass1 ? "✅" : "❌ FAIL"}`);
console.log(`candidateUnion 단락 채택: ${pass2 ? "✅" : "❌ FAIL"}`);
if (pass1 && pass2) {
  console.log("");
  console.log("✅ route dispatch 분기 정상 동작");
} else {
  console.log("");
  console.log("❌ 검증 실패");
  process.exit(1);
}
