/**
 * 엑셀/CSV 양식 파서 + 헤더-필드 자동 매핑
 *
 * 사용자의 실제 CLP 양식 특성:
 *   - 1~9행: 회사 정보 + CLP 메타데이터(CLP 번호 / P.O.D / M.BOOKING NO / VESSEL / ETD/ETA / SIZE)
 *   - 10행: 실제 컬럼 헤더 (No., House B/L, DEST, Booking No, 차수, H/B, E/P, N, 실화주, 화주, Q'TY, G.W/T, CFS CBM, ABOUT, REMARK)
 *   - 11행~: 화물 데이터 (REMARK에 "112X145X165" 또는 "247x129x46(2)" 같은 사이즈 문자열이 들어 있을 수 있음)
 *   - 셀 병합 때문에 같은 헤더가 여러 컬럼에 걸쳐 있고 빈 헤더(`__EMPTY_N`)도 자주 등장
 */

import * as XLSX from "xlsx";

/** 화물(per-row) 필드 */
export type CargoFieldKey =
  | "itemName"
  | "itemActualShipperName"
  | "itemShipperName"
  | "cargoType"
  | "widthCm"
  | "lengthCm"
  | "heightCm"
  | "quantity"
  | "weightPerUnitKg"
  | "cbm"
  | "noStacking"
  | "topOnly"
  | "orientation"
  | "heavierBelow"
  | "selfStackOnly"
  | "itemRemark";

/** 부킹(shipment-level) 필드 — 한 부킹에 공통이라 보통 첫 행 값을 채택 */
export type BookingFieldKey =
  | "displayNo"
  | "houseBlNo"
  | "destination"
  | "bookingNo"
  | "shipmentRound"
  | "hb"
  | "ep"
  | "n"
  | "actualShipperName"
  | "shipperName"
  | "about"
  | "generalRemark";

export type FieldKey = CargoFieldKey | BookingFieldKey;

export interface ExcelMeta {
  /** P.O.D — 도착항 / 목적지 */
  destination?: string;
  /** M.BOOKING NO — 마스터 부킹 번호 */
  bookingNo?: string;
  /** CLP 번호 (사내 관리번호) */
  clpNumber?: string;
  /** VESSEL / VOY (선박/항차) */
  vessel?: string;
  /** ETD (출항) */
  etd?: string;
  /** ETA (입항) */
  eta?: string;
  /** SIZE (40HQ, 20GP 등) */
  containerType?: string;
}

export interface ParsedExcel {
  headers: string[];
  rows: Record<string, unknown>[];
  /** 헤더 위쪽에서 추출한 부킹/CLP 메타데이터 */
  meta: ExcelMeta;
  /** 헤더로 인식된 행의 0-based 인덱스 */
  headerRowIndex: number;
}

/** UI 그룹화용 — 부킹 필드와 화물 필드를 분리해서 보여줌 */
export const BOOKING_FIELDS: BookingFieldKey[] = [
  "displayNo",
  "houseBlNo",
  "destination",
  "bookingNo",
  "shipmentRound",
  "hb",
  "ep",
  "n",
  "actualShipperName",
  "shipperName",
  "about",
  "generalRemark",
];

export const CARGO_FIELDS: CargoFieldKey[] = [
  "itemName",
  "itemActualShipperName",
  "itemShipperName",
  "cargoType",
  "widthCm",
  "lengthCm",
  "heightCm",
  "quantity",
  "weightPerUnitKg",
  "cbm",
  "noStacking",
  "topOnly",
  "orientation",
  "heavierBelow",
  "selfStackOnly",
  "itemRemark",
];

/** 사용자 양식 표시용 한글 라벨 */
export const FIELD_LABELS: Record<FieldKey, string> = {
  // 부킹
  displayNo: "No.",
  houseBlNo: "House B/L",
  destination: "DEST(목적지)",
  bookingNo: "Booking No",
  shipmentRound: "차수",
  hb: "H/B",
  ep: "E/P",
  n: "N",
  actualShipperName: "실화주",
  shipperName: "화주",
  about: "ABOUT",
  generalRemark: "REMARK(부킹)",
  // 화물
  itemName: "품목명",
  itemActualShipperName: "실화주(화물)",
  itemShipperName: "화주(화물)",
  cargoType: "구분(PL/WB/CT 등)",
  widthCm: "가로(cm)",
  lengthCm: "세로(cm)",
  heightCm: "높이(cm)",
  quantity: "수량",
  weightPerUnitKg: "중량(kg/개)",
  cbm: "CBM",
  noStacking: "다단금지",
  topOnly: "상단적재",
  orientation: "방향제한",
  heavierBelow: "중량조건",
  selfStackOnly: "자체다단",
  itemRemark: "메모(화물) — REMARK 등",
};

/**
 * 박스 1개 무게 자동 보정.
 *
 * 알고리즘은 unitSize.weight 를 "박스 1개 무게" 로 사용 (algorithm.ts:131,
 * extreme-point.ts:850). 그러나 엑셀에서 사용자가 G.W/T 컬럼에 행 총중량을
 * 적고, 같은 값을 모든 사이즈 그룹의 weight 칸에도 그대로 박아둔 양식이
 * 발견됨. 이 경우 박스 1개가 행 총중량으로 처리돼 다단·중량 룰이 깨진다.
 *
 * 보정 룰:
 *  - 모든 unitSize.weight 가 cargo 의 행 총중량(weightPerUnitKg) 과
 *    같으면(오차 1% 이내) AND cargo.quantity > 1
 *    → 박스1개 무게 = 행총중량 / Σunit.quantity 로 통일
 *  - weight 가 0/누락이면 그대로 둠 (차선책 경로 유지)
 *  - 정상값이면 그대로 둠
 *
 * 순수 함수. cargo 자체는 변형하지 않고 보정된 unitSizes 배열만 반환
 * (보정 불필요 시 null).
 */
export interface UnitSizeWeightLike {
  width: number;
  length: number;
  height: number;
  quantity: number;
  weight: number;
}

export interface CargoLikeForUnitWeightFix {
  quantity: number;
  weightPerUnitKg: number;
  unitSizes?: UnitSizeWeightLike[];
}

const UNIT_WEIGHT_TOLERANCE = 0.01; // 1%

function approxEqualWeight(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= UNIT_WEIGHT_TOLERANCE;
}

export function correctInflatedUnitWeights<T extends UnitSizeWeightLike>(
  cargo: CargoLikeForUnitWeightFix,
  unitSizes: T[],
): T[] | null {
  if (!unitSizes || unitSizes.length === 0) return null;
  const wpu = Number(cargo.weightPerUnitKg) || 0;
  const qty = Number(cargo.quantity) || 0;
  if (wpu <= 0 || qty <= 1) return null;

  const totalUnitQty = unitSizes.reduce(
    (acc, u) => acc + (Number(u.quantity) || 0),
    0,
  );
  if (totalUnitQty <= 0) return null;

  const allEqualWpu = unitSizes.every((u) =>
    approxEqualWeight(Number(u.weight) || 0, wpu),
  );
  if (!allEqualWpu) return null;

  const fixed = Number((wpu / totalUnitQty).toFixed(3));
  return unitSizes.map((u) => ({ ...u, weight: fixed }));
}

/**
 * 빈 헤더(`__EMPTY`, `__EMPTY_1`)를 사용자 친화적 표시명으로 변환.
 * 매핑 키로는 원본 헤더(`__EMPTY...`)를 그대로 써야 행 데이터에 접근 가능하므로
 * UI 표시용으로만 사용.
 */
export function displayHeader(h: string): string {
  if (h === "__EMPTY") return "(빈 헤더)";
  if (h.startsWith("__EMPTY_")) {
    const n = h.slice("__EMPTY_".length);
    return `(빈 헤더 ${n})`;
  }
  return h;
}

/** 사이즈 문자열 1건 (예: 247x129x46(2)) */
export interface DimensionMatch {
  width: number;
  length: number;
  height: number;
  /** REMARK 텍스트에 명시된 sub-quantity (예: "(2)") */
  count?: number;
}

/**
 * REMARK 텍스트에서 사이즈 패턴 추출.
 * 사용자 양식에서 관찰된 모든 표기를 지원:
 *   A) 곱셈 기호 구분: "112X145X165", "247x129x46(2)", "60×60×40", "110*110*95"
 *   B) 공백 + 슬래시 구분 (다중행): "180 90 27 / 1 / 190KG\n128 122 84 / 1 / 506KG"
 *   C) 여러 사이즈 한 줄: "112X145X165 + 100x100x100" 도 전부 추출
 */

// 공백/슬래시 형식이 더 까다로우므로 먼저 시도. 매치되면 그것만 사용 (A 와 중복 방지)
// 형태: W H L / count [/ weightKG]
const PATTERN_SLASH = /(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*(?:\/\s*\d+(?:\.\d+)?\s*K?G)?/gi;

// 형태: W [xX×*] H [xX×*] L (optional count: "(N)" 또는 "XN" 또는 "xN")
//   ex) "80*60*50X2" → count=2,  "118x114x59(6)" → count=6
const PATTERN_OP = /(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:\(\s*(\d+)\s*\)|[xX]\s*(\d+))?/g;

/**
 * 사이즈 단위 정규화 — REMARK 에 mm 단위로 적힌 값(예: 2330×1510×1176)을
 * cm 로 자동 변환.
 *
 * 룰: max > 300 AND min ≥ 100 → mm 로 간주 (÷ 10)
 *  - mm 케이스 (정규화 대상): 1100×1100×400, 2330×1510×1176, 830×630×1120 등 모두 통과
 *  - cm 그대로 (정규화 X): 제일기공 366×95×103 (min=95<100), 데코론 247×129×46 (max<300) 등
 *
 * 이중 조건으로 실제 cm 으로 적힌 큰 화물(제일기공 같이 한 변이 짧은 케이스) 보호.
 */
function normalizeMmToCm(d: { width: number; length: number; height: number }): {
  width: number;
  length: number;
  height: number;
} {
  const max = Math.max(d.width, d.length, d.height);
  const min = Math.min(d.width, d.length, d.height);
  if (max > 300 && min >= 100) {
    return { width: d.width / 10, length: d.length / 10, height: d.height / 10 };
  }
  return d;
}

export function parseDimensionsFromText(s: string | null | undefined): DimensionMatch[] {
  if (!s) return [];
  const out: DimensionMatch[] = [];

  // 1) 슬래시-카운트 형식 (다중행 가능) 먼저 시도
  const reSlash = new RegExp(PATTERN_SLASH.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = reSlash.exec(s)) !== null) {
    const norm = normalizeMmToCm({
      width: Number(m[1]),
      length: Number(m[2]),
      height: Number(m[3]),
    });
    out.push({
      width: norm.width,
      length: norm.length,
      height: norm.height,
      count: m[4] ? Number(m[4]) : undefined,
    });
  }
  if (out.length > 0) return out;

  // 2) 곱셈 기호(또는 *) 형식 — count 는 "(N)" 또는 "XN" 형식
  const reOp = new RegExp(PATTERN_OP.source, "g");
  while ((m = reOp.exec(s)) !== null) {
    const count = m[4] ?? m[5];
    const norm = normalizeMmToCm({
      width: Number(m[1]),
      length: Number(m[2]),
      height: Number(m[3]),
    });
    out.push({
      width: norm.width,
      length: norm.length,
      height: norm.height,
      count: count ? Number(count) : undefined,
    });
  }
  return out;
}

/**
 * 사이즈 패턴(`162×107×66`, `180 90 27 / 1 / 190KG` 등) 을 텍스트에서 제거하고 잔여 문자열 반환.
 * REMARK 텍스트에서 사이즈를 W/L/H로 추출한 뒤 메모 컬럼에 남길 텍스트를 정리할 때 사용.
 */
export function stripDimensionsFromText(s: string): string {
  let out = s;
  out = out.replace(new RegExp(PATTERN_SLASH.source, "gi"), " ");
  out = out.replace(new RegExp(PATTERN_OP.source, "g"), " ");
  return out;
}

export interface ExtractedFlags {
  noStacking?: boolean;
  topOnly?: boolean;
  heavierBelow?: boolean;
  selfStackOnly?: boolean;
  /** "free" 는 명시 안 함 — 키가 있을 때만 적용 */
  orientation?: "long_along_length" | "fixed";
}

/**
 * REMARK 텍스트에서 리마크 플래그(다단금지/상단적재/중량조건/장축길이방향/회전금지)를
 * 추출하고, 해당 키워드를 텍스트에서 제거한 잔여 문자열을 반환.
 *
 * 매칭은 한국어 키워드 + `*다단금지*` 처럼 별표로 강조한 변형까지 흡수.
 */
export function extractFlagsAndStrip(text: string): {
  flags: ExtractedFlags;
  residual: string;
} {
  let out = text;
  const flags: ExtractedFlags = {};

  if (/다단\s*금지/.test(out)) {
    flags.noStacking = true;
    out = out.replace(/\*?\s*다단\s*금지\s*\*?/g, " ");
  }
  if (/상단\s*적재/.test(out)) {
    flags.topOnly = true;
    out = out.replace(/\*?\s*상단\s*적재\s*\*?/g, " ");
  }
  if (/중량\s*조건/.test(out)) {
    flags.heavierBelow = true;
    out = out.replace(/\*?\s*중량\s*조건\s*\*?/g, " ");
  }
  // 자체다단 — 같은 booking 안에서만 적층 허용
  if (/자체\s*다단/.test(out)) {
    flags.selfStackOnly = true;
    out = out.replace(/\*?\s*자체\s*다단\s*\*?/g, " ");
  }
  // 장축(길이|방향|길이방향) 제한
  if (/장축[\s가-힣]{0,8}(?:길이|방향|제한)/.test(out)) {
    flags.orientation = "long_along_length";
    out = out.replace(/\*?\s*장축[\s가-힣]{0,8}(?:길이방향제한|길이|방향|제한)\s*\*?/g, " ");
  }
  // 회전 금지 / fixed → fixed
  if (/회전\s*금지/.test(out) || /\bfixed\b/i.test(out)) {
    flags.orientation = "fixed";
    out = out.replace(/\*?\s*회전\s*금지\s*\*?/g, " ");
    out = out.replace(/\bfixed\b/gi, " ");
  }
  // 자유 — 기본값이라 토글은 안 건드리지만 텍스트는 제거
  out = out.replace(/\*?\s*자유\s*\*?/g, " ");

  return { flags, residual: out };
}

/** 사이즈/플래그 제거 후 남은 문자열 정리 — 구분자/공백 정돈 */
export function tidyResidualText(s: string): string {
  const out = s
    .replace(/[\u2022·•]/g, " ")
    .replace(/[*]+/g, " ")
    .replace(/(\s*,\s*)+/g, ", ")
    .replace(/(\s*\/\s*)+/g, " / ")
    .replace(/\s+/g, " ")
    .replace(/^[\s/\\\-—|,]+/g, "")
    .replace(/[\s/\\\-—|,]+$/g, "")
    .trim();
  // 영숫자/한글이 하나도 없으면 의미 없는 잔여 — 빈 문자열로
  if (!/[A-Za-z0-9가-힣]/.test(out)) return "";
  return out;
}

/**
 * 엑셀 시트를 읽어 헤더 행을 자동 감지하고, 그 위 메타와 그 아래 데이터를 분리해서 반환.
 */
export async function parseExcelFile(file: File): Promise<ParsedExcel> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [], meta: {}, headerRowIndex: 0 };
  }
  const sheet = wb.Sheets[firstSheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });

  const headerRowIndex = findHeaderRow(aoa);
  const headerRow = (aoa[headerRowIndex] ?? []) as unknown[];
  const meta = extractMeta(aoa.slice(0, headerRowIndex) as unknown[][]);

  // 빈 헤더 셀은 __EMPTY_N 으로 키화 — 병합 셀 빈 칸도 따로 매핑할 수 있도록
  const rawHeaders: string[] = headerRow.map((h, i) => {
    if (typeof h === "string" && h.trim().length > 0) return h.trim();
    if (typeof h === "number") return String(h);
    return `__EMPTY_${i}`;
  });
  // 중복 헤더가 있을 수 있어 _2, _3 등을 붙여 유일화
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const c = seen.get(h) ?? 0;
    seen.set(h, c + 1);
    return c === 0 ? h : `${h}_${c}`;
  });

  // 푸터(요약) 행 키워드 — 첫 번째 비어있지 않은 셀이 이 키워드 중 하나면 행 자체를 스킵.
  // 호치민 TOTAL 샘플 같이 데이터 끝에 "TOTAL" 합계 행이 추가된 케이스 방지.
  const FOOTER_KEYWORDS = new Set([
    "total",
    "totals",
    "subtotal",
    "sum",
    "합계",
    "총합",
    "총계",
    "소계",
    "계",
  ]);
  const isFooterRow = (row: unknown[]): boolean => {
    const firstNonEmpty = row.find((c) => c !== "" && c != null);
    if (firstNonEmpty == null) return false;
    if (typeof firstNonEmpty !== "string") return false;
    return FOOTER_KEYWORDS.has(firstNonEmpty.trim().toLowerCase());
  };

  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const row = (aoa[i] ?? []) as unknown[];
    if (row.every((c) => c === "" || c == null)) continue;
    if (isFooterRow(row)) continue;
    const obj: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] ?? "";
    }
    rows.push(obj);
  }

  return { headers, rows, meta, headerRowIndex };
}

/** "House B/L" / "Booking No" / "실화주" 가 있는 행을 헤더로 인식 */
function findHeaderRow(aoa: unknown[][]): number {
  const markers = ["house b/l", "booking no", "실화주", "화주", "q'ty"];
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const joined = row
      .map((c) => String(c ?? "").trim().toLowerCase())
      .join("|");
    let score = 0;
    for (const m of markers) {
      if (joined.includes(m)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    // 2개 이상 매치되면 바로 채택 (양식 예측 가능 시점)
    if (score >= 3) return i;
  }
  return bestScore > 0 ? bestIdx : 0;
}

/** 헤더 위쪽 영역에서 "P.O.D : SINGAPORE" 같은 key:value 패턴을 끌어모음 */
function extractMeta(metaRows: unknown[][]): ExcelMeta {
  const meta: ExcelMeta = {};
  for (const rawRow of metaRows) {
    const cells = (rawRow ?? []).map((c) => String(c ?? "").trim());
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c) continue;
      const lower = c.toLowerCase();

      // P.O.D : SINGAPORE  /  P.O.D : HO CHI MINH CITY, VIETNAM
      if (
        !meta.destination &&
        (lower.includes("p.o.d") ||
          lower.startsWith("pod ") ||
          lower === "pod" ||
          lower.includes("port of discharge"))
      ) {
        const v = nextValue(cells, i);
        if (v) meta.destination = v;
      }

      // M.BOOKING NO. : SNKO0102603...
      if (!meta.bookingNo && lower.includes("booking no")) {
        const v = nextValue(cells, i);
        if (v) meta.bookingNo = v;
      }

      // CLP 번호 : ABSG2600012-1
      if (!meta.clpNumber && (lower.includes("clp 번호") || lower.includes("clp number") || lower.includes("clp no"))) {
        const v = nextValue(cells, i);
        if (v) meta.clpNumber = v;
      }

      // VESSEL / VOY : TIANJIN VOYAGER / 2603S
      if (!meta.vessel && (lower.startsWith("vessel") || lower.includes("vessel /"))) {
        const v = nextValue(cells, i);
        if (v) meta.vessel = v;
      }

      // ETD / ETA — 날짜 두 개가 같은 행에 있음 (라벨 + ETD + 사이값 + ETA)
      if (lower.startsWith("etd") || lower.includes("etd/eta") || lower.includes("etd /")) {
        const dates = collectDates(cells, i);
        if (!meta.etd && dates[0]) meta.etd = dates[0];
        if (!meta.eta && dates[1]) meta.eta = dates[1];
      }

      // SIZE : 40HQ
      if (!meta.containerType && (lower === "size" || lower === "size :" || lower.startsWith("size "))) {
        const v = nextValue(cells, i);
        if (v && /\d/.test(v)) meta.containerType = v;
      }
    }
  }
  return meta;
}

/** 다음 비어있지 않은 셀의 값을 가져오되 ":-—" 구분문자는 떼어냄 */
function nextValue(cells: string[], from: number): string | undefined {
  for (let j = from + 1; j < cells.length; j++) {
    const raw = cells[j];
    if (!raw) continue;
    const cleaned = raw.replace(/^[:\-—\s]+/u, "").trim();
    if (cleaned.length > 0) return cleaned;
  }
  return undefined;
}

/** 한 행에서 yyyy-mm-dd 또는 yyyy/mm/dd 형식 날짜 토큰만 골라 순서대로 반환 */
function collectDates(cells: string[], from: number): string[] {
  const out: string[] = [];
  const re = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;
  for (let j = from + 1; j < cells.length; j++) {
    const m = cells[j]?.match(re);
    if (m) out.push(m[0]);
  }
  return out;
}

/**
 * 키워드 기반 헤더 → 필드 자동 매핑.
 * - 짧은 헤더(N, H/B, E/P)는 정확 매칭만
 * - REMARK 만 있을 땐 booking-level (generalRemark) 우선
 * - 비교 시 공백/마침표/대소문자를 정규화 → "G. W/T" 같은 양식도 매칭
 */
const KEYWORDS: Record<FieldKey, string[]> = {
  // 부킹
  displayNo: ["순번", "번호"],
  houseBlNo: ["house b/l", "house bl", "h.b/l", "h/b/l", "house bill", "houseBl"],
  destination: ["dest", "destination", "도착지", "목적지", "p.o.d", "pod"],
  bookingNo: ["booking no", "booking#", "booking number", "부킹"],
  shipmentRound: ["차수", "round", "shipment round"],
  hb: [],
  ep: [],
  n: [],
  // 부킹 단위 화주 — 자동 매핑 키워드 비움. 화물 단위 fields 가 우선 매칭됨.
  // 단일 화주 부킹의 경우 사용자가 드롭다운에서 직접 선택하면 됨.
  actualShipperName: [],
  shipperName: [],
  about: ["about"],
  // generalRemark = 부킹 단위 메모. 사용자 양식의 "REMARK" 는 화물 사이즈/특이사항이 들어가므로 itemRemark 우선.
  generalRemark: ["리마크"],
  // 화물
  itemName: ["품목", "품명", "item name", "item"],
  // 화물 단위 화주는 사용자 양식의 콘솔(TOTAL) 케이스 — 행마다 다른 화주
  itemActualShipperName: ["실화주", "actual shipper", "real shipper"],
  itemShipperName: ["화주", "shipper", "consignor"],
  // 화물 종류 — 엑셀에선 보통 Q'TY 옆 빈 헤더 셀에 코드(PL/CR/WB 등) 가 들어감.
  // 명시 헤더가 있을 경우만 키워드로 매칭, 그 외엔 ExcelImport 가 Q'TY 우측 폴백으로 잡음.
  cargoType: ["구분", "type", "kind", "package type"],
  widthCm: ["가로", "width", "폭"],
  lengthCm: ["세로", "length", "길이"],
  heightCm: ["높이", "height"],
  quantity: ["수량", "qty", "quantity", "개수", "q'ty", "qty pcs"],
  weightPerUnitKg: ["중량", "weight", "kg", "무게", "g.w/t", "g.wt", "gross", "g/w"],
  cbm: ["cbm", "부피", "cfs cbm"],
  noStacking: ["다단금지", "no stack", "nostack", "no-stack"],
  topOnly: ["상단적재", "상단", "top only", "toponly"],
  orientation: ["방향", "orientation"],
  heavierBelow: ["중량조건", "heavier below", "heavier"],
  selfStackOnly: ["자체다단", "self stack", "selfstack", "same booking only"],
  // itemRemark = 화물별 메모. 사용자 양식의 "REMARK" 컬럼은 사이즈 텍스트("112X145X165") 가 들어가므로 여기로 매핑.
  itemRemark: ["메모", "비고", "note", "item remark", "remark"],
};

function compact(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
}

function guessField(header: string): FieldKey | null {
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (trimmed === "__EMPTY" || trimmed.startsWith("__EMPTY_")) return null;

  const lower = trimmed.toLowerCase();
  const cmpct = compact(trimmed);

  // 짧은 코드성 헤더는 정확 매칭
  if (lower === "no." || lower === "no" || cmpct === "no" || cmpct === "순번") return "displayNo";
  if (lower === "h/b" || lower === "hb" || cmpct === "h/b") return "hb";
  if (lower === "e/p" || lower === "ep" || cmpct === "e/p") return "ep";
  if (lower === "n") return "n";

  // 화물 단위 fields 를 우선 시도 — "실화주/화주" 같은 양식 컬럼은 콘솔의 경우 행마다 다르므로
  const ordered: FieldKey[] = [...CARGO_FIELDS, ...BOOKING_FIELDS];
  for (const field of ordered) {
    for (const kw of KEYWORDS[field]) {
      if (cmpct.includes(compact(kw))) return field;
    }
  }
  return null;
}

/**
 * 헤더 배열을 받아 필드 매핑 추정 — 결과는 사용자가 UI 에서 보정.
 * 같은 field 가 여러 헤더에서 매핑되면 첫 헤더만 채택, 나머지는 null.
 * 예: 메모 헤더 "입고된 화물 60CBM 가까이..." 가 'cbm' 키워드 포함이라
 *     진짜 "CFS CBM" 컬럼 매핑을 덮어쓰는 충돌 차단.
 */
export function mapHeadersToFields(
  headers: string[],
): Record<string, FieldKey | null> {
  const out: Record<string, FieldKey | null> = {};
  const usedFields = new Set<FieldKey>();
  for (const h of headers) {
    const f = guessField(h);
    if (f && !usedFields.has(f)) {
      out[h] = f;
      usedFields.add(f);
    } else {
      out[h] = null;
    }
  }
  return out;
}
