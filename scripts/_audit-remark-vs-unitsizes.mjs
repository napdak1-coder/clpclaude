/**
 * 5 샘플 JSON 의 itemRemark (REMARK 텍스트) vs unitSizes (배열) 일치 검사.
 *
 * REMARK 패턴 예: "116*55*74, 110*110*143X2, 110*110*152X2"
 *   → 116×55×74 ×1, 110×110×143 ×2, 110×110×152 ×2 = 총 5박스
 *
 * unitSizes 가 REMARK 와 일치하는지 확인 → 불일치 = 파싱 버그.
 */
import fs from "node:fs";
import path from "node:path";

const SAMPLES = [
  { label: "1ST SG", json: "data/samples/singapore-total.json" },
  { label: "1ST HM", json: "data/samples/hochiminh-total.json" },
  { label: "2ST SG", json: "data/samples/singapore-total-2.json" },
  { label: "2ST HM", json: "data/samples/hochiminh-total-2.json" },
  { label: "3ST SG", json: "data/samples/singapore-total-3.json" },
];

/**
 * REMARK 텍스트 → [{w, l, h, qty}, ...]
 * 패턴: 숫자*숫자*숫자 (또는 x/X), 끝에 *N 또는 XN 또는 xN 있으면 수량.
 *   "116*55*74"        → {116,55,74,1}
 *   "110*110*143X2"    → {110,110,143,2}
 *   "110*110*152x3"    → {110,110,152,3}
 *   "116**55*74"       → {116,55,74,1}  (** 두번 = 띄어쓰기 의도)
 */
function parseRemark(text) {
  if (!text) return [];
  const out = [];
  // 정규식: 숫자[*xX]+숫자[*xX]+숫자 + 수량 옵션
  //   수량 표기: "X2", "x3", "*4", "(5)" 모두 지원
  const re = /(\d+)\s*[*xX]+\s*(\d+)\s*[*xX]+\s*(\d+)(?:\s*(?:[*xX]\s*(\d+)|\((\d+)\)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const qty = m[4] ? Number(m[4]) : m[5] ? Number(m[5]) : 1;
    out.push({
      w: Number(m[1]),
      l: Number(m[2]),
      h: Number(m[3]),
      qty,
    });
  }
  return out;
}

function sizeKey(w, l, h) {
  return [w, l, h].sort((a, b) => a - b).join("×"); // 정렬 후 비교 (회전 무관)
}

function summarize(boxes) {
  const m = new Map();
  for (const b of boxes) {
    const k = sizeKey(b.w, b.l, b.h);
    m.set(k, (m.get(k) ?? 0) + (b.qty ?? 1));
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function summarizeUnits(unitSizes) {
  const m = new Map();
  for (const u of unitSizes ?? []) {
    if (!u.width || !u.length || !u.height) continue;
    const k = sizeKey(u.width, u.length, u.height);
    m.set(k, (m.get(k) ?? 0) + (u.quantity ?? 1));
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

const allMismatch = [];

for (const s of SAMPLES) {
  const abs = path.resolve(s.json);
  if (!fs.existsSync(abs)) {
    console.log(`[${s.label}] 파일 없음 — skip`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  console.log(`\n=== [${s.label}] 총 ${data.rows.length} 행 ===`);

  let ok = 0,
    mismatch = 0,
    noRemark = 0;
  const mList = [];

  data.rows.forEach((r, idx) => {
    const remark = r.itemRemark ?? "";
    const parsed = parseRemark(remark);
    const remarkSum = summarize(parsed);
    const unitSum = summarizeUnits(r.unitSizes ?? []);
    const remarkBoxCount = parsed.reduce((s, x) => s + x.qty, 0);
    const unitBoxCount = (r.unitSizes ?? []).reduce(
      (s, u) => s + (u.quantity ?? 1),
      0,
    );
    const rowQty = r.quantity ?? 0;
    const hasRowSize = (r.widthCm ?? 0) > 0 && (r.lengthCm ?? 0) > 0 && (r.heightCm ?? 0) > 0;
    const rowSizeKey = hasRowSize ? sizeKey(r.widthCm, r.lengthCm, r.heightCm) : null;

    if (parsed.length === 0) {
      noRemark++;
      return;
    }

    // 진짜 버그 패턴 분류
    const reasons = [];

    // (A) REMARK 다중 사이즈 (2종+) 인데 unitSizes 비어있음 또는 부족
    if (remarkSum.length >= 2 && unitSum.length < remarkSum.length) {
      reasons.push(`REMARK ${remarkSum.length}종 사이즈인데 unitSizes ${unitSum.length}종`);
    }
    // (B) unitSizes 있는데 REMARK 와 사이즈 종류·수량 다름
    if (unitSum.length > 0 && !arraysEqual(remarkSum, unitSum)) {
      reasons.push(`사이즈/수량 불일치`);
    }
    // (C) unitSizes 비어있고 REMARK 1종 — 행 단위 사이즈와 비교
    if (
      unitSum.length === 0 &&
      remarkSum.length === 1 &&
      hasRowSize &&
      remarkSum[0][0] !== rowSizeKey
    ) {
      reasons.push(`REMARK ${remarkSum[0][0]} ≠ 행 사이즈 ${rowSizeKey}`);
    }
    // (D) 박스 총수 불일치 (REMARK 박스 수 vs quantity)
    if (remarkBoxCount > 0 && rowQty > 0 && remarkBoxCount !== rowQty) {
      // 1종 사이즈 + qty>1 일 때 REMARK 1로 표기되는 정상 케이스 제외
      const isSingleNoQtyMark = remarkSum.length === 1 && remarkBoxCount === 1 && rowQty > 1;
      if (!isSingleNoQtyMark) {
        reasons.push(`박스 수 REMARK ${remarkBoxCount} vs Q'TY ${rowQty}`);
      }
    }

    if (reasons.length === 0) {
      ok++;
    } else {
      mismatch++;
      mList.push({
        idx: idx + 1,
        shipper: r.actualShipperName ?? "",
        booking: r.bookingNo ?? "",
        qty: rowQty,
        remark,
        remarkSum,
        unitSum,
        rowSize: rowSizeKey,
        reasons,
      });
    }
  });

  console.log(
    `  일치: ${ok}, 불일치: ${mismatch}, REMARK 없음/판단불가: ${noRemark}`,
  );
  if (mList.length > 0) {
    console.log(`  --- 진짜 버그 의심 행 ---`);
    for (const m of mList) {
      console.log(
        `  [#${m.idx}] ${m.shipper} (booking=${m.booking}, qty=${m.qty}) — ${m.reasons.join("; ")}`,
      );
      console.log(`    REMARK: ${m.remark.replace(/\n/g, " | ")}`);
      console.log(`    REMARK 파싱: ${m.remarkSum.map(([k, v]) => `${k}×${v}`).join(", ")}`);
      console.log(`    unitSizes : ${m.unitSum.length > 0 ? m.unitSum.map(([k, v]) => `${k}×${v}`).join(", ") : "(비어있음)"}`);
      console.log(`    행 사이즈 : ${m.rowSize ?? "(없음)"}`);
      allMismatch.push({ sample: s.label, ...m });
    }
  }
}

console.log(`\n\n=== 종합: 5 샘플 불일치 ${allMismatch.length} 행 ===`);
if (allMismatch.length === 0) {
  console.log("모든 행 REMARK ↔ unitSizes 일치");
}
