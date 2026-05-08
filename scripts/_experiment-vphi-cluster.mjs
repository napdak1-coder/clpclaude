/**
 * 3ST SG TOTAL 컨2 — VPHI 사전 컬럼 클러스터링 실험
 *
 * 가설: VPHI 9박스 (sg3-22, sg3-23, sg3-24, sg3-25)를 4컬럼 (자체이단/삼단)으로
 * 사전에 묶어서 박은 뒤 나머지를 채우면 컨2 0 미배치가 가능하다.
 *
 * VPHI 4행:
 *   sg3-22: 111×111×104 ×2 (각 375.5kg)  → 컬럼 A: 자체이단, footprint 111×111, 높이 208
 *   sg3-23: 114×114×71 ×2 (각 375.5kg)   → 사용자 가설은 ×3 자체삼단이지만 실제 ×2
 *   sg3-24: 114×114×71 ×2 (각 186kg)
 *   sg3-25: 114×114×71 ×3 (각 250kg)
 *
 * 사용자 4컬럼 제안 (총 9박스):
 *   A: sg3-22 ×2 자체이단 (111×111×208)
 *   B: sg3-25 ×3 자체삼단 (114×114×213)
 *   C: sg3-23 ×2 + sg3-24 ×1 자체삼단 (114×114×213)  — 무거운 거 아래
 *   D: sg3-24 ×1 단층 (114×114×71)
 *
 * 2×2 배치 시 footprint 약 225×225 (2A=222, 2B=228, 2C=228, 2D=228)
 * 컨2 폭 234cm 안에 들어감.
 *
 * 시나리오: VPHI cluster 의 (x, y) anchor 를 다양하게 시도
 *   - X=0 (왼쪽 벽), X=110 (FLOWBUS 1단 옆), X=230-228=6  등
 *   - Y=0 (입구쪽), Y=326 (FLOWBUS 뒤), Y=502, Y=874 등
 *
 * 출력: scenario × seed 결과표 + best layout
 */
import fs from "node:fs";
import path from "node:path";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

const LOG_BEST_TXT = path.resolve("logs/experiment-vphi-cluster-best.txt");
const LOG_RESULTS_TXT = path.resolve("logs/experiment-vphi-cluster-results.txt");
fs.mkdirSync(path.dirname(LOG_BEST_TXT), { recursive: true });

// === 데이터 expand ===
function expandUnits(rows) {
  const units = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const cargoId = `sg3-${idx + 1}`;
    const remarks = {
      noStacking: r.noStacking ?? false,
      topOnly: r.topOnly ?? false,
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    };
    if (r.unitSizes && r.unitSizes.length > 0) {
      const totalUnits = r.unitSizes.reduce((s, u) => s + u.quantity, 0) || r.quantity;
      const fallbackW = totalUnits > 0 ? (r.weightPerUnitKg ?? 0) / totalUnits : 0;
      let i = 0;
      for (const us of r.unitSizes) {
        const w = us.weight && us.weight > 0 ? us.weight : fallbackW;
        for (let k = 0; k < us.quantity; k++) {
          units.push({ unitId: `${cargoId}-${i++}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
            cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
            width: us.width, length: us.length, height: us.height, weight: w, remarks });
        }
      }
    } else if (r.widthCm > 0 && r.lengthCm > 0 && r.heightCm > 0) {
      const perUnit = r.quantity > 0 ? (r.weightPerUnitKg ?? 0) / r.quantity : 0;
      for (let i = 0; i < r.quantity; i++) {
        units.push({ unitId: `${cargoId}-${i}`, cargoId, shipper: r.actualShipperName, bookingNo: r.bookingNo,
          cargoType: r.cargoType ?? "PL", cfsCbm: r.cbm ?? null,
          width: r.widthCm, length: r.lengthCm, height: r.heightCm, weight: perUnit, remarks });
      }
    }
  }
  return units;
}

const allUnits = expandUnits(sample.rows);
const c2Units = allUnits.filter(u => parseInt(u.cargoId.replace("sg3-", "")) - 1 >= 19);

const flowbus = c2Units.filter(u => u.cargoId === "sg3-30");
const skGeo = c2Units.filter(u => u.cargoId === "sg3-35");
const vphi22 = c2Units.filter(u => u.cargoId === "sg3-22"); // 111×111×104 ×2
const vphi23 = c2Units.filter(u => u.cargoId === "sg3-23"); // 114×114×71 ×2 (375.5kg)
const vphi24 = c2Units.filter(u => u.cargoId === "sg3-24"); // 114×114×71 ×2 (186kg)
const vphi25 = c2Units.filter(u => u.cargoId === "sg3-25"); // 114×114×71 ×3 (250kg)
const vphiAll = [...vphi22, ...vphi23, ...vphi24, ...vphi25];

const others = c2Units.filter(u =>
  !["sg3-30", "sg3-35", "sg3-22", "sg3-23", "sg3-24", "sg3-25"].includes(u.cargoId)
);

console.log(`컨2 총 unit: ${c2Units.length}`);
console.log(`  FLOWBUS: ${flowbus.length}, SK GEO: ${skGeo.length}`);
console.log(`  VPHI: ${vphiAll.length} (22:${vphi22.length} 23:${vphi23.length} 24:${vphi24.length} 25:${vphi25.length})`);
console.log(`  기타: ${others.length}\n`);

const VOL = (u) => u.width * u.length * u.height;

// === 정렬 전략 (others 용) ===
const sortStrategies = {
  "tall-first":  (a,b) => b.height - a.height,
  "ldf":         (a,b) => VOL(b) - VOL(a),
  "footprint":   (a,b) => (b.width*b.length) - (a.width*a.length),
  "long-item":   (a,b) => Math.max(b.width,b.length,b.height) - Math.max(a.width,a.length,a.height),
  "anc-first":   (a,b) => (a.shipper.includes("ANC") ? 0 : 1) - (b.shipper.includes("ANC") ? 0 : 1) || VOL(b) - VOL(a),
  "anc-tall":    (a,b) => (a.shipper.includes("ANC") ? 0 : 1) - (b.shipper.includes("ANC") ? 0 : 1) || b.height - a.height,
};

// === 강제 좌표 배치 (placeAt) ===
function placeAt(state, unit, x, y, z, faceIdx) {
  // 강제 face 로 정확 위치에 시도. 실패하면 false (state 변경 없음).
  // 직접 manual placement 추가 (tryPlaceUnit 의 후보점 의존 회피).
  // 제약: 컨테이너 안, 충돌 없음, z>0 이면 지지·stack 룰.
  const cargo = { width: unit.width, length: unit.length, height: unit.height, weightPerUnit: unit.weight, remarks: unit.remarks };

  // face 0: w×l×h (no rotation)
  // 우리 스크립트는 명시적으로 회전을 결정해 placement 를 만들 것
  const eff = effSize(cargo, faceIdx);

  // 컨테이너 경계
  if (x + eff.width > spec.innerWidth + 0.01) return false;
  if (y + eff.length > spec.innerLength + 0.01) return false;
  if (z + eff.height > spec.innerHeight + 0.01) return false;

  // 충돌
  for (const p of state.placements) {
    const overlap =
      x + eff.width > p.position.x + 0.01 && x + 0.01 < p.position.x + p.size.width &&
      y + eff.length > p.position.y + 0.01 && y + 0.01 < p.position.y + p.size.length &&
      z + eff.height > p.position.z + 0.01 && z + 0.01 < p.position.z + p.size.height;
    if (overlap) return false;
  }

  // 중량
  if (state.totalWeight + unit.weight > spec.maxWeightKg) return false;

  // z>0 이면 지지 검사
  if (z > 0.01) {
    const supporters = state.placements.filter(p => {
      const topZ = p.position.z + p.size.height;
      if (Math.abs(topZ - z) > 0.01) return false;
      return (
        x + eff.width > p.position.x + 0.01 && x + 0.01 < p.position.x + p.size.width &&
        y + eff.length > p.position.y + 0.01 && y + 0.01 < p.position.y + p.size.length
      );
    });
    if (supporters.length === 0) return false;
    // full support 4 corners + center
    const points = [
      { x: x + 0.01, y: y + 0.01 },
      { x: x + eff.width - 0.01, y: y + 0.01 },
      { x: x + 0.01, y: y + eff.length - 0.01 },
      { x: x + eff.width - 0.01, y: y + eff.length - 0.01 },
      { x: x + eff.width / 2, y: y + eff.length / 2 },
    ];
    const fullySup = points.every(pt =>
      supporters.some(s =>
        pt.x >= s.position.x - 0.01 && pt.x <= s.position.x + s.size.width + 0.01 &&
        pt.y >= s.position.y - 0.01 && pt.y <= s.position.y + s.size.length + 0.01
      )
    );
    if (!fullySup) return false;
  }

  // 추가
  const placed = {
    unitId: unit.unitId, cargoId: unit.cargoId, shipper: unit.shipper, bookingNo: unit.bookingNo,
    name: unit.name, cargoType: unit.cargoType, cfsCbm: unit.cfsCbm,
    position: { x, y, z }, size: { width: eff.width, length: eff.length, height: eff.height },
    faceIdx, rotated: eff.width !== unit.width || eff.length !== unit.length,
    weight: unit.weight, remarks: unit.remarks,
    layer: z <= 0.01 ? "bottom" : "top",
  };
  state.placements.push(placed);
  state.totalWeight += unit.weight;
  state.visualCbm += (eff.width * eff.length * eff.height) / 1e6;
  // 후보점 6개 추가 (중복 무시 — tryPlaceUnit 이 재정렬해줌)
  state.candidates.push(
    { x: x + eff.width, y, z },
    { x, y: y + eff.length, z },
    { x, y, z: z + eff.height },
  );
  return true;
}

function effSize(c, faceIdx) {
  // face 0: (w,l,h) 회전 없음
  // face 1: (l,w,h) length-width 스왑
  // face 2: (w,h,l) length-height 스왑
  // face 3: (h,l,w) width-height 스왑
  // face 4: (l,h,w)
  // face 5: (h,w,l)
  const W = c.width, L = c.length, H = c.height;
  switch (faceIdx) {
    case 0: return { width: W, length: L, height: H };
    case 1: return { width: L, length: W, height: H };
    case 2: return { width: W, length: H, height: L };
    case 3: return { width: H, length: L, height: W };
    case 4: return { width: L, length: H, height: W };
    case 5: return { width: H, length: W, height: L };
  }
  return { width: W, length: L, height: H };
}

// === FLOWBUS 1단 (X=0, X=116) at y=0 ===
function placeFlowbus(state) {
  // sg3-30: 326×116×110 → face 1: (116, 326, 110) 가 face 1 (length-width swap)
  // 원본 widthCm=326, lengthCm=116, heightCm=110 가정. 행 보면 sg3-30 의 사이즈는 search 스크립트의 placeFlowbus 가 (0,0,0) (116,0,0) 두 박스를 폭 232 로 박았으므로 face 1 사용.
  const a = placeAt(state, flowbus[0], 0, 0, 0, 1);
  const b = placeAt(state, flowbus[1], 116, 0, 0, 1);
  return a && b;
}

// === SK GEO 배치 (FLOWBUS 뒤 y=326 자유) ===
function placeSkGeo(state) {
  const sg = [...skGeo];
  for (const u of sg) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) return false;
  }
  return true;
}

// === VPHI cluster: 4컬럼 ===
// 컬럼 A (111×111×208): sg3-22 ×2 자체이단
// 컬럼 B (114×114×213): sg3-25 ×3 자체삼단
// 컬럼 C (114×114×213): sg3-23 ×2 + sg3-24 ×1 자체삼단  (무거운 sg3-23 아래)
// 컬럼 D (114×114×71): sg3-24 ×1 단층
//
// 2×2 배치: A,B 한 행 / C,D 한 행
//   A(0,0) B(111,0)
//   C(0,114) D(114,114)  (offsets 내부)
// total footprint width = max(111+114, 0+114) = 225, length = max(0+111, 114+114) = 228
function placeVphiCluster(state, anchorX, anchorY) {
  const ops = [];
  // 컬럼 A — sg3-22 자체이단 (111×111 footprint)
  if (!placeAt(state, vphi22[0], anchorX + 0,   anchorY + 0,   0,   0)) return false;
  if (!placeAt(state, vphi22[1], anchorX + 0,   anchorY + 0,   104, 0)) return false;
  // 컬럼 B — sg3-25 자체삼단 (114×114, 무거운 거 아래)
  // sg3-25 모두 250kg 동일
  if (!placeAt(state, vphi25[0], anchorX + 111, anchorY + 0,   0,   0)) return false;
  if (!placeAt(state, vphi25[1], anchorX + 111, anchorY + 0,   71,  0)) return false;
  if (!placeAt(state, vphi25[2], anchorX + 111, anchorY + 0,   142, 0)) return false;
  // 컬럼 C — sg3-23 (375.5kg) ×2 아래, sg3-24 (186kg) ×1 위
  if (!placeAt(state, vphi23[0], anchorX + 0,   anchorY + 114, 0,   0)) return false;
  if (!placeAt(state, vphi23[1], anchorX + 0,   anchorY + 114, 71,  0)) return false;
  if (!placeAt(state, vphi24[0], anchorX + 0,   anchorY + 114, 142, 0)) return false;
  // 컬럼 D — sg3-24 단층
  if (!placeAt(state, vphi24[1], anchorX + 114, anchorY + 114, 0,   0)) return false;
  return true;
}

// === 시나리오: VPHI cluster anchor 위치 ===
// FLOWBUS 가 (0,0)~(232, 326) 점유. cluster footprint 약 225×228.
// VPHI cluster 가능 위치 (anchor):
//   (0, 326)   — FLOWBUS 바로 뒤, 왼쪽 벽
//   (0, 502)   — SK GEO 뒤
//   (0, 670)   — 더 안쪽
//   (0, 874)   — 매우 안쪽
//   (0, 972)   — 끝쪽 (228 + 972 = 1200)
const vphiAnchors = [
  { x: 0, y: 326,  label: "vphi-326" },
  { x: 0, y: 360,  label: "vphi-360" },
  { x: 0, y: 400,  label: "vphi-400" },
  { x: 0, y: 441,  label: "vphi-441" }, // SK GEO 두 개(0,326)(0,441) 뒤
  { x: 0, y: 502,  label: "vphi-502" },
  { x: 0, y: 556,  label: "vphi-556" },
  { x: 0, y: 670,  label: "vphi-670" },
  { x: 0, y: 874,  label: "vphi-874" },
  { x: 0, y: 972,  label: "vphi-972" },
];

// SK GEO 위치 옵션: vphi 와 충돌 안 나도록 vphi 앞 또는 뒤
const skGeoVariants = ["auto", "after-vphi"];

function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// === 한 trial ===
function runTrial(vphiAnchor, sgVariant, sortName, sortFn, seed) {
  const state = makeContainerState();

  // 1. FLOWBUS
  if (!placeFlowbus(state)) return { unplaced: c2Units.length, reason: "FLOWBUS 실패", state, unplacedItems: [...c2Units] };

  // 2. VPHI cluster (FLOWBUS 직후 박는다)
  if (!placeVphiCluster(state, vphiAnchor.x, vphiAnchor.y)) {
    return { unplaced: c2Units.length - 2, reason: `VPHI cluster anchor=(${vphiAnchor.x},${vphiAnchor.y}) 실패`, state, unplacedItems: [...vphiAll, ...skGeo, ...others] };
  }

  // 3. SK GEO
  let sgOk;
  if (sgVariant === "auto") {
    sgOk = placeSkGeo(state);
  } else {
    // after-vphi: vphi 뒤쪽 강제 (auto 와 동일하게 fallback)
    sgOk = placeSkGeo(state);
  }
  if (!sgOk) {
    return { unplaced: c2Units.length - 11, reason: "SK GEO 실패", state, unplacedItems: [...skGeo, ...others] };
  }

  // 4. 나머지 (others) 정렬·셔플 후 배치
  let pool = [...others].sort(sortFn);
  if (seed > 0) pool = shuffle(pool, seed);

  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { unplaced: unplaced.length, reason: unplaced.length === 0 ? "성공" : "기타 미배치", state, unplacedItems: unplaced };
}

// === main ===
const results = [];
let best = { unplaced: Infinity, label: "", state: null, unplacedItems: [] };

const sortNames = Object.keys(sortStrategies);
const seedsPerCombo = 20;

const tStart = Date.now();
let trialCount = 0;

for (const anchor of vphiAnchors) {
  for (const sgV of skGeoVariants) {
    for (const sortName of sortNames) {
      let comboBest = Infinity;
      for (let seedIdx = 0; seedIdx < seedsPerCombo; seedIdx++) {
        const seed = seedIdx === 0 ? 0 : (trialCount * 2654435761) >>> 0;
        const r = runTrial(anchor, sgV, sortName, sortStrategies[sortName], seed);
        trialCount++;
        if (r.unplaced < comboBest) comboBest = r.unplaced;
        if (r.unplaced < best.unplaced) {
          best = {
            unplaced: r.unplaced,
            label: `${anchor.label}/sg-${sgV}/${sortName}/seed=${seed}`,
            state: r.state,
            unplacedItems: r.unplacedItems,
          };
          if (r.unplaced === 0) break;
        }
      }
      results.push({ anchor: anchor.label, sg: sgV, sort: sortName, bestUnplaced: comboBest });
      if (best.unplaced === 0) break;
    }
    if (best.unplaced === 0) break;
  }
  if (best.unplaced === 0) break;
}

const totalRuntime = (Date.now() - tStart) / 1000;

// === 결과 표 ===
console.log(`\n=== VPHI cluster 실험 결과 ===`);
console.log(`총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s\n`);

// 표 (anchor × sortName), 모든 sg variant 묶어 min
const summary = {};
for (const r of results) {
  const k = `${r.anchor}|${r.sort}`;
  if (!(k in summary) || r.bestUnplaced < summary[k]) summary[k] = r.bestUnplaced;
}
console.log("VPHI anchor × sort 전략 best 미배치:");
console.log("anchor".padEnd(12) + sortNames.map(s => s.padEnd(12)).join(""));
for (const anchor of vphiAnchors) {
  let line = anchor.label.padEnd(12);
  for (const sortName of sortNames) {
    const v = summary[`${anchor.label}|${sortName}`];
    line += String(v ?? "-").padEnd(12);
  }
  console.log(line);
}

console.log(`\n--- BEST: ${best.label} → 미배치 ${best.unplaced}/${c2Units.length} ---`);
if (best.unplacedItems.length > 0) {
  console.log("미배치 박스:");
  for (const u of best.unplacedItems) {
    console.log(`  [${u.cargoId}] ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg`);
  }
}

// === best txt 저장 ===
let txt = `=== 3ST SG TOTAL 컨2 — VPHI cluster 실험 BEST ===\n`;
txt += `시나리오: ${best.label}\n`;
txt += `미배치: ${best.unplaced}/${c2Units.length}\n`;
txt += `총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s\n`;
if (best.state) {
  txt += `총 부피: ${best.state.visualCbm.toFixed(2)} m³\n`;
  txt += `총 무게: ${best.state.totalWeight.toFixed(0)} kg\n\n`;
  txt += `--- 배치 (${best.state.placements.length}개) ---\n`;
  for (const p of best.state.placements) {
    txt += `  [${p.cargoId}] ${p.shipper} ${p.size.width}×${p.size.length}×${p.size.height} at (${p.position.x},${p.position.y},${p.position.z}) face=${p.faceIdx} ${p.weight}kg\n`;
  }
}
if (best.unplacedItems.length > 0) {
  txt += `\n--- 미배치 (${best.unplacedItems.length}개) ---\n`;
  for (const u of best.unplacedItems) {
    txt += `  [${u.cargoId}] ${u.shipper} ${u.width}×${u.length}×${u.height} ${u.weight}kg\n`;
  }
}
fs.writeFileSync(LOG_BEST_TXT, txt);

// === 전체 결과 표 저장 ===
let resTxt = `=== VPHI cluster 실험 — 전체 시나리오 결과 ===\n`;
resTxt += `총 trial: ${trialCount}, 런타임: ${totalRuntime.toFixed(1)}s\n\n`;
resTxt += "anchor".padEnd(12) + "sg".padEnd(14) + "sort".padEnd(14) + "best미배치\n";
for (const r of results) {
  resTxt += r.anchor.padEnd(12) + r.sg.padEnd(14) + r.sort.padEnd(14) + r.bestUnplaced + "\n";
}
fs.writeFileSync(LOG_RESULTS_TXT, resTxt);

console.log(`\n저장: ${LOG_BEST_TXT}`);
console.log(`     ${LOG_RESULTS_TXT}`);
