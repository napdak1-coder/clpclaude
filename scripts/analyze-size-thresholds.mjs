/**
 * 4 샘플(1ST SG, 2ST SG, 1ST HM, 2ST HM)의 실무자 분배에서
 * "큰 화물" 기준 도출용 통계.
 *
 * 각 샘플:
 *  - 40FT 들어간 화물 vs 20FT 들어간 화물 분리
 *  - CBM(about) / 무게 합 / 화주 별 통계
 *  - 임계값 후보 (4, 5, 6, 7, 8 m³ 와 1.5, 2, 2.5, 3 t) 적용 시 분류 정확도
 */
import fs from "node:fs";
import path from "node:path";

const SAMPLES = [
  { key: "singapore-total",   label: "1ST SG", containers: { "40FT": 1, "20FT": 1 } },
  { key: "singapore-total-2", label: "2ST SG", containers: { "40FT": 2, "20FT": 0 } },
  { key: "hochiminh-total",   label: "1ST HM", containers: { "40FT": 1, "20FT": 1 } },
  { key: "hochiminh-total-2", label: "2ST HM", containers: { "40FT": 2, "20FT": 1 } },
];

// 실무자 expected distribution — 각 화주가 어느 사이즈 컨테이너에 들어갔는지
// 화주 → "40FT" or "20FT"
function loadExpected(sampleKey, rows) {
  if (sampleKey === "singapore-total") {
    const c40 = new Set([
      "메가젠임플란트","데코론","YKMC","보현석재","에이제이테크","카페봄봄",
      "EXCELERATE ENERGY","VISCOSMO","더블유티 스프레이","리만","대한정밀공업",
      "선진뷰티사이언스","SUNGBO INDUSTRIA","제일기공","웨스코","디에스콘","티케이테크",
    ]);
    const c20 = new Set(["AWOT","대원산업","씨에스에프","HD현대건설기계","포컴퍼니"]);
    return rows.map((r) => c20.has(r.actualShipperName) ? "20FT" : c40.has(r.actualShipperName) ? "40FT" : "?");
  }
  if (sampleKey === "singapore-total-2") {
    // 2 컨 모두 40FT — 모든 화물 40FT
    return rows.map(() => "40FT");
  }
  if (sampleKey === "hochiminh-total") {
    // verify-hm-total.mjs 는 index 기준 — 첫 24 행 = 40FT, 다음 10 행 = 20FT
    return rows.map((_, i) => (i < 24 ? "40FT" : "20FT"));
  }
  if (sampleKey === "hochiminh-total-2") {
    const c40_1 = new Set(["AMS","한국쎄미텍","유라","KIOSKIN","전영사","SD KOREA","SJIT","일라","SJI","KFTS","한성엔터프라이즈","이구산업","케이티엔테크놀러지"]);
    const c40_2 = new Set(["제임스텍","중앙바이오텍","리브유","파인 파인비나","블루오션","파인비나","장안어패럴","디씨이메탈","스톰테크"]);
    const c20 = new Set(["효성","로제화장품","삼원절연","화인써키트"]);
    return rows.map((r) =>
      c20.has(r.actualShipperName) ? "20FT" :
      (c40_1.has(r.actualShipperName) || c40_2.has(r.actualShipperName)) ? "40FT" : "?",
    );
  }
  return rows.map(() => "?");
}

// 화물 한 행의 weight 합
function rowWeight(r) {
  const wPer = r.weightPerUnitKg ?? 0;
  return wPer * (r.quantity ?? 1);
}

// 통계 출력
function summary(label, rows) {
  if (rows.length === 0) {
    console.log(`  ${label}: 없음`);
    return;
  }
  const cbms = rows.map((r) => r.aboutCbm ?? r.cbm ?? 0);
  const wts = rows.map(rowWeight);
  const cbmSum = cbms.reduce((s, x) => s + x, 0);
  const wtSum = wts.reduce((s, x) => s + x, 0);
  cbms.sort((a, b) => a - b);
  wts.sort((a, b) => a - b);
  const med = (arr) => arr.length === 0 ? 0 : arr[Math.floor(arr.length / 2)];
  const max = (arr) => arr.length === 0 ? 0 : arr[arr.length - 1];
  const min = (arr) => arr.length === 0 ? 0 : arr[0];
  console.log(
    `  ${label} (${rows.length}행, 합 ${cbmSum.toFixed(1)}m³ ${(wtSum/1000).toFixed(1)}t)\n` +
    `    CBM  min=${min(cbms).toFixed(2)} med=${med(cbms).toFixed(2)} max=${max(cbms).toFixed(2)}\n` +
    `    무게 min=${(min(wts)/1000).toFixed(2)} med=${(med(wts)/1000).toFixed(2)} max=${(max(wts)/1000).toFixed(2)} (단위:t)`,
  );
}

console.log("=== 샘플별 실무자 분배 통계 ===\n");

const allBig = []; // 40FT 들어간 화물 모음
const allSmall = []; // 20FT 들어간 화물 모음

for (const s of SAMPLES) {
  const file = path.resolve(`data/samples/${s.key}.json`);
  if (!fs.existsSync(file)) {
    console.log(`(${s.label}: ${s.key}.json 없음 — 스킵)`);
    continue;
  }
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const expected = loadExpected(s.key, d.rows);

  const c40 = [];
  const c20 = [];
  const unknown = [];
  d.rows.forEach((r, i) => {
    const tgt = expected[i];
    if (tgt === "40FT") c40.push(r);
    else if (tgt === "20FT") c20.push(r);
    else unknown.push(r);
  });

  console.log(`■ ${s.label} (${s.key}, ${d.rows.length}행, 컨: ${Object.entries(s.containers).filter(([k,v])=>v>0).map(([k,v])=>`${v}×${k}`).join(" + ")})`);
  summary("40FT 들어간 화물", c40);
  summary("20FT 들어간 화물", c20);
  if (unknown.length > 0) summary("미분류", unknown);
  console.log("");

  if (s.containers["20FT"] > 0) {
    // 혼종 컨테이너 셋만 임계값 분석에 사용 (40FT 만 있는 2ST SG 는 제외)
    allBig.push(...c40);
    allSmall.push(...c20);
  }
}

console.log("\n=== 임계값 분석 (혼종 컨 샘플 3개 통합: 1ST SG, 1ST HM, 2ST HM) ===");
console.log(`40FT 들어간 화물: ${allBig.length}건`);
console.log(`20FT 들어간 화물: ${allSmall.length}건\n`);

// 후보 임계값
const cbmThresholds = [3, 4, 5, 6, 7, 8];
const wtThresholds = [1500, 2000, 2500, 3000, 3500];

console.log("CBM 임계값별 — '큰 화물(CBM ≥ T)' 분류 적합도");
console.log("(% 40FT는 = 40FT에서 큰 화물 비율, % 20FT는 = 20FT에서 큰 화물 잘못된 비율)");
for (const t of cbmThresholds) {
  const big40 = allBig.filter((r) => (r.aboutCbm ?? r.cbm ?? 0) >= t).length;
  const big20 = allSmall.filter((r) => (r.aboutCbm ?? r.cbm ?? 0) >= t).length;
  const pct40 = (big40 / allBig.length * 100).toFixed(0);
  const pct20Wrong = (big20 / Math.max(1, allSmall.length) * 100).toFixed(0);
  console.log(`  CBM ≥ ${t}m³ : 40FT 큰 ${big40}/${allBig.length}(${pct40}%), 20FT 큰 ${big20}/${allSmall.length}(${pct20Wrong}%) [낮을수록 좋음]`);
}

console.log("\n무게 임계값별 — '무거운 화물(weight ≥ T)' 분류 적합도");
for (const t of wtThresholds) {
  const big40 = allBig.filter((r) => rowWeight(r) >= t).length;
  const big20 = allSmall.filter((r) => rowWeight(r) >= t).length;
  const pct40 = (big40 / allBig.length * 100).toFixed(0);
  const pct20Wrong = (big20 / Math.max(1, allSmall.length) * 100).toFixed(0);
  console.log(`  무게 ≥ ${t}kg : 40FT 무거 ${big40}/${allBig.length}(${pct40}%), 20FT 무거 ${big20}/${allSmall.length}(${pct20Wrong}%) [낮을수록 좋음]`);
}

console.log("\n=== '작은 화물(20FT 우선)' 임계값 분석 ===");
console.log("(20FT 화물 중 '작은' 분류되는 비율 vs 40FT 화물 중 '작은' 분류되는 비율)");
for (const t of cbmThresholds) {
  const sm20 = allSmall.filter((r) => (r.aboutCbm ?? r.cbm ?? 0) <= t).length;
  const sm40 = allBig.filter((r) => (r.aboutCbm ?? r.cbm ?? 0) <= t).length;
  const pct20 = (sm20 / Math.max(1, allSmall.length) * 100).toFixed(0);
  const pct40Wrong = (sm40 / allBig.length * 100).toFixed(0);
  console.log(`  CBM ≤ ${t}m³ : 20FT 작 ${sm20}/${allSmall.length}(${pct20}%), 40FT 작 ${sm40}/${allBig.length}(${pct40Wrong}%) [40FT 작 비율 높을수록 임계값 너무 큼]`);
}

console.log("\n=== 화주별 상세 ===");
for (const s of SAMPLES) {
  const file = path.resolve(`data/samples/${s.key}.json`);
  if (!fs.existsSync(file)) continue;
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const expected = loadExpected(s.key, d.rows);
  console.log(`\n■ ${s.label}`);
  d.rows.forEach((r, i) => {
    const cbm = (r.aboutCbm ?? r.cbm ?? 0).toFixed(2);
    const wt = (rowWeight(r) / 1000).toFixed(2);
    console.log(`  [${expected[i].padEnd(4)}] ${(r.actualShipperName||'').padEnd(22)} CBM=${cbm.padStart(6)}m³, 무게=${wt.padStart(6)}t`);
  });
}
