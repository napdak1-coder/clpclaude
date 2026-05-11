/**
 * 단일 pack() 호출로 heavy rescue 효과 확인.
 * packBest 매트릭스 우회 (Stage 4/5.6/5.7 fallback chain 시간 누적 회피).
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));
const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`, itemName: r.itemName||null, actualShipperName: r.actualShipperName ?? "", shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0, quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0, cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"), bookingNo: r.bookingNo || undefined, unitSizes: r.unitSizes,
  remarks: { noStacking: !!r.noStacking, topOnly: !!r.topOnly, orientation: r.orientation || "free", heavierBelow: !!r.heavierBelow },
}));

const STRAT = process.argv[2] || "ldf";
const t0 = Date.now();
const r = pack(cargoes, undefined, {
  sortStrategy: STRAT,
  containerOrder: "biggest-first",
  autoConsolidateCompleted: true,
  placementMode: "wrapper",
});
const ms = Date.now() - t0;

console.log(`전략: ${STRAT}`);
console.log(`pack 시간: ${ms}ms`);
console.log(`컨테이너: ${r.containers.length}대, unplaced=${r.unplaced.length}`);
console.log(`unplaced cargos: ${r.unplaced.map((u) => u.cargoId).join(", ")}`);

// sg3-11 위치 (또는 미배치 여부)
let sg11 = null;
for (const [ci, c] of r.containers.entries()) {
  for (const row of c.rows ?? []) {
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      if (it.cargoId === "sg3-11") sg11 = { ...it, ci: ci + 1 };
    }
  }
}

if (sg11) {
  console.log(`\n=== sg3-11 ✅ 배치 ===`);
  console.log(`  컨${sg11.ci} pos=(${sg11.position.x}, ${sg11.position.y}, ${sg11.position.z})`);
  console.log(`  사이즈: ${sg11.size.width}×${sg11.size.length}×${sg11.size.height} faceIdx=${sg11.faceIdx} rotated=${sg11.rotated}`);
  console.log(`  무게: ${sg11.weight}kg layer=${sg11.layer}`);

  // 받침 박스 찾기
  if (sg11.position.z > 0.01) {
    const cont = r.containers[sg11.ci - 1];
    const allP = (cont.rows ?? []).flatMap((row) => [
      ...(row.bottomItems ?? []),
      ...(row.topItems ?? []),
    ]);
    const supporter = allP.find((p) =>
      p !== sg11 &&
      Math.abs(p.position.z + p.size.height - sg11.position.z) < 0.01 &&
      sg11.position.x >= p.position.x - 0.01 &&
      sg11.position.x + sg11.size.width <= p.position.x + p.size.width + 0.01 &&
      sg11.position.y >= p.position.y - 0.01 &&
      sg11.position.y + sg11.size.length <= p.position.y + p.size.length + 0.01
    );
    if (supporter) {
      const supportPct =
        ((sg11.size.width * sg11.size.length) / (supporter.size.width * supporter.size.length)) *
        100;
      console.log(`\n=== 받침 박스 ===`);
      console.log(`  cargoId: ${supporter.cargoId}`);
      console.log(`  화주: ${supporter.shipper}`);
      console.log(`  사이즈: ${supporter.size.width}×${supporter.size.length}×${supporter.size.height}`);
      console.log(`  무게: ${supporter.weight}kg`);
      console.log(`  topWeight: ${sg11.weight}kg / bottomWeight: ${supporter.weight}kg`);
      console.log(`  canStackOn 통과: ${sg11.weight <= supporter.weight ? "✅" : "❌"}`);
      console.log(`  support %: ${supportPct.toFixed(1)}%`);
    }
  } else {
    console.log(`  z=0 바닥 자리 (받침 없음)`);
  }
}
