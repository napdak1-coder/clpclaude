/**
 * 시스템이 실제 산출하는 layout 을 사용자 표 형식으로 출력
 * (Row | 위치 | 층 | 화주 | 수량 | 좌표 / 사이즈)
 *
 * 사용자가 손으로 적은 layout 과 비교용.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const samplePath = resolve(process.cwd(), "data/samples/singapore-total.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

// 시스템이 실제로 받는 CargoSpec 형식으로 변환 (route/api 와 동일)
const cargoes = sample.rows.map((r, i) => ({
  id: `c-${i}`,
  shipmentId: "sample",
  sortOrder: i,
  cargoType: r.cargoType,
  itemName: r.itemName ?? undefined,
  actualShipperName: r.actualShipperName ?? undefined,
  shipperName: r.shipperName ?? undefined,
  width: r.widthCm,
  length: r.lengthCm,
  height: r.heightCm,
  quantity: r.quantity,
  weightPerUnit: r.weightPerUnitKg,
  cbm: r.cbm ?? undefined,
  aboutCbm: r.aboutCbm ?? undefined,
  remarks: {
    noStacking: r.noStacking,
    topOnly: r.topOnly,
    orientation: r.orientation,
    heavierBelow: r.heavierBelow,
    notes: r.itemRemark ?? undefined,
  },
}));

// AUTO 모드 — 시스템 알고리즘이 컨테이너 결정
const result = packBest(cargoes, "auto");

// 화주 이름으로 그룹핑된 placement 카운트 (qty 표시용)
function fmtRow(rowIdx, yStart, yEnd, layer, shipper, qty, x, y, size) {
  const sz = `${size.width}x${size.length}x${size.height}`;
  return `${rowIdx}\ty ${Math.round(yStart)}-${Math.round(yEnd)}\t${layer}\t${shipper}\t${qty}\tx${Math.round(x)} y${Math.round(y)} / ${sz}`;
}

for (const cont of result.containers) {
  console.log(`\n=== ${cont.spec.type} 컨테이너 (시스템 출력) ===\n`);
  console.log(`Row\t위치\t층\t화주\t수량\t배치 좌표 / 사이즈`);
  for (const row of cont.rows) {
    // 같은 화주가 같은 행에 여러 unit 있을 수 있음 → 화주별로 묶음
    const byShipper = new Map();
    for (const it of row.bottomItems) {
      const k = `${it.shipper}|bottom`;
      if (!byShipper.has(k)) byShipper.set(k, []);
      byShipper.get(k).push({ ...it, layer: "하단" });
    }
    for (const it of row.topItems) {
      const k = `${it.shipper}|top`;
      if (!byShipper.has(k)) byShipper.set(k, []);
      byShipper.get(k).push({ ...it, layer: "상단" });
    }
    for (const items of byShipper.values()) {
      // 각 placement 를 한 줄씩 (qty=1) — 사용자 표와 같이 좌표별로 분리
      for (const it of items) {
        console.log(fmtRow(
          row.index + 1, row.yStart, row.yEnd,
          it.layer, it.shipper.replace(/\s*\/\s*$/, "").trim(),
          1,
          it.position.x, it.position.y, it.size,
        ));
      }
    }
  }
}

console.log(`\n--- 요약 ---`);
console.log(`컨테이너: ${result.containers.length}대 (${result.containers.map(c => c.spec.type).join(", ")})`);
console.log(`미배치: ${result.unplaced.length} 종 / ${result.unplaced.reduce((s,u)=>s+(u.quantity??1),0)} unit`);
if (result.summary.warnings?.length) {
  console.log(`\n경고:`);
  for (const w of result.summary.warnings) console.log(`  - ${w}`);
}
