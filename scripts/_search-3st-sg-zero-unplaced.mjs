/**
 * 3ST SG TOTAL 미배치 0 search.
 * 외부에서 다양한 시드(입력 순서 + 옵션 조합) 시도 → 미배치 0 찾는 첫 조합 보고.
 * lightMode=true 로 한 시도당 ≈ 30~60s 목표.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");
const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;

const EXPECTED_C1 = Array.from({ length: 19 }, (_, i) => i + 1);
const EXPECTED_C2 = Array.from({ length: 16 }, (_, i) => i + 20);

const baseCargoes = rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
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

const expectedC1Names = EXPECTED_C1.map((i) => baseCargoes[i - 1]?.actualShipperName ?? "?");
const expectedC2Names = EXPECTED_C2.map((i) => baseCargoes[i - 1]?.actualShipperName ?? "?");

const multiset = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const cmpDiff = (a, b) => {
  const ma = multiset(a), mb = multiset(b);
  let mis = 0, ext = 0;
  for (const [k, v] of mb) mis += Math.max(0, v - (ma.get(k) ?? 0));
  for (const [k, v] of ma) ext += Math.max(0, v - (mb.get(k) ?? 0));
  return mis + ext;
};

function measureMismatch(result) {
  const containerOf = new Map();
  result.containers.forEach((c, ci) => {
    for (const row of c.rows) for (const it of [...row.bottomItems, ...row.topItems]) containerOf.set(it.cargoId, ci);
    for (const bi of c.bulkItems ?? []) if (!containerOf.has(bi.cargoId)) containerOf.set(bi.cargoId, ci);
  });
  const lists = result.containers.map(() => []);
  for (const c of baseCargoes) {
    const idx = containerOf.get(c.id);
    if (idx != null) lists[idx].push(c.actualShipperName);
  }
  if (lists.length !== 2) return null;
  const d1 = cmpDiff(lists[0], expectedC1Names) + cmpDiff(lists[1], expectedC2Names);
  const d2 = cmpDiff(lists[0], expectedC2Names) + cmpDiff(lists[1], expectedC1Names);
  return Math.min(d1, d2);
}

/* 시드 매트릭스 */
const fixedContainers = ["40FT", "40FT"];

function reverse(arr) { return [...arr].reverse(); }
function rotate(arr, k) { return [...arr.slice(k), ...arr.slice(0, k)]; }
function sortByVolume(arr, dir) {
  const vol = (c) => (c.width * c.length * c.height * c.quantity);
  return [...arr].sort((a, b) => dir === "desc" ? vol(b) - vol(a) : vol(a) - vol(b));
}
function sortByWeight(arr, dir) {
  const w = (c) => (c.weightPerUnit ?? 0) * (c.quantity ?? 1);
  return [...arr].sort((a, b) => dir === "desc" ? w(b) - w(a) : w(a) - w(b));
}
function shuffleSeeded(arr, seed) {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const seeds = [
  { name: "원본순서", cargoes: baseCargoes, opts: { fixedContainers, lightMode: true } },
  { name: "역순서", cargoes: reverse(baseCargoes), opts: { fixedContainers, lightMode: true } },
  { name: "부피큰순", cargoes: sortByVolume(baseCargoes, "desc"), opts: { fixedContainers, lightMode: true } },
  { name: "부피작은순", cargoes: sortByVolume(baseCargoes, "asc"), opts: { fixedContainers, lightMode: true } },
  { name: "무거운순", cargoes: sortByWeight(baseCargoes, "desc"), opts: { fixedContainers, lightMode: true } },
  { name: "가벼운순", cargoes: sortByWeight(baseCargoes, "asc"), opts: { fixedContainers, lightMode: true } },
  { name: "원본+장축앵커", cargoes: baseCargoes, opts: { fixedContainers, lightMode: true, longAxisAnchor: { enabled: true } } },
  { name: "부피큰순+장축앵커", cargoes: sortByVolume(baseCargoes, "desc"), opts: { fixedContainers, lightMode: true, longAxisAnchor: { enabled: true } } },
  { name: "원본+사전묶음끄기", cargoes: baseCargoes, opts: { fixedContainers, lightMode: true, footprintCluster: { enabled: false } } },
  { name: "셔플시드7", cargoes: shuffleSeeded(baseCargoes, 7), opts: { fixedContainers, lightMode: true } },
  { name: "셔플시드42", cargoes: shuffleSeeded(baseCargoes, 42), opts: { fixedContainers, lightMode: true } },
  { name: "셔플시드123", cargoes: shuffleSeeded(baseCargoes, 123), opts: { fixedContainers, lightMode: true } },
];

console.log(`# 시도 ${seeds.length} 종`);
const summary = [];
let foundZero = null;

for (const seed of seeds) {
  const t0 = Date.now();
  let r;
  let err = null;
  try {
    r = packBest(seed.cargoes, "auto", seed.opts);
  } catch (e) {
    err = e?.message ?? String(e);
  }
  const dt = Date.now() - t0;
  if (err) {
    console.log(`[${seed.name}] ERROR ${dt}ms — ${err}`);
    summary.push({ name: seed.name, ms: dt, unplaced: "ERR", containers: "ERR", mismatch: "ERR" });
    continue;
  }
  const unplaced = r.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
  const containers = r.containers.map((c) => c.spec.type).join("+");
  const mismatch = measureMismatch(r);
  console.log(`[${seed.name}] ${dt}ms  미배치=${unplaced}  컨=${containers}  실무자불일치=${mismatch}`);
  summary.push({ name: seed.name, ms: dt, unplaced, containers, mismatch });
  if (unplaced === 0 && !foundZero) {
    foundZero = { ...seed, mismatch, ms: dt };
    console.log(`>>> 미배치 0 첫 발견: ${seed.name} (실무자불일치=${mismatch}, ${dt}ms)`);
    // 중단하지 않고 모두 측정 (가장 좋은 mismatch 찾기)
  }
}

console.log("\n=== 요약 표 ===");
console.log("이름                 시간(ms)  미배치  컨테이너    실무자불일치");
for (const s of summary) {
  console.log(`${s.name.padEnd(20)} ${String(s.ms).padStart(7)}  ${String(s.unplaced).padStart(5)}  ${String(s.containers).padEnd(10)} ${s.mismatch}`);
}

const zeros = summary.filter((s) => s.unplaced === 0);
console.log(`\n미배치 0 달성 시드: ${zeros.length}/${summary.length}`);
if (zeros.length > 0) {
  zeros.sort((a, b) => (a.mismatch ?? 999) - (b.mismatch ?? 999));
  console.log(`최저 실무자불일치 = ${zeros[0].name} (mismatch=${zeros[0].mismatch})`);
}
