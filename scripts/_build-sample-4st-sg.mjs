/**
 * 4ST SG TOTAL 영속화본 생성 — singapore-total-4.xlsx → data/samples/singapore-total-4.json
 *
 * 사용자가 브라우저에서 import + 저장 안 한 경우 임시로 server-side 에서 매핑 거쳐 생성.
 * 매핑 룰: lib/excel.ts 의 KEYWORDS + ExcelImport.tsx 의 변환 로직 모방.
 */
import fs from "node:fs";
import path from "node:path";

const { parseExcelFile, parseDimensionsFromText, extractFlagsAndStrip } =
  await import("../lib/excel.ts");

const XLSX = path.resolve("public/samples/singapore-total-4.xlsx");
const OUT = path.resolve("data/samples/singapore-total-4.json");

const buf = fs.readFileSync(XLSX);
const fakeFile = {
  arrayBuffer: async () =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};
const parsed = await parseExcelFile(fakeFile);

console.log(`총 ${parsed.rows.length} 행`);
console.log(`헤더 ${parsed.headers.length}개`);

// 헤더 매핑 — KEYWORDS 기반 (lib/excel.ts:520~)
const KW = {
  itemActualShipperName: ["실화주"],
  itemShipperName: ["화주"],
  bookingNo: ["booking no", "house b/l"],
  destination: ["dest"],
  cargoType: ["구분", "type"],
  widthCm: ["가로", "width", "폭"],
  lengthCm: ["세로", "length", "길이"],
  heightCm: ["높이", "height"],
  quantity: ["q'ty", "qty", "수량"],
  weightPerUnitKg: ["g.w/t", "g. w/t", "g.wt", "kg", "무게", "중량"],
  cbm: ["cfs cbm", "cbm"],
  about: ["about"],
  itemRemark: ["remark", "비고"],
};
function compact(s) {
  return String(s).toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
}
function guess(header) {
  const lower = String(header).trim().toLowerCase();
  if (!lower || lower.startsWith("__empty")) return null;
  const compactH = compact(header);
  for (const [field, kws] of Object.entries(KW)) {
    for (const kw of kws) {
      if (lower.includes(kw.toLowerCase()) || compactH.includes(compact(kw))) {
        return field;
      }
    }
  }
  return null;
}

const mapping = {};
const usedFields = new Set();
for (const h of parsed.headers) {
  const f = guess(h);
  // 같은 field 두 번째 헤더는 무시 (예: "입고된 화물 60CBM..." 메모가 cbm 매핑 덮어쓰기 차단)
  if (f && !usedFields.has(f)) {
    mapping[h] = f;
    usedFields.add(f);
  }
}

// cargoType 폴백 — 명시 헤더 없으면 Q'TY 우측 컬럼 (__EMPTY_N) 에서 추출.
// 엑셀 양식상 Q'TY 옆 빈 셀에 PL/CT/PK/CR/WB/WC/BX/CS 등 코드가 들어감.
const qtyHeader = Object.keys(mapping).find((h) => mapping[h] === "quantity");
let cargoTypeFallbackHeader = null;
if (qtyHeader && !usedFields.has("cargoType")) {
  const qtyIdx = parsed.headers.indexOf(qtyHeader);
  if (qtyIdx >= 0 && qtyIdx + 1 < parsed.headers.length) {
    cargoTypeFallbackHeader = parsed.headers[qtyIdx + 1];
  }
}
console.log("\n--- 매핑 ---");
for (const [h, f] of Object.entries(mapping)) console.log(`  ${h} → ${f}`);

const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const rows = [];
parsed.rows.forEach((raw, idx) => {
  const r = {
    cargoType: "PL",
    bookingNo: "",
    houseBlNo: "",
    destination: "",
    itemName: "",
    actualShipperName: "",
    shipperName: "",
    widthCm: 0,
    lengthCm: 0,
    heightCm: 0,
    quantity: 1,
    weightPerUnitKg: 0,
    cbm: null,
    aboutCbm: null,
    noStacking: false,
    topOnly: false,
    orientation: "free",
    heavierBelow: false,
    itemRemark: "",
    unitSizes: undefined,
  };

  for (const [header, field] of Object.entries(mapping)) {
    const v = raw[header];
    switch (field) {
      case "itemActualShipperName":
        r.actualShipperName = String(v ?? "").trim();
        break;
      case "itemShipperName":
        r.shipperName = String(v ?? "").trim();
        break;
      case "bookingNo":
        if (!r.bookingNo) r.bookingNo = String(v ?? "").trim();
        if (header.toLowerCase().includes("house"))
          r.houseBlNo = String(v ?? "").trim();
        break;
      case "destination":
        r.destination = String(v ?? "").trim();
        break;
      case "cargoType":
        r.cargoType = String(v ?? "PL").trim() || "PL";
        break;
      case "widthCm":
        r.widthCm = toNum(v);
        break;
      case "lengthCm":
        r.lengthCm = toNum(v);
        break;
      case "heightCm":
        r.heightCm = toNum(v);
        break;
      case "quantity":
        r.quantity = Math.max(1, Math.round(toNum(v)));
        break;
      case "weightPerUnitKg":
        r.weightPerUnitKg = toNum(v);
        break;
      case "cbm":
        r.cbm = toNum(v) || null;
        break;
      case "about":
        r.aboutCbm = toNum(v) || null;
        break;
      case "itemRemark":
        r.itemRemark = String(v ?? "");
        break;
    }
  }

  // cargoType 폴백 — 명시 헤더 매핑 없으면 Q'TY 우측 컬럼 값 사용
  if (cargoTypeFallbackHeader) {
    const fallback = String(raw[cargoTypeFallbackHeader] ?? "").trim();
    // 유효 코드만 (PL/CT/PK/CR/WB/WC/BX/CS 등 2~3자 영문)
    if (/^[A-Z]{1,4}$/.test(fallback)) {
      r.cargoType = fallback;
    }
  }

  // 의미 있는 행만 (실화주 또는 cbm 또는 사이즈 있음)
  const hasAny =
    (r.actualShipperName && r.actualShipperName.length > 0) ||
    (r.cbm ?? 0) > 0 ||
    (r.aboutCbm ?? 0) > 0 ||
    r.widthCm > 0;
  if (!hasAny) return;

  // REMARK 에서 사이즈 텍스트 추출 → unitSizes
  if (r.itemRemark) {
    const flagged = extractFlagsAndStrip(r.itemRemark);
    if (flagged.flags) {
      r.noStacking = flagged.flags.noStacking ?? false;
      r.topOnly = flagged.flags.topOnly ?? false;
      r.orientation = flagged.flags.orientation ?? "free";
      r.heavierBelow = flagged.flags.heavierBelow ?? false;
    }
    const dims = parseDimensionsFromText(r.itemRemark);
    if (dims.length > 0) {
      const expanded = [];
      for (const d of dims) {
        for (let i = 0; i < d.qty; i++) {
          expanded.push({
            width: d.width,
            length: d.length,
            height: d.height,
            quantity: 1,
            weight: 0,
          });
        }
      }
      if (expanded.length > 0) r.unitSizes = expanded;
      // 행 단위 사이즈가 비었으면 첫 박스로 보충
      if (r.widthCm === 0 && dims[0]) {
        r.widthCm = dims[0].width;
        r.lengthCm = dims[0].length;
        r.heightCm = dims[0].height;
      }
    }
  }

  rows.push(r);
});

console.log(`\n변환 후 ${rows.length} 행`);
let cbmHas = 0,
  aboutHas = 0;
rows.forEach((r) => {
  if ((r.cbm ?? 0) > 0) cbmHas++;
  if ((r.aboutCbm ?? 0) > 0) aboutHas++;
});
console.log(`cbm 채워진 행: ${cbmHas}`);
console.log(`aboutCbm 채워진 행: ${aboutHas}`);

const payload = { bookingPatch: {}, rows };
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`\n✅ 저장 완료: ${OUT}`);
