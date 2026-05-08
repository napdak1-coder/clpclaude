/**
 * 빠른 회귀 — 1ST SG / 2ST SG / 2ST HM 단독 pack() 호출.
 * pack() 본체에 내장된 long-axis fallback 회귀 영향 확인용.
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

function buildCargoes(rows, prefix) {
  return rows.map((r, idx) => ({
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
}

function runOne(label, jsonPath, prefix) {
  const sample = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const cargoes = buildCargoes(sample.rows, prefix);
  const t0 = Date.now();
  // Before-fallback baseline: pack() 본체 fallback 우회
  const baseline = pack(cargoes, "auto", {
    footprintCluster: { enabled: true },
    _internalSkipLongAxisFallback: true,
  });
  const baselineUnplaced = baseline.unplaced.filter(
    (u) => u.group !== "ct" && u.group !== "completed",
  );
  const baselineQty = baselineUnplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
  // After-fallback: 본체에서 자동 fallback 발동
  const result = pack(cargoes, "auto", { footprintCluster: { enabled: true } });
  const elapsed = Date.now() - t0;
  const visualUnplaced = result.unplaced.filter(
    (u) => u.group !== "ct" && u.group !== "completed",
  );
  const totalQty = visualUnplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
  // B1 카운트 (HM 의 경우): 같은 booking 이 두 컨에 쪼개진 케이스
  const bookingToContainers = new Map();
  for (const c of result.containers) {
    for (const row of c.rows) {
      for (const it of [...row.bottomItems, ...row.topItems]) {
        const cargo = cargoes.find((x) => x.id === it.cargoId);
        const bk = cargo?.bookingNo;
        if (!bk) continue;
        const set = bookingToContainers.get(bk) ?? new Set();
        set.add(c.index);
        bookingToContainers.set(bk, set);
      }
    }
  }
  let b1Count = 0;
  for (const [bk, set] of bookingToContainers) {
    if (set.size > 1) b1Count++;
  }
  console.log(
    `[${label}] rows=${sample.rows.length} containers=${result.containers.length} baseline=${baselineQty} after=${totalQty} B1=${b1Count} elapsed=${elapsed}ms`,
  );
  if (totalQty > 0) {
    for (const u of visualUnplaced) {
      console.log(
        `  - ${u.cargoId} (${u.shipper ?? "?"}) qty=${u.quantity ?? 1}`,
      );
    }
  }
  return { label, unplaced: totalQty, b1Count, elapsed };
}

const samples = [
  ["1ST SG", "data/samples/singapore-total.json", "sg1"],
  ["2ST SG", "data/samples/singapore-total-2.json", "sg2"],
  ["2ST HM", "data/samples/hochiminh-total-2.json", "hm2"],
];

const results = [];
for (const [label, p, prefix] of samples) {
  results.push(runOne(label, path.resolve(p), prefix));
}

console.log("\n=== 회귀 종합 ===");
let allOk = true;
for (const r of results) {
  const ok = r.unplaced === 0;
  if (!ok) allOk = false;
  console.log(`${ok ? "✅" : "❌"} ${r.label}: unplaced=${r.unplaced} B1=${r.b1Count}`);
}
process.exit(allOk ? 0 : 1);
