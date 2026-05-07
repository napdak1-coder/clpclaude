"use client";

/**
 * 엑셀/CSV 양식 가져오기
 *
 * 1) 파일 업로드 → 헤더 자동 감지 + 헤더 위쪽 메타 정보(P.O.D / M.BOOKING NO / CLP 번호 / 선박 / ETD / SIZE) 추출
 * 2) 컬럼 매핑(부킹 + 화물 그룹화) — 사용자 보정 가능
 * 3) 확정 시:
 *    - 메타 + 매핑된 부킹 컬럼 → bookingPatch (사용자 입력은 보존)
 *    - 화물 행: 매핑된 컬럼 → CargoRow
 *    - itemRemark / generalRemark 텍스트에서 "112X145X165(2)" 같은 사이즈 패턴 자동 추출 →
 *      width/length/height/quantity 자동 채움. 여러 사이즈("+" 구분) 는 행을 분할.
 *
 * 또한 "샘플파일" 버튼 — public/samples/ 에 박혀 있는 고정 양식을 한 번에 로드 (테스트 단축 경로).
 */

import { useRef, useState } from "react";
import {
  BOOKING_FIELDS,
  CARGO_FIELDS,
  FIELD_LABELS,
  displayHeader,
  extractFlagsAndStrip,
  mapHeadersToFields,
  parseDimensionsFromText,
  parseExcelFile,
  type BookingFieldKey,
  type CargoFieldKey,
  type DimensionMatch,
  type ExcelMeta,
  type FieldKey,
  type ParsedExcel,
} from "@/lib/excel";
import { makeEmptyRow, type CargoRow } from "./CargoTable";
import { normalizeCargoType } from "@/types/cargo";

export interface ExcelImportPayload {
  /** 부킹 입력칸 자동 채움 — 비어 있는 칸만 채워서 사용자 수기 입력 보존 */
  bookingPatch: Partial<Record<BookingFieldKey, string>>;
  /** 추가/교체할 화물 행들 */
  rows: CargoRow[];
}

interface ExcelImportProps {
  /**
   * @param payload  변환된 부킹 패치 + 화물 행
   * @param source   샘플 버튼에서 로드된 경우 샘플 키. 일반 파일 업로드는 undefined.
   *                 부모는 이 키를 보관해 두었다가 저장 시 같은 키로 샘플을 갱신할 수 있다.
   */
  onImport: (payload: ExcelImportPayload, source?: { sampleKey: string }) => void;
}

function toBoolish(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "y" || s === "yes" || s === "true" || s === "o" || s === "1";
  }
  return false;
}

function toNumberish(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isEmptyCell(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  return false;
}

/**
 * 엑셀 CBM = 매핑된 "CFS CBM" 셀 값만. 폴백 없음.
 * 양수면 그대로, 0/빈칸이면 null. 시스템 CBM 비교 시 1순위 기준.
 */
function pickRowCbm(
  row: Record<string, unknown>,
  cbmHeader: string,
): number | null {
  const v = toNumberish(row[cbmHeader]);
  return v > 0 ? v : null;
}

/**
 * 엑셀 ABOUT = "ABOUT" 라벨 헤더에서 우선 시도, 없으면 CFS CBM 우측 인접 3칸의
 * __EMPTY_n / about / cbm-like 헤더에서 첫 양수를 사용 (병합 오버플로 대응).
 *
 * 사용자 양식에서 ABOUT 셀이 자동 계산된 총 CBM 을 담고 있어, CFS CBM 이
 * 비어있을 때의 폴백 비교 대상이 된다.
 */
function pickRowAbout(
  row: Record<string, unknown>,
  headers: string[],
  cbmHeader: string,
): number | null {
  const aboutHeader = headers.find(
    (h) => h.toLowerCase().trim() === "about",
  );
  if (aboutHeader) {
    const v = toNumberish(row[aboutHeader]);
    if (v > 0) return v;
  }
  const idx = headers.indexOf(cbmHeader);
  if (idx < 0) return null;
  for (let j = idx + 1; j < Math.min(headers.length, idx + 4); j++) {
    const h = headers[j];
    const lower = h.toLowerCase().trim();
    const isExtension =
      h.startsWith("__EMPTY_") ||
      lower === "about" ||
      lower.includes("cbm") ||
      h.includes("부피");
    if (!isExtension) break;
    const v = toNumberish(row[h]);
    if (v > 0) return v;
  }
  return null;
}

const CARGO_FIELD_SET = new Set<FieldKey>(CARGO_FIELDS);
const BOOKING_FIELD_SET = new Set<FieldKey>(BOOKING_FIELDS);

/**
 * 메타 정보를 부킹 패치에 반영.
 * 매핑된 컬럼 값(per-row)이 우선이지만, 컬럼이 비어 있을 때 메타로 보강한다.
 */
function bookingPatchFromMeta(meta: ExcelMeta): Partial<Record<BookingFieldKey, string>> {
  const patch: Partial<Record<BookingFieldKey, string>> = {};
  if (meta.destination) patch.destination = meta.destination;
  if (meta.bookingNo) patch.bookingNo = meta.bookingNo;
  // CLP 번호 / SIZE / VESSEL / ETD 는 about 칸에 한 줄로 모아 보존
  const aboutBits: string[] = [];
  if (meta.clpNumber) aboutBits.push(`CLP:${meta.clpNumber}`);
  if (meta.containerType) aboutBits.push(`SIZE:${meta.containerType}`);
  if (meta.vessel) aboutBits.push(`VESSEL:${meta.vessel}`);
  if (meta.etd) aboutBits.push(`ETD:${meta.etd}`);
  if (meta.eta) aboutBits.push(`ETA:${meta.eta}`);
  if (aboutBits.length > 0) patch.about = aboutBits.join(" / ");
  return patch;
}

/**
 * 사이즈 매치 1건을 적용해 새 행을 만든다.
 * 단일 사이즈 보충(applyDimension)에서는 base.cbm/unitSizes 를 보존한다.
 * 다중 사이즈로 분리해야 하는 경우엔 호출자가 cbm/unitSizes 를 따로 비운다.
 *
 * 수량 규칙: 엑셀 Q'TY 컬럼이 진실원천(SoT). REMARK 의 count("(2)" / "X14") 는
 * Q'TY 가 비어 있을 때만 폴백으로 사용한다.
 */
function applyDimension(base: CargoRow, dim: DimensionMatch): CargoRow {
  const next: CargoRow = {
    ...base,
    rowKey: crypto.randomUUID(),
    widthCm: dim.width,
    lengthCm: dim.length,
    heightCm: dim.height,
  };
  if (base.quantity <= 0 && dim.count && dim.count > 0) {
    next.quantity = dim.count;
  }
  return next;
}

/**
 * 파싱 결과 + 매핑 + 옵션을 받아 onImport 페이로드를 만드는 순수 함수.
 * 매핑 UI 확정 버튼(confirmImport)과 샘플 한방 로드(loadSample) 양쪽에서
 * 동일한 변환 로직을 공유하기 위해 추출돼 있다.
 */
function buildImportPayload(
  parsed: ParsedExcel,
  mapping: Record<string, FieldKey | null>,
  applyMeta: boolean,
  extractDimensions: boolean,
): ExcelImportPayload {
  /** 1) 부킹 패치 — 메타 + 매핑된 컬럼 첫 번째 비어있지 않은 값 */
  const bookingPatch: Partial<Record<BookingFieldKey, string>> = applyMeta
    ? bookingPatchFromMeta(parsed.meta)
    : {};

  const bookingHeaderMap = new Map<BookingFieldKey, string>();
  for (const [header, field] of Object.entries(mapping)) {
    if (!field) continue;
    if (BOOKING_FIELD_SET.has(field)) {
      bookingHeaderMap.set(field as BookingFieldKey, header);
    }
  }
  for (const [field, header] of bookingHeaderMap.entries()) {
    for (const row of parsed.rows) {
      const v = row[header];
      if (!isEmptyCell(v)) {
        bookingPatch[field] = String(v).trim();
        break;
      }
    }
  }

  /** 2) 화물 행 — 매핑된 컬럼 + REMARK 사이즈 자동 추출.
   *  사용자 양식에서 House B/L 이 비어있어도 각 행은 별개의 부킹(다른 화주/Booking No/DEST)
   *  이므로 자동 병합하지 않는다. 한 행 = 한 화물.
   */
  const cargoRows: CargoRow[] = [];

  // 화물종류 자동 폴백: 명시 매핑(cargoType 헤더)이 없으면 Q'TY 매핑 헤더의 우측 인접 1칸을 시도.
  // 사용자 양식에선 보통 Q'TY 옆이 빈 헤더(__EMPTY_n) 인데 그 셀에 PL/CR/WB 같은 코드가 들어있다.
  let cargoTypeFallbackHeader: string | null = null;
  const explicitCargoTypeHeader = Object.entries(mapping).find(
    ([, f]) => f === "cargoType",
  )?.[0];
  if (!explicitCargoTypeHeader) {
    const qtyHeader = Object.entries(mapping).find(
      ([, f]) => f === "quantity",
    )?.[0];
    if (qtyHeader) {
      const idx = parsed.headers.indexOf(qtyHeader);
      if (idx >= 0 && idx + 1 < parsed.headers.length) {
        const candidate = parsed.headers[idx + 1];
        // 다른 필드로 매핑된 헤더는 건드리지 않음
        if (!mapping[candidate]) cargoTypeFallbackHeader = candidate;
      }
    }
  }

  for (const row of parsed.rows) {
    const base = makeEmptyRow();
    let remarkText = "";

    for (const [header, field] of Object.entries(mapping)) {
      if (!field) continue;
      if (!CARGO_FIELD_SET.has(field)) continue;
      const value = row[header];
      switch (field as CargoFieldKey) {
        case "itemName":
          base.itemName = String(value ?? "");
          break;
        case "itemActualShipperName":
          base.actualShipperName = String(value ?? "").trim();
          break;
        case "itemShipperName":
          base.shipperName = String(value ?? "").trim();
          break;
        case "widthCm":
          base.widthCm = toNumberish(value);
          break;
        case "lengthCm":
          base.lengthCm = toNumberish(value);
          break;
        case "heightCm":
          base.heightCm = toNumberish(value);
          break;
        case "quantity":
          base.quantity = Math.max(1, Math.round(toNumberish(value)));
          break;
        case "weightPerUnitKg":
          base.weightPerUnitKg = toNumberish(value);
          break;
        case "cbm": {
          // 엑셀 CBM 과 ABOUT 을 별도로 파싱
          base.cbm = pickRowCbm(row, header);
          base.aboutCbm = pickRowAbout(row, parsed.headers, header);
          break;
        }
        case "noStacking":
          base.noStacking = toBoolish(value);
          break;
        case "topOnly":
          base.topOnly = toBoolish(value);
          break;
        case "orientation": {
          const s = String(value ?? "").toLowerCase();
          if (s.includes("fixed") || s.includes("회전")) base.orientation = "fixed";
          else if (s.includes("long") || s.includes("장축")) base.orientation = "long_along_length";
          else base.orientation = "free";
          break;
        }
        case "heavierBelow":
          base.heavierBelow = toBoolish(value);
          break;
        case "cargoType": {
          base.cargoType = normalizeCargoType(value);
          break;
        }
        case "itemRemark": {
          const txt = String(value ?? "");
          // raw 값은 일단 그대로 저장 — 아래 사이즈/플래그 추출 후 잔여 텍스트로 덮어씀
          base.itemRemark = txt;
          if (txt) remarkText += (remarkText ? " " : "") + txt;
          break;
        }
      }
    }

    // 부킹/HBL/DEST 컬럼은 BookingFieldKey 라 cargo 루프에서 안 잡히지만
    // 콘솔 양식은 행마다 다른 값을 가질 수 있어 cargo row 에도 per-row 보존.
    const findHeaderForField = (f: string): string | undefined =>
      Object.entries(mapping).find(([, ff]) => ff === f)?.[0];
    const bnHeader = findHeaderForField("bookingNo");
    if (bnHeader) {
      const v = row[bnHeader];
      if (v != null && String(v).trim()) base.bookingNo = String(v).trim();
    }
    const hblHeader = findHeaderForField("houseBlNo");
    if (hblHeader) {
      const v = row[hblHeader];
      if (v != null && String(v).trim()) base.houseBlNo = String(v).trim();
    }
    const destHeader = findHeaderForField("destination");
    if (destHeader) {
      const v = row[destHeader];
      if (v != null && String(v).trim()) base.destination = String(v).trim();
    }

    // 부킹용 generalRemark 컬럼에도 사이즈 텍스트가 있을 수 있어 같이 스캔
    // (사용자 양식의 "REMARK" 가 itemRemark 로 매핑돼도 안전망 차원에서 둘 다 본다)
    if (extractDimensions && !remarkText) {
      const generalHeader = Object.entries(mapping).find(
        ([, f]) => f === "generalRemark",
      )?.[0];
      if (generalHeader) {
        const v = row[generalHeader];
        if (typeof v === "string" && v.trim()) remarkText = v.trim();
      }
    }

    const dimsMissing =
      base.widthCm === 0 || base.lengthCm === 0 || base.heightCm === 0;
    let dims: DimensionMatch[] = [];
    if (extractDimensions && remarkText) {
      dims = parseDimensionsFromText(remarkText);
    }

    // 명시 매핑 없는 경우 Q'TY 우측 인접 셀에서 cargoType 폴백
    if (!explicitCargoTypeHeader && cargoTypeFallbackHeader) {
      base.cargoType = normalizeCargoType(row[cargoTypeFallbackHeader]);
    }

    // REMARK 텍스트에서 플래그(다단금지/상단적재/중량조건/장축/회전금지)만 토글로 흡수.
    // 메모(itemRemark) 본문은 사용자 요구에 따라 원본 REMARK 텍스트를 그대로 보존.
    if (remarkText) {
      const { flags } = extractFlagsAndStrip(remarkText);
      if (flags.noStacking) base.noStacking = true;
      if (flags.topOnly) base.topOnly = true;
      if (flags.heavierBelow) base.heavierBelow = true;
      if (flags.orientation) base.orientation = flags.orientation;
    }

    if (dims.length === 0) {
      // 사이즈가 없어도 행에 의미 있는 정보 (House B/L / 실화주 / 화주 / Booking No /
      // Q'TY / CBM 등) 가 하나라도 있으면 cargoRow 로 유지. 사용자가 UI 에서 W/L/H 를
      // 채워 넣을 수 있음. (이전엔 W/L/H/Qty 다 있어야 push → 호치민처럼 사이즈 칼럼
      // 없는 양식에서 행 절반 이상 손실됨.)
      const hasMeaningful =
        (base.actualShipperName ?? "").trim().length > 0 ||
        (base.shipperName ?? "").trim().length > 0 ||
        (base.itemName ?? "").trim().length > 0 ||
        base.quantity > 0 ||
        (base.cbm ?? 0) > 0 ||
        (base.aboutCbm ?? 0) > 0 ||
        (base.weightPerUnitKg ?? 0) > 0 ||
        (base.itemRemark ?? "").trim().length > 0;
      if (
        base.widthCm > 0 &&
        base.lengthCm > 0 &&
        base.heightCm > 0 &&
        base.quantity > 0
      ) {
        cargoRows.push(base);
      } else if (hasMeaningful) {
        // W/L/H 미입력인 채 저장 가능하려면 CT(카톤) 으로 분류해야 검증 통과 (CBM 만 합산).
        // 사용자가 나중에 사이즈 채우고 cargoType 을 PL/WB/등으로 바꿀 수 있음.
        if (!base.cargoType) base.cargoType = "CT";
        cargoRows.push(base);
      }
    } else if (dims.length === 1) {
      // 단일 사이즈: 매핑된 가로/세로/높이가 비어 있으면 보충 (cbm/unitSizes/메모 보존)
      const target = dimsMissing ? applyDimension(base, dims[0]) : base;
      if (
        target.widthCm > 0 &&
        target.lengthCm > 0 &&
        target.heightCm > 0 &&
        target.quantity > 0
      ) {
        cargoRows.push(target);
      }
    } else {
      // 다중 사이즈 — 행을 분리하지 않고 한 행 안에 unitSizes 로 묶는다.
      // 대표 사이즈는 첫 번째 사이즈.
      // 수량 규칙: 엑셀 Q'TY 컬럼이 진실원천(SoT). REMARK 사이즈 합계는 폴백.
      // unitSizes 는 합계가 최종 quantity 와 정확히 일치할 때만 보존
      // (REMARK 가 일부 사이즈를 누락하면 합계 < Q'TY 가 되어 일관성 깨지므로 생략).
      const first = dims[0];
      const sumCounts = dims.reduce(
        (s, d) => s + (d.count && d.count > 0 ? d.count : 1),
        0,
      );
      const finalQty = base.quantity > 0 ? base.quantity : sumCounts;
      const unitSizes = sumCounts === finalQty
        ? dims.map((d) => ({
            width: d.width,
            length: d.length,
            height: d.height,
            quantity: d.count && d.count > 0 ? d.count : 1,
            weight: 0,
          }))
        : undefined;
      const target: CargoRow = {
        ...base,
        widthCm: first.width,
        lengthCm: first.length,
        heightCm: first.height,
        quantity: finalQty,
        ...(unitSizes ? { unitSizes } : {}),
      };
      if (
        target.widthCm > 0 &&
        target.lengthCm > 0 &&
        target.heightCm > 0 &&
        target.quantity > 0
      ) {
        cargoRows.push(target);
      }
    }
  }

  return { bookingPatch, rows: cargoRows };
}

/**
 * 샘플 버튼 메타데이터.
 * - key:      /api/samples/<key> 영속화 키. 사용자 편집본이 우선.
 * - url:      key 에 해당하는 영속화본이 없을 때 폴백으로 파싱할 xlsx (public/samples/).
 * - filename: 파서가 인식할 가짜 파일 이름 (확장자 보존용).
 */
const SAMPLE_FILES: Array<{
  key: string;
  label: string;
  url: string;
  filename: string;
}> = [
  {
    key: "singapore-total",
    label: "1ST SG TOTAL",
    url: "/samples/singapore-total.xlsx",
    filename: "싱가폴 TOTAL 샘플.xlsx",
  },
  {
    key: "singapore-total-2",
    label: "2ST SG TOTAL",
    url: "/samples/singapore-total-2.xlsx",
    filename: "싱가폴 TOTAL 두번째.xlsx",
  },
  {
    key: "singapore-total-3",
    label: "3ST SG TOTAL",
    url: "/samples/singapore-total-3.xlsx",
    filename: "싱가폴 TOTAL 세번째.xlsx",
  },
  {
    key: "hochiminh-total",
    label: "1ST HM TOTAL",
    url: "/samples/hochiminh-total.xlsx",
    filename: "호치민 TOTAL 샘플.xlsx",
  },
  {
    key: "hochiminh-total-2",
    label: "2ST HM TOTAL",
    url: "/samples/hochiminh-total-2.xlsx",
    filename: "호치민 TOTAL 두번째.xlsx",
  },
];

export function ExcelImport({ onImport }: ExcelImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedExcel | null>(null);
  const [mapping, setMapping] = useState<Record<string, FieldKey | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extractDimensions, setExtractDimensions] = useState(true);
  const [applyMeta, setApplyMeta] = useState(true);

  const onPickFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const result = await parseExcelFile(file);
      setParsed(result);
      setMapping(mapHeadersToFields(result.headers));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "파일 파싱 실패";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = () => {
    if (!parsed) return;
    const payload = buildImportPayload(parsed, mapping, applyMeta, extractDimensions);
    onImport(payload);
    setParsed(null);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  };

  /**
   * 샘플 파일 한방 로드 — 매핑 UI 없이 즉시 import.
   *
   * 우선순위:
   *  1) /api/samples/<key>  — 사용자가 이전에 편집·저장한 영속화본 (있으면 이걸 사용)
   *  2) /samples/<file>.xlsx — 원본 양식 (영속화본이 없으면 파싱해 사용)
   *
   * 부모에는 sampleKey 를 source 로 함께 전달해, 저장 시 같은 키로 갱신할 수 있게 한다.
   */
  const loadSample = async (sample: {
    key: string;
    url: string;
    filename: string;
  }) => {
    setError(null);
    setBusy(true);
    try {
      // 1) 영속화본 시도
      const apiRes = await fetch(`/api/samples/${sample.key}`);
      if (apiRes.ok) {
        const json = (await apiRes.json()) as {
          success: boolean;
          data?: { bookingPatch: ExcelImportPayload["bookingPatch"]; rows: CargoRow[] };
        };
        if (json.success && json.data) {
          const rowsWithKeys: CargoRow[] = json.data.rows.map((r) => ({
            ...r,
            rowKey: crypto.randomUUID(),
          }));
          onImport(
            { bookingPatch: json.data.bookingPatch, rows: rowsWithKeys },
            { sampleKey: sample.key },
          );
          return;
        }
      }

      // 2) xlsx 폴백
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error(`샘플 파일 로드 실패 (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], sample.filename, { type: blob.type });
      const result = await parseExcelFile(file);
      const autoMapping = mapHeadersToFields(result.headers);
      const payload = buildImportPayload(result, autoMapping, true, true);
      onImport(payload, { sampleKey: sample.key });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "샘플 로드 실패";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded bg-neutral-700 px-3 py-1 text-white hover:bg-neutral-800">
          엑셀/CSV 가져오기
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
        </label>
        {SAMPLE_FILES.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={busy}
            onClick={() => void loadSample(s)}
            className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700 disabled:opacity-50"
            title="저장된 샘플 양식을 매핑 없이 한 번에 불러옵니다. 편집·저장 시 같은 샘플로 갱신됩니다."
          >
            {s.label}
          </button>
        ))}
        <span className="text-xs text-neutral-500">
          헤더가 1행이 아니어도 자동 감지 (House B/L / Booking No 인식). 상단 메타(P.O.D, M.BOOKING NO 등)도 자동 추출.
        </span>
        {busy && <span className="text-xs text-neutral-500">파싱 중…</span>}
      </div>

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}

      {parsed && parsed.headers.length > 0 && (
        <div className="mt-3 space-y-3">
          {/* 감지된 메타 정보 */}
          {hasMeta(parsed.meta) && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-amber-800">
                  상단 메타 자동 인식 (헤더 {parsed.headerRowIndex + 1}행 위)
                </span>
                <label className="flex items-center gap-1 text-amber-800">
                  <input
                    type="checkbox"
                    checked={applyMeta}
                    onChange={(e) => setApplyMeta(e.target.checked)}
                  />
                  부킹에 자동 채우기
                </label>
              </div>
              <ul className="space-y-0.5 text-amber-900">
                {parsed.meta.destination && (
                  <li>
                    <b>P.O.D → 목적지</b>: {parsed.meta.destination}
                  </li>
                )}
                {parsed.meta.bookingNo && (
                  <li>
                    <b>M.BOOKING NO → Booking No</b>: {parsed.meta.bookingNo}
                  </li>
                )}
                {parsed.meta.clpNumber && (
                  <li>
                    <b>CLP 번호</b>: {parsed.meta.clpNumber}
                  </li>
                )}
                {parsed.meta.containerType && (
                  <li>
                    <b>SIZE</b>: {parsed.meta.containerType}
                  </li>
                )}
                {parsed.meta.vessel && (
                  <li>
                    <b>VESSEL</b>: {parsed.meta.vessel}
                  </li>
                )}
                {(parsed.meta.etd || parsed.meta.eta) && (
                  <li>
                    <b>ETD / ETA</b>: {parsed.meta.etd ?? "?"} → {parsed.meta.eta ?? "?"}
                  </li>
                )}
              </ul>
              <p className="mt-1 text-[11px] text-amber-700">
                CLP 번호 / SIZE / VESSEL / ETD / ETA 는 ABOUT 칸에 한 줄로 모아 저장됩니다.
              </p>
            </div>
          )}

          {/* 사이즈 자동 추출 옵션 */}
          <label className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-2 py-1 text-xs">
            <input
              type="checkbox"
              checked={extractDimensions}
              onChange={(e) => setExtractDimensions(e.target.checked)}
            />
            <span className="text-neutral-700">
              REMARK/메모 칸의 <span className="font-mono">112X145X165(2)</span> 같은 사이즈 텍스트를 가로×세로×높이로 자동 변환
            </span>
          </label>

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-neutral-700">
              컬럼 매핑 ({parsed.rows.length}행)
            </div>
            <div className="text-[11px] text-neutral-500">
              빈 헤더(<span className="font-mono">__EMPTY</span>)도 직접 매핑하거나 <b>무시</b>로 둘 수 있어요.
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {parsed.headers.map((h) => {
              const current = mapping[h] ?? "";
              const isBookingMapped =
                current && BOOKING_FIELD_SET.has(current as FieldKey);
              const isCargoMapped =
                current && CARGO_FIELD_SET.has(current as FieldKey);
              return (
                <label
                  key={h}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1 ${
                    isBookingMapped
                      ? "border-emerald-200 bg-emerald-50"
                      : isCargoMapped
                        ? "border-blue-200 bg-blue-50"
                        : "border-neutral-200 bg-white"
                  }`}
                >
                  <span
                    className="truncate font-mono text-neutral-700"
                    title={h}
                  >
                    {displayHeader(h)}
                  </span>
                  <select
                    value={current}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [h]: e.target.value
                          ? (e.target.value as FieldKey)
                          : null,
                      })
                    }
                    className="rounded border border-neutral-300 bg-white px-1 py-0.5"
                  >
                    <option value="">— 무시 —</option>
                    <optgroup label="부킹 정보">
                      {BOOKING_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="화물 정보">
                      {CARGO_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-neutral-500">
              <span className="mr-2 inline-block h-2 w-2 rounded bg-emerald-300" />
              부킹 매핑
              <span className="ml-3 mr-2 inline-block h-2 w-2 rounded bg-blue-300" />
              화물 매핑
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setParsed(null);
                  setMapping({});
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="rounded border border-neutral-300 px-3 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmImport}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                불러오기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hasMeta(m: ExcelMeta): boolean {
  return Boolean(
    m.destination ||
      m.bookingNo ||
      m.clpNumber ||
      m.containerType ||
      m.vessel ||
      m.etd ||
      m.eta,
  );
}
