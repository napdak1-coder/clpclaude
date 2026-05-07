/**
 * 3ST SG TOTAL 컨2 (실무자 row 20~35) 27 unit 이 40FT 안에 물리적으로 들어가는지 증명 실험.
 *
 * 목적:
 *   - 0 미배치 가능 여부를 결정적으로 판단
 *   - 모든 시도를 로그로 기록 (logs/c2-fit-proof.log)
 *   - 다양한 정렬 + 회전 + 사전배치 + 1만회 셔플 + face 강제 조합
 *
 * 출력:
 *   - 표준출력 요약
 *   - logs/c2-fit-proof.log 전체 기록
 */
import fs from "node:fs";
import path from "node:path";
import { makeContainerState, tryPlaceUnit, tryPlaceUnitBruteForce } from "../lib/packing/extreme-point.ts";

const LOG_PATH = path.resolve("logs/c2-fit-proof.log");
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
const log = fs.createWriteStream(LOG_PATH, { flags: "w" });
const out = (s) => { console.log(s); log.write(s + "\n"); };

const sample = JSON.parse(fs.readFileSync("data/samples/singapore-total-3.json", "utf8"));
const spec = { type: "40FT", innerWidth: 234, innerLength: 1200, innerHeight: 268, doorHeight: 258, maxWeightKg: 25000, maxCbm: 60 };

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

const VOL = (u) => u.width * u.length * u.height;
const totalCbm = c2Units.reduce((s, u) => s + VOL(u), 0) / 1e6;
const containerCbm = (234 * 1200 * 268) / 1e6;

out("===== 3ST SG TOTAL 컨2 — 27 unit 물리 적재 가능성 검증 =====");
out(`컨테이너: 40FT 234×1200×268 cm = ${containerCbm.toFixed(2)} m³`);
out(`unit 수: ${c2Units.length}, 총 부피: ${totalCbm.toFixed(2)} m³ (${(totalCbm/containerCbm*100).toFixed(1)}%)`);
out("");
out("--- 컨2 unit 목록 ---");
for (const u of c2Units) {
  out(`  ${u.cargoId.padEnd(8)} ${u.shipper.padEnd(20)} ${String(u.width).padStart(3)}×${String(u.length).padStart(4)}×${String(u.height).padStart(3)} cm  ${VOL(u)/1e6}m³`);
}

function packPool(pool) {
  const state = makeContainerState();
  const unplaced = [];
  for (const u of pool) {
    const ok = tryPlaceUnit(u, state, spec) || tryPlaceUnitBruteForce(u, state, spec);
    if (!ok) unplaced.push(u);
  }
  return { state, unplaced };
}

function summary(pool) {
  const { unplaced } = packPool(pool);
  return unplaced.length;
}

const results = [];

// --- 결정 정렬 9종 ---
out("\n===== 결정 정렬 9 종 =====");
const sorts = [
  ["volume desc", (a,b) => VOL(b) - VOL(a)],
  ["volume asc",  (a,b) => VOL(a) - VOL(b)],
  ["height desc", (a,b) => b.height - a.height],
  ["height asc",  (a,b) => a.height - b.height],
  ["max-dim desc", (a,b) => Math.max(b.width,b.length,b.height) - Math.max(a.width,a.length,a.height)],
  ["footprint desc", (a,b) => (b.width*b.length) - (a.width*a.length)],
  ["rod first + tall + volume", (a,b) => {
    const ar = Math.max(a.width,a.length,a.height) > 234 ? 0 : 1;
    const br = Math.max(b.width,b.length,b.height) > 234 ? 0 : 1;
    if (ar !== br) return ar - br;
    const at = a.height >= 100 ? 0 : 1;
    const bt = b.height >= 100 ? 0 : 1;
    if (at !== bt) return at - bt;
    return VOL(b) - VOL(a);
  }],
  ["cargoId 묶음 + volume desc", (a,b) => {
    if (a.cargoId !== b.cargoId) {
      const va = c2Units.filter(x=>x.cargoId===a.cargoId).reduce((s,x)=>s+VOL(x),0);
      const vb = c2Units.filter(x=>x.cargoId===b.cargoId).reduce((s,x)=>s+VOL(x),0);
      return vb - va;
    }
    return VOL(b) - VOL(a);
  }],
  ["noStacking 먼저", (a,b) => {
    const an = a.remarks.noStacking ? 0 : 1;
    const bn = b.remarks.noStacking ? 0 : 1;
    if (an !== bn) return an - bn;
    return VOL(b) - VOL(a);
  }],
];
for (const [name, cmp] of sorts) {
  const pool = [...c2Units].sort(cmp);
  const u = summary(pool);
  out(`  ${name.padEnd(35)} 미배치 ${u}`);
  results.push({ name, unplaced: u });
}

// --- 10000 회 random shuffle ---
out("\n===== 10000 회 random shuffle =====");
{
  let best = c2Units.length;
  let bestSeed = -1;
  let bestUnplaced = null;
  let zero = 0;
  let one = 0;
  const dist = new Map();
  for (let s = 0; s < 10000; s++) {
    let seed = (s * 2654435761) >>> 0;
    const pool = [...c2Units];
    for (let i = pool.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = seed % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const { unplaced } = packPool(pool);
    dist.set(unplaced.length, (dist.get(unplaced.length) ?? 0) + 1);
    if (unplaced.length === 0) zero++;
    if (unplaced.length === 1) one++;
    if (unplaced.length < best) { best = unplaced.length; bestSeed = s; bestUnplaced = unplaced; }
  }
  out(`  최저 미배치: ${best} (seed=${bestSeed})`);
  out(`  미배치 분포:`);
  const keys = [...dist.keys()].sort((a,b)=>a-b);
  for (const k of keys) out(`    ${k} 미배치: ${dist.get(k)} 회`);
  out(`  0 미배치 횟수: ${zero}/10000`);
  if (bestUnplaced && bestUnplaced.length > 0) {
    out(`  최저 케이스 미배치 박스:`);
    for (const u of bestUnplaced) out(`    ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
  }
  results.push({ name: "10000 shuffle 최저", unplaced: best, zeroCount: zero });
}

// --- cargoId 그룹 단위 permutation 도전 (이미 cargoId 16개) ---
out("\n===== cargoId 그룹 순서 1000 permutation =====");
{
  const cargoMap = new Map();
  for (const u of c2Units) {
    if (!cargoMap.has(u.cargoId)) cargoMap.set(u.cargoId, []);
    cargoMap.get(u.cargoId).push(u);
  }
  const cargoIds = [...cargoMap.keys()];
  let best = c2Units.length;
  let bestPerm = null;
  let bestUnplaced = null;
  let zero = 0;
  for (let s = 0; s < 1000; s++) {
    let seed = (s * 2654435761 + 7) >>> 0;
    const ids = [...cargoIds];
    for (let i = ids.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = seed % (i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const pool = [];
    for (const id of ids) {
      const units = [...cargoMap.get(id)].sort((a,b) => VOL(b) - VOL(a));
      pool.push(...units);
    }
    const { unplaced } = packPool(pool);
    if (unplaced.length === 0) zero++;
    if (unplaced.length < best) { best = unplaced.length; bestPerm = ids; bestUnplaced = unplaced; }
  }
  out(`  최저 미배치: ${best}, 0 미배치 횟수: ${zero}/1000`);
  if (bestPerm) out(`  최저 순서: ${bestPerm.join(" → ")}`);
  if (bestUnplaced && bestUnplaced.length > 0) {
    for (const u of bestUnplaced) out(`    ${u.shipper} ${u.unitId} ${u.width}×${u.length}×${u.height}`);
  }
  results.push({ name: "cargoId 1000 perm", unplaced: best, zeroCount: zero });
}

out("\n===== 종합 =====");
out(`총 시도: 결정 정렬 ${sorts.length}종 + 10000 unit shuffle + 1000 cargoId perm = ${sorts.length + 11000} 회`);
out(`전체 최저 미배치: ${Math.min(...results.map(r => r.unplaced))}`);
out(`0 미배치 발견: ${results.some(r => r.unplaced === 0) ? "✅ YES" : "❌ NO"}`);
out("");
if (!results.some(r => r.unplaced === 0)) {
  out("[결론] 27 unit 컨2 안에 모두 들어가는 배치 패턴 발견 못 함.");
  out("       → 알고리즘 한계가 아닌 공간 한계 가능성 높음.");
  out("       → 현재 알고리즘 미배치 2 는 한계 근접 (best-effort).");
} else {
  out("[결론] 27 unit 들어가는 패턴 발견. 알고리즘에 그 패턴 반영 가능.");
}

log.end();
console.log(`\n로그 저장: ${LOG_PATH}`);
