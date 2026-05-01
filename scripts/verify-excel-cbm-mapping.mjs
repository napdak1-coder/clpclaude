/**
 * 새 부킹 페이지의 "샘플: 싱가폴 TOTAL" 버튼이 호출하는 파싱 흐름을 그대로 재현.
 * lib/excel.ts 의 parseExcelFile + mapHeadersToFields 를 사용해서
 * 각 화물 행의 "엑셀 CBM" 값이 xlsx 원본의 "CFS CBM" 셀 값과 일치하는지 검증.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const { parseExcelFile, mapHeadersToFields, displayHeader } = await import(
  "../lib/excel.ts"
);

const samplePath = path.resolve(
  process.cwd(),
  "public/samples/singapore-total.xlsx",
);
const buf = readFileSync(samplePath);

// Node 환경의 File polyfill (브라우저 흐름과 같은 인자 모양)
class FilePolyfill {
  constructor(parts, name, opts = {}) {
    this._buf = Buffer.concat(parts.map((p) => Buffer.from(p)));
    this.name = name;
    this.type = opts.type ?? "";
  }
  async arrayBuffer() {
    return this._buf.buffer.slice(
      this._buf.byteOffset,
      this._buf.byteOffset + this._buf.byteLength,
    );
  }
}
if (typeof globalThis.File === "undefined") {
  globalThis.File = FilePolyfill;
}

const file = new File([buf], "singapore-total.xlsx");
const parsed = await parseExcelFile(file);
const mapping = mapHeadersToFields(parsed.headers);

console.log("=== 자동 매핑 결과 ===");
const cbmEntry = Object.entries(mapping).find(([, f]) => f === "cbm");
if (!cbmEntry) {
  console.log("❌ cbm 필드로 매핑된 헤더가 없습니다");
  process.exit(1);
}
const [cbmHeader, cbmField] = cbmEntry;
console.log(
  `cbm(엑셀 CBM) ← 헤더 "${displayHeader(cbmHeader)}" (raw key: ${JSON.stringify(cbmHeader)})`,
);

// 다른 cbm 후보 헤더가 있는지(중복 매핑) 확인
const allCbmCandidates = parsed.headers.filter((h) =>
  /cfs|cbm/i.test(String(h).toLowerCase()),
);
console.log(`\nxlsx 헤더 중 CBM 관련 후보: [${allCbmCandidates.map(displayHeader).join(", ")}]`);

// xlsx 원본에서 CFS CBM 컬럼 값 직접 추출 (대조용 ground truth)
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  blankrows: false,
  defval: null,
});
const headerRowIdx = parsed.headerRowIndex; // parseExcelFile 가 알려준 인덱스
const headerRow = rawRows[headerRowIdx];
const cfsRawColIdx = headerRow.findIndex(
  (h) => typeof h === "string" && /cfs\s*cbm/i.test(h.trim()),
);
console.log(
  `\nxlsx 헤더 행 (${headerRowIdx + 1}행) 의 CFS CBM 컬럼 인덱스 = ${cfsRawColIdx}`,
);

// 각 데이터 행 비교
console.log("\n=== 행별 비교 (parseExcelFile 결과 vs xlsx 원본 CFS CBM 셀) ===");
let matched = 0;
let mismatched = 0;
let nonZero = 0;
let parsedSum = 0;
let rawSum = 0;
parsed.rows.forEach((row, idx) => {
  const parsedVal = row[cbmHeader];
  const parsedNum =
    typeof parsedVal === "number"
      ? parsedVal
      : Number(String(parsedVal ?? "").replace(/,/g, "")) || 0;
  // xlsx 의 같은 행 (header 행 + 1 + idx)
  const rawRow = rawRows[headerRowIdx + 1 + idx];
  const rawVal = rawRow ? rawRow[cfsRawColIdx] : null;
  const rawNum =
    typeof rawVal === "number"
      ? rawVal
      : Number(String(rawVal ?? "").replace(/,/g, "")) || 0;
  parsedSum += parsedNum;
  rawSum += rawNum;
  const ok = Math.abs(parsedNum - rawNum) < 0.001;
  if (ok) matched += 1;
  else mismatched += 1;
  if (rawNum > 0) nonZero += 1;
  const flag = ok ? "✅" : "❌";
  console.log(
    `  ${flag} 행 ${idx + 1}: parsed=${parsedNum} | xlsx=${rawNum}` +
      (ok ? "" : "   ← 차이"),
  );
});

console.log(
  `\n=== 합계 ===\nparseExcelFile 의 cbm 합 = ${parsedSum.toFixed(3)} m³\nxlsx 원본 CFS CBM 합 = ${rawSum.toFixed(3)} m³\nCFS CBM 값 있는 행 수 = ${nonZero}/${parsed.rows.length}\n매칭 ${matched}행 / 불일치 ${mismatched}행`,
);
console.log(
  matched === parsed.rows.length
    ? "\n✅ 결과: 샘플 엑셀의 CFS CBM 이 그대로 '엑셀 CBM' 으로 파싱됩니다."
    : "\n⚠️ 일부 행에서 값 차이가 발견됨 — 위 ❌ 행 확인.",
);
