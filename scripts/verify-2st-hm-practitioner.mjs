/**
 * 2ST HM TOTAL — 실무자 분배가 물리적으로 유효한지 검증.
 *
 * pack() 에 fixedContainers (40FT, 40FT, 20FT) + fixedAssignment (실무자 명시 매핑) 을
 * 강제 주입한 뒤 컨테이너별 A1~A5 / B1~B7 검증. unplaced 발생 시 그 화물은 실무자 계획상
 * 해당 컨테이너에 물리적으로 안 들어간다는 뜻.
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");

const sample = JSON.parse(
  fs.readFileSync(path.resolve("data/samples/hochiminh-total-2.json"), "utf8"),
);

// 실무자 분배 — 사용자 명시
const PRACTITIONER = {
  1: ["AMS", "한국쎄미텍", "유라", "KIOSKIN", "전영사", "SD KOREA", "SJIT", "일라", "SJI", "KFTS", "한성엔터프라이즈", "이구산업", "케이티엔테크놀러지"],
  2: ["제임스텍", "중앙바이오텍", "리브유", "파인 파인비나", "블루오션", "파인비나", "장안어패럴", "디씨이메탈", "스톰테크"],
  3: ["효성", "로제화장품", "삼원절연", "화인써키트"],
};

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

// 실화주 → cargoId 역인덱스
const shipperToId = new Map();
for (const c of cargoes) shipperToId.set(c.actualShipperName, c.id);

const fixedAssignment = {};
for (const [contIdx, shippers] of Object.entries(PRACTITIONER)) {
  for (const sh of shippers) {
    const id = shipperToId.get(sh);
    if (!id) {
      console.error(`매칭 실패: 실화주 "${sh}" 가 sample 에 없음`);
      process.exit(2);
    }
    fixedAssignment[id] = Number(contIdx);
  }
}

// 컨테이너 강제 — 실무자 셋: 40FT × 2 + 20FT × 1
const fixedContainers = ["40FT", "40FT", "20FT"];

console.log("=== 2ST HM TOTAL — 실무자 분배 물리 검증 ===");
console.log(`fixedContainers: ${fixedContainers.join(", ")}`);
console.log(`fixedAssignment: 26 cargo → 컨1=${PRACTITIONER[1].length}, 컨2=${PRACTITIONER[2].length}, 컨3=${PRACTITIONER[3].length}`);

const result = pack(cargoes, "auto", { fixedContainers, fixedAssignment });
console.log(`\n컨테이너: ${result.containers.length}대 (${result.containers.map((c) => c.spec.type).join(" + ")})`);
console.log(`unplaced (실무자 계획에서 안 들어간 unit): ${result.unplaced.length}\n`);

const SOFT_OVERFLOW = 1.05;
const EPS = 0.5;
const cargoById = new Map(cargoes.map((c) => [c.id, c]));
const overall = { pass: 0, fail: 0 };

const reportCheck = (label, ok, detail = "") => {
  console.log(`    ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (ok) overall.pass++;
  else overall.fail++;
};

const px = (p) => p.position.x;
const py = (p) => p.position.y;
const pw = (p) => p.size.width;
const pl = (p) => p.size.length;
const ph = (p) => p.size.height;

for (const cont of result.containers) {
  console.log(`────────────────────────────────────────`);
  console.log(`[${cont.index}] ${cont.spec.type}  (inner ${cont.spec.innerWidth}×${cont.spec.innerLength}×${cont.spec.innerHeight} cm)`);
  console.log(`  실무자 배정 화주: ${PRACTITIONER[cont.index].join(", ")}`);

  const placements = [];
  for (const row of cont.rows) {
    for (const it of row.bottomItems) placements.push({ ...it, layer: "bottom", z: 0 });
    for (const it of row.topItems) placements.push({ ...it, layer: "top", z: row.bottomHeight ?? 0 });
  }
  const bulks = cont.bulkItems ?? [];
  console.log(`  visual placements: ${placements.length}, bulk items: ${bulks.length}`);

  const wMax = cont.spec.innerWidth + EPS;
  const hMax = cont.spec.innerHeight + EPS;
  const oobW = placements.filter((p) => px(p) + pw(p) > wMax);
  const oobH = placements.filter((p) => p.z + ph(p) > hMax);
  reportCheck("A1a. bounding width (≤ innerWidth)", oobW.length === 0, oobW.length ? `OOB-W ${oobW.length}` : "");
  reportCheck("A1b. bounding height (≤ innerHeight)", oobH.length === 0, oobH.length ? `OOB-H ${oobH.length}` : "");

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
  reportCheck("A4. 충돌 0", collisions === 0, collisions ? `${collisions}쌍` : "");

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
  reportCheck("A5. full support (≥70%)", unsupported === 0, unsupported ? `${unsupported}` : "");
}

console.log(`\n────────────────────────────────────────`);
console.log(`[전역] 룰`);
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
reportCheck("B1. cargoId 분산 0", split.length === 0,
  split.length ? split.map(([id, s]) => `${id}→[${[...s].join(",")}]`).join(", ") : "");

const unp = result.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
reportCheck("B3. 미배치 0", unp === 0, unp ? `${unp} units (${result.unplaced.map(u=>cargoById.get(u.cargo?.id ?? u.cargoId)?.actualShipperName ?? "?").join(",")})` : "");

console.log(`\n=== 종합: ${overall.pass} pass / ${overall.fail} fail ===`);
process.exit(overall.fail > 0 ? 1 : 0);
