/**
 * 2ST HM TOTAL — 시뮬레이션 vs 실무자 분배 상세 비교 보고서
 *
 * 1) 시스템 AUTO 모드 결과
 * 2) 실무자 강제 모드 결과
 * 3) 화주별 어디 컨테이너 갔는지 1:1 비교
 * 4) 각 화물의 물리 좌표 (x, y, z, 회전, layer) 표시
 */
import fs from "node:fs";
import { pack } from "../lib/packing/algorithm.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/hochiminh-total-2.json", "utf8"));

const PRACT = {
  1: ["AMS","한국쎄미텍","유라","KIOSKIN","전영사","SD KOREA","SJIT","일라","SJI","KFTS","한성엔터프라이즈","이구산업","케이티엔테크놀러지"],
  2: ["제임스텍","중앙바이오텍","리브유","파인 파인비나","블루오션","파인비나","장안어패럴","디씨이메탈","스톰테크"],
  3: ["효성","로제화장품","삼원절연","화인써키트"],
};

const cargoes = sample.rows.map((r, idx) => ({
  id: `hm2-${idx + 1}`,
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

const shToId = new Map();
for (const c of cargoes) shToId.set(c.actualShipperName, c.id);

// 1) AUTO 모드
const autoResult = pack(cargoes, "auto");

// 2) 실무자 강제 모드
const fixedAssignment = {};
for (const [ci, shippers] of Object.entries(PRACT)) {
  for (const sh of shippers) {
    const id = shToId.get(sh);
    if (id) fixedAssignment[id] = Number(ci);
  }
}
const forceResult = pack(cargoes, "auto", { fixedContainers: ["40FT", "40FT", "20FT"], fixedAssignment });

// 결과 추출 helper
function extractPlacements(result) {
  const map = new Map();
  result.containers.forEach((cont, ci) => {
    for (const row of cont.rows) {
      for (const it of [...row.bottomItems, ...row.topItems]) {
        const list = map.get(it.cargoId) ?? [];
        list.push({
          containerIdx: ci + 1,
          containerType: cont.spec.type,
          x: it.position.x, y: it.position.y, z: it.layer === "top" ? "TOP" : "BOTTOM",
          w: it.size.width, l: it.size.length, h: it.size.height,
          layer: it.layer,
        });
        map.set(it.cargoId, list);
      }
    }
    for (const b of cont.bulkItems ?? []) {
      const list = map.get(b.cargoId) ?? [];
      list.push({
        containerIdx: ci + 1,
        containerType: cont.spec.type,
        bulk: true,
        cbm: b.cbm,
      });
      map.set(b.cargoId, list);
    }
  });
  return map;
}

const autoMap = extractPlacements(autoResult);
const forceMap = extractPlacements(forceResult);

// 헤더
console.log("=".repeat(100));
console.log("2ST HM TOTAL — 시뮬레이션 vs 실무자 분배 비교");
console.log("=".repeat(100));

// 컨테이너 셋 비교
console.log("\n┃ 컨테이너 셋 비교");
console.log(`  시스템 AUTO: ${autoResult.containers.map(c => c.spec.type).join(" + ")} (${autoResult.containers.length} 대)`);
console.log(`  실무자 강제: ${forceResult.containers.map(c => c.spec.type).join(" + ")} (${forceResult.containers.length} 대)`);

// 화주별 컨테이너 매핑 비교
console.log("\n┃ 화주별 컨테이너 매핑 (시스템 vs 실무자)");
console.log("─".repeat(100));
console.log(`${"실화주".padEnd(20)} | ${"시스템 컨".padEnd(8)} | ${"실무자 컨".padEnd(8)} | 일치`);
console.log("─".repeat(100));
let mismatchCount = 0;
for (const c of cargoes) {
  const autoPlacements = autoMap.get(c.id) ?? [];
  const forcePlacements = forceMap.get(c.id) ?? [];
  const autoCont = autoPlacements[0]?.containerIdx;
  const forceCont = forcePlacements[0]?.containerIdx;
  const match = autoCont === forceCont;
  if (!match) mismatchCount++;
  console.log(`${c.actualShipperName.padEnd(20)} | ${String(autoCont ?? "?").padEnd(8)} | ${String(forceCont ?? "?").padEnd(8)} | ${match ? "✅" : "❌"}`);
}
console.log("─".repeat(100));
console.log(`총 mismatch: ${mismatchCount} / ${cargoes.length}`);

// 화물별 물리 배치 상세 (실무자 강제 모드 기준)
console.log("\n\n" + "=".repeat(100));
console.log("┃ 실무자 강제 모드 — 각 화물의 물리적 배치");
console.log("=".repeat(100));
for (const ci of [1, 2, 3]) {
  const cont = forceResult.containers.find(c => c.index === ci);
  if (!cont) continue;
  console.log(`\n┃ 컨테이너 [${ci}] ${cont.spec.type} (${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight}cm)`);
  console.log(`  적재 정보: visual ${cont.rows.flatMap(r=>[...r.bottomItems,...r.topItems]).length} 박스, bulk ${(cont.bulkItems??[]).length} 화물, 충전률 ${cont.cbmFillRate?.toFixed(1)}%, 무게 ${cont.totalWeight?.toFixed(0)}kg`);
  console.log("─".repeat(100));
  for (const sh of PRACT[ci]) {
    const c = cargoes.find(x => x.actualShipperName === sh);
    if (!c) continue;
    const placements = forceMap.get(c.id) ?? [];
    const totalQty = c.quantity;
    console.log(`  ${sh.padEnd(20)} qty=${totalQty} ${c.width}×${c.length}×${c.height}cm ${c.cargoType}`);
    if (placements.length === 0) {
      console.log(`    ⚠ 미배치`);
      continue;
    }
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (p.bulk) {
        console.log(`    [${i+1}] bulk(CT) cbm=${p.cbm?.toFixed(2)}m³ 컨[${p.containerIdx}]`);
      } else {
        console.log(`    [${i+1}] (${p.x},${p.y}) ${p.w}×${p.l}×${p.h} ${p.z === "TOP" ? "윗단" : "바닥"} 컨[${p.containerIdx}]`);
      }
    }
  }
}

// 물리 검증 요약
console.log("\n\n" + "=".repeat(100));
console.log("┃ 물리 검증 요약");
console.log("=".repeat(100));
const SOFT_OVERFLOW = 1.05;
for (const cont of forceResult.containers) {
  const placements = cont.rows.flatMap(r => [...r.bottomItems, ...r.topItems]);
  const visualCbm = placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
  const ctCbm = (cont.bulkItems ?? []).reduce((s, b) => s + (b.cbm ?? 0), 0);
  const totalCbm = visualCbm + ctCbm;
  const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
  console.log(`\n컨[${cont.index}] ${cont.spec.type}:`);
  console.log(`  적재 박스: ${placements.length} visual + ${(cont.bulkItems??[]).length} bulk`);
  console.log(`  CBM: ${totalCbm.toFixed(2)} / ${maxCbm.toFixed(2)} m³ (${(totalCbm/maxCbm*100).toFixed(1)}%)`);
  console.log(`  무게: ${cont.totalWeight?.toFixed(0)} / ${cont.spec.maxWeightKg} kg (${(cont.totalWeight/cont.spec.maxWeightKg*100).toFixed(1)}%)`);
}
console.log(`\n전체 미배치: ${forceResult.unplaced.reduce((s,u)=>s+(u.quantity??1),0)} units`);
