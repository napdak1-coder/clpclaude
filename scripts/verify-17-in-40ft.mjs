/**
 * 17종 단독으로 40FT 한 대에 100% 시각 적재 가능한지 검증.
 *
 * - 모든 strategy / 모든 input ordering 시도
 * - 가장 좋은 결과 (최소 unplaced) 보고
 * - 0 unplaced 달성 시 success
 */

const { pack, packBest } = await import("../lib/packing/algorithm.ts");
const { getShipment } = await import("../lib/repositories/shipments.ts");

const FORTY = new Set([
  "메가젠임플란트",
  "데코론",
  "YKMC",
  "보현석재",
  "에이제이테크",
  "카페봄봄",
  "EXCELERATE ENERGY",
  "VISCOSMO",
  "더블유티 스프레이",
  "리만",
  "대한정밀공업",
  "선진뷰티사이언스",
  "SUNGBO INDUSTRIA",
  "제일기공",
  "웨스코",
  "디에스콘",
  "티케이테크",
]);

const ship = await getShipment("bbd2cece-976f-4665-b207-175aa2751b77");
const for40 = ship.items.filter((c) => FORTY.has(c.actualShipperName));
console.log(`17종 cargo 수: ${for40.length}`);

let bestUnp = Infinity;
let bestLabel = "";
let bestResult = null;

const t0 = Date.now();

// 1) packBest 40ft_only (full 56 + backtrack)
const rb = packBest(for40, "40ft_only");
const unpb = rb.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
console.log(`packBest 40ft_only: unplaced=${unpb} fill=${rb.containers[0]?.cbmFillRate.toFixed(1)}%`);
if (unpb < bestUnp) { bestUnp = unpb; bestLabel = "packBest"; bestResult = rb; }

// 2) 각 strategy 단독 시도
for (const strat of ["ldf", "longest-side", "tallest", "widest", "input", "shortest", "shortest-height"]) {
  for (const co of ["biggest-first", "smallest-first"]) {
    const r = pack(for40, "40ft_only", { sortStrategy: strat, containerOrder: co, autoConsolidateCompleted: false });
    const u = r.unplaced.reduce((s, x) => s + (x.quantity ?? 1), 0);
    if (u < bestUnp) {
      bestUnp = u;
      bestLabel = `pack(${strat},${co})`;
      bestResult = r;
    }
  }
}

console.log(`\n=== BEST ===`);
console.log(`  ${bestLabel} → unplaced=${bestUnp} fill=${bestResult?.containers[0]?.cbmFillRate.toFixed(1)}%`);
console.log(`  time ${Date.now() - t0}ms`);

if (bestUnp === 0) {
  console.log("\n✅ SUCCESS — 17종 모두 40FT 한 대에 시각 적재 완료");
  // 분배 화주 출력
  const sh = new Set();
  for (const row of bestResult.containers[0].rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      sh.add(ship.items.find((x) => x.id === it.cargoId)?.actualShipperName ?? "?");
    }
  }
  console.log("  화주: " + [...sh].sort().join(", "));
  process.exit(0);
} else {
  console.log("\n❌ FAIL — 미배치 cargo:");
  for (const u of bestResult.unplaced) {
    console.log(`  × ${u.shipper} ${u.width}x${u.length}x${u.height} qty=${u.quantity}`);
  }
  process.exit(1);
}
