/**
 * 2ST HM TOTAL — 각 화물의 물리 좌표 답안지
 * 시스템 AUTO / 실무자 강제 — 컨테이너별 배치 결과
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
  bookingNo: r.bookingNo, unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

const shToId = new Map();
for (const c of cargoes) shToId.set(c.actualShipperName, c.id);

const fixedAssignment = {};
for (const [ci, list] of Object.entries(PRACT)) for (const sh of list) fixedAssignment[shToId.get(sh)] = +ci;

const auto = pack(cargoes, "auto");
const force = pack(cargoes, "auto", { fixedContainers: ["40FT", "40FT", "20FT"], fixedAssignment });

function dump(label, result) {
  console.log("\n" + "█".repeat(100));
  console.log(`█ ${label}`);
  console.log("█".repeat(100));
  for (const cont of result.containers) {
    const placements = cont.rows.flatMap(r => [...r.bottomItems, ...r.topItems]);
    const bulks = cont.bulkItems ?? [];
    const visualCbm = placements.reduce((s, p) => s + (p.size.width * p.size.length * p.size.height) / 1e6, 0);
    const ctCbm = bulks.reduce((s, b) => s + (b.cbm ?? 0), 0);
    const totalCbm = visualCbm + ctCbm;
    const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
    console.log(`\n[${cont.index}] ${cont.spec.type} (${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight}cm)  CBM ${totalCbm.toFixed(2)}/${maxCbm.toFixed(2)}m³ (${(totalCbm/maxCbm*100).toFixed(0)}%)  무게 ${cont.totalWeight.toFixed(0)}/${cont.spec.maxWeightKg}kg`);
    console.log("─".repeat(100));
    // 화주별로 그룹화
    const byCargo = new Map();
    for (const it of placements) {
      const c = cargoes.find(c => c.id === it.cargoId);
      if (!c) continue;
      const list = byCargo.get(c.actualShipperName) ?? [];
      list.push({ x: it.position.x, y: it.position.y, z: it.layer === "top" ? "윗단" : "바닥", w: it.size.width, l: it.size.length, h: it.size.height });
      byCargo.set(c.actualShipperName, list);
    }
    const bulkByCargo = new Map();
    for (const b of bulks) {
      const c = cargoes.find(c => c.id === b.cargoId);
      if (!c) continue;
      const list = bulkByCargo.get(c.actualShipperName) ?? [];
      list.push({ cbm: b.cbm });
      bulkByCargo.set(c.actualShipperName, list);
    }
    for (const [sh, items] of byCargo) {
      const c = cargoes.find(c => c.actualShipperName === sh);
      console.log(`  ▸ ${sh.padEnd(20)} (${c.width}×${c.length}×${c.height} ${c.cargoType}, qty=${c.quantity}) — visual ${items.length}박스`);
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        console.log(`     [${String(i+1).padStart(2)}] (x=${String(p.x).padStart(3)}, y=${String(p.y).padStart(4)}) ${p.w}×${p.l}×${p.h} ${p.z}`);
      }
    }
    for (const [sh, blist] of bulkByCargo) {
      const c = cargoes.find(c => c.actualShipperName === sh);
      console.log(`  ▸ ${sh.padEnd(20)} (CT 무차원, qty=${c.quantity}) — bulk ${blist[0].cbm.toFixed(2)}m³`);
    }
  }
  console.log(`\n전체 미배치: ${result.unplaced.reduce((s,u)=>s+(u.quantity??1),0)} unit`);
}

dump("시스템 AUTO 모드 답안지", auto);
dump("실무자 강제 모드 답안지", force);
