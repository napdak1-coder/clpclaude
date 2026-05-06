/**
 * HM TOTAL 호치민 샘플 — 실무자 분배 vs 알고리즘 비교 + 물리·룰·부킹 인접 검증.
 *
 * 흐름:
 *   1) public/samples/hochiminh-total.xlsx → CargoSpec[]
 *   2) AUTO 모드 packBest → 실무자 expected 와 비교
 *   3) FORCE 모드 (fixedAssignment) → 실무자 분배 자체의 물리·CBM·무게 검증
 *   4) Booking 인접: 같은 booking_no 행이 같은 컨테이너에 있는지
 */

import fs from "node:fs";
import path from "node:path";

// 동적 import (TS strip-types 통해 lib/* 사용)
const { parseExcelFile, parseDimensionsFromText, extractFlagsAndStrip } = await import(
  "../lib/excel.ts"
);
const { pack, packBest } = await import("../lib/packing/algorithm.ts");
const { getContainerSpec } = await import("../lib/packing/containers.ts");

const XLSX_PATH = path.resolve("public/samples/hochiminh-total.xlsx");

/* =========================================================================
 * 실무자 expected 분배 — 엑셀 No. 1~34 순서
 * ========================================================================= */
const EXPECTED_FORTY = [
  "레오캡", "AMS", "신화인터텍", "한영", "제이앤제이디에프",
  "알앤디", "오디에스", "오디에스", "영진", "알앤디",
  "더죤테크", "더죤테크", "더죤테크", "성진산업", "아로마라인",
  "캐스텍코리아", "반도글로벌", "세광섬유", "서진테크", "리더스",
  "미래나노텍", "미래나노텍", "녹원", "지브이",
];
const EXPECTED_TWENTY = [
  "ACE COMPANY", "로얄티엔엘", "로얄티엔엘", "프런티어",
  "한일베어링", "한일베어링", "한일베어링",
  "세양폴리머(SAMSUNG CNT)", "다이나믹 디자인", "진양오일씰",
];

/* =========================================================================
 * 1) 엑셀 → CargoSpec[]
 * ========================================================================= */

const buf = fs.readFileSync(XLSX_PATH);
const fakeFile = {
  arrayBuffer: async () =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};
const parsed = await parseExcelFile(fakeFile);
console.log(`엑셀 파싱: ${parsed.rows.length} 행`);

// 헤더 → 필드 자동 매핑 (싱가폴 SG TOTAL 과 같은 양식 가정)
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

function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/,/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// CargoSpec[] 만들기 (buildImportPayload 의 핵심 로직 재현)
const cargoes = [];
parsed.rows.forEach((row, idx) => {
  let widthCm = 0,
    lengthCm = 0,
    heightCm = 0;
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
  // ABOUT — about 컬럼 직접 또는 CFS CBM 우측 인접
  const aboutHeader = parsed.headers.find(
    (h) => String(h).toLowerCase().trim() === "about",
  );
  if (aboutHeader) aboutCbm = toNum(row[aboutHeader]) || null;

  // 호치민 양식은 REMARK 사이즈가 mm 단위(불일치) 라 cm 가정 시 거대 화물로 잘못 해석됨.
  // 검증 스크립트에서는 모든 행을 CT bulk 로 라우팅 (CFS CBM 만 사용해 컨테이너 결정)
  // — 실무자 분배도 CFS CBM 기준이므로 일치 비교 가능.
  const cargoType = "CT";

  // 의미 있는 정보 있으면 push
  const hasMeaningful =
    actualShipperName.length > 0 ||
    shipperName.length > 0 ||
    quantity > 0 ||
    (cbm ?? 0) > 0 ||
    (aboutCbm ?? 0) > 0;
  if (!hasMeaningful) return;
  // 사이즈 미기재는 0 으로 둬서 classify 가 CT bulk 로 라우팅 → CBM 만 합산.
  // (DB 저장 시에는 placeholder 0.01 필요하나 검증 스크립트는 in-memory 라 무관.)

  cargoes.push({
    id: `hm-${idx + 1}`,
    itemName: null,
    actualShipperName,
    shipperName,
    width: widthCm,
    length: lengthCm,
    height: heightCm,
    quantity,
    weightPerUnit: weightPerUnitKg,
    cbm,
    aboutCbm,
    cargoType,
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

console.log(`CargoSpec 생성: ${cargoes.length} 화물`);
console.log("\n실화주 목록:");
cargoes.forEach((c, i) =>
  console.log(
    `  ${i + 1}. ${c.actualShipperName.padEnd(25)} ` +
      `qty=${c.quantity} cbm=${c.cbm ?? "-"} about=${c.aboutCbm ?? "-"} ` +
      `size=${c.width}×${c.length}×${c.height} booking=${c.bookingNo ?? "-"}`,
  ),
);

/* =========================================================================
 * 2) AUTO 모드
 * ========================================================================= */

console.log("\n=== AUTO 모드 packBest ===");
const t0 = Date.now();
const auto = packBest(cargoes, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너 ${auto.containers.length}대, unplaced ${auto.unplaced.length}`);

const containerOf = new Map(); // cargoId → containerType
for (const c of auto.containers) {
  for (const row of c.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      containerOf.set(it.cargoId, c.spec.type);
    }
  }
  // bulk items (CT/입고완료) — rows 가 비어있는 컨테이너의 bulkItems 도 트래킹
  for (const bi of c.bulkItems ?? []) {
    containerOf.set(bi.cargoId, c.spec.type);
  }
}

console.log("\n--- AUTO 결과: 실화주 → 컨테이너 ---");
const autoBy40 = [];
const autoBy20 = [];
const autoUnassigned = [];
for (const c of cargoes) {
  const t = containerOf.get(c.id);
  if (t === "40FT") autoBy40.push(c.actualShipperName);
  else if (t === "20FT") autoBy20.push(c.actualShipperName);
  else autoUnassigned.push(c.actualShipperName);
}
console.log(`40FT (${autoBy40.length}): ${autoBy40.join(", ")}`);
console.log(`20FT (${autoBy20.length}): ${autoBy20.join(", ")}`);
if (autoUnassigned.length) console.log(`UNASSIGNED (${autoUnassigned.length}): ${autoUnassigned.join(", ")}`);

/* =========================================================================
 * 3) AUTO vs EXPECTED diff
 * ========================================================================= */

console.log("\n=== AUTO vs EXPECTED diff ===");
let mismatch = 0;
let containerMismatch40 = 0;
let containerMismatch20 = 0;

for (let i = 0; i < cargoes.length; i++) {
  const c = cargoes[i];
  const expected = i < EXPECTED_FORTY.length ? "40FT" : "20FT";
  const actual = containerOf.get(c.id) ?? "(none)";
  const expectedShipper =
    i < EXPECTED_FORTY.length
      ? EXPECTED_FORTY[i]
      : EXPECTED_TWENTY[i - EXPECTED_FORTY.length];
  const shipperMatch = c.actualShipperName === expectedShipper;
  const containerMatch = actual === expected;
  if (!containerMatch) {
    mismatch++;
    if (expected === "40FT") containerMismatch40++;
    else containerMismatch20++;
    console.log(
      `  ✗ row ${i + 1}: ${c.actualShipperName} (expected ${expected}, actual ${actual})` +
        (shipperMatch ? "" : ` [shipper diff: expected="${expectedShipper}"]`),
    );
  }
}
console.log(
  `\nmismatch ${mismatch}/${cargoes.length} (40FT 누락 ${containerMismatch40}, 20FT 누락 ${containerMismatch20})`,
);

/* =========================================================================
 * 4) FORCE 모드 — 실무자 expected mapping 강제
 * ========================================================================= */

console.log("\n=== FORCE 모드 — 실무자 분배 강제 ===");
const fixedAssignment = {};
for (let i = 0; i < cargoes.length; i++) {
  fixedAssignment[cargoes[i].id] = i < EXPECTED_FORTY.length ? 1 : 2;
}
const force = pack(cargoes, "auto", {
  fixedContainers: ["40FT", "20FT"],
  fixedAssignment,
});
console.log(
  `force 결과: 컨테이너 ${force.containers.length}대, unplaced ${force.unplaced.length}`,
);

/* =========================================================================
 * 5) 물리·CBM·무게 검증 (FORCE 결과)
 * ========================================================================= */

console.log("\n--- 물리·한도 검증 (FORCE) ---");
let physicalPass = true;
for (const c of force.containers) {
  const spec = c.spec;
  const totalCbm = c.cbmFillRate * (spec.cbm ?? 0); // approx
  const placed = [];
  for (const r of c.rows)
    for (const it of [...r.bottomItems, ...r.topItems]) placed.push(it);

  // Bounding box
  let bbOK = true;
  for (const p of placed) {
    if (
      p.position.x + p.size.width > spec.innerWidth + 0.5 ||
      p.position.y + p.size.length > spec.innerLength + 0.5
    ) {
      bbOK = false;
      break;
    }
  }

  // Weight
  const weight = c.totalWeightKg ?? 0;
  const weightOK = weight <= (spec.maxWeightKg ?? Infinity);

  console.log(
    `[${spec.type}] placed=${placed.length}, fill ${c.cbmFillRate.toFixed(1)}%, ` +
      `weight ${weight}/${spec.maxWeightKg}, bb ${bbOK ? "✓" : "✗"}, weight ${weightOK ? "✓" : "✗"}`,
  );
  if (!bbOK || !weightOK) physicalPass = false;
}

/* =========================================================================
 * 6) Booking 인접
 * ========================================================================= */

console.log("\n--- Booking 인접 (AUTO) ---");
const bookingByContainer = new Map(); // bookingNo → Set<containerType>
for (const c of cargoes) {
  if (!c.bookingNo) continue;
  const t = containerOf.get(c.id);
  if (!t) continue;
  if (!bookingByContainer.has(c.bookingNo))
    bookingByContainer.set(c.bookingNo, new Set());
  bookingByContainer.get(c.bookingNo).add(t);
}
let bookingSplit = 0;
for (const [bk, set] of bookingByContainer) {
  if (set.size > 1) {
    bookingSplit++;
    console.log(`  ✗ ${bk} split across: ${[...set].join(", ")}`);
  }
}
console.log(`booking split ${bookingSplit}/${bookingByContainer.size}`);

/* =========================================================================
 * 7) 종합
 * ========================================================================= */

console.log("\n=== 종합 ===");
const allOK = mismatch === 0 && physicalPass && bookingSplit === 0;
console.log(`AUTO 분배 일치 : ${mismatch === 0 ? "✅" : "❌"} (mismatch ${mismatch})`);
console.log(`FORCE 물리·한도 : ${physicalPass ? "✅" : "❌"}`);
console.log(`Booking 인접   : ${bookingSplit === 0 ? "✅" : "❌"} (split ${bookingSplit})`);
console.log(`전체           : ${allOK ? "✅ PASS" : "❌ FAIL"}`);

process.exit(allOK ? 0 : 1);
