/**
 * 빠른 회귀 검증 (단독 pack 호출) — long-axis anchor default ON 변경 영향 측정.
 * 1ST/2ST SG, 2ST HM 샘플에 대해 pack() 단일 호출 결과의 미배치 수 출력.
 */
import fs from "node:fs";
import path from "node:path";

const { pack } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  { label: "1ST SG", file: "data/samples/singapore-total.json", idPrefix: "sg1" },
  { label: "2ST SG", file: "data/samples/singapore-total-2.json", idPrefix: "sg2" },
  { label: "2ST HM", file: "data/samples/hochiminh-total-2.json", idPrefix: "hm2" },
];

function toCargoes(rows, prefix) {
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

const results = [];

for (const s of SAMPLES) {
  const sample = JSON.parse(fs.readFileSync(path.resolve(s.file), "utf8"));
  const cargoes = toCargoes(sample.rows, s.idPrefix);
  // ON (default 변경 후 동작)
  const t0 = Date.now();
  const rOn = pack(cargoes, "auto", { footprintCluster: { enabled: true } });
  const tOn = Date.now() - t0;
  const upOn = rOn.unplaced.filter((u) => u.group !== "ct" && u.group !== "completed");
  // OFF (베이스라인 = long-axis 비활성)
  const t1 = Date.now();
  const rOff = pack(cargoes, "auto", {
    footprintCluster: { enabled: true },
    longAxisAnchor: { enabled: false },
  });
  const tOff = Date.now() - t1;
  const upOff = rOff.unplaced.filter((u) => u.group !== "ct" && u.group !== "completed");
  results.push({
    label: s.label,
    rows: sample.rows.length,
    on: { containers: rOn.containers.length, unp: upOn.length, ms: tOn,
          detail: upOn.map((u) => `${u.cargoId}(${u.shipper}) ${u.width}x${u.length}x${u.height}`) },
    off: { containers: rOff.containers.length, unp: upOff.length, ms: tOff,
          detail: upOff.map((u) => `${u.cargoId}(${u.shipper}) ${u.width}x${u.length}x${u.height}`) },
  });
}

console.log("\n=== 단독 pack() 회귀 결과 (ON=default | OFF=베이스라인) ===");
for (const r of results) {
  console.log(
    `[${r.label}] 행 ${r.rows} | ON: 컨 ${r.on.containers}/미배치 ${r.on.unp}/${r.on.ms}ms` +
    ` | OFF: 컨 ${r.off.containers}/미배치 ${r.off.unp}/${r.off.ms}ms`,
  );
  if (r.on.detail.length) console.log(`     ON 미배치:  ${r.on.detail.join(", ")}`);
  if (r.off.detail.length) console.log(`     OFF 미배치: ${r.off.detail.join(", ")}`);
}
