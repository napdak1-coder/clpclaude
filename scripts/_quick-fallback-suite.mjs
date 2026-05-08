/**
 * 빠른 회귀 — 1ST SG / 2ST SG / 2ST HM / 3ST SG 모두 packBest 호출 (fallback 자동).
 * 각 샘플 visual 미배치 = 0 인지만 빠르게 확인.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const samples = [
  { name: "1ST SG", file: "singapore-total.json", idPrefix: "sg1" },
  { name: "2ST SG", file: "singapore-total-2.json", idPrefix: "sg2" },
  { name: "2ST HM", file: "hochiminh-total-2.json", idPrefix: "hm2" },
  { name: "3ST SG", file: "singapore-total-3.json", idPrefix: "sg3" },
];

function rowsToCargoes(rows, idPrefix) {
  return rows.map((r, idx) => ({
    id: `${idPrefix}-${idx + 1}`,
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

const summary = [];
let anyFailure = false;

for (const s of samples) {
  const filePath = path.resolve("data/samples", s.file);
  const sample = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rows = sample.rows;
  const cargoes = rowsToCargoes(rows, s.idPrefix);

  const t0 = Date.now();
  const result = packBest(cargoes, "auto");
  const elapsed = Date.now() - t0;

  const visualUnplaced = result.unplaced.filter(
    (u) => u.group !== "ct" && u.group !== "completed",
  );

  const containerStr = result.containers.map((c) => c.spec.type).join("+");
  const ok = visualUnplaced.length === 0;
  if (!ok) anyFailure = true;

  // B1 (한 부킹 = 한 컨) 체크 — 같은 부킹이 여러 컨에 분산됐는지
  const bookingToContainers = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const items = [];
    for (const row of c.rows)
      for (const it of [...row.bottomItems, ...row.topItems]) items.push(it);
    for (const b of c.bulkItems ?? []) items.push(b);
    for (const it of items) {
      const bk = it.bookingNo;
      if (!bk) continue;
      const set = bookingToContainers.get(bk) ?? new Set();
      set.add(ci);
      bookingToContainers.set(bk, set);
    }
  }
  let b1Violations = 0;
  for (const [, set] of bookingToContainers) {
    if (set.size > 1) b1Violations++;
  }

  summary.push({
    name: s.name,
    elapsed,
    containers: containerStr,
    unplaced: visualUnplaced.length,
    b1Violations,
    ok: ok && b1Violations === 0,
  });

  console.log(
    `[${s.name}] ${result.containers.length}대(${containerStr}) — visual unplaced ${visualUnplaced.length}, B1 위반 ${b1Violations}, ${elapsed}ms`,
  );
  if (!ok) {
    for (const u of visualUnplaced) {
      console.log(
        `   미배치: ${u.cargoId} (${u.shipper ?? "?"}) ${u.width}x${u.length}x${u.height} qty=${u.quantity ?? 1}`,
      );
    }
  }
}

console.log(`\n=== 요약 ===`);
for (const r of summary) {
  console.log(
    `${r.name}: ${r.ok ? "PASS" : "FAIL"} (unplaced=${r.unplaced}, B1=${r.b1Violations}, ${r.elapsed}ms)`,
  );
}
process.exit(anyFailure ? 1 : 0);
