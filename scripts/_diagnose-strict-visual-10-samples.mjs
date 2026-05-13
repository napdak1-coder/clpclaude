/* 1단계 진단 — strictVisualClassification=true 로 10 샘플 trace.
 *
 * 목적:
 *   사용자 룰 "사이즈 적힌 건 다 시각" 을 강제 적용한 상태에서 실제 시각 배치
 *   미해결 케이스가 어디서 발생하는지 정확히 분류.
 *
 * production 영향 0 — 옵션 default false, 본 스크립트만 true 로 호출.
 *
 * 사용자 절대 룰 준수:
 *   - 자동 CBM 끄기 X
 *   - 사용자 CBM 수동 비우기 강제 X
 *   - CT 벌크 fallback X
 *   - 특정 샘플 하드코딩 X
 *   - fixedAssignment X
 *   - 점수 합산 X
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-2", name: "2ST SG", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", name: "3ST SG", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
  { id: "hm-1", name: "1ST HM", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", name: "2ST HM", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", name: "3ST HM", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", name: "4ST HM", file: "data/samples/hochiminh-total-4.json" },
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

function hasMainSize(c) {
  return c.width >= 1 && c.length >= 1 && c.height >= 1;
}
function hasUnitSize(c) {
  return (
    c.unitSizes != null &&
    c.unitSizes.length > 0 &&
    c.unitSizes.every((u) => u.width >= 1 && u.length >= 1 && u.height >= 1)
  );
}
function anyHasSize(c) {
  return hasMainSize(c) || hasUnitSize(c);
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 1단계: strictVisualClassification=true 10 샘플 trace ===");
log(`date: ${new Date().toISOString()}`);
log("(목적: 사이즈 있는 행 visual 강제 상태에서 미배치 발생 위치 진단)");
log("");
log("| sample | rows | visual | ct | bulk | size→CT | unpl | rowsOut | pack(s) | 통과? |");
log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");

const summary = [];

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    log(`| ${s.id} | — | — | — | — | — | — | — | — | SKIP |`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const totalRows = cargoes.length;

  const t0 = Date.now();
  let result;
  try {
    result = pack(cargoes, "auto", { strictVisualClassification: true });
  } catch (e) {
    log(`| ${s.id} | ${totalRows} | — | — | — | — | — | — | ERROR | ❌ |`);
    log(`  error: ${e.message?.slice(0, 100)}`);
    continue;
  }
  const dt = (Date.now() - t0) / 1000;

  // 어느 행이 어디로 갔는지 추적
  const placedVisualIds = new Set();
  for (const c of result.containers) {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) placedVisualIds.add(it.cargoId);
      }
    }
  }
  const placedBulkIds = new Set();
  let bulkItemsCount = 0;
  for (const c of result.containers) {
    for (const bi of c.bulkItems ?? []) {
      bulkItemsCount++;
      if (bi.cargoId) placedBulkIds.add(bi.cargoId);
    }
  }
  const unplacedIds = new Set(
    (result.unplaced ?? []).map((u) => u.cargoId).filter(Boolean),
  );

  // classify 결과 재구성 (visual=배치+미배치 중 visual 영역, ct=bulk 영역)
  // strictVisualClassification 모드에서 사이즈 없는 행만 ct 로 가야 함.
  let visualCount = 0;
  let ctCount = 0;
  let sizedToBulk = 0;
  let rowsOut = 0;
  for (const c of result.containers) rowsOut += (c.rows ?? []).length;

  for (const cg of cargoes) {
    // 어디로 갔는지 판정
    const inVisual = placedVisualIds.has(cg.id);
    const inBulk = placedBulkIds.has(cg.id);
    const inUnpl = unplacedIds.has(cg.id);
    const sized = anyHasSize(cg);
    if (sized) {
      visualCount++;
      if (inBulk) sizedToBulk++;
    } else {
      ctCount++;
    }
  }

  const unplCount = result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  const pass =
    sizedToBulk === 0 &&
    unplCount === 0 &&
    rowsOut > 0 &&
    bulkItemsCount === 0 + ctCount; // (간단 기준)
  log(
    `| ${s.id} | ${totalRows} | ${visualCount} | ${ctCount} | ${bulkItemsCount} | ${sizedToBulk} | ${unplCount} | ${rowsOut} | ${dt.toFixed(1)} | ${
      sizedToBulk === 0 && unplCount === 0 ? "✅" : "❌"
    } |`,
  );

  // 미배치 cargo 세부 (실패 샘플만)
  if (unplCount > 0) {
    log("");
    log(`  --- ${s.id} 미배치 세부 ---`);
    const seen = new Set();
    for (const u of result.unplaced) {
      const key = u.cargoId;
      if (seen.has(key)) continue;
      seen.add(key);
      const orig = cargoes.find((c) => c.id === u.cargoId);
      const sz = orig
        ? `W${orig.width} L${orig.length} H${orig.height} ×${orig.quantity}`
        : "(원본 못 찾음)";
      const wt = orig?.weightPerUnit ?? "?";
      const ns = orig?.remarks?.noStacking ? " noStacking" : "";
      const to = orig?.remarks?.topOnly ? " topOnly" : "";
      const bk = orig?.bookingNo ?? "—";
      log(
        `    ${u.cargoId} ${sz} ${wt}kg${ns}${to} booking=${bk} reason=${u.reason ?? "?"} qty=${u.quantity ?? 1}`,
      );
    }

    // 같은 booking 의 다른 cargo 가 어디 갔는지 (split / 단독 미배치 여부)
    const unplBookings = new Set();
    for (const u of result.unplaced) {
      const orig = cargoes.find((c) => c.id === u.cargoId);
      if (orig?.bookingNo) unplBookings.add(orig.bookingNo);
    }
    if (unplBookings.size > 0) {
      log(`  --- 같은 booking 의 다른 cargo 위치 ---`);
      for (const bk of unplBookings) {
        const sibs = cargoes.filter((c) => c.bookingNo === bk);
        const placed = sibs.filter(
          (c) => placedVisualIds.has(c.id) || placedBulkIds.has(c.id),
        );
        const unpl = sibs.filter((c) => unplacedIds.has(c.id));
        log(
          `    booking ${bk}: 총 ${sibs.length}건 (배치 ${placed.length} / 미배치 ${unpl.length})`,
        );
      }
    }
  }

  // 컨테이너 잔여 공간
  log(`  --- ${s.id} 컨테이너 잔여 공간 ---`);
  for (let i = 0; i < result.containers.length; i++) {
    const c = result.containers[i];
    const usedCbm = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const maxCbm = c.spec.maxCbm;
    const remCbm = Math.max(0, maxCbm - usedCbm);
    const usedW = c.totalWeight ?? 0;
    const maxW = c.spec.maxWeightKg;
    const remW = Math.max(0, maxW - usedW);
    log(
      `    컨 ${i + 1} (${c.spec.type}): CBM ${usedCbm.toFixed(2)}/${maxCbm} (남은 ${remCbm.toFixed(2)} m³) · 무게 ${(usedW / 1000).toFixed(1)}/${(maxW / 1000).toFixed(1)} t (남은 ${(remW / 1000).toFixed(1)} t)`,
    );
  }
  log("");

  summary.push({
    id: s.id,
    pass: sizedToBulk === 0 && unplCount === 0,
    unplCount,
    sizedToBulk,
    packSec: dt,
  });
}

log("");
log("=== 통과 기준 (1단계) ===");
log("- size 있는 행 중 CT 로 빠진 행 수 = 0");
log("- rows.length > 0");
log("- bulkItems 는 사이즈 없는 행에 대해서만");
log("");
log("=== 1단계 결론 ===");
const passCount = summary.filter((s) => s.pass).length;
log(`전체 ${summary.length} 샘플 중 ${passCount} 통과`);
const failed = summary.filter((s) => !s.pass);
if (failed.length > 0) {
  log("실패 샘플:");
  for (const f of failed) {
    log(`  ${f.id}: unpl=${f.unplCount} sizedToBulk=${f.sizedToBulk} pack=${f.packSec.toFixed(1)}s`);
  }
}

const outPath = path.resolve("scripts/_diagnose-strict-visual-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
