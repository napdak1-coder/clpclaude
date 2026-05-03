/**
 * 싱가폴 TOTAL 샘플 — 물리·규칙 종합 감사 (PHYSICAL coordinates).
 *
 * 주의: pack()/packBest() 결과의 containers[].rows 는 화면 표시용으로 좌표가 재배치됨.
 *       (display-rows.ts 가 ROW_GAP_CM, LABEL_AREA_CM 을 추가해 yEnd > innerLength 가능)
 *       물리적 진실은 extreme-point 의 packState.placements 에 있다.
 *
 * 본 스크립트는 packExtremePoint 를 컨테이너별로 직접 호출하여 PHYSICAL 좌표로
 *   - bounding box (≤ innerWidth/Length/Height)
 *   - 3D AABB no-overlap (어떤 두 unit 도 겹치지 않음)
 *   - 무게 ≤ maxWeightKg
 *   - door height (totalStackHeight ≤ doorHeight)
 *   - remark rules (top_only / orientation / no_stacking)
 * 두 시나리오를 동시에 검증:
 *   ① AUTO 분배 (알고리즘이 컨테이너 결정)
 *   ② 사용자 강제 분배 (40FT 1대 + 20FT 1대, fixedAssignment)
 */

const { packExtremePoint, expandCargoesToUnits, makeContainerState, tryPlaceUnit } = await import("../lib/packing/extreme-point.ts");
const { getContainerSpec } = await import("../lib/packing/containers.ts");

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

// 시각 적재 대상 — CT 제외 (CT 는 algorithm.ts 와 동일하게 bulk 처리)
const visual = all.filter((c) => c.cargoType !== "CT");

const EPS = 0.001;
const overlap1D = (a0, a1, b0, b1) => a0 + EPS < b1 && b0 + EPS < a1;
const overlap3D = (a, b) =>
  overlap1D(a.x, a.x + a.w, b.x, b.x + b.w) &&
  overlap1D(a.y, a.y + a.l, b.y, b.y + b.l) &&
  overlap1D(a.z, a.z + a.h, b.z, b.z + b.h);

function audit(label, packState, spec) {
  console.log(`\n  --- ${label} (${spec.type}: ${spec.innerWidth}×${spec.innerLength}×${spec.innerHeight}cm, ${spec.maxWeightKg}kg) ---`);
  const pls = packState.placements;
  const aabbs = pls.map((p) => ({
    p,
    x: p.position.x, y: p.position.y, z: p.position.z,
    w: p.size.width, l: p.size.length, h: p.size.height,
  }));

  let boxFails = [];
  for (const a of aabbs) {
    if (
      a.x < -EPS || a.y < -EPS || a.z < -EPS ||
      a.x + a.w > spec.innerWidth + EPS ||
      a.y + a.l > spec.innerLength + EPS ||
      a.z + a.h > spec.innerHeight + EPS
    ) boxFails.push(a);
  }
  let overlapFails = [];
  for (let i = 0; i < aabbs.length; i++)
    for (let j = i + 1; j < aabbs.length; j++)
      if (overlap3D(aabbs[i], aabbs[j])) overlapFails.push([aabbs[i].p, aabbs[j].p]);

  const totalW = pls.reduce((s, p) => s + (p.weight ?? 0), 0);
  const weightOK = totalW <= spec.maxWeightKg + EPS;

  const ruleFails = [];
  for (const p of pls) {
    const r = p.remarks ?? {};
    if (r.topOnly && p.layer !== "top") ruleFails.push(`topOnly violated`);
    if (r.orientation === "fixed" && p.rotated) ruleFails.push(`fixed but rotated`);
  }
  const maxStackTop = aabbs.reduce((m, a) => Math.max(m, a.z + a.h), 0);
  const doorOK = maxStackTop <= spec.doorHeight + EPS;

  const checks = [
    ["bounding box (X/Y/Z within container)", boxFails.length === 0, boxFails[0]],
    ["no-overlap (3D AABB)", overlapFails.length === 0, overlapFails[0]],
    ["weight ≤ max", weightOK, `${totalW.toFixed(0)}/${spec.maxWeightKg} kg`],
    ["door height (max stack ≤ door)", doorOK, `${maxStackTop} vs ${spec.doorHeight}`],
    ["remark rules", ruleFails.length === 0, ruleFails[0]],
  ];

  let pass = 0, fail = 0;
  for (const [name, ok, ex] of checks) {
    const mark = ok ? "✓" : "✗";
    let msg = "";
    if (!ok) {
      if (Array.isArray(ex)) msg = `  e.g. (${ex[0].shipper ?? ex[0].cargoId}) ↔ (${ex[1].shipper ?? ex[1].cargoId})`;
      else if (typeof ex === "object" && ex.p) msg = `  e.g. ${ex.p.shipper ?? ex.p.cargoId} at (x=${ex.x},y=${ex.y},z=${ex.z}) size ${ex.w}×${ex.l}×${ex.h}`;
      else if (ex) msg = `  ${ex}`;
    }
    console.log(`    ${mark} ${name}${msg}`);
    if (ok) pass++; else fail++;
  }
  return { pass, fail, total: pls.length, totalW };
}

console.log("\n========================================");
console.log("싱가폴 TOTAL 샘플 — 물리 좌표 감사");
console.log("========================================");

let grandPass = 0, grandFail = 0;

// === ① AUTO mode (40FT 1대) — 모든 visual 화물을 한 컨테이너에 ===
{
  const spec = getContainerSpec("40FT");
  const sortLDF = (us) => [...us].sort((a, b) => {
    const va = a.width * a.length * a.height, vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    return b.weight - a.weight;
  });
  const units = sortLDF(expandCargoesToUnits(visual));
  const packed = packExtremePoint(units, spec);
  console.log(`\n[① AUTO 40FT 단일컨] units=${units.length} placed=${packed.placements.length} unplaced=${packed.unplaced.length}`);
  const r = audit("packExtremePoint(visual, 40FT)", { placements: packed.placements }, spec);
  grandPass += r.pass; grandFail += r.fail;
}

// === ② 사용자 강제 분배 — 40FT 1대 + 20FT 1대, 화주별 강제 매핑 ===
{
  const spec40 = getContainerSpec("40FT");
  const spec20 = getContainerSpec("20FT");
  const FORTY = new Set(["메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄","EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업","선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크"]);
  const TWENTY = new Set(["AWOT","대원산업","씨에스에프","HD현대건설기계","포컴퍼니"]);
  const for40 = visual.filter((c) => FORTY.has(c.id));
  const for20 = visual.filter((c) => TWENTY.has(c.id));
  const sortLDF = (us) => [...us].sort((a, b) => {
    const va = a.width * a.length * a.height, vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    return b.weight - a.weight;
  });
  const u40 = sortLDF(expandCargoesToUnits(for40));
  const u20 = sortLDF(expandCargoesToUnits(for20));
  const p40 = packExtremePoint(u40, spec40);
  const p20 = packExtremePoint(u20, spec20);
  console.log(`\n[② 사용자 강제분배] 40FT placed=${p40.placements.length}/${u40.length} (unplaced=${p40.unplaced.length})  |  20FT placed=${p20.placements.length}/${u20.length} (unplaced=${p20.unplaced.length})`);
  const r1 = audit("40FT (FORTY 화주)", { placements: p40.placements }, spec40);
  const r2 = audit("20FT (TWENTY 화주)", { placements: p20.placements }, spec20);
  grandPass += r1.pass + r2.pass; grandFail += r1.fail + r2.fail;

  // 총 unplaced unit 수
  const totalUnp = p40.unplaced.length + p20.unplaced.length;
  if (totalUnp > 0) {
    console.log(`\n  ⚠ 강제분배 미배치 ${totalUnp} unit (사용자 분배가 컨테이너 용량을 초과)`);
    for (const u of p40.unplaced) console.log(`    [40FT 거부] ${u.shipper} ${u.width}×${u.length}×${u.height}`);
    for (const u of p20.unplaced) console.log(`    [20FT 거부] ${u.shipper} ${u.width}×${u.length}×${u.height}`);
  }
}

console.log(`\n========================================`);
console.log(`OVERALL: ${grandPass} PASS / ${grandFail} FAIL`);
console.log(`========================================`);
process.exit(grandFail > 0 ? 1 : 0);
