/* 10 샘플 classify read-only trace — 코드 수정 없음.
 *
 * 목적:
 *   사이즈 있는 행이 c.cbm 채워졌다는 이유만으로 CT 벌크로 빠지는지 확인.
 *   사용자 절대 룰 "사이즈 적힌 건 다 시각" 위반 검증.
 *
 * cbm 출처 구분 휴리스틱:
 *   사용자 직접 입력 CFS CBM (Excel "CFS CBM" 열) 은 박스 계산값과 다른 게 보통.
 *   메인 W·L·H 또는 unitSizes 로 계산한 부피 ≈ c.cbm 이면 "자동 계산일 가능성 높음".
 *   상대 오차 ≤ 2% (또는 0.05 m³) 이면 calc 일치로 본다.
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-2", name: "2ST SG", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", name: "3ST SG", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
  { id: "hm-1", name: "1ST HM", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", name: "2ST HM", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", name: "3ST HM", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", name: "4ST HM", file: "data/samples/hochiminh-total-4.json" },
];

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
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

function calcPhysicalCbm(c) {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce((s, u) => {
      if (typeof u.cbm === "number" && u.cbm > 0) return s + u.cbm;
      return s + (u.width * u.length * u.height * u.quantity) / 1_000_000;
    }, 0);
  }
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}

/** c.cbm 값이 "박스 계산값"과 거의 같은지 (calc 자동 채움 의심) */
function isCbmLikelyCalculated(c) {
  if (c.cbm == null || c.cbm <= 0) return false;
  const calc = calcPhysicalCbm(c);
  if (calc <= 0) return false;
  const dAbs = Math.abs(c.cbm - calc);
  const dRel = dAbs / calc;
  return dAbs <= 0.05 || dRel <= 0.02;
}

function hasMainSize(c) {
  return c.width >= 1 && c.length >= 1 && c.height >= 1;
}
function hasUnitSizes(c) {
  return (
    c.unitSizes != null &&
    c.unitSizes.length > 0 &&
    c.unitSizes.every((u) => u.width >= 1 && u.length >= 1 && u.height >= 1)
  );
}
function anyHasSize(c) {
  return hasMainSize(c) || hasUnitSizes(c);
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 10 샘플 classify read-only trace ===");
log(`date: ${new Date().toISOString()}`);
log("");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    log(`[${s.id}] ${s.name} — 파일 없음 (${s.file})`);
    log("");
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const totalRows = cargoes.length;

  const allHaveCbm = totalRows >= 2 && cargoes.every((c) => (c.cbm ?? 0) > 0);
  const cbmCalc = cargoes.map(isCbmLikelyCalculated);
  const cbmFilled = cargoes.map((c) => (c.cbm ?? 0) > 0);
  const allHaveUserEnteredCbm =
    totalRows >= 2 && cargoes.every((c, i) => cbmFilled[i] && !cbmCalc[i]);
  const allHaveCalculatedCbm =
    totalRows >= 2 && cargoes.every((c, i) => cbmFilled[i] && cbmCalc[i]);
  const sizeArr = cargoes.map(anyHasSize);
  const anyHasSizeFlag = sizeArr.some(Boolean);

  const wlhCount = cargoes.filter(hasMainSize).length;
  const unitCount = cargoes.filter(hasUnitSizes).length;
  const sizeAnyCount = sizeArr.filter(Boolean).length;

  // pack 실행 (트레이스용 — auto 모드)
  const result = pack(cargoes, "auto", { attachDebug: true });

  // classify 결과는 result 자체에 노출되지 않으니 우회 — visualCargoes 는 rows 안에 있고,
  // bulkItems 는 컨테이너의 bulkItems 에 있음.
  const placedVisualCargoIds = new Set();
  for (const c of result.containers) {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) placedVisualCargoIds.add(it.cargoId);
      }
    }
  }
  const placedBulkCargoIds = new Set();
  let bulkItemsCount = 0;
  for (const c of result.containers) {
    for (const bi of c.bulkItems ?? []) {
      bulkItemsCount++;
      if (bi.cargoId) placedBulkCargoIds.add(bi.cargoId);
    }
  }
  const unplacedCargoIds = new Set(
    (result.unplaced ?? []).map((u) => u.cargoId).filter(Boolean),
  );

  // 사이즈 있는 행 중 CT (bulk) 로 빠진 행
  const sizedToBulk = cargoes.filter(
    (c) => anyHasSize(c) && placedBulkCargoIds.has(c.id) && !placedVisualCargoIds.has(c.id),
  );
  const sizedToUnplaced = cargoes.filter(
    (c) => anyHasSize(c) && unplacedCargoIds.has(c.id),
  );

  const visualCargoIds = [...placedVisualCargoIds].slice(0, 5);
  const bulkCargoIds = [...placedBulkCargoIds].slice(0, 5);

  // 모든 row 가 어디로 갔는지
  let rowsCount = 0;
  for (const c of result.containers) rowsCount += (c.rows ?? []).length;

  log(`[${s.id}] ${s.name}`);
  log(`  totalRows                   : ${totalRows}`);
  log(`  allHaveCbm                  : ${allHaveCbm}   ← 현재 classify 룰 1 조건`);
  log(`  allHaveUserEnteredCbm       : ${allHaveUserEnteredCbm}   ← cbm 값이 박스 계산값과 다른 행만`);
  log(`  allHaveCalculatedCbm        : ${allHaveCalculatedCbm}   ← cbm 값이 박스 계산값과 ≈ 같은 행만`);
  log(`  anyHasSize                  : ${anyHasSizeFlag}`);
  log(`  W/L/H 있는 행 수            : ${wlhCount}`);
  log(`  unitSizes 있는 행 수        : ${unitCount}`);
  log(`  size 있는 행 (전체)         : ${sizeAnyCount}`);
  log(`  c.cbm 채워진 행 수          : ${cbmFilled.filter(Boolean).length}`);
  log(`  c.cbm ≈ 계산값 인 행 수     : ${cbmCalc.filter(Boolean).length}   ← 자동 채움 의심 행`);
  log(`  -- pack 결과 --`);
  log(`  containers                  : ${result.containers.map((c) => c.spec.type).join("+")}`);
  log(`  visual rows 총합            : ${rowsCount}`);
  log(`  bulkItems 총합              : ${bulkItemsCount}`);
  log(`  unplaced 총 수량            : ${result.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0)}`);
  log(`  visual 로 간 cargoId 5개    : ${visualCargoIds.join(", ") || "(없음)"}`);
  log(`  CT bulk 로 간 cargoId 5개   : ${bulkCargoIds.join(", ") || "(없음)"}`);
  log(`  size 있는데 CT 로 간 행 수  : ${sizedToBulk.length}   ← 룰 위반 후보`);
  if (sizedToBulk.length > 0) {
    log(`     예시 5: ${sizedToBulk.slice(0, 5).map((c) => `${c.id}(W${c.width}L${c.length}H${c.height})`).join(", ")}`);
  }
  log(`  size 있는데 미배치 행 수    : ${sizedToUnplaced.length}`);
  if (sizedToUnplaced.length > 0) {
    log(`     예시 5: ${sizedToUnplaced.slice(0, 5).map((c) => c.id).join(", ")}`);
  }
  log("");
}

log("=== cbmSource 구분 가능 여부 ===");
log("");
log("현재 데이터 모델: c.cbm 한 필드만 존재 (Excel 'CFS CBM' 열 + 사용자 직접 입력 + 자동 채움 결과 모두 같은 곳).");
log("→ 명시적 구분 X. 휴리스틱 (cbm ≈ W×L×H×Q 인지) 으로 추정만 가능.");
log("");
log("권장: cbmSource: 'user' | 'calculated' | 'cfs' 필드 도입 (UnitSize / CargoSpec 둘 다).");
log("- 'user'  — 사용자가 모달에서 직접 타이핑한 값");
log("- 'cfs'   — Excel CFS CBM 열에서 읽은 값 (사용자 입력 기원)");
log("- 'calculated' — UI 가 W×L×H×Q 로 자동 계산해서 채운 값 (classify allHaveCbm 판단에서 제외해야 함)");
log("");

// 결과를 파일로도 저장
const outPath = path.resolve("scripts/_classify-trace-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
