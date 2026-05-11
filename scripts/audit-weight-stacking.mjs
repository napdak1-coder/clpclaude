/**
 * 무게 적층 룰 audit — 5 샘플 위반 검사
 *
 * 룰 두 가지를 동시에 검사:
 *   - **엄격**:  위 무게 > 아래 무게        (사용자 기대 룰: "하단 ≥ 상단")
 *   - **느슨**:  위 무게 > 아래 무게 × 1.5  (현재 코드 룰, constraints.ts:120 STACK_WEIGHT_TOLERANCE)
 *
 * 적층 페어 추출은 verify-physical-rules.mjs 패턴 (PHYSICAL z 좌표):
 *   1) packBest 로 cargo→container 분배 결정.
 *   2) 컨테이너별로 그 subset 만 packExtremePoint 재실행 → 원본 3D position.z 보존.
 *      (containers[].rows 는 display 용 변환을 거쳐 z 정보가 사라지므로 직접 못 씀.)
 *   3) 두 placement p (아래), q (위) 가 |q.z - (p.z + p.h)| < EPS + x/y AABB 겹치면 페어.
 *
 * 1ST HM (hochiminh-total.xlsx) 만 예외:
 *   - verify-hm-total.mjs 와 동일하게 모든 행을 CT bulk 로 라우팅 (사이즈 mm/cm 불일치 회피).
 *   - CT bulk = placement 없음 = 적층 페어 0건.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");
const { packExtremePoint, expandCargoesToUnits } = await import(
  "../lib/packing/extreme-point.ts"
);
const { parseExcelFile } = await import("../lib/excel.ts");

const EPS = 0.5;
const STACK_WEIGHT_TOLERANCE = 1.5;

/* ===== sample loaders =====
 * 각 로더: () => Promise<{ cargoes, note?: string } | { error: string }>
 * verify-1st-sg-total.mjs 의 매핑을 그대로 따른다 (id prefix 만 샘플별로 다름).
 */

function mapJsonRowsToCargoes(rows, idPrefix) {
  return rows.map((r, idx) => ({
    id: `${idPrefix}-${idx + 1}`,
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
}

function loadJsonSample(jsonPath, idPrefix) {
  return async () => {
    const abs = path.resolve(jsonPath);
    if (!fs.existsSync(abs)) {
      return {
        error:
          `샘플 파일 없음: ${jsonPath}\n` +
          `   먼저 'node --experimental-strip-types scripts/rebuild-all-samples.mjs' 등으로 생성 필요.`,
      };
    }
    const sample = JSON.parse(fs.readFileSync(abs, "utf8"));
    return { cargoes: mapJsonRowsToCargoes(sample.rows, idPrefix) };
  };
}

/** 1ST HM 전용: xlsx → CT bulk (사이즈 0, CBM 만 사용). verify-hm-total.mjs:43-172 패턴. */
async function load1stHm() {
  const xlsxPath = path.resolve("public/samples/hochiminh-total.xlsx");
  if (!fs.existsSync(xlsxPath)) return { error: `샘플 파일 없음: ${xlsxPath}` };

  const buf = fs.readFileSync(xlsxPath);
  const fakeFile = {
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const parsed = await parseExcelFile(fakeFile);

  const FIELD_BY_HEADER_LOWER = new Map([
    ["house b/l", "houseBlNo"],
    ["booking no", "bookingNo"],
    ["dest", "destination"],
    ["실화주", "itemActualShipperName"],
    ["화주", "itemShipperName"],
    ["q'ty", "quantity"],
    ["g. w/t", "weightPerUnitKg"],
    ["g.w/t", "weightPerUnitKg"],
    ["cfs cbm", "cbm"],
    ["remark", "itemRemark"],
  ]);
  const mapping = {};
  for (const h of parsed.headers) {
    if (!h) continue;
    const lower = String(h).toLowerCase().trim();
    for (const [key, field] of FIELD_BY_HEADER_LOWER) {
      if (lower.includes(key)) {
        mapping[h] = field;
        break;
      }
    }
  }

  const toNum = (v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const cargoes = [];
  parsed.rows.forEach((row, idx) => {
    let actualShipperName = "",
      shipperName = "",
      bookingNo = "";
    let quantity = 1,
      weightPerUnitKg = 0,
      cbm = null,
      aboutCbm = null;
    let itemRemark = "";

    for (const [header, field] of Object.entries(mapping)) {
      const v = row[header];
      switch (field) {
        case "itemActualShipperName":
          actualShipperName = String(v ?? "").trim();
          break;
        case "itemShipperName":
          shipperName = String(v ?? "").trim();
          break;
        case "bookingNo":
          bookingNo = String(v ?? "").trim();
          break;
        case "quantity":
          quantity = Math.max(1, Math.round(toNum(v)));
          break;
        case "weightPerUnitKg":
          weightPerUnitKg = toNum(v);
          break;
        case "cbm":
          cbm = toNum(v) || null;
          break;
        case "itemRemark":
          itemRemark = String(v ?? "");
          break;
      }
    }
    const aboutHeader = parsed.headers.find(
      (h) => String(h).toLowerCase().trim() === "about",
    );
    if (aboutHeader) aboutCbm = toNum(row[aboutHeader]) || null;

    const hasMeaningful =
      actualShipperName.length > 0 ||
      shipperName.length > 0 ||
      quantity > 0 ||
      (cbm ?? 0) > 0 ||
      (aboutCbm ?? 0) > 0;
    if (!hasMeaningful) return;

    cargoes.push({
      id: `hm1-${idx + 1}`,
      itemName: null,
      actualShipperName,
      shipperName,
      width: 0,
      length: 0,
      height: 0,
      quantity,
      weightPerUnit: weightPerUnitKg,
      cbm,
      aboutCbm,
      cargoType: "CT", // 모든 행 CT bulk
      bookingNo: bookingNo || undefined,
      unitSizes: undefined,
      remarks: {
        noStacking: false,
        topOnly: false,
        orientation: "free",
        heavierBelow: false,
      },
      itemRemark,
    });
  });

  return {
    cargoes,
    note: "모든 행 CT bulk 로 라우팅 (xlsx 사이즈 mm 단위 회피) — placement 없음, 적층 페어 0건 예상",
  };
}

const SAMPLES = [
  { label: "1ST SG", load: loadJsonSample("data/samples/singapore-total.json", "sg1") },
  { label: "1ST HM", load: load1stHm },
  { label: "2ST SG", load: loadJsonSample("data/samples/singapore-total-2.json", "sg2") },
  { label: "2ST HM", load: loadJsonSample("data/samples/hochiminh-total-2.json", "hm2") },
  { label: "3ST SG", load: loadJsonSample("data/samples/singapore-total-3.json", "sg3") },
];

/* ===== 페어 추출 + 위반 카운트 ===== */

const px = (p) => p.position.x;
const py = (p) => p.position.y;
const pw = (p) => p.size.width;
const pl = (p) => p.size.length;
const ph = (p) => p.size.height;

function auditPlacements(sampleLabel, ci, placements, cargoById) {
  let totalPairs = 0;
  const strictPairs = [];
  const toleratedPairs = [];
  const pz = (p) => p.position.z;

  for (const p of placements) {
    const topZ = pz(p) + ph(p);
    for (const q of placements) {
      if (q === p) continue;
      if (Math.abs(pz(q) - topZ) > EPS) continue;
      const ox = Math.min(px(p) + pw(p), px(q) + pw(q)) - Math.max(px(p), px(q));
      const oy = Math.min(py(p) + pl(p), py(q) + pl(q)) - Math.max(py(p), py(q));
      if (ox <= EPS || oy <= EPS) continue;

      totalPairs++;
      const wBot = p.weight ?? 0;
      const wTop = q.weight ?? 0;
      const detail = {
        sample: sampleLabel,
        container: ci + 1,
        bottom: {
          cargoId: p.cargoId,
          shipper: cargoById.get(p.cargoId)?.actualShipperName ?? p.shipper ?? "?",
          weight: wBot,
          z: `${pz(p).toFixed(0)}..${(pz(p) + ph(p)).toFixed(0)}`,
        },
        top: {
          cargoId: q.cargoId,
          shipper: cargoById.get(q.cargoId)?.actualShipperName ?? q.shipper ?? "?",
          weight: wTop,
          z: `${pz(q).toFixed(0)}..${(pz(q) + ph(q)).toFixed(0)}`,
        },
      };
      if (wTop > wBot + 0.01) strictPairs.push(detail);
      if (wTop > wBot * STACK_WEIGHT_TOLERANCE + 0.01)
        toleratedPairs.push(detail);
    }
  }

  return { totalPairs, strictPairs, toleratedPairs };
}

/**
 * cont.rows 에서 그 컨테이너에 배치된 cargoId 들 추출 (visual placements 만).
 * CT/입고완료 bulk 는 적층 페어와 무관해 제외.
 */
function visualCargoIdsIn(cont) {
  const ids = new Set();
  for (const row of cont.rows ?? []) {
    for (const it of row.bottomItems ?? []) ids.add(it.cargoId);
    for (const it of row.topItems ?? []) ids.add(it.cargoId);
  }
  return ids;
}

/* ===== 실행 ===== */

console.log(`=== 무게 적층 룰 audit (5 샘플) ===\n`);

const rows = [];
const allStrict = [];
const allTolerated = [];

for (const s of SAMPLES) {
  process.stdout.write(`[${s.label}] 로드 중... `);
  const loaded = await s.load();
  if (loaded.error) {
    console.log(`✗ skip\n  ${loaded.error}\n`);
    rows.push({
      label: s.label,
      status: "skip",
      reason: loaded.error.split("\n")[0],
    });
    continue;
  }
  console.log(`${loaded.cargoes.length} 화물`);
  if (loaded.note) console.log(`  주: ${loaded.note}`);

  const t0 = Date.now();
  const result = packBest(loaded.cargoes, undefined, { lightMode: true });
  console.log(
    `  pack: ${Date.now() - t0}ms · 컨${result.containers.length}대 (${result.containers.map((c) => c.spec.type).join("+")}) · unplaced ${result.unplaced.length}`,
  );

  const cargoById = new Map(loaded.cargoes.map((c) => [c.id, c]));
  let totalPairs = 0,
    strictCount = 0,
    toleratedCount = 0;

  for (const [ci, cont] of result.containers.entries()) {
    // 이 컨테이너에 들어간 visual cargo subset 재패킹 → 원본 3D 좌표 확보
    const ids = visualCargoIdsIn(cont);
    if (ids.size === 0) continue;
    const subset = loaded.cargoes.filter((c) => ids.has(c.id));
    const units = expandCargoesToUnits(subset);
    const epResult = packExtremePoint(units, cont.spec);
    if (epResult.unplaced.length > 0) {
      console.log(
        `  ⚠ 컨${ci + 1} 재패킹 unplaced ${epResult.unplaced.length}건 — packBest 결과와 차이 있을 수 있음`,
      );
    }
    const audit = auditPlacements(s.label, ci, epResult.placements, cargoById);
    totalPairs += audit.totalPairs;
    strictCount += audit.strictPairs.length;
    toleratedCount += audit.toleratedPairs.length;
    allStrict.push(...audit.strictPairs);
    allTolerated.push(...audit.toleratedPairs);
  }

  rows.push({
    label: s.label,
    status: "ok",
    containers: result.containers.map((c) => c.spec.type).join("+"),
    unplaced: result.unplaced.length,
    totalPairs,
    strictCount,
    toleratedCount,
  });
  console.log(
    `  적층 페어 ${totalPairs}건 · 엄격 위반 ${strictCount} · 느슨 위반 ${toleratedCount}\n`,
  );
}

/* ===== 요약 표 ===== */

console.log(`\n=== 요약 ===\n`);
console.log(
  `| 샘플    | 컨테이너    | unplaced | 적층 페어 | 엄격 위반 | 느슨 위반(×1.5) |`,
);
console.log(
  `|---------|-------------|----------|-----------|-----------|-----------------|`,
);
for (const r of rows) {
  if (r.status === "skip") {
    console.log(
      `| ${r.label.padEnd(7)} | (skip)      | -        | -         | -         | -               |  ${r.reason}`,
    );
    continue;
  }
  console.log(
    `| ${r.label.padEnd(7)} | ${r.containers.padEnd(11)} | ${String(r.unplaced).padEnd(8)} | ${String(r.totalPairs).padEnd(9)} | ${String(r.strictCount).padEnd(9)} | ${String(r.toleratedCount).padEnd(15)} |`,
  );
}

/* ===== 위반 상세 ===== */

if (allStrict.length > 0) {
  console.log(`\n--- 엄격 위반 상세 (위 무게 > 아래 무게) ---`);
  for (const d of allStrict) {
    console.log(
      `[${d.sample} / 컨${d.container}]\n` +
        `  아래: ${d.bottom.cargoId} ${d.bottom.shipper} ${d.bottom.weight}kg z=${d.bottom.z}\n` +
        `  위:   ${d.top.cargoId} ${d.top.shipper} ${d.top.weight}kg z=${d.top.z}`,
    );
  }
}

if (allTolerated.length > 0) {
  console.log(`\n--- 느슨 위반 상세 (위 무게 > 아래 × 1.5) ---`);
  for (const d of allTolerated) {
    console.log(
      `[${d.sample} / 컨${d.container}]\n` +
        `  아래: ${d.bottom.cargoId} ${d.bottom.shipper} ${d.bottom.weight}kg z=${d.bottom.z}\n` +
        `  위:   ${d.top.cargoId} ${d.top.shipper} ${d.top.weight}kg z=${d.top.z}`,
    );
  }
}

/* ===== 종료 ===== */

const totalStrict = allStrict.length;
const totalTolerated = allTolerated.length;
console.log(
  `\n=== 종합: 엄격 ${totalStrict}건 · 느슨 ${totalTolerated}건 ===`,
);
if (totalStrict === 0 && totalTolerated === 0) {
  console.log(`모든 적층 페어 두 기준 통과`);
}
process.exit(totalTolerated > 0 ? 1 : 0);
