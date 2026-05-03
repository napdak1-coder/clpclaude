/**
 * 사용자 지정 입고완료 5종이 20FT 한 컨테이너에 들어가는지 물리 검증.
 *
 * 사용자 지정 (실화주 기준):
 *   AWOT, 대원산업, 씨에스에프, HD현대건설기계, 포컴퍼니
 *
 * 검증 항목:
 *   1) 각 화물의 cfs cbm (입고완료 표식) 여부
 *   2) 합산 CBM ≤ 20FT 한도(28 m³)
 *   3) 합산 중량 ≤ 20FT 한도(21000 kg)
 *   4) packExtremePoint 로 실제 시각 배치 — bounding box / no-overlap / door / rules 모두 통과?
 *   5) HD현대(현재 cargoType=CT) 가 PK 로 분류되어야 시각 가능
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { packExtremePoint, expandCargoesToUnits } = await import(
  "../lib/packing/extreme-point.ts"
);
const { getContainerSpec } = await import("../lib/packing/containers.ts");

const samplePath = resolve(process.cwd(), "data/samples/singapore-total.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

const TARGET = new Set([
  "AWOT",
  "대원산업",
  "씨에스에프",
  "HD현대건설기계",
  "포컴퍼니",
]);

// 1) 사용자 지정 5종 추출 + 입고완료 여부
console.log("=== 사용자 지정 5종 (입고완료 마감 후보) ===\n");
const targets = sample.rows
  .filter((r) => TARGET.has(r.actualShipperName))
  .map((r, idx) => ({
    id: `c-${idx}`,
    shipmentId: "test",
    sortOrder: idx,
    cargoType: r.cargoType,
    actualShipperName: r.actualShipperName,
    shipperName: r.shipperName,
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
    },
  }));

let totalCfsCbm = 0;
let totalPhysCbm = 0;
let totalWeight = 0;
for (const c of targets) {
  const physCbm = (c.width * c.length * c.height * c.quantity) / 1_000_000;
  const w = (c.weightPerUnit ?? 0) * c.quantity;
  const isCompleted = c.cbm != null && c.cbm > 0;
  console.log(
    `  ${c.actualShipperName}  type=${c.cargoType}  qty=${c.quantity}  ` +
    `${c.width}×${c.length}×${c.height}  ` +
    `[${isCompleted ? "✓ cfs " + c.cbm : "✗ no cbm"}]  ` +
    `phys=${physCbm.toFixed(3)} m³  W=${w} kg`,
  );
  totalCfsCbm += isCompleted ? c.cbm : 0;
  totalPhysCbm += physCbm;
  totalWeight += w;
}

const spec20 = getContainerSpec("20FT");
console.log(`\n=== 20FT 한도 vs 사용자 지정 합산 ===`);
console.log(`  CBM 한도(maxCbm)     : ${spec20.maxCbm} m³`);
console.log(`  cfs CBM 합산(입고완료): ${totalCfsCbm.toFixed(3)} m³  ${totalCfsCbm <= spec20.maxCbm ? "✓ OK" : "✗ 초과"}`);
console.log(`  물리 CBM 합산(W×L×H×qty): ${totalPhysCbm.toFixed(3)} m³  ${totalPhysCbm <= spec20.maxCbm ? "✓ OK" : "✗ 초과"}`);
console.log(`  중량 한도(maxWeightKg): ${spec20.maxWeightKg} kg`);
console.log(`  중량 합산            : ${totalWeight} kg  ${totalWeight <= spec20.maxWeightKg ? "✓ OK" : "✗ 초과"}`);

// 2) 시각 적재 가능성 — 각 화물의 cargoType 별 처리
console.log(`\n=== cargoType 점검 (시각 적재 가능 여부) ===`);
const REGULAR = new Set(["PL", "WB", "WC", "WD", "CR", "CL", "PK"]);
for (const c of targets) {
  const visual = REGULAR.has(c.cargoType);
  console.log(
    `  ${c.actualShipperName}  type=${c.cargoType}  → ${visual ? "🟦 시각" : "🟧 CBM 합산만 (CT)"}`,
  );
}

// 3) 시각 화물만 추려 packExtremePoint 로 실제 배치 시도
const visualTargets = targets.filter((c) => REGULAR.has(c.cargoType));
console.log(`\n=== 20FT 시각 적재 (CT 제외) — packExtremePoint 직접 호출 ===`);
const sortLDF = (us) =>
  [...us].sort((a, b) => {
    const va = a.width * a.length * a.height,
      vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    return b.weight - a.weight;
  });
const units = sortLDF(expandCargoesToUnits(visualTargets));
const packed = packExtremePoint(units, spec20);
console.log(`  units=${units.length}  placed=${packed.placements.length}  unplaced=${packed.unplaced.length}`);
console.log(`  visualCbm=${packed.visualCbm.toFixed(3)}  totalWeight=${packed.totalWeight} kg`);

// 4) 물리·규칙 audit
const EPS = 0.001;
const overlap1D = (a0, a1, b0, b1) => a0 + EPS < b1 && b0 + EPS < a1;
const overlap3D = (a, b) =>
  overlap1D(a.x, a.x + a.w, b.x, b.x + b.w) &&
  overlap1D(a.y, a.y + a.l, b.y, b.y + b.l) &&
  overlap1D(a.z, a.z + a.h, b.z, b.z + b.h);
const aabbs = packed.placements.map((p) => ({
  p,
  x: p.position.x, y: p.position.y, z: p.position.z,
  w: p.size.width, l: p.size.length, h: p.size.height,
}));
const boxFails = aabbs.filter(
  (a) =>
    a.x < -EPS || a.y < -EPS || a.z < -EPS ||
    a.x + a.w > spec20.innerWidth + EPS ||
    a.y + a.l > spec20.innerLength + EPS ||
    a.z + a.h > spec20.innerHeight + EPS,
);
let overlapFails = 0;
for (let i = 0; i < aabbs.length; i++)
  for (let j = i + 1; j < aabbs.length; j++)
    if (overlap3D(aabbs[i], aabbs[j])) overlapFails++;
const maxStack = aabbs.reduce((m, a) => Math.max(m, a.z + a.h), 0);
console.log(`\n  ${boxFails.length === 0 ? "✓" : "✗"} bounding box (모두 컨테이너 안)`);
console.log(`  ${overlapFails === 0 ? "✓" : "✗"} no-overlap (3D)`);
console.log(`  ${packed.totalWeight <= spec20.maxWeightKg ? "✓" : "✗"} weight ≤ ${spec20.maxWeightKg} kg`);
console.log(`  ${maxStack <= spec20.doorHeight ? "✓" : "✗"} max stack ${maxStack} ≤ door ${spec20.doorHeight}`);

if (packed.unplaced.length > 0) {
  console.log(`\n  ⚠ 미배치 ${packed.unplaced.length} unit:`);
  for (const u of packed.unplaced)
    console.log(`    - ${u.shipper} ${u.width}×${u.length}×${u.height}`);
}
