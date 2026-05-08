/**
 * VPHI 부킹 FBSIN260400 (sg3-22 ~ sg3-25) 의 좌표·컨테이너 배치 정밀 audit.
 * 3ST SG TOTAL, footprintCluster ON.
 * 한 부킹의 9 unit 이 한 컨테이너에 모여있는지 확인 (B1: 부킹 분산 금지).
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

const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};

log(`JSON 샘플 로드: ${rows.length} 행`);

// 입력 데이터 — VPHI 4행 확인
log(`\n=== 입력 데이터: VPHI 부킹 FBSIN260400 4행 ===`);
const vphiInputRows = cargoes.filter((c) => c.bookingNo === "FBSIN260400");
for (const c of vphiInputRows) {
  log(
    `  ${c.id} (${c.actualShipperName}) ${c.width}x${c.length}x${c.height} qty=${c.quantity} weight/unit=${c.weightPerUnit}kg`,
  );
}

const t0 = Date.now();
const result = pack(cargoes, "auto", {
  footprintCluster: { enabled: true },
});
const elapsed = Date.now() - t0;

log(`\n=== pack() 실행 (footprintCluster ON) ===`);
log(`소요: ${elapsed}ms`);
log(`컨테이너: ${result.containers.length}대 — ${result.containers.map((c) => c.spec.type).join(", ")}`);
log(`전체 unplaced: ${result.unplaced.length}`);

// VPHI unit 추적 — 각 컨테이너의 모든 row.bottomItems / row.topItems 순회
log(`\n=== VPHI 부킹 (FBSIN260400) unit 위치 추적 ===`);
const vphiUnitsByContainer = new Map(); // containerIdx -> array of {cargoId, x, y, z, w, l, h, weight}
const otherBookings = ["FBSIN260343", "FBSIN260344", "FBSIN260423"];
const otherUnitsByBookingContainer = new Map(); // booking -> Map<containerIdx, [...]>
for (const b of otherBookings) otherUnitsByBookingContainer.set(b, new Map());

result.containers.forEach((c, ci) => {
  c.rows.forEach((row, rIdx) => {
    const bottoms = (row.bottomItems ?? []).map((it) => ({ ...it, _layer: "bottom" }));
    const tops = (row.topItems ?? []).map((it) => ({ ...it, _layer: "top" }));
    for (const item of [...bottoms, ...tops]) {
      const meta = cargoes.find((cg) => cg.id === item.cargoId);
      const booking = meta?.bookingNo;
      const x = item.position?.x;
      const y = item.position?.y;
      const z = item.layer ?? item._layer;
      const w = item.size?.width;
      const l = item.size?.length;
      const h = item.size?.height;
      if (booking === "FBSIN260400") {
        if (!vphiUnitsByContainer.has(ci)) vphiUnitsByContainer.set(ci, []);
        vphiUnitsByContainer.get(ci).push({
          cargoId: item.cargoId,
          x, y, z, w, l, h,
          weight: item.weight,
          rowIndex: rIdx,
          shipper: item.shipper,
        });
      }
      if (otherBookings.includes(booking)) {
        const m = otherUnitsByBookingContainer.get(booking);
        if (!m.has(ci)) m.set(ci, []);
        m.get(ci).push({ cargoId: item.cargoId, x, y, z, w, l, h });
      }
    }
  });
});

// VPHI 출력
log(`\n--- VPHI unit 컨테이너 분포 ---`);
let totalVphiUnits = 0;
for (const [ci, units] of vphiUnitsByContainer) {
  log(`[컨${ci + 1}] VPHI unit ${units.length}개:`);
  for (const u of units) {
    log(
      `  ${u.cargoId} | (x=${u.x}, y=${u.y}, z=${u.z}) | ${u.w}x${u.l}x${u.h} | ${u.weight ?? "?"}kg | row#${u.rowIndex}`,
    );
    totalVphiUnits++;
  }
}
log(`\nVPHI 총 unit: ${totalVphiUnits}개 (예상 9개: 2+2+2+3)`);

// B1 위반 판정
const containerCount = vphiUnitsByContainer.size;
const b1Violation = containerCount > 1;
log(`\n=== B1 부킹 분산 위반 판정 ===`);
log(`VPHI unit 분산 컨테이너 수: ${containerCount}`);
log(`B1 위반: ${b1Violation ? "✅ Y (분산됨, 위반)" : "❌ N (한 컨에 모임, OK)"}`);
if (b1Violation) {
  const distrib = [...vphiUnitsByContainer.entries()]
    .map(([ci, units]) => `컨${ci + 1}=${units.length}개`)
    .join(" / ");
  log(`분산 패턴: ${distrib}`);
}

// 다른 부킹 (sg3-20, sg3-21, sg3-31) 검사
log(`\n=== 다른 부킹 분산 검사 (sg3-20·21·31) ===`);
for (const b of otherBookings) {
  const m = otherUnitsByBookingContainer.get(b);
  const cnt = m.size;
  const total = [...m.values()].reduce((s, arr) => s + arr.length, 0);
  const distrib = [...m.entries()].map(([ci, arr]) => `컨${ci + 1}=${arr.length}`).join(" / ");
  log(`  ${b}: ${total} unit, ${cnt} 컨테이너 (${distrib}) — ${cnt > 1 ? "분산" : "단일"}`);
}

// 파일 저장
const LOG_PATH = path.resolve("logs/vphi-coord-audit.txt");
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, lines.join("\n"), "utf8");
log(`\n로그 저장: ${LOG_PATH}`);

process.exit(0);
