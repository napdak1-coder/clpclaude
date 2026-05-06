/**
 * 3개 샘플 영속화 JSON 일괄 재생성:
 *  - 새 파서(parseDimensionsFromText mm→cm 정규화 + per-row HBL/DEST 추출)로 저장
 *  - 기존 user 편집 손실 가능성: 의도적 (per-row HBL/DEST 추가가 우선)
 */
import fs from "node:fs";
import path from "node:path";

const { parseExcelFile, parseDimensionsFromText } = await import("../lib/excel.ts");

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

const toNum = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

async function buildSample(xlsxPath, extraRows = []) {
  const buf = fs.readFileSync(xlsxPath);
  const fakeFile = {
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const parsed = await parseExcelFile(fakeFile);

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

  const cellOf = (row) => (field) => {
    for (const [h, f] of Object.entries(mapping)) {
      if (f === field) return row[h];
    }
    return undefined;
  };

  const rows = [];
  for (const row of parsed.rows) {
    const cell = cellOf(row);
    const actualShipperName = String(cell("actualShipperName") ?? "").trim();
    if (!actualShipperName) continue;

    const itemRemark = String(cell("itemRemark") ?? "");
    let widthCm = 0,
      lengthCm = 0,
      heightCm = 0;
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
        width: d.width,
        length: d.length,
        height: d.height,
        quantity: d.count && d.count > 0 ? d.count : 1,
        weight: 0,
      }));
    }

    const cbmVal = toNum(cell("cbm"));
    const aboutHeader = parsed.headers.find(
      (h) => String(h).toLowerCase().trim() === "about",
    );
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

  for (const extra of extraRows) rows.push(extra);

  const meta = parsed.meta ?? {};
  const bookingPatch = {};
  if (meta.bookingNo) bookingPatch.bookingNo = meta.bookingNo;
  if (meta.destination) bookingPatch.destination = meta.destination;
  if (meta.containerType) bookingPatch.about = `SIZE:${meta.containerType}`;

  return { bookingPatch, rows };
}

const SAMPLES = [
  { key: "singapore-total", xlsx: "public/samples/singapore-total.xlsx" },
  {
    key: "singapore-total-2",
    xlsx: "public/samples/singapore-total-2.xlsx",
    extras: [
      {
        cargoType: "PK",
        itemName: "",
        actualShipperName: "세광하이테크",
        shipperName: "(주) 세이프로지스/찬의 /",
        widthCm: 31,
        lengthCm: 11,
        heightCm: 25,
        quantity: 1,
        weightPerUnitKg: 13.8,
        cbm: null,
        aboutCbm: 0.01,
        noStacking: false,
        topOnly: false,
        orientation: "free",
        heavierBelow: false,
        itemRemark: "310*110*250 (mm)",
        bookingNo: "FBSIN260388",
        houseBlNo: "FBSIN260388",
        destination: "SINGAPORE",
      },
    ],
  },
  { key: "hochiminh-total", xlsx: "public/samples/hochiminh-total.xlsx" },
];

for (const s of SAMPLES) {
  const payload = await buildSample(path.resolve(s.xlsx), s.extras ?? []);
  const out = path.resolve(`data/samples/${s.key}.json`);
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  const hblCount = payload.rows.filter((r) => r.houseBlNo).length;
  const bnCount = payload.rows.filter((r) => r.bookingNo).length;
  const destCount = payload.rows.filter((r) => r.destination).length;
  console.log(
    `${s.key}: rows=${payload.rows.length} | hbl=${hblCount} bn=${bnCount} dest=${destCount} → ${out}`,
  );
}
