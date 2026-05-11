/**
 * sg3-35 SK GEO 원본 placement 검증 + sg3-11 valid 후보 raw 좌표 출력.
 * pack(ldf) 후 globalThis.__lastPackContainers 의 raw placement 사용.
 * display-rows 변환 X — 진짜 algorithm 좌표.
 */
import fs from "node:fs";
import path from "node:path";

process.env.DEBUG_RAW_PLACEMENTS = "1";

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
const r = pack(cargoes, undefined, {
  sortStrategy: STRAT,
  containerOrder: "biggest-first",
  autoConsolidateCompleted: true,
  placementMode: "wrapper",
});

const dump = globalThis.__lastPackContainers;
fs.writeFileSync(
  path.resolve("logs/sg3-11-ldf-placement-before-rescue.json"),
  JSON.stringify(dump, null, 2),
);
console.log(`raw dump 저장: logs/sg3-11-ldf-placement-before-rescue.json`);
console.log(`전략: ${STRAT}, unplaced: ${r.unplaced.length} (${r.unplaced.map((u) => u.cargoId).join(",")})`);

// ============================================================
// sg3-35 검증
// ============================================================
let sg35 = null;
let sg35Cont = null;
for (const c of dump) {
  for (const p of c.placements) {
    if (p.cargoId === "sg3-35") {
      sg35 = p;
      sg35Cont = c;
    }
  }
}

console.log(`\n========== sg3-35 검증 ==========`);
if (!sg35) {
  console.log(`sg3-35 미배치`);
} else {
  console.log(`컨${sg35Cont.index} pos=(${sg35.position.x}, ${sg35.position.y}, ${sg35.position.z})`);
  console.log(`size: ${sg35.size.width}×${sg35.size.length}×${sg35.size.height}`);
  console.log(`weight: ${sg35.weight}kg`);
  console.log(`rotated: ${sg35.rotated} faceIdx=${sg35.faceIdx} layer=${sg35.layer}`);
  console.log(`remarks: noStacking=${sg35.remarks.noStacking} topOnly=${sg35.remarks.topOnly} heavierBelow=${sg35.remarks.heavierBelow}`);

  // sg3-35 가 z>0 이면 받침 박스 찾기
  if (sg35.position.z > 0.01) {
    console.log(`\nsg3-35 가 z>0 위치 — 받침 박스 분석:`);
    const supporters = sg35Cont.placements.filter((p) =>
      p !== sg35 &&
      Math.abs(p.position.z + p.size.height - sg35.position.z) < 0.5 &&
      // x/y overlap
      sg35.position.x < p.position.x + p.size.width &&
      sg35.position.x + sg35.size.width > p.position.x &&
      sg35.position.y < p.position.y + p.size.length &&
      sg35.position.y + sg35.size.length > p.position.y
    );
    console.log(`  받침 박스 ${supporters.length}건:`);
    let totalSupportArea = 0;
    for (const sp of supporters) {
      const xOverlap = Math.max(0, Math.min(sg35.position.x + sg35.size.width, sp.position.x + sp.size.width) - Math.max(sg35.position.x, sp.position.x));
      const yOverlap = Math.max(0, Math.min(sg35.position.y + sg35.size.length, sp.position.y + sp.size.length) - Math.max(sg35.position.y, sp.position.y));
      const area = xOverlap * yOverlap;
      totalSupportArea += area;
      const valid = sg35.weight <= sp.weight;
      console.log(`    - ${sp.cargoId} ${sp.shipper} (${sp.size.width}×${sp.size.length}×${sp.size.height}) ${sp.weight}kg pos=(${sp.position.x},${sp.position.y},${sp.position.z}) noStacking=${sp.remarks.noStacking} 받침면적=${area}cm² ${valid ? "✅ topW≤bottomW" : "❌ topW>bottomW (위반!)"}`);
    }
    const sg35Footprint = sg35.size.width * sg35.size.length;
    const supportPct = (totalSupportArea / sg35Footprint) * 100;
    console.log(`  총 받침률: ${supportPct.toFixed(1)}% (받침면적 ${totalSupportArea}cm² / sg3-35 footprint ${sg35Footprint}cm²)`);

    // **핵심 검증**: sg3-35 위에 올라간 받침 박스보다 무거우면 룰 #7 위반
    const violations = supporters.filter((sp) => sg35.weight > sp.weight);
    if (violations.length > 0) {
      console.log(`\n  🚨 룰 #7 위반: sg3-35 (${sg35.weight}kg) > 받침 ${violations.length}건의 무게`);
      for (const v of violations) {
        console.log(`     - ${v.cargoId} (${v.weight}kg)`);
      }
    }
  } else {
    console.log(`\nsg3-35 z=0 (바닥) — 무게 룰 위반 없음`);
  }
}

// ============================================================
// sg3-11 + 광성텍 sg3-7 / FLOWBUS sg3-30 raw placement 출력
// ============================================================
console.log(`\n========== sg3-7 광성텍 / sg3-30 FLOWBUS placements ==========`);
for (const c of dump) {
  const targets = c.placements.filter((p) => p.cargoId === "sg3-7" || p.cargoId === "sg3-30");
  for (const p of targets) {
    console.log(`컨${c.index} ${p.cargoId} ${p.shipper} (${p.size.width}×${p.size.length}×${p.size.height}) ${p.weight}kg pos=(${p.position.x},${p.position.y},${p.position.z}) noStacking=${p.remarks.noStacking} topZ=${p.position.z + p.size.height}`);
  }
}

// ============================================================
// 광성텍 / FLOWBUS 위 sg3-11 valid 후보 raw 검증
// ============================================================
console.log(`\n========== sg3-11 valid 후보 검증 (raw 좌표) ==========`);
const sg11 = { width: 150, length: 80, height: 68, weight: 750, remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false } };

for (const c of dump) {
  const targets = c.placements.filter((p) => (p.cargoId === "sg3-7" || p.cargoId === "sg3-30") && p.weight >= 750);
  for (const P of targets) {
    const topZ = P.position.z + P.size.height;
    const doorH = c.spec.doorHeight ?? c.spec.innerHeight;

    console.log(`\n--- 컨${c.index} ${P.cargoId} ${P.shipper} (${P.size.width}×${P.size.length}×${P.size.height}) ${P.weight}kg pos=(${P.position.x},${P.position.y},${P.position.z}) topZ=${topZ} ---`);

    // 6 faces
    const FACES = [
      { idx: 0, w: 150, l: 80, h: 68 },
      { idx: 1, w: 80, l: 150, h: 68 },
      { idx: 2, w: 150, l: 68, h: 80 },
      { idx: 3, w: 68, l: 150, h: 80 },
      { idx: 4, w: 80, l: 68, h: 150 },
      { idx: 5, w: 68, l: 80, h: 150 },
    ];

    let foundValid = false;
    for (const f of FACES) {
      const checks = [];
      if (f.w > P.size.width + 0.01) checks.push(`fit-W ${f.w}>${P.size.width}`);
      if (f.l > P.size.length + 0.01) checks.push(`fit-L ${f.l}>${P.size.length}`);
      if (P.position.x + f.w > c.spec.innerWidth + 0.01) checks.push(`bound-W`);
      if (P.position.y + f.l > c.spec.innerLength + 0.01) checks.push(`bound-L y=${P.position.y+f.l}>${c.spec.innerLength}`);
      if (topZ + f.h > c.spec.innerHeight + 0.01) checks.push(`innerH`);
      if (topZ + f.h > doorH + 0.01) checks.push(`doorH`);
      if (P.remarks.noStacking) checks.push(`noStacking`);
      if (sg11.weight > P.weight) checks.push(`canStackOn`);

      // 충돌 검사
      let collQ = null;
      for (const Q of c.placements) {
        if (Q === P) continue;
        const qx = Q.position.x;
        const qxe = qx + Q.size.width;
        const qy = Q.position.y;
        const qye = qy + Q.size.length;
        const qz = Q.position.z;
        const qze = qz + Q.size.height;
        if (P.position.x + f.w <= qx + 0.01) continue;
        if (P.position.x >= qxe - 0.01) continue;
        if (P.position.y + f.l <= qy + 0.01) continue;
        if (P.position.y >= qye - 0.01) continue;
        if (topZ + f.h <= qz + 0.01) continue;
        if (topZ >= qze - 0.01) continue;
        collQ = Q;
        break;
      }
      if (collQ) checks.push(`collide-with ${collQ.cargoId} pos=(${collQ.position.x},${collQ.position.y},${collQ.position.z})`);

      if (checks.length === 0) {
        console.log(`  ✅ face${f.idx} (${f.w}×${f.l}×${f.h}) at (${P.position.x},${P.position.y},${topZ}) — VALID`);
        foundValid = true;
      } else {
        console.log(`  ❌ face${f.idx} (${f.w}×${f.l}×${f.h}): ${checks.join(", ")}`);
      }
    }
    if (!foundValid) console.log(`  → 모든 face fail`);
  }
}
