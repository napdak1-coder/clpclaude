/**
 * 샘플 파일 → 알고리즘 통과 검증 스크립트 (수동 실행)
 *
 * 검증 항목:
 *  - 입고완료 CFS CBM 합 = 45.38 m³ (사용자 보고와 일치하는지)
 *  - bulkItems 에 width/length/height/quantity/weightPerUnit 채워졌는지
 *  - 분할 발생 시 sub 라벨 가능한 데이터인지 (cbm < totalCbm)
 *  - 미배치(unplaced) 건수 표시
 *
 * 실행: node scripts/verify-sample-pack.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

// 알고리즘 import — TS 파일 직접 import 위해 strip-types 플래그 필요
// (node --experimental-strip-types scripts/verify-sample-pack.mjs)
const { pack } = await import("../lib/packing/algorithm.ts");

// 1) xlsx 읽기
const buf = readFileSync(
  path.resolve(process.cwd(), "public/samples/singapore-total.xlsx"),
);
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  blankrows: false,
  defval: null,
});

// 2) 헤더 9행, 데이터 10~32행. CFS CBM 컬럼 인덱스 찾기
const HEADER_ROW = 9;
const headers = rows[HEADER_ROW];
const cfsIdx = headers.findIndex(
  (h) => typeof h === "string" && h.toLowerCase().includes("cfs cbm"),
);
const qtyIdx = headers.findIndex(
  (h) => typeof h === "string" && (h.includes("Q'TY") || h.includes("수량")),
);
const wtIdx = headers.findIndex(
  (h) => typeof h === "string" && h.includes("G. W/T"),
);
const remarkIdx = headers.findIndex(
  (h) => typeof h === "string" && h.includes("REMARK"),
);
const cargoTypeIdx = qtyIdx + 1; // Q'TY 우측 인접
const shipperIdx = headers.findIndex(
  (h) => typeof h === "string" && h.includes("화주") && !h.includes("실"),
);
const actualShipperIdx = headers.findIndex(
  (h) => typeof h === "string" && h.includes("실화주"),
);

console.log("\n=== 헤더 인덱스 ===");
console.log({ cfsIdx, qtyIdx, wtIdx, remarkIdx, cargoTypeIdx, shipperIdx });

// 3) 사이즈 패턴 추출 (lib/excel.ts 의 parseDimensionsFromText 간단 복제)
function parseDimensions(text) {
  if (!text || typeof text !== "string") return null;
  // 112x145x165(2) / 247x129x46(2) / 110*110*95 / 180 90 27 / 1 패턴 매치
  const patterns = [
    /(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)\s*\(?(\d+)?\)?/,
    /(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return {
        width: Number(m[1]),
        length: Number(m[2]),
        height: Number(m[3]),
        count: m[4] ? Number(m[4]) : 1,
      };
    }
  }
  return null;
}

// 4) CargoSpec[] 만들기
const cargoes = [];
let cfsTotal = 0;
const dataRows = rows.slice(HEADER_ROW + 1, HEADER_ROW + 1 + 30);
for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i];
  if (!r || r.every((c) => c == null)) continue;
  const noStr = r[0];
  if (typeof noStr === "string" && noStr.trim().toUpperCase().includes("TOTAL"))
    break;
  const cfs = Number(r[cfsIdx]) || 0;
  const qty = Number(r[qtyIdx]) || 1;
  const wt = Number(r[wtIdx]) || 0;
  const cargoType = String(r[cargoTypeIdx] ?? "").trim().toUpperCase();
  const remark = String(r[remarkIdx] ?? "");
  const shipper = String(r[shipperIdx] ?? "").trim();
  const actualShipper = String(r[actualShipperIdx] ?? "").trim();
  const dim = parseDimensions(remark);
  if (cfs > 0) cfsTotal += cfs;

  cargoes.push({
    id: `c${i}`,
    shipmentId: "test",
    sortOrder: i,
    cargoType: ["PL", "WB", "WC", "WD", "CR", "CL", "CT"].includes(cargoType)
      ? cargoType
      : "CT",
    itemName: `행${i + 1}`,
    actualShipperName: actualShipper || undefined,
    shipperName: shipper || undefined,
    width: dim?.width ?? 0,
    length: dim?.length ?? 0,
    height: dim?.height ?? 0,
    quantity: dim?.count ?? qty,
    weightPerUnit: wt,
    cbm: cfs > 0 ? cfs : undefined,
    aboutCbm: undefined,
    remarks: {
      noStacking: false,
      topOnly: false,
      orientation: "free",
      heavierBelow: false,
    },
  });
}

console.log(`\n=== 입력 화물 ${cargoes.length}건 ===`);
console.log("CFS CBM 합 (입고완료):", cfsTotal.toFixed(3), "m³");
const completed = cargoes.filter((c) => c.cbm != null && c.cbm > 0);
const visual = cargoes.filter(
  (c) => (c.cbm == null || c.cbm <= 0) && c.cargoType !== "CT",
);
const ct = cargoes.filter((c) => (c.cbm == null || c.cbm <= 0) && c.cargoType === "CT");
console.log(`분류: 입고완료 ${completed.length} / 시각 ${visual.length} / CT ${ct.length}`);
console.log(
  "사이즈 0인 시각화물 (REMARK 추출 실패):",
  visual.filter((c) => c.width === 0 || c.length === 0 || c.height === 0).length,
);

// 5) pack 실행
const result = pack(cargoes, "auto");
console.log(`\n=== pack 결과 ===`);
console.log(`컨테이너 ${result.containers.length}대 (20FT ${result.summary.count20FT}, 40FT ${result.summary.count40FT})`);
console.log("totalCbm (시각):", result.summary.totalCbm.toFixed(3));
console.log("ctTotalCbm:", result.summary.ctTotalCbm.toFixed(3));
console.log("completedTotalCbm:", result.summary.completedTotalCbm.toFixed(3));
console.log("warnings:", result.summary.warnings);
console.log(`unplaced: ${result.unplaced.length}건`);
result.unplaced.slice(0, 10).forEach((u) => {
  console.log("  -", u.cargoId, ":", u.reason);
});

// 6) bulkItems 검증
console.log("\n=== 컨테이너별 bulkItems 검사 ===");
for (const cont of result.containers) {
  console.log(`#${cont.index} ${cont.spec.type}:`);
  console.log(
    `  ctCbm=${cont.ctCbm.toFixed(2)}, completedCbm=${cont.completedCbm.toFixed(2)}, fillRate=${cont.cbmFillRate.toFixed(1)}%`,
  );
  console.log(`  rows: ${cont.rows.length}, bulkItems: ${cont.bulkItems.length}`);
  for (const b of cont.bulkItems.slice(0, 5)) {
    const split = Math.abs(b.cbm - b.totalCbm) > 0.001 ? " 🔀분할" : "";
    console.log(
      `    [${b.group}] ${b.shipper || "-"} | ${b.name || "-"} | ${b.width}×${b.length}×${b.height} | qty=${b.quantity} | unitWt=${b.weightPerUnit} | cbm=${b.cbm.toFixed(3)}${split} (총 ${b.totalCbm.toFixed(2)})`,
    );
  }
  if (cont.bulkItems.length > 5) console.log(`    ... 외 ${cont.bulkItems.length - 5}개`);
}

// 7) 합계 검증
const totalBulkCbm = result.containers.reduce(
  (s, c) => s + c.bulkItems.reduce((ss, b) => ss + b.cbm, 0),
  0,
);
console.log(
  `\n=== 합계 검증 ===\n입력 CFS 합 ${cfsTotal.toFixed(3)} ↔ summary.completedTotalCbm ${result.summary.completedTotalCbm.toFixed(3)} ↔ bulkItems 분배 합 ${totalBulkCbm.toFixed(3)}`,
);
const ok = Math.abs(cfsTotal - result.summary.completedTotalCbm) < 0.01;
console.log(ok ? "✅ 일치" : "❌ 불일치");
