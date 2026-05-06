/**
 * 2ST HM TOTAL — 컨테이너별 물리·알고리즘 규칙 종합 검증
 *
 * 검증 항목:
 *   A. 물리 규격 (각 컨테이너 별)
 *      A1. bounding — 모든 placement (x+w, y+l, z+h) ≤ 내부 (W, L, H)
 *      A2. weight  — placement 무게 합 ≤ maxWeightKg
 *      A3. cbm     — visual+ct CBM 합 ≤ maxCbm × 1.05 (SOFT_OVERFLOW)
 *      A4. 충돌 (collision) — 두 placement AABB 겹침 X
 *      A5. full support — z>0 면 아래 (z-h_below) 면적 ≥ 70%
 *
 *   B. 알고리즘 룰 (전역)
 *      B1. CBM 쪼개기 금지 — 같은 cargoId 의 placement+bulkItem 이 2 컨테이너에 분산 X
 *      B2. 부킹 인접 — 같은 bookingNo 의 cargo 들이 모두 같은 컨
 *      B3. 미배치 0
 *      B4. noStacking — 그 화물 위에 다른 placement X
 *      B5. topOnly — layer === "top"
 *      B6. heavierBelow — 아래 화물 무게/면적 ≥ 위 화물
 *      B7. orientation — fixed/long_along_length 준수
 */
import fs from "node:fs";
import path from "node:path";
const { packBest } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/hochiminh-total-2.json"), "utf8"),
);
const cargoes = sample.rows.map((r, idx) => ({
  id: `hm2-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0,
  length: r.lengthCm ?? 0,
  height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null,
  aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: {
    noStacking: r.noStacking ?? false,
    topOnly: r.topOnly ?? false,
    orientation: r.orientation ?? "free",
    heavierBelow: r.heavierBelow ?? false,
  },
  itemRemark: r.itemRemark ?? "",
}));

const result = packBest(cargoes, "auto");
const SOFT_OVERFLOW = 1.05;
const EPS = 0.5;

console.log(`\n=== 2ST HM TOTAL — 물리·규칙 종합 검증 ===`);
console.log(`컨테이너: ${result.containers.length}대 (${result.containers.map((c) => c.spec.type).join(" + ")})`);
console.log(`unplaced: ${result.unplaced.length}\n`);

const cargoById = new Map(cargoes.map((c) => [c.id, c]));
const overall = { pass: 0, fail: 0 };

const reportCheck = (label, ok, detail = "") => {
  console.log(`    ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (ok) overall.pass++;
  else overall.fail++;
  return ok;
};

const px = (p) => p.position.x;
const py = (p) => p.position.y;
const pw = (p) => p.size.width;
const pl = (p) => p.size.length;
const ph = (p) => p.size.height;

for (const cont of result.containers) {
  console.log(`────────────────────────────────────────`);
  console.log(`[${cont.index}] ${cont.spec.type}  (inner ${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight} cm)`);

  const placements = [];
  for (const row of cont.rows) {
    for (const it of row.bottomItems)
      placements.push({ ...it, layer: "bottom", z: 0, _row: row });
    for (const it of row.topItems)
      placements.push({ ...it, layer: "top", z: row.bottomHeight ?? 0, _row: row });
  }
  const bulks = cont.bulkItems ?? [];
  console.log(`  visual placements: ${placements.length}, bulk items: ${bulks.length}`);

  const wMax = cont.spec.innerWidth + EPS;
  const hMax = cont.spec.innerHeight + EPS;
  const oobW = placements.filter((p) => px(p) + pw(p) > wMax);
  const oobH = placements.filter((p) => p.z + ph(p) > hMax);
  reportCheck("A1a. bounding width (≤ innerWidth)", oobW.length === 0,
    oobW.length ? `OOB-W ${oobW.length}개` : "");
  reportCheck("A1b. bounding height (≤ innerHeight)", oobH.length === 0,
    oobH.length ? `OOB-H ${oobH.length}개` : "");

  const wt = placements.reduce((s, p) => s + (p.weight ?? 0), 0)
    + bulks.reduce((s, b) => s + (b.weightPerUnit ?? 0), 0);
  reportCheck("A2. weight 합 ≤ 한도", wt <= cont.spec.maxWeightKg + EPS,
    `${wt.toFixed(1)}/${cont.spec.maxWeightKg} kg (${((wt/cont.spec.maxWeightKg)*100).toFixed(1)}%)`);

  const visualCbm = placements.reduce((s, p) => s + (pw(p) * pl(p) * ph(p)) / 1e6, 0);
  const ctCbm = bulks.reduce((s, b) => s + (b.cbm ?? 0), 0);
  const totalCbm = visualCbm + ctCbm;
  const maxCbm = (cont.spec.innerWidth * cont.spec.innerLength * cont.spec.innerHeight) / 1e6;
  reportCheck("A3. cbm 합 ≤ cap × 1.05 (SOFT_OVERFLOW)", totalCbm <= maxCbm * SOFT_OVERFLOW + EPS,
    `${totalCbm.toFixed(2)}/${maxCbm.toFixed(2)} m³ (${((totalCbm/maxCbm)*100).toFixed(1)}%)`);

  let collisions = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      const overlap =
        px(a) < px(b) + pw(b) - EPS && px(b) < px(a) + pw(a) - EPS &&
        py(a) < py(b) + pl(b) - EPS && py(b) < py(a) + pl(a) - EPS &&
        a.z < b.z + ph(b) - EPS && b.z < a.z + ph(a) - EPS;
      if (overlap) collisions++;
    }
  }
  reportCheck("A4. 충돌 0 (AABB pairwise)", collisions === 0,
    collisions ? `${collisions}쌍 겹침` : "");

  let unsupported = 0;
  for (const p of placements) {
    if (p.z <= EPS) continue;
    const baseArea = pw(p) * pl(p);
    let coveredArea = 0;
    for (const q of placements) {
      if (q === p) continue;
      const qTop = q.z + ph(q);
      if (Math.abs(qTop - p.z) > EPS) continue;
      const ox = Math.max(0, Math.min(px(p) + pw(p), px(q) + pw(q)) - Math.max(px(p), px(q)));
      const oy = Math.max(0, Math.min(py(p) + pl(p), py(q) + pl(q)) - Math.max(py(p), py(q)));
      coveredArea += ox * oy;
    }
    if (coveredArea < baseArea * 0.7) unsupported++;
  }
  reportCheck("A5. full support (z>0 화물 ≥ 70% 받침)", unsupported === 0,
    unsupported ? `${unsupported} 위태로움` : "");

  let nsViol = 0, toViol = 0, hbViol = 0, orViol = 0;
  for (const p of placements) {
    const cg = cargoById.get(p.cargoId);
    if (!cg) continue;
    const r = cg.remarks;
    if (r.noStacking) {
      const above = placements.find((q) => q !== p &&
        q.z >= p.z + ph(p) - EPS &&
        px(q) < px(p) + pw(p) - EPS && px(p) < px(q) + pw(q) - EPS &&
        py(q) < py(p) + pl(p) - EPS && py(p) < py(q) + pl(q) - EPS);
      if (above) nsViol++;
    }
    if (r.topOnly && p.layer !== "top") toViol++;
    if (r.heavierBelow) {
      const above = placements.find((q) => q !== p &&
        Math.abs(q.z - (p.z + ph(p))) < EPS &&
        px(q) < px(p) + pw(p) - EPS && px(p) < px(q) + pw(q) - EPS &&
        py(q) < py(p) + pl(p) - EPS && py(p) < py(q) + pl(q) - EPS);
      if (above && (above.weight ?? 0) > (p.weight ?? 0)) hbViol++;
    }
    if (r.orientation === "fixed") {
      if (pw(p) !== cg.width || pl(p) !== cg.length) orViol++;
    } else if (r.orientation === "long_along_length") {
      if (pl(p) < pw(p)) orViol++;
    }
  }
  reportCheck("B4. noStacking 위반 0", nsViol === 0, nsViol ? `${nsViol}건` : "");
  reportCheck("B5. topOnly 위반 0", toViol === 0, toViol ? `${toViol}건` : "");
  reportCheck("B6. heavierBelow 위반 0", hbViol === 0, hbViol ? `${hbViol}건` : "");
  reportCheck("B7. orientation 위반 0", orViol === 0, orViol ? `${orViol}건` : "");
}

console.log(`\n────────────────────────────────────────`);
console.log(`[전역] 알고리즘 룰`);

const cargoToCont = new Map();
for (const c of result.containers) {
  for (const row of c.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      const set = cargoToCont.get(it.cargoId) ?? new Set();
      set.add(c.index);
      cargoToCont.set(it.cargoId, set);
    }
  }
  for (const b of c.bulkItems ?? []) {
    const set = cargoToCont.get(b.cargoId) ?? new Set();
    set.add(c.index);
    cargoToCont.set(b.cargoId, set);
  }
}
const split = [...cargoToCont].filter(([, s]) => s.size > 1);
reportCheck("B1. CBM 쪼개기 0 (cargoId 분산 X)", split.length === 0,
  split.length ? split.map(([id, s]) => `${id}→[${[...s].join(",")}]`).join(", ") : "");

const bookingToCont = new Map();
for (const [cargoId, contSet] of cargoToCont) {
  const cg = cargoById.get(cargoId);
  if (!cg?.bookingNo) continue;
  const set = bookingToCont.get(cg.bookingNo) ?? new Set();
  for (const ci of contSet) set.add(ci);
  bookingToCont.set(cg.bookingNo, set);
}
const bnSplit = [...bookingToCont].filter(([, s]) => s.size > 1);
reportCheck("B2. 부킹 인접 (bookingNo 분산 0)", bnSplit.length === 0,
  bnSplit.length ? bnSplit.map(([bn, s]) => `${bn}→[${[...s].join(",")}]`).join(", ") : "");

const unp = result.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
reportCheck("B3. 미배치 0", unp === 0, unp ? `${unp} 건` : "");

console.log(`\n=== 종합: ${overall.pass} pass / ${overall.fail} fail ===`);
process.exit(overall.fail > 0 ? 1 : 0);
