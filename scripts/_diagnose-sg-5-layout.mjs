/* 5ST SG — 컨테이너 안 적재배치도 결과 정확 측정.
 * production packBest 호출 (기본 경로) + strict visual 모드 비교.
 * 각 cargo 가 박스 그림 트랙으로 배치되는지 / 부피 합산 트랙으로 가는지 / 미배치인지 확인.
 */
import fs from "node:fs";
const { packBest, CONTAINER_SOFT_OVERFLOW_RATIO } = await import("../lib/packing/algorithm.ts");
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
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
    remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, bottomOnly: r.bottomOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
    itemRemark: r.itemRemark ?? "",
  }));
}

function classifyCargoTracks(result, cargoes) {
  const visualCargoIds = new Set();
  const bulkCargoIds = new Set();
  const unplacedCargoIds = new Set();
  for (const c of result.containers) {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) visualCargoIds.add(it.cargoId);
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) bulkCargoIds.add(b.cargoId);
    }
  }
  for (const u of result.unplaced) {
    if (u.cargoId) unplacedCargoIds.add(u.cargoId);
  }
  // 박스 그림에 들어간 cargoId 별 unit 수 (rows 안)
  const visualUnitCount = new Map();
  for (const c of result.containers) {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          visualUnitCount.set(it.cargoId, (visualUnitCount.get(it.cargoId) ?? 0) + 1);
        }
      }
    }
  }
  return { visualCargoIds, bulkCargoIds, unplacedCargoIds, visualUnitCount };
}

const SAMPLE = { id: "sg-5", file: "data/samples/singapore-total-5.json" };
const rows = JSON.parse(fs.readFileSync(SAMPLE.file, "utf8")).rows;
const cargoes = build(rows, SAMPLE.id);

console.log("# 5ST SG — 컨테이너 안 적재배치도 결과 정확 측정");
console.log(`date: ${new Date().toISOString()}`);
console.log(`총 cargo: ${cargoes.length}`);
console.log("");

// 1) 운영 호출 (packBest 기본 - 8 정렬 전략 매트릭스, strictVisualClassification 안 켬)
console.log("## A. 기본 운영 호출 (packBest, strictVisualClassification 안 켬)");
const t1 = Date.now();
const r1 = packBest(cargoes, "auto");
const dt1 = (Date.now() - t1) / 1000;
const c1 = classifyCargoTracks(r1, cargoes);
const audit1 = strictStackAudit(r1);
console.log(`- 컨 셋: ${r1.containers.map((c) => c.spec.type).join("+")}`);
console.log(`- 미배치: ${r1.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0)} unit (${c1.unplacedCargoIds.size} cargo)`);
console.log(`- 박스 그림 트랙 (적재배치도에 그려지는 cargo): ${c1.visualCargoIds.size} 개`);
console.log(`- 부피 합산 트랙 (그림 없이 부피만 더해 처리): ${c1.bulkCargoIds.size} 개`);
console.log(`- audit pass: ${audit1.pass ? "PASS" : "FAIL"}`);
console.log(`- 잔여 CBM 합산 (각 컨 maxCbm + softCap):`);
for (let ci = 0; ci < r1.containers.length; ci++) {
  const c = r1.containers[ci];
  const used = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
  const softCap = c.spec.maxCbm * SOFT;
  console.log(`    컨${ci + 1} ${c.spec.type}: 사용 ${used.toFixed(2)} / 정원 ${c.spec.maxCbm} (softCap ${softCap.toFixed(2)})`);
}
console.log(`- pack 시간: ${dt1.toFixed(1)}s`);
console.log("");

// 사이즈 있는 cargo 중 부피 합산 트랙으로 간 것
const sizedToBulk = [];
for (const cg of cargoes) {
  const hasMainSize = cg.width >= 1 && cg.length >= 1 && cg.height >= 1;
  const hasUnitSizes = cg.unitSizes && cg.unitSizes.length > 0 && cg.unitSizes.every((u) => u.width >= 1 && u.length >= 1 && u.height >= 1);
  if ((hasMainSize || hasUnitSizes) && c1.bulkCargoIds.has(cg.id)) {
    sizedToBulk.push(cg);
  }
}
if (sizedToBulk.length > 0) {
  console.log(`## ⚠ 사이즈 있는데 부피 합산 트랙 (적재배치도 안 그림) 으로 간 cargo: ${sizedToBulk.length} 개`);
  for (const cg of sizedToBulk.slice(0, 10)) {
    console.log(`    ${cg.id}: ${cg.width}×${cg.length}×${cg.height}×${cg.quantity} ${cg.actualShipperName || "?"} (사용자 룰 #4 위반 후보)`);
  }
}
console.log("");

// 2) strict visual 호출
console.log("## B. 진단 호출 (packBest + strictVisualClassification=true)");
const t2 = Date.now();
const r2 = packBest(cargoes, "auto", { strictVisualClassification: true });
const dt2 = (Date.now() - t2) / 1000;
const c2 = classifyCargoTracks(r2, cargoes);
const audit2 = strictStackAudit(r2);
console.log(`- 컨 셋: ${r2.containers.map((c) => c.spec.type).join("+")}`);
console.log(`- 미배치: ${r2.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0)} unit (${c2.unplacedCargoIds.size} cargo)`);
console.log(`- 박스 그림 트랙 (적재배치도에 그려지는 cargo): ${c2.visualCargoIds.size} 개`);
console.log(`- 부피 합산 트랙 (그림 없이 부피만 더해 처리): ${c2.bulkCargoIds.size} 개`);
console.log(`- audit pass: ${audit2.pass ? "PASS" : "FAIL"}`);
if (c2.unplacedCargoIds.size > 0) {
  console.log(`- 미배치 cargo:`);
  for (const cid of c2.unplacedCargoIds) {
    const cg = cargoes.find((c) => c.id === cid);
    if (cg) console.log(`    ${cid}: ${cg.width}×${cg.length}×${cg.height}×${cg.quantity} ${cg.actualShipperName || "?"}`);
  }
}
console.log(`- pack 시간: ${dt2.toFixed(1)}s`);
