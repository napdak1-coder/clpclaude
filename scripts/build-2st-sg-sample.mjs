/**
 * 2ST SG TOTAL 영속화 JSON 생성:
 *  - public/samples/singapore-total-2.xlsx 의 22 행 파싱
 *  - 추가 부킹 (세광하이테크 FBSIN260388) 1 행 append
 *  - data/samples/singapore-total-2.json 저장 (SamplePayload 포맷)
 */
import fs from "node:fs";
import path from "node:path";

const { parseExcelFile, parseDimensionsFromText } = await import("../lib/excel.ts");

const XLSX_PATH = path.resolve("public/samples/singapore-total-2.xlsx");
const OUT = path.resolve("data/samples/singapore-total-2.json");

const buf = fs.readFileSync(XLSX_PATH);
const fakeFile = {
  arrayBuffer: async () =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};
const parsed = await parseExcelFile(fakeFile);

const FIELD_MAP = new Map([
  ["house b/l", "houseBlNo"],
  ["booking no", "bookingNo"],
  ["dest", "destination"],
  ["실화주", "actualShipperName"],
  ["화주", "shipperName"],
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
  for (const [key, field] of FIELD_MAP) {
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

const rows = [];
for (const row of parsed.rows) {
  const cell = (field) => {
    for (const [h, f] of Object.entries(mapping)) {
      if (f === field) return row[h];
    }
    return undefined;
  };
  const aboutHeader = parsed.headers.find(
    (h) => String(h).toLowerCase().trim() === "about",
  );

  const actualShipperName = String(cell("actualShipperName") ?? "").trim();
  if (!actualShipperName) continue;

  const itemRemark = String(cell("itemRemark") ?? "");
  let widthCm = 0, lengthCm = 0, heightCm = 0;
  let unitSizes;
  let quantity = Math.max(1, Math.round(toNum(cell("quantity"))));
  const dims = parseDimensionsFromText(itemRemark);
  if (dims.length === 1) {
    widthCm = dims[0].width;
    lengthCm = dims[0].length;
    heightCm = dims[0].height;
    if (dims[0].count && dims[0].count > 0) quantity = dims[0].count;
  } else if (dims.length > 1) {
    widthCm = dims[0].width;
    lengthCm = dims[0].length;
    heightCm = dims[0].height;
    const tq = dims.reduce((s, d) => s + (d.count && d.count > 0 ? d.count : 1), 0);
    if (tq > 0) quantity = tq;
    unitSizes = dims.map((d) => ({
      width: d.width, length: d.length, height: d.height,
      quantity: d.count && d.count > 0 ? d.count : 1, weight: 0,
    }));
  }

  const cbmVal = toNum(cell("cbm"));
  const aboutVal = aboutHeader ? toNum(row[aboutHeader]) : 0;

  rows.push({
    cargoType: widthCm > 0 ? "PL" : "CT",
    itemName: "",
    actualShipperName,
    shipperName: String(cell("shipperName") ?? "").trim(),
    widthCm,
    lengthCm,
    heightCm,
    quantity,
    weightPerUnitKg: toNum(cell("weightPerUnitKg")),
    cbm: cbmVal > 0 ? cbmVal : null,
    aboutCbm: aboutVal > 0 ? aboutVal : null,
    noStacking: false,
    topOnly: false,
    orientation: "free",
    heavierBelow: false,
    itemRemark,
    bookingNo: String(cell("bookingNo") ?? "").trim() || undefined,
    houseBlNo: String(cell("houseBlNo") ?? "").trim() || undefined,
    destination: String(cell("destination") ?? "").trim() || undefined,
    ...(unitSizes ? { unitSizes } : {}),
  });
}

console.log(`xlsx 파싱: ${rows.length} 행`);

// 추가 부킹: 세광하이테크 (FBSIN260388)
// REMARK: "310*110*250 (mm)" → parseDimensionsFromText 가 mm→cm 자동 변환 → 31×11×25
const extraRemark = "310*110*250 (mm)";
const extraDims = parseDimensionsFromText(extraRemark);
const ed = extraDims[0];
rows.push({
  cargoType: "PK",
  itemName: "",
  actualShipperName: "세광하이테크",
  shipperName: "(주) 세이프로지스/찬의 /",
  widthCm: ed?.width ?? 31,
  lengthCm: ed?.length ?? 11,
  heightCm: ed?.height ?? 25,
  quantity: 1,
  weightPerUnitKg: 13.80,
  cbm: null,
  aboutCbm: 0.01,
  noStacking: false,
  topOnly: false,
  orientation: "free",
  heavierBelow: false,
  itemRemark: extraRemark,
  bookingNo: "FBSIN260388",
  houseBlNo: "FBSIN260388",
  destination: parsed.meta?.destination ?? "SINGAPORE",
});

// 부킹 패치: meta 정보 (1ST SG 패턴 따라 가정)
const meta = parsed.meta ?? {};
const bookingPatch = {};
if (meta.bookingNo) bookingPatch.bookingNo = meta.bookingNo;
if (meta.destination) bookingPatch.destination = meta.destination;
if (meta.containerType) bookingPatch.about = `SIZE:${meta.containerType}`;

const payload = { bookingPatch, rows };
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`저장: ${OUT}`);
console.log(`총 행수: ${rows.length} (xlsx ${rows.length - 1} + 추가 1)`);
console.log(`마지막 행:`, rows[rows.length - 1]);
