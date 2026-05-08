/**
 * 자동(auto) 모드 전수 검증 — 5개 샘플 모두 packBest 호출, 미배치 0 여부 확인.
 * 실무자 분배 무시, 시스템이 자동으로 컨테이너 셋 결정.
 *
 * 시간 보호: 각 샘플은 lightMode=true 로 (매트릭스 줄임).
 * 단독 pack() 결과도 같이 찍어 비교.
 */
import fs from "node:fs";
import path from "node:path";

const { pack, packBest } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  { id: "1ST SG", file: "data/samples/singapore-total.json", prefix: "sg1" },
  { id: "2ST SG", file: "data/samples/singapore-total-2.json", prefix: "sg2" },
  { id: "1ST HM", file: "data/samples/hochiminh-total.json", prefix: "hm1" },
  { id: "2ST HM", file: "data/samples/hochiminh-total-2.json", prefix: "hm2" },
  { id: "3ST SG", file: "data/samples/singapore-total-3.json", prefix: "sg3" },
];

const toCargoes = (rows, prefix) =>
  rows.map((r, idx) => ({
    id: `${prefix}-${idx + 1}`,
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

const summarizeUnplaced = (unplaced) => {
  if (unplaced.length === 0) return "(0건)";
  return unplaced
    .slice(0, 8)
    .map((u) => {
      const name = u.actualShipperName || u.shipperName || u.cargoId || "?";
      const dim =
        u.width != null && u.length != null && u.height != null
          ? `${u.width}x${u.length}x${u.height}cm`
          : "";
      const qty = u.quantity != null ? `×${u.quantity}` : "";
      return `${name}${qty} ${dim}`.trim();
    })
    .join(" | ") + (unplaced.length > 8 ? ` … 외 ${unplaced.length - 8}건` : "");
};

const summary = [];

for (const s of SAMPLES) {
  console.log(`\n========================================`);
  console.log(`[${s.id}] ${s.file}`);
  console.log(`========================================`);
  const sample = JSON.parse(
    fs.readFileSync(path.resolve(s.file), "utf8"),
  );
  const cargoes = toCargoes(sample.rows, s.prefix);
  const totalQty = cargoes.reduce((a, c) => a + (c.quantity ?? 1), 0);
  console.log(`행 ${cargoes.length}개 · 총 박스수 ${totalQty}`);

  /* (a) 단독 pack */
  let packResult, packTime, packErr;
  try {
    const t0 = Date.now();
    packResult = pack(cargoes, "auto", {
      footprintCluster: { enabled: true },
      longAxisAnchor: undefined,
    });
    packTime = Date.now() - t0;
  } catch (e) {
    packErr = e?.message ?? String(e);
  }

  /* (b) packBest lightMode */
  let bestResult, bestTime, bestErr;
  try {
    const t0 = Date.now();
    bestResult = packBest(cargoes, "auto", {
      footprintCluster: { enabled: true },
      lightMode: true,
    });
    bestTime = Date.now() - t0;
  } catch (e) {
    bestErr = e?.message ?? String(e);
  }

  if (packResult) {
    const conSet = packResult.containers.map((c) => c.spec.type).join(", ");
    const unp = packResult.unplaced.reduce(
      (a, u) => a + (u.quantity ?? 1),
      0,
    );
    console.log(`\n[단독 pack] ${packTime}ms`);
    console.log(`  컨테이너(${packResult.containers.length}): ${conSet}`);
    console.log(`  미배치 박스수: ${unp}`);
    console.log(`  미배치 상세: ${summarizeUnplaced(packResult.unplaced)}`);
  } else {
    console.log(`\n[단독 pack] ERROR: ${packErr}`);
  }

  if (bestResult) {
    const conSet = bestResult.containers.map((c) => c.spec.type).join(", ");
    const unp = bestResult.unplaced.reduce(
      (a, u) => a + (u.quantity ?? 1),
      0,
    );
    console.log(`\n[packBest light] ${bestTime}ms`);
    console.log(`  컨테이너(${bestResult.containers.length}): ${conSet}`);
    console.log(`  미배치 박스수: ${unp}`);
    console.log(`  미배치 상세: ${summarizeUnplaced(bestResult.unplaced)}`);
    summary.push({
      sample: s.id,
      conSet,
      unplaced: unp,
      timeMs: bestTime,
    });
  } else {
    console.log(`\n[packBest light] ERROR: ${bestErr}`);
    summary.push({ sample: s.id, conSet: "?", unplaced: -1, timeMs: -1 });
  }
}

console.log(`\n\n=========== 요약 ===========`);
for (const r of summary) {
  console.log(
    `${r.sample.padEnd(8)} | ${r.conSet.padEnd(28)} | 미배치 ${String(r.unplaced).padStart(3)} | ${r.timeMs}ms`,
  );
}
