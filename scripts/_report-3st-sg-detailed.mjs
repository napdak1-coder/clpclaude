/**
 * 3ST SG TOTAL — 컨테이너 배치 상세 보고서
 * 사용자 요청: 각 컨테이너 화물 배치, 크기·무게, 미배치 원인, 부킹 인접 처리, 배분 순서.
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));

const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

// 실무자 분배 강제 (rows 1~19 → 컨1, 20~35 → 컨2)
const fixedAssignment = {};
cargoes.forEach((c, i) => { fixedAssignment[c.id] = i < 19 ? 1 : 2; });

const result = pack(cargoes, "auto", { fixedContainers: ["40FT", "40FT"], fixedAssignment });

const cargoMap = new Map(cargoes.map(c => [c.id, c]));

console.log("==========================================");
console.log("  3ST SG TOTAL — 컨테이너 배치 상세 보고");
console.log("==========================================");
console.log(`\n전체 화물: ${cargoes.length} 행`);
console.log(`컨테이너: ${result.containers.length}대 (${result.containers.map(c => c.spec.type).join(" + ")})`);
console.log(`미배치: ${result.unplaced.length} unit`);

// 부킹별 그룹
const bookingGroups = new Map();
for (const c of cargoes) {
  const bk = c.bookingNo || "(부킹없음)";
  if (!bookingGroups.has(bk)) bookingGroups.set(bk, []);
  bookingGroups.get(bk).push(c);
}

// 컨테이너별 배치
for (const cont of result.containers) {
  const idx = cont.index;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[컨테이너 ${idx}] ${cont.spec.type} (내부 ${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight} cm)`);
  console.log(`${"=".repeat(60)}`);

  // 모든 placement 수집
  const placements = [];
  for (const row of cont.rows) {
    for (const it of row.bottomItems) placements.push({ ...it, layer: "하단", z: 0 });
    for (const it of row.topItems) placements.push({ ...it, layer: "상단", z: row.bottomMaxHeight });
  }
  const bulks = cont.bulkItems ?? [];

  console.log(`\n시각 박스: ${placements.length}개   벌크 화물: ${bulks.length}건`);

  // 부킹 묶음 (이 컨에 들어간 cargoId 기준)
  const inThisCont = new Set();
  for (const p of placements) inThisCont.add(p.cargoId);
  for (const b of bulks) inThisCont.add(b.cargoId);

  const containerBookings = new Map();
  for (const cid of inThisCont) {
    const cg = cargoMap.get(cid);
    if (!cg) continue;
    const bk = cg.bookingNo || "(부킹없음)";
    if (!containerBookings.has(bk)) containerBookings.set(bk, []);
    containerBookings.get(bk).push(cg);
  }

  console.log(`\n--- 부킹 묶음 (이 컨에 들어간 부킹) ---`);
  for (const [bk, items] of containerBookings) {
    console.log(`  ${bk.padEnd(16)} ${items.length}행:`);
    for (const i of items) {
      const sizes = i.unitSizes && i.unitSizes.length > 0
        ? i.unitSizes.map(us => `${us.width}×${us.length}×${us.height}cm×${us.quantity}개`).join(", ")
        : (i.width > 0 ? `${i.width}×${i.length}×${i.height}cm×${i.quantity}개` : "(사이즈 없음)");
      const cbmTotal = i.unitSizes && i.unitSizes.length > 0
        ? i.unitSizes.reduce((s, u) => s + (u.width * u.length * u.height * u.quantity) / 1e6, 0)
        : (i.aboutCbm ?? i.cbm ?? (i.width * i.length * i.height * i.quantity / 1e6));
      const weightTotal = (i.weightPerUnit ?? 0);
      console.log(`     - ${i.actualShipperName.padEnd(20)} ${i.id.padEnd(8)} 종류:${(i.cargoType || "?").padEnd(3)} ${sizes}  부피${cbmTotal.toFixed(2)}m³  무게${weightTotal}kg`);
    }
  }

  // 합계
  const totalWeight = placements.reduce((s, p) => s + (p.weight ?? 0), 0)
    + bulks.reduce((s, b) => s + (b.weightPerUnit ?? 0) * (b.quantity ?? 1), 0);
  const totalVisualCbm = placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  const totalBulkCbm = bulks.reduce((s, b) => s + (b.cbm ?? 0), 0);
  const totalCbm = totalVisualCbm + totalBulkCbm;
  const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
  console.log(`\n--- 합계 ---`);
  console.log(`  무게: ${totalWeight.toFixed(0)} / ${cont.spec.maxWeightKg} kg (${(totalWeight/cont.spec.maxWeightKg*100).toFixed(1)}%)`);
  console.log(`  부피: 시각 ${totalVisualCbm.toFixed(2)} + 벌크 ${totalBulkCbm.toFixed(2)} = ${totalCbm.toFixed(2)} / ${maxCbm.toFixed(2)} m³ (${(totalCbm/maxCbm*100).toFixed(1)}%)`);

  // 행별 배치
  console.log(`\n--- 행별 배치 (Y 축 순) ---`);
  for (const row of cont.rows) {
    const rowLength = row.yEnd - row.yStart;
    console.log(`\n  [행 ${row.index}] y ${row.yStart}~${row.yEnd}cm (길이 ${rowLength}cm), 천장여유 ${row.topClearance}cm`);
    if (row.bottomItems.length > 0) {
      console.log(`    하단:`);
      for (const b of row.bottomItems) {
        const cg = cargoMap.get(b.cargoId);
        const bk = cg?.bookingNo || "(부킹없음)";
        const ct = cg?.cargoType || "?";
        console.log(`      ${cg?.actualShipperName.padEnd(20) ?? "?"} ${b.cargoId.padEnd(8)} 종류:${ct.padEnd(3)} ${b.size.width}×${b.size.length}×${b.size.height}cm  ${(b.weight ?? 0).toFixed(0)}kg  부킹${bk}  x=${b.position.x}`);
      }
    }
    if (row.topItems.length > 0) {
      console.log(`    상단:`);
      for (const t of row.topItems) {
        const cg = cargoMap.get(t.cargoId);
        const bk = cg?.bookingNo || "(부킹없음)";
        const ct = cg?.cargoType || "?";
        console.log(`      ${cg?.actualShipperName.padEnd(20) ?? "?"} ${t.cargoId.padEnd(8)} 종류:${ct.padEnd(3)} ${t.size.width}×${t.size.length}×${t.size.height}cm  ${(t.weight ?? 0).toFixed(0)}kg  부킹${bk}  x=${t.position.x}`);
      }
    }
  }

  if (bulks.length > 0) {
    console.log(`\n--- 벌크 화물 (사이즈 없음, CBM/무게만 합산) ---`);
    for (const b of bulks) {
      const cg = cargoMap.get(b.cargoId);
      const bk = cg?.bookingNo || "(부킹없음)";
      console.log(`  ${cg?.actualShipperName ?? "?"} ${b.cargoId} ${b.cargoType} ${(b.cbm ?? 0).toFixed(2)}m³ ${((b.weightPerUnit ?? 0) * (b.quantity ?? 1)).toFixed(0)}kg 부킹 ${bk}`);
    }
  }
}

// 미배치
console.log(`\n${"=".repeat(60)}`);
console.log(`  ⚠ 미배치 박스 분석`);
console.log(`${"=".repeat(60)}`);
if (result.unplaced.length === 0) {
  console.log("\n없음 — 0 미배치 ✅");
} else {
  for (const u of result.unplaced) {
    const cg = u.cargo ?? cargoMap.get(u.cargoId);
    console.log(`\n  화주: ${cg?.actualShipperName} (${cg?.id})`);
    console.log(`  부킹: ${cg?.bookingNo || "(없음)"}`);
    console.log(`  실무자 의도: 컨${fixedAssignment[cg?.id]}`);
    console.log(`  사이즈: ${cg?.unitSizes ? '복합' : `${cg?.width}×${cg?.length}×${cg?.height} cm`}`);
    if (cg?.unitSizes) for (const us of cg.unitSizes) console.log(`    ${us.width}×${us.length}×${us.height} ×${us.quantity}개`);
    console.log(`  CBM: ${(cg?.aboutCbm ?? cg?.cbm ?? 0).toFixed(2)} m³`);
    console.log(`  무게: ${cg?.weightPerUnit ?? 0} kg`);
  }

  // 못 들어간 이유 분석 (실무자 의도 컨테이너 잔여 공간 vs 박스 크기)
  console.log(`\n--- 못 들어간 이유 ---`);
  for (const u of result.unplaced) {
    const cg = u.cargo ?? cargoMap.get(u.cargoId);
    const targetIdx = fixedAssignment[cg?.id];
    const cont = result.containers.find(c => c.index === targetIdx);
    if (!cont) continue;

    // 그 컨의 잔여 공간 추정
    const placements = [];
    for (const row of cont.rows) {
      for (const it of row.bottomItems) placements.push(it);
      for (const it of row.topItems) placements.push(it);
    }
    const visualCbm = placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
    const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
    const reservedCbm = visualCbm + (cont.bulkItems?.reduce((s, b) => s + (b.cbm ?? 0), 0) ?? 0);
    const freeCbm = maxCbm - reservedCbm;
    console.log(`\n  ${cg?.actualShipperName} (${cg?.id}): 컨${targetIdx} 남은 부피 ${freeCbm.toFixed(2)} m³`);
    if (cg?.unitSizes) {
      const cbm = cg.unitSizes.reduce((s, us) => s + (us.width * us.length * us.height * us.quantity) / 1e6, 0);
      console.log(`    필요 부피 ${cbm.toFixed(2)} m³ — 부피상으론 ${freeCbm >= cbm ? "들어감" : "부족"}`);
    } else {
      const cbm = (cg.width * cg.length * cg.height * cg.quantity) / 1e6;
      console.log(`    필요 부피 ${cbm.toFixed(2)} m³ — 부피상으론 ${freeCbm >= cbm ? "들어감" : "부족"}`);
    }
    console.log(`    → 부피 여유 있어도 형상상 안 들어감 (큰 박스들이 자리 차지)`);
  }
}

// 부킹 인접 검증
console.log(`\n${"=".repeat(60)}`);
console.log(`  📋 부킹 인접 검증`);
console.log(`${"=".repeat(60)}`);
const bookingToContainers = new Map();
for (const cont of result.containers) {
  const inCont = new Set();
  for (const row of cont.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) inCont.add(it.cargoId);
  }
  for (const b of cont.bulkItems ?? []) inCont.add(b.cargoId);
  for (const cid of inCont) {
    const cg = cargoMap.get(cid);
    if (cg?.bookingNo) {
      if (!bookingToContainers.has(cg.bookingNo)) bookingToContainers.set(cg.bookingNo, new Set());
      bookingToContainers.get(cg.bookingNo).add(cont.index);
    }
  }
}
let splits = 0;
for (const [bk, conts] of bookingToContainers) {
  if (conts.size > 1) {
    console.log(`  ❌ ${bk} → 컨${[...conts].join(",")} 갈라짐`);
    splits++;
  }
}
if (splits === 0) console.log(`  ✅ 모든 부킹 한 컨에 묶여 있음 (${bookingToContainers.size}개 부킹)`);
console.log(`\n부킹 인접 위반: ${splits} 건`);

console.log(`\n${"=".repeat(60)}`);
console.log("  보고서 끝");
console.log(`${"=".repeat(60)}`);
