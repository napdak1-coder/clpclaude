/**
 * 5 샘플 화물 밀도 분포 분석 → 삼원절연 무게 추정
 *
 * 1) 모든 행 중 (W>0, L>0, H>0, 무게>0) 인 행 추출 (PL/PK 위주, 사이즈+무게 둘 다 있는 것).
 * 2) 부피(m³) 당 무게(kg/m³) = 밀도 계산. unitSizes 가 있으면 unit 별로.
 * 3) 분포: 평균, 중앙값, 백분위(25/50/75/90), 최소·최대.
 * 4) 화주별 / cargoType별 그룹 평균.
 * 5) 삼원절연 부피 합 × 추정 밀도 = 추정 무게 보고.
 */
import fs from "node:fs";
import path from "node:path";

const SAMPLES = [
  { label: "1ST SG", json: "data/samples/singapore-total.json" },
  { label: "2ST SG", json: "data/samples/singapore-total-2.json" },
  { label: "2ST HM", json: "data/samples/hochiminh-total-2.json" },
  { label: "3ST SG", json: "data/samples/singapore-total-3.json" },
];

const obs = []; // {sample, shipper, cargoType, w, l, h, weight, density}

for (const s of SAMPLES) {
  const abs = path.resolve(s.json);
  if (!fs.existsSync(abs)) {
    console.log(`skip ${s.label} (파일 없음)`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  for (const r of data.rows) {
    const shipper = r.actualShipperName ?? "";
    const cargoType = r.cargoType ?? "PL";
    const wpu = r.weightPerUnitKg ?? 0;
    // 행 단위 (대표 사이즈)
    if ((r.widthCm ?? 0) > 0 && (r.lengthCm ?? 0) > 0 && (r.heightCm ?? 0) > 0 && wpu > 0) {
      const vol = (r.widthCm * r.lengthCm * r.heightCm) / 1_000_000; // m³
      obs.push({ sample: s.label, shipper, cargoType, w: r.widthCm, l: r.lengthCm, h: r.heightCm, weight: wpu, density: wpu / vol });
    }
    // unitSizes 가 있으면 unit 별로 추가 (행 단위와 중복될 수 있어 별도 표기)
    if (Array.isArray(r.unitSizes)) {
      for (const u of r.unitSizes) {
        if ((u.width ?? 0) > 0 && (u.length ?? 0) > 0 && (u.height ?? 0) > 0 && (u.weight ?? 0) > 0) {
          const vol = (u.width * u.length * u.height) / 1_000_000;
          obs.push({ sample: s.label, shipper, cargoType, w: u.width, l: u.length, h: u.height, weight: u.weight, density: u.weight / vol, isUnit: true });
        }
      }
    }
  }
}

console.log(`=== 무게+사이즈 둘 다 있는 ${obs.length} 케이스 추출 ===\n`);

const dens = obs.map((o) => o.density).sort((a, b) => a - b);
const sum = dens.reduce((s, x) => s + x, 0);
const mean = sum / dens.length;
const pct = (q) => dens[Math.floor((dens.length - 1) * q)];
const median = pct(0.5);

console.log("--- 전체 밀도 분포 (kg/m³) ---");
console.log(`샘플 수: ${dens.length}`);
console.log(`평균   : ${mean.toFixed(0)}`);
console.log(`중앙값 : ${median.toFixed(0)}`);
console.log(`P25    : ${pct(0.25).toFixed(0)}`);
console.log(`P75    : ${pct(0.75).toFixed(0)}`);
console.log(`P90    : ${pct(0.9).toFixed(0)}`);
console.log(`최소   : ${pct(0).toFixed(0)}`);
console.log(`최대   : ${pct(0.99).toFixed(0)}`);

// cargoType별
console.log("\n--- cargoType별 평균 밀도 ---");
const byType = new Map();
for (const o of obs) {
  if (!byType.has(o.cargoType)) byType.set(o.cargoType, []);
  byType.get(o.cargoType).push(o.density);
}
for (const [t, arr] of byType) {
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  console.log(`  ${t}: ${arr.length} 케이스, 평균 ${m.toFixed(0)} kg/m³, 중앙값 ${arr.sort((a,b)=>a-b)[Math.floor(arr.length/2)].toFixed(0)}`);
}

// 삼원절연 같은 화주 있나?
console.log("\n--- 삼원절연 (또는 비슷한 화주) 검색 ---");
const samwon = obs.filter((o) => o.shipper.includes("삼원") || o.shipper.includes("절연"));
if (samwon.length === 0) {
  console.log("  없음 (다른 샘플에 삼원절연 행 없거나 무게 0)");
} else {
  for (const o of samwon) {
    console.log(`  [${o.sample}] ${o.shipper} ${o.w}×${o.l}×${o.h} 무게 ${o.weight}kg → 밀도 ${o.density.toFixed(0)} kg/m³`);
  }
}

// 삼원절연 unitSizes 적용
const SAMWON = {
  unitSizes: [
    { w: 116, l: 55, h: 74 },
    { w: 116, l: 55, h: 74 },
    { w: 116, l: 55, h: 74 },
    { w: 116, l: 55, h: 74 },
    { w: 110, l: 110, h: 143 },
    { w: 110, l: 110, h: 143 },
  ],
  cbm: 9.34,
};

console.log("\n--- 삼원절연 부피 ---");
let totalVol = 0;
for (const u of SAMWON.unitSizes) {
  const vol = (u.w * u.l * u.h) / 1_000_000;
  console.log(`  ${u.w}×${u.l}×${u.h} = ${vol.toFixed(3)} m³`);
  totalVol += vol;
}
console.log(`합계 부피 (사이즈 기준): ${totalVol.toFixed(3)} m³`);
console.log(`엑셀 cfs cbm           : ${SAMWON.cbm} m³`);

console.log("\n--- 삼원절연 무게 추정치 ---");
const estByMean = totalVol * mean;
const estByMedian = totalVol * median;
const estByP25 = totalVol * pct(0.25);
const estByP75 = totalVol * pct(0.75);
console.log(`전체 평균 밀도(${mean.toFixed(0)}) × 부피 = ${estByMean.toFixed(0)} kg`);
console.log(`전체 중앙값(${median.toFixed(0)}) × 부피 = ${estByMedian.toFixed(0)} kg`);
console.log(`P25(${pct(0.25).toFixed(0)}) × 부피 = ${estByP25.toFixed(0)} kg (가벼운 가정)`);
console.log(`P75(${pct(0.75).toFixed(0)}) × 부피 = ${estByP75.toFixed(0)} kg (무거운 가정)`);

// PL 만 따로
const plDens = obs.filter((o) => o.cargoType === "PL").map((o) => o.density).sort((a, b) => a - b);
if (plDens.length > 0) {
  const plMean = plDens.reduce((s, x) => s + x, 0) / plDens.length;
  const plMed = plDens[Math.floor(plDens.length / 2)];
  console.log(`\n--- PL 만 ---`);
  console.log(`PL 평균(${plMean.toFixed(0)}) × 부피 = ${(totalVol * plMean).toFixed(0)} kg`);
  console.log(`PL 중앙값(${plMed.toFixed(0)}) × 부피 = ${(totalVol * plMed).toFixed(0)} kg`);
}

// per-unit 추정 (각 박스별)
console.log("\n--- 박스별 추정 (PL 중앙값 기준) ---");
const useDensity = plDens.length > 0 ? plDens[Math.floor(plDens.length / 2)] : median;
console.log(`사용 밀도: ${useDensity.toFixed(0)} kg/m³`);
for (const u of SAMWON.unitSizes) {
  const vol = (u.w * u.l * u.h) / 1_000_000;
  const w = vol * useDensity;
  console.log(`  ${u.w}×${u.l}×${u.h} (${vol.toFixed(3)} m³) → 약 ${w.toFixed(0)} kg`);
}
