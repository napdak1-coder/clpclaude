/**
 * 사용자 수동 분배 검증 — 17 화주는 40FT 단독, 5 화주는 20FT 단독 패킹.
 * 결과: 각 그룹이 한 컨테이너 안에 모두 들어가는지, 미배치는 없는지.
 *
 * 실행: node --experimental-strip-types scripts/verify-user-split.mjs
 */

const { pack } = await import("../lib/packing/algorithm.ts");

// /api/shipments/{id} 응답에서 받은 22 화물 (CargoSpec 형식으로 매핑)
// id 는 실제 DB id 대신 검증용 단축 사용 (알고리즘은 id 만 식별자로 사용)
const CARGOES = [
  { id: "메가젠임플란트", actualShipperName: "메가젠임플란트", shipperName: "미르국제운송 민정B /", cargoType: "PL", width: 112, length: 145, height: 165, quantity: 2, weightPerUnit: 560, cbm: 5.359 },
  { id: "데코론", actualShipperName: "데코론", shipperName: "R&F 이재호 /", cargoType: "PL", width: 247, length: 129, height: 46, quantity: 2, weightPerUnit: 2350, cbm: 2.931 },
  { id: "YKMC", actualShipperName: "YKMC", shipperName: "FCA N/퀴네 /", cargoType: "CR", width: 118, length: 114, height: 59, quantity: 6, weightPerUnit: 2154, cbm: 4.762 },
  { id: "보현석재", actualShipperName: "보현석재", shipperName: "N/ANS LOGISTICS /", cargoType: "PL", width: 180, length: 90, height: 27, quantity: 4, weightPerUnit: 2310, cbm: 4.041 },
  { id: "에이제이테크", actualShipperName: "에이제이테크", shipperName: "위너스해운항공  /", cargoType: "WB", width: 128, length: 48, height: 74, quantity: 1, weightPerUnit: 500, cbm: 0.455 },
  { id: "카페봄봄", actualShipperName: "카페봄봄", shipperName: "세방익스프레스(주)/찬의 /", cargoType: "PL", width: 132, length: 120, height: 190, quantity: 1, weightPerUnit: 422, cbm: 3.01 },
  { id: "EXCELERATE ENERGY", actualShipperName: "EXCELERATE ENERGY", shipperName: "스카이로드 /", cargoType: "WB", width: 163, length: 107, height: 67, quantity: 4, weightPerUnit: 2707, cbm: 4.674 },
  { id: "VISCOSMO", actualShipperName: "VISCOSMO", shipperName: "N/VISCOSMO /", cargoType: "PL", width: 110, length: 110, height: 95, quantity: 1, weightPerUnit: 310, cbm: 1.0 },
  { id: "더블유티 스프레이", actualShipperName: "더블유티 스프레이", shipperName: "동서로지스틱스 /", cargoType: "PL", width: 81, length: 77, height: 144, quantity: 5, weightPerUnit: 550, cbm: 4.001 },
  { id: "리만", actualShipperName: "리만", shipperName: "(주)이넥스해운항공 /", cargoType: "CT", width: 110, length: 110, height: 81, quantity: 1, weightPerUnit: 92, cbm: 0.98 },
  { id: "대한정밀공업", actualShipperName: "대한정밀공업", shipperName: "N/대한정밀공업 /", cargoType: "PL", width: 110, length: 110, height: 100, quantity: 1, weightPerUnit: 585.9, cbm: 1.21 },
  { id: "선진뷰티사이언스", actualShipperName: "선진뷰티사이언스", shipperName: "태웅로직스 /", cargoType: "PL", width: 115, length: 115, height: 112, quantity: 1, weightPerUnit: 760, cbm: 1.481 },
  { id: "SUNGBO INDUSTRIA", actualShipperName: "SUNGBO INDUSTRIA", shipperName: "FCA N/성보인터내셔널 /", cargoType: "WC", width: 100, length: 100, height: 50, quantity: 3, weightPerUnit: 2000, cbm: 1.44 },
  { id: "제일기공", actualShipperName: "제일기공", shipperName: "이도 이솔 /", cargoType: "PL", width: 366, length: 95, height: 103, quantity: 1, weightPerUnit: 632, cbm: 3.581 },
  { id: "웨스코", actualShipperName: "웨스코", shipperName: "제이에스항공해운  /", cargoType: "PL", width: 105, length: 220, height: 200, quantity: 2, weightPerUnit: 1848, cbm: 8.9 },
  { id: "디에스콘", actualShipperName: "디에스콘", shipperName: "태웅로직스 /", cargoType: "CT", width: 80, length: 60, height: 50, quantity: 3, weightPerUnit: 1200, cbm: 1.0 },
  { id: "티케이테크", actualShipperName: "티케이테크", shipperName: "태웅로직스 /", cargoType: "CT", width: 225, length: 134, height: 62, quantity: 1, weightPerUnit: 710, cbm: 1.869 },
  { id: "AWOT", actualShipperName: "AWOT", shipperName: "N/AWOT  /", cargoType: "PL", width: 113, length: 110, height: 176, quantity: 2, weightPerUnit: 1324, cbm: 4.375 },
  { id: "대원산업", actualShipperName: "대원산업", shipperName: "N/OEC /", cargoType: "PL", width: 120, length: 100, height: 145, quantity: 1, weightPerUnit: 486, cbm: 1.74 },
  { id: "씨에스에프", actualShipperName: "씨에스에프", shipperName: "N/OEC /", cargoType: "PL", width: 110, length: 110, height: 170, quantity: 3, weightPerUnit: 1898, cbm: 6.21 },
  { id: "HD현대건설기계", actualShipperName: "HD현대건설기계", shipperName: "EXW N/현대인프라코어  /", cargoType: "CT", width: 113, length: 85, height: 46, quantity: 3, weightPerUnit: 445, cbm: 2.326 },
  { id: "포컴퍼니", actualShipperName: "포컴퍼니", shipperName: "N/포컴퍼니 /", cargoType: "PL", width: 110, length: 110, height: 96, quantity: 6, weightPerUnit: 1828, cbm: 8.434 },
];

const baseRemark = { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false };
const all = CARGOES.map((c, i) => ({
  ...c,
  shipmentId: "verify",
  sortOrder: i,
  remarks: { ...baseRemark },
}));

const FORTY = new Set([
  "메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄",
  "EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업",
  "선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크",
]);
const TWENTY = new Set(["AWOT","대원산업","씨에스에프","HD현대건설기계","포컴퍼니"]);

const g40 = all.filter((c) => FORTY.has(c.actualShipperName));
const g20 = all.filter((c) => TWENTY.has(c.actualShipperName));

console.log(`40FT 그룹: ${g40.length} 화물 / 20FT 그룹: ${g20.length} 화물`);
console.log(`total expanded units (40FT) = ${g40.reduce((s,c)=>s+c.quantity,0)}`);
console.log(`total expanded units (20FT) = ${g20.reduce((s,c)=>s+c.quantity,0)}`);

function summarize(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`컨테이너 ${result.containers.length}대 (20FT ${result.summary.count20FT}, 40FT ${result.summary.count40FT})`);
  for (const c of result.containers) {
    const usedY = Math.max(0, ...c.rows.map(r => r.yEnd));
    const placed = c.rows.reduce((s,r) => s + r.bottomItems.length + r.topItems.length, 0);
    const bottoms = c.rows.reduce((s,r) => s + r.bottomItems.length, 0);
    const tops = c.rows.reduce((s,r) => s + r.topItems.length, 0);
    console.log(`  #${c.index} ${c.spec.type}: rows=${c.rows.length} placed=${placed} (b=${bottoms}, t=${tops}) usedL=${usedY}/${c.spec.innerLength} fillRate=${c.cbmFillRate.toFixed(1)}% W=${c.totalWeight.toFixed(0)}kg/${c.spec.maxWeightKg} visualCbm=${c.totalCbm.toFixed(2)} ctCbm=${c.ctCbm.toFixed(2)}`);
  }
  const totalUnp = result.unplaced.reduce((s,u) => s + (u.quantity ?? 1), 0);
  console.log(`unplaced: ${result.unplaced.length}종 / ${totalUnp} unit`);
  for (const u of result.unplaced) {
    console.log(`  - [${u.group}] ${u.cargoType} ${u.shipper ?? ""} ${u.width}×${u.length}×${u.height} qty=${u.quantity} unfit=${u.unfitCbm?.toFixed?.(3) ?? "?"} m³ — ${u.reason}`);
  }
  if (result.summary.warnings && result.summary.warnings.length) {
    console.log(`warnings:`);
    for (const w of result.summary.warnings) console.log(`  - ${w}`);
  }
}

const r40 = pack(g40, "40ft_only");
summarize("40FT only — 17 화주", r40);

const r20 = pack(g20, "20ft_only");
summarize("20FT only — 5 화주", r20);

console.log("\n=== 종합 ===");
console.log(`40FT: ${r40.containers.length}대 사용 (사용자 분배 의도: 1대) ${r40.containers.length === 1 ? "✅" : "❌"}, unplaced ${r40.unplaced.length}종`);
console.log(`20FT: ${r20.containers.length}대 사용 (사용자 분배 의도: 1대) ${r20.containers.length === 1 ? "✅" : "❌"}, unplaced ${r20.unplaced.length}종`);
