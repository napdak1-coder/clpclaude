/**
 * 사용자 강제 분배 모드 검증 — fixedContainers + fixedAssignment 사용.
 * verify-user-split.mjs 의 데이터 재활용. 한 번 pack 호출로 두 컨테이너 모두 시뮬.
 */

const { packBest } = await import("../lib/packing/algorithm.ts");

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
const all = CARGOES.map((c, i) => ({ ...c, shipmentId: "verify", sortOrder: i, remarks: { ...baseRemark } }));

const FORTY = ["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"];
const TWENTY = ["AWOT","대원산업","씨에스에프","HD현대건설기계","포컴퍼니"];

// fixedAssignment: 화주 → 컨테이너 인덱스 (#1=40FT, #2=20FT)
const fixedAssignment = {};
for (const id of FORTY) fixedAssignment[id] = 1;
for (const id of TWENTY) fixedAssignment[id] = 2;

const result = packBest(all, "auto", {
  fixedContainers: ["40FT", "20FT"],
  fixedAssignment,
});

console.log("=== 사용자 강제 분배 시뮬레이션 (fixedContainers + fixedAssignment) ===");
for (const c of result.containers) {
  const usedY = Math.max(0, ...c.rows.map(r => r.yEnd));
  const placed = c.rows.reduce((s, r) => s + r.bottomItems.length + r.topItems.length, 0);
  const bottoms = c.rows.reduce((s, r) => s + r.bottomItems.length, 0);
  const tops = c.rows.reduce((s, r) => s + r.topItems.length, 0);
  console.log(`#${c.index} ${c.spec.type}: rows=${c.rows.length} placed=${placed} (b=${bottoms}, t=${tops}) usedL=${usedY}/${c.spec.innerLength} fillRate=${c.cbmFillRate.toFixed(1)}% W=${c.totalWeight.toFixed(0)}kg/${c.spec.maxWeightKg} visualCbm=${c.totalCbm.toFixed(2)} ctCbm=${c.ctCbm.toFixed(2)}`);
}
const totalUnp = result.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
console.log(`\nunplaced: ${result.unplaced.length}종 / ${totalUnp} unit`);
for (const u of result.unplaced) {
  console.log(`  - [${u.group}] ${u.cargoType} ${u.shipper ?? ""} ${u.width}×${u.length}×${u.height} qty=${u.quantity} unfit=${u.unfitCbm?.toFixed?.(3) ?? "?"} m³`);
}
if (result.summary.warnings && result.summary.warnings.length) {
  console.log(`\nwarnings:`);
  for (const w of result.summary.warnings) console.log(`  - ${w}`);
}
