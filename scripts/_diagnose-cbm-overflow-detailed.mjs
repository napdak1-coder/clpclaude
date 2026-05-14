/* A1 — CBM overflow 발생 위치/원인 정밀 추적 (망작 / 4ST SG / 1ST HM).
 *
 * soft vs hard 분류:
 *   - soft: maxCbm < cbm ≤ maxCbm × 1.05  (allocateBulkGroup 의 SOFT_OVERFLOW=1.05 안)
 *   - hard: cbm > maxCbm × 1.05  (소프트캡 초과)
 *
 * read-only — production packBest 호출 후 결과 분석.
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { packBest } = algo;

const SOFT_OVERFLOW = 1.05;

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "hm-1", name: "1ST HM", file: "data/samples/hochiminh-total.json" },
];

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

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== A1 — CBM overflow 정밀 추적 (망작 / 4ST SG / 1ST HM) ===");
log(`date: ${new Date().toISOString()}`);
log(`SOFT_OVERFLOW = ${SOFT_OVERFLOW} (allocateBulkGroup 안 운영 정책)`);
log("");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const cargoById = new Map(cargoes.map((c) => [c.id, c]));

  const result = packBest(cargoes, "auto");

  log(`## ${s.id} (${s.name})`);
  log(`- 컨 셋: ${result.containers.map((c) => c.spec.type).join("+")}`);
  log("");

  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const visualCbm = c.totalCbm ?? 0;
    const ctCbm = c.ctCbm ?? 0;
    const completedCbm = c.completedCbm ?? 0;
    const totalLoaded = visualCbm + ctCbm + completedCbm;
    const maxCbm = c.spec.maxCbm;
    const softCap = maxCbm * SOFT_OVERFLOW;
    const overflowAbs = totalLoaded - maxCbm;
    const overflowPct = (overflowAbs / maxCbm) * 100;

    let status = "✅ within maxCbm";
    if (totalLoaded > softCap + 0.001) {
      status = `❌ HARD overflow (softCap ${softCap.toFixed(2)} 초과)`;
    } else if (totalLoaded > maxCbm + 0.001) {
      status = `⚠ SOFT overflow (maxCbm 초과, softCap 안)`;
    }

    log(
      `  컨${ci + 1} ${c.spec.type}: 적재=${totalLoaded.toFixed(3)} / max=${maxCbm} / softCap=${softCap.toFixed(2)} m³`,
    );
    log(`    visualCbm=${visualCbm.toFixed(3)}, ctCbm=${ctCbm.toFixed(3)}, completedCbm=${completedCbm.toFixed(3)}`);
    log(`    overflow=${overflowAbs > 0 ? "+" : ""}${overflowAbs.toFixed(3)} m³ (${overflowPct.toFixed(1)}%)`);
    log(`    상태: ${status}`);

    if (totalLoaded > maxCbm + 0.001) {
      // 어느 cargo 들이 들어갔는지 + 각 cargo 의 CBM 출처
      log(`    --- 컨${ci + 1} 안 cargo (visual + bulk) ---`);
      // visual rows 안 cargoId
      const visualIds = new Set();
      for (const row of c.rows ?? []) {
        for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
          if (it.cargoId) visualIds.add(it.cargoId);
        }
      }
      // bulk cargoId
      const bulkItems = c.bulkItems ?? [];

      log(`    visual cargo: ${visualIds.size}건`);
      for (const cid of [...visualIds].slice(0, 5)) {
        const cg = cargoById.get(cid);
        if (!cg) continue;
        const sysCbm = (cg.unitSizes?.length ?? 0) > 0
          ? cg.unitSizes.reduce((s, u) => s + (typeof u.cbm === "number" && u.cbm > 0 ? u.cbm : (u.width * u.length * u.height * u.quantity) / 1_000_000), 0)
          : (cg.width * cg.length * cg.height * cg.quantity) / 1_000_000;
        log(`      ${cid}: cfsCbm=${cg.cbm ?? "—"}, aboutCbm=${cg.aboutCbm ?? "—"}, sysCbm=${sysCbm.toFixed(3)}, cbmSource=${cg.cbmSource ?? "(undef→legacy-cfs)"}`);
      }
      if (visualIds.size > 5) log(`      ... ${visualIds.size - 5}건 더`);

      log(`    bulk cargo (CT/입고완료): ${bulkItems.length}건`);
      for (const bi of bulkItems.slice(0, 10)) {
        const cg = cargoById.get(bi.cargoId);
        if (!cg) continue;
        log(
          `      ${bi.cargoId}: 이 컨에 ${bi.cbm.toFixed(3)} m³ (cargoTotal=${bi.totalCbm.toFixed(3)}), cfsCbm=${cg.cbm ?? "—"}, aboutCbm=${cg.aboutCbm ?? "—"}, cbmSource=${cg.cbmSource ?? "(undef)"}, group=${bi.group}`,
        );
      }
      if (bulkItems.length > 10) log(`      ... ${bulkItems.length - 10}건 더`);
    }
    log("");
  }
}

log("");
log("=== softCap 룰 위치 ===");
log("- lib/packing/algorithm.ts:446 — `const SOFT_OVERFLOW = 1.05` (allocateBulkGroup 안)");
log("- 운영 정책: maxCbm 60/28 은 보수적, 5% overflow 통상 허용, 부킹 묶음 보존 목적");
log("");
log("=== isValid6 / compareLex 기준 ===");
log("- algorithm.ts:3100 isValid6: `c.totalCbm + c.ctCbm > c.spec.maxCbm + 0.001` 면 invalid");
log("- algorithm.ts:3168 compareLex: 같은 검사로 cbmOverflow 카운트");
log("- **기준 불일치**: allocateBulkGroup softCap (1.05) ≠ isValid6 hard (1.0)");
log("");
log("=== production packBest vs candidateUnion 동작 ===");
log("- production packBest 단독: allocateBulkGroup softCap 1.05 적용 → CBM overflow 결과를 그대로 best 로 선택");
log("- candidateUnion (isValid6): maxCbm + 0.001 초과면 invalid → softCap 안 overflow 도 invalid");
log("- → 같은 결과도 두 경로에서 다르게 판정");

const outPath = path.resolve("scripts/_diagnose-cbm-overflow-detailed-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
