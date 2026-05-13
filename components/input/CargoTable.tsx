"use client";

/**
 * 화물 입력 표
 *
 * - 한 부킹 안에 들어가는 화물 행을 모아 편집
 * - "엑셀 CBM" : 엑셀 파싱/사용자 직접 입력값. 자동 계산 안 함 (빈 칸 가능)
 * - "시스템 CBM" : 가로×세로×높이×수량 / 1_000_000 으로 자동 계산. 단위 사이즈가 있으면 그룹별 합산
 * - "사이즈" 버튼 : 수량 안에서 사이즈가 다른 단위가 섞여 있을 때 단위 사이즈 그룹을 입력하는 모달 호출
 */

import { Fragment, useMemo, useState } from "react";
import type { CargoSpec, CargoType, Orientation, Remark, UnitSize } from "@/types/cargo";
import { CARGO_TYPES, calcSystemCbm, DEFAULT_REMARK } from "@/types/cargo";
import { distributeBookingValues, type DistributedField } from "@/lib/distribute-booking-values";
import { correctInflatedUnitWeights } from "@/lib/excel";
import { RemarksEditor } from "./RemarksEditor";
import { UnitSizesModal } from "./UnitSizesModal";

/**
 * 표가 다루는 행 — API 입력 스키마(CargoItemInput) 와 1:1 대응
 * 단, 표 내부 추적용 임시 키(rowKey) 만 추가
 */
export interface CargoRow {
  rowKey: string;
  id?: string;
  sortOrder?: number;
  /** 화물 종류 — PL/WB/WC/WD/CR/CL = 정상, CT = 카톤(시각화 제외) */
  cargoType: CargoType;
  /** 부킹 번호 — 같은 booking 화물 묶음 배치용 */
  bookingNo: string;
  /** House B/L (포워더 발행) — cargo 단위 */
  houseBlNo: string;
  /** DEST(목적지) — cargo 단위 */
  destination: string;
  itemName: string;
  /** 화물 라인별 실화주 (콘솔 케이스에서 행마다 다름) */
  actualShipperName: string;
  /** 화물 라인별 화주(표시) */
  shipperName: string;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  quantity: number;
  weightPerUnitKg: number;
  /** 엑셀 "CFS CBM" 셀 또는 사용자 직접 입력 CBM. 미입력은 null */
  cbm: number | null;
  /** 엑셀 ABOUT 셀에서 파싱한 값. CFS CBM 비어있을 때 비교 폴백 */
  aboutCbm: number | null;
  /** 단위별 사이즈 그룹 (없거나 길이 0이면 시스템 CBM 은 대표 사이즈 사용) */
  unitSizes?: UnitSize[];
  noStacking: boolean;
  topOnly: boolean;
  orientation: Orientation;
  heavierBelow: boolean;
  /** 자체다단 — 같은 booking 안에서만 적층 허용. 다른 booking 위/아래 적층 X */
  selfStackOnly?: boolean;
  itemRemark: string;
}

interface CargoTableProps {
  rows: CargoRow[];
  onChange: (rows: CargoRow[]) => void;
}

export function makeEmptyRow(): CargoRow {
  return {
    rowKey: crypto.randomUUID(),
    cargoType: "CT",
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
  };
}

/** 시스템 CBM — 단위 사이즈 묶음 우선, 없으면 대표 사이즈 × 수량 */
function rowSystemCbm(r: CargoRow): number {
  const v = calcSystemCbm({
    width: r.widthCm,
    length: r.lengthCm,
    height: r.heightCm,
    quantity: r.quantity,
    unitSizes: r.unitSizes,
  });
  return Number.isFinite(v) ? v : 0;
}

/**
 * unit weight 합 계산 — UnitSizesModal defaultDraft 와 같은 보정 적용.
 * 1. correctInflatedUnitWeights (모든 unit weight == rowWt 케이스 분배)
 * 2. 그래도 unit weight 가 0/누락이면 perUnit (= rowWt / quantity) 폴백
 */
function computeEffectiveUnitWeightSum(r: CargoRow, rowWt: number): number {
  if (!r.unitSizes || r.unitSizes.length === 0) return 0;
  const corrected =
    correctInflatedUnitWeights(
      { quantity: r.quantity, weightPerUnitKg: rowWt },
      r.unitSizes,
    ) ?? r.unitSizes;
  const perUnit = r.quantity > 0 ? rowWt / r.quantity : 0;
  return corrected.reduce((s, u) => {
    const w = u.weight && u.weight > 0 ? u.weight : perUnit;
    return s + w * (u.quantity ?? 1);
  }, 0);
}

/**
 * 무게 분배 불일치 검출 — raw OR distribute 후 둘 중 하나 일치면 mismatch X.
 *
 * 두 가지 케이스 모두 일치로 처리:
 * - raw 행 무게 == raw unit 합 (예: DSR 행 1 — raw 6238 vs 693.111×9=6238)
 * - distribute 후 행 무게 == raw unit 합 (예: 지브이 8 — raw 4400 분배 후 20.56 vs unit 20.561)
 *
 * 둘 다 차이 100kg + 5% 초과면 결함.
 *
 * @param effRowWeight distribute 적용 후 행 무게 (없으면 raw)
 */
function isWeightMismatch(r: CargoRow, effRowWeight?: number): boolean {
  if (!r.unitSizes || r.unitSizes.length === 0) return false;
  const rawRowWt = r.weightPerUnitKg;
  // raw 기준 일치 검사
  if (rawRowWt > 0) {
    const unitWtSumRaw = computeEffectiveUnitWeightSum(r, rawRowWt);
    const dRaw = Math.abs(unitWtSumRaw - rawRowWt);
    if (dRaw <= 100 || dRaw / rawRowWt <= 0.05) return false;
  }
  // distribute 후 기준 일치 검사
  const effWt = effRowWeight ?? rawRowWt;
  if (!effWt || effWt <= 0) return false;
  const unitWtSumEff = computeEffectiveUnitWeightSum(r, effWt);
  const dEff = Math.abs(unitWtSumEff - effWt);
  return dEff > 100 && dEff / effWt > 0.05;
}

/**
 * CBM 분배 불일치 검출 — 시각 적재 화물 (PL/WB/WC/WD/CR/CL) 만 검사.
 * CT / PK (카톤류 — 보통 사이즈 안 적힌 채 부피만 합산) 는 사이즈 불일치 의미 X → 검사 제외.
 * 시스템 cbm 과 행 cbm/about 차이가 0.01 m³ 초과면 결함.
 *
 * @param effRowCbm distribute 적용 후 행 cbm (없으면 raw r.cbm ?? r.aboutCbm)
 */
function isCbmMismatch(r: CargoRow, effRowCbm?: number | null): boolean {
  if (r.cargoType === "CT" || r.cargoType === "PK") return false;
  const referenceCbm =
    effRowCbm != null ? effRowCbm : (r.cbm ?? r.aboutCbm ?? null);
  if (referenceCbm == null || referenceCbm <= 0) return false;
  return Math.abs(rowSystemCbm(r) - referenceCbm) > 0.01;
}

export function CargoTable({ rows, onChange }: CargoTableProps) {
  const [sizeModalRowKey, setSizeModalRowKey] = useState<string | null>(null);
  const [hideShippers, setHideShippers] = useState(false);
  const [mismatchFilter, setMismatchFilter] = useState<"all" | "weight" | "cbm">("all");
  const sizeModalRow = rows.find((r) => r.rowKey === sizeModalRowKey) ?? null;

  // 부킹 단위 자동 분배 정보 — 같은 booking + 같은 화주 안에서 한 행에만 무게/CBM 몰려있으면
  // 수량 비율 분배. 분배된 필드 + 분배값을 별도로 보관해 화면에 빨간 글씨로 표시.
  const distInfo = useMemo(() => {
    const cargoes: CargoSpec[] = rows.map((r) => ({
      id: r.rowKey,
      shipmentId: "",
      sortOrder: r.sortOrder ?? 0,
      cargoType: r.cargoType,
      bookingNo: r.bookingNo,
      actualShipperName: r.actualShipperName,
      width: r.widthCm,
      length: r.lengthCm,
      height: r.heightCm,
      quantity: r.quantity,
      weightPerUnit: r.weightPerUnitKg,
      cbm: r.cbm ?? undefined,
      aboutCbm: r.aboutCbm ?? undefined,
      remarks: DEFAULT_REMARK,
    }));
    const result = distributeBookingValues(cargoes);
    const distributedValues = new Map<
      string,
      { cbm?: number; aboutCbm?: number; weightPerUnit?: number }
    >();
    for (const c of result.cargoes) {
      const fields = result.distributedFields.get(c.id);
      if (!fields || fields.size === 0) continue;
      const v: { cbm?: number; aboutCbm?: number; weightPerUnit?: number } = {};
      if (fields.has("cbm")) v.cbm = c.cbm;
      if (fields.has("aboutCbm")) v.aboutCbm = c.aboutCbm;
      if (fields.has("weightPerUnit")) v.weightPerUnit = c.weightPerUnit;
      distributedValues.set(c.id, v);
    }
    return { distributedFields: result.distributedFields, distributedValues };
  }, [rows]);

  const isDistributed = (rowKey: string, field: DistributedField): boolean => {
    return distInfo.distributedFields.get(rowKey)?.has(field) ?? false;
  };
  const distributedValue = (rowKey: string, field: DistributedField): number | undefined => {
    const v = distInfo.distributedValues.get(rowKey);
    if (!v) return undefined;
    return v[field];
  };

  // distribute 적용 후 실제 행 값 — 부킹 자동 분배·correct 보정 후 비교 (raw 거짓 양성 제거)
  const effRowWeight = (r: CargoRow): number =>
    isDistributed(r.rowKey, "weightPerUnit")
      ? (distributedValue(r.rowKey, "weightPerUnit") ?? r.weightPerUnitKg)
      : r.weightPerUnitKg;
  const effRowCbm = (r: CargoRow): number | null => {
    if (isDistributed(r.rowKey, "cbm"))
      return distributedValue(r.rowKey, "cbm") ?? null;
    if (r.cbm != null && r.cbm > 0) return r.cbm;
    if (isDistributed(r.rowKey, "aboutCbm"))
      return distributedValue(r.rowKey, "aboutCbm") ?? null;
    return r.aboutCbm ?? null;
  };
  const checkWeightMismatch = (r: CargoRow): boolean =>
    isWeightMismatch(r, effRowWeight(r));
  const checkCbmMismatch = (r: CargoRow): boolean =>
    isCbmMismatch(r, effRowCbm(r));
  // 불일치 행 카운트 — 헤더 버튼 표시용
  const weightMismatchCount = rows.filter(checkWeightMismatch).length;
  const cbmMismatchCount = rows.filter(checkCbmMismatch).length;

  const updateRow = (rowKey: string, patch: Partial<CargoRow>) => {
    onChange(
      rows.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)),
    );
  };

  const addRow = () => onChange([...rows, makeEmptyRow()]);
  const removeRow = (rowKey: string) =>
    onChange(rows.filter((r) => r.rowKey !== rowKey));

  const updateRemarks = (rowKey: string, remark: Remark) =>
    updateRow(rowKey, {
      noStacking: remark.noStacking,
      topOnly: remark.topOnly,
      orientation: remark.orientation,
      heavierBelow: remark.heavierBelow,
      selfStackOnly: remark.selfStackOnly ?? false,
    });

  // 20컬럼: # / HBL / DEST / 부킹 / 품목 / 실화주 / 화주 / 구분 / 가로 / 세로 / 높이 / 수량 / 중량 / CFS / ABOUT / 시스템 / 사이즈 / 리마크 / 메모 / 삭제
  // 화주 숨김은 컬럼 폭 변경이 아닌 시각적 모자이크(blur) 로 처리 — 레이아웃 그대로.
  // CFS / ABOUT / 시스템CBM — CBM 류 3 컬럼 동일 너비 5% (ABOUT 데이터 잘림 방지, 2026-05-13 수정)
  const colWidths = ["1.5%", "6%", "8.5%", "6%", "2%", "8%", "7%", "2.5%", "3%", "3%", "3%", "2.5%", "4%", "5%", "5%", "5%", "3%", "8%", "15.5%", "1.5%"];
  const visibleColCount = 20;
  // 모자이크 클래스 — 입력 값과 placeholder 가 흐려지고 클릭/포커스도 차단해 옆사람이 읽지 못하게.
  const shipperMaskCls = hideShippers
    ? "pointer-events-none select-none [filter:blur(5px)]"
    : "";

  // 토탈 — 화물 목록 합계 (엑셀 가져온 값 + 사용자 직접 수정값 모두 반영)
  const totals = rows.reduce(
    (acc, r) => ({
      cfs: acc.cfs + (r.cbm ?? 0),
      about: acc.about + (r.aboutCbm ?? 0),
      quantity: acc.quantity + (Number.isFinite(r.quantity) ? r.quantity : 0),
      weight:
        acc.weight +
        (Number.isFinite(r.weightPerUnitKg) ? r.weightPerUnitKg : 0),
    }),
    { cfs: 0, about: 0, quantity: 0, weight: 0 },
  );

  return (
    <div className="rounded-lg border border-neutral-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-2 py-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-tight">
          <span className="text-neutral-500">총 {rows.length} 행</span>
          {rows.length > 0 && (
            <>
              <span className="text-neutral-300">|</span>
              <span>
                <span className="text-neutral-500">총 CFS CBM</span>{" "}
                <b className="text-neutral-900">{totals.cfs.toFixed(3)}</b>
                <span className="text-neutral-400"> m³</span>
              </span>
              <span>
                <span className="text-neutral-500">총 ABOUT</span>{" "}
                <b className="text-neutral-900">{totals.about.toFixed(3)}</b>
                <span className="text-neutral-400"> m³</span>
              </span>
              <span>
                <span className="text-neutral-500">총 수량</span>{" "}
                <b className="text-neutral-900">{totals.quantity}</b>
                <span className="text-neutral-400">개</span>
              </span>
              <span>
                <span className="text-neutral-500">총 무게</span>{" "}
                <b className="text-neutral-900">{totals.weight.toFixed(1)}</b>
                <span className="text-neutral-400"> kg</span>
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setHideShippers((v) => !v)}
          className={`rounded border px-2 py-0.5 text-[11px] leading-tight ${
            hideShippers
              ? "border-neutral-700 bg-neutral-800 text-white hover:bg-neutral-900"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
          }`}
          title={hideShippers ? "화주/실화주 컬럼 다시 표시" : "화주/실화주 컬럼 숨기기 (화면 가림용)"}
        >
          {hideShippers ? "👁 화주 다시 보기" : "🙈 화주 숨기기"}
        </button>
      </div>
      {/* 불일치 필터 — 무게/CBM 분배 안 맞는 행만 보기 (2026-05-13 추가) */}
      <div className="mb-1 flex items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => setMismatchFilter("all")}
          className={`rounded border px-2 py-0.5 leading-tight ${
            mismatchFilter === "all"
              ? "border-neutral-700 bg-neutral-800 text-white"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          전체 목록 보기 ({rows.length})
        </button>
        <button
          type="button"
          onClick={() => setMismatchFilter("weight")}
          disabled={weightMismatchCount === 0}
          className={`rounded border px-2 py-0.5 leading-tight ${
            mismatchFilter === "weight"
              ? "border-red-700 bg-red-600 text-white"
              : weightMismatchCount > 0
                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-neutral-200 bg-neutral-50 text-neutral-400"
          }`}
          title="unit 무게 합과 행 무게 차이 큰 행 (100kg + 5% 초과)"
        >
          무게 불일치 {weightMismatchCount}
        </button>
        <button
          type="button"
          onClick={() => setMismatchFilter("cbm")}
          disabled={cbmMismatchCount === 0}
          className={`rounded border px-2 py-0.5 leading-tight ${
            mismatchFilter === "cbm"
              ? "border-amber-700 bg-amber-600 text-white"
              : cbmMismatchCount > 0
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border-neutral-200 bg-neutral-50 text-neutral-400"
          }`}
          title="시스템 CBM 과 행 CBM/ABOUT 차이 0.01 m³ 초과 행"
        >
          CBM 불일치 {cbmMismatchCount}
        </button>
      </div>
      <table className="w-full table-fixed text-xs">
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="bg-neutral-50 text-[11px] leading-none text-neutral-700">
          <tr>
            <th className="px-0 py-1 text-center text-neutral-500">#</th>
            <th className="px-0 py-1 text-left">House B/L</th>
            <th className="px-0 py-1 text-left">DEST</th>
            <th className="px-0 py-1 text-left">Booking No</th>
            <th className="px-0 py-1 text-left">품목명</th>
            <th className="px-0 py-1 text-left">실화주</th>
            <th className="px-0 py-1 text-left">화주</th>
            <th className="px-0 py-1 text-center">구분</th>
            <th className="px-0 py-1 text-right">가로</th>
            <th className="px-0 py-1 text-right">세로</th>
            <th className="px-0 py-1 text-right">높이</th>
            <th className="px-0 py-1 text-right">수량</th>
            <th className="px-0 py-1 text-right">총 중량 (kg)</th>
            <th className="px-0 py-1 text-right">CFS CBM(입고완료)</th>
            <th className="px-0 py-1 text-right">ABOUT</th>
            <th className="px-0 py-1 text-right">시스템CBM</th>
            <th className="px-0 py-1 text-center">사이즈</th>
            <th className="px-0 py-1 text-left">리마크</th>
            <th className="px-0 py-1 text-left">메모</th>
            <th className="px-0 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={visibleColCount}
                className="px-2 py-6 text-center text-neutral-500"
              >
                아래 &quot;행 추가&quot; 버튼으로 화물을 입력하세요.
              </td>
            </tr>
          ) : (
            rows
              .filter((r) => {
                if (mismatchFilter === "all") return true;
                const predicate =
                  mismatchFilter === "weight"
                    ? checkWeightMismatch
                    : checkCbmMismatch;
                // 본인이 불일치면 표시
                if (predicate(r)) return true;
                // 같은 booking 안 다른 행이 불일치하면 같이 표시 (부킹 단위 분배 보정 편의)
                if (!r.bookingNo) return false;
                return rows.some(
                  (other) => other.bookingNo === r.bookingNo && predicate(other),
                );
              })
              .map((r, idx) => {
              const remark: Remark = {
                noStacking: r.noStacking,
                topOnly: r.topOnly,
                orientation: r.orientation,
                heavierBelow: r.heavierBelow,
                selfStackOnly: r.selfStackOnly,
              };
              const sysCbm = rowSystemCbm(r);
              const hasUnitSizes = !!r.unitSizes && r.unitSizes.length > 0;
              // 시스템 CBM 비교 기준: distribute 적용 후 실제 값 (raw 거짓 양성 제거)
              const referenceCbm = effRowCbm(r);
              const cbmDiff =
                referenceCbm != null ? Math.abs(sysCbm - referenceCbm) : null;
              const cbmMismatch = checkCbmMismatch(r);
              // unitSizes 무게 분배 불일치 — distribute + correct 적용 후 비교
              const weightMismatch = checkWeightMismatch(r);
              // 불일치 행 깜박임 — 사용자가 한눈에 확인하도록 시각 강조 (2026-05-13 추가)
              const rowBlink = cbmMismatch || weightMismatch;
              // 불일치 안내용 정확한 차이 값 — isWeightMismatch 와 같은 raw 기준 비교
              // (distribute 분배 후 값은 사용자 보정 결과라 검사 무관, 표시도 raw 로 통일)
              const rawWt = r.weightPerUnitKg;
              const unitWtSum = hasUnitSizes
                ? computeEffectiveUnitWeightSum(r, rawWt)
                : 0;
              const dWt = unitWtSum - rawWt;
              const dCbm = referenceCbm != null ? sysCbm - referenceCbm : 0;
              return (
                <Fragment key={r.rowKey}>
                <tr
                  className={`border-t border-neutral-200 align-middle leading-none ${
                    rowBlink ? "animate-pulse bg-red-50" : ""
                  }`}
                  title={
                    rowBlink
                      ? `[확인 필요] ${weightMismatch ? "무게 분배 불일치" : ""}${
                          weightMismatch && cbmMismatch ? " · " : ""
                        }${cbmMismatch ? "CBM 분배 불일치" : ""}`
                      : undefined
                  }
                >
                  <td className="px-0 py-0.5 text-center text-[11px] text-neutral-500">
                    <div>{idx + 1}</div>
                    {distInfo.distributedFields.has(r.rowKey) && (
                      <div
                        className="cursor-help text-[9px] font-bold text-red-600 leading-none"
                        title="같은 부킹 안 한 행에 몰린 값을 수량 비율로 자동 분배"
                      >
                        자동 분배
                      </div>
                    )}
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.houseBlNo}
                      onChange={(e) =>
                        updateRow(r.rowKey, { houseBlNo: e.target.value })
                      }
                      className="block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 font-mono text-[11px] leading-tight"
                      placeholder="House B/L"
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.destination}
                      onChange={(e) =>
                        updateRow(r.rowKey, { destination: e.target.value })
                      }
                      className="block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 text-[11px] leading-tight"
                      placeholder="DEST"
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.bookingNo}
                      onChange={(e) =>
                        updateRow(r.rowKey, { bookingNo: e.target.value })
                      }
                      className="block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 font-mono text-[11px] leading-tight"
                      placeholder="Booking No"
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.itemName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemName: e.target.value })
                      }
                      className="block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 text-[11px] leading-tight"
                      placeholder="품목"
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.actualShipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, {
                          actualShipperName: e.target.value,
                        })
                      }
                      className={`block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 text-[11px] leading-tight ${shipperMaskCls}`}
                      placeholder="실화주"
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <input
                      type="text"
                      value={r.shipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { shipperName: e.target.value })
                      }
                      className={`block w-full min-w-0 rounded border border-neutral-300 px-0.5 py-0 text-[11px] leading-tight ${shipperMaskCls}`}
                      placeholder="화주"
                    />
                  </td>
                  {/* 구분 — 화물 종류. CT 면 시각화 제외, CBM 만 합산 */}
                  <td className="px-0 py-0.5">
                    <select
                      value={r.cargoType}
                      onChange={(e) => {
                        const next = e.target.value as CargoType;
                        const patch: Partial<CargoRow> = { cargoType: next };
                        // unitSizes 안 cargoType 도 동기화 (알고리즘은 unit별 cargoType 우선)
                        if (r.unitSizes && r.unitSizes.length > 0) {
                          patch.unitSizes = r.unitSizes.map((u) => ({
                            ...u,
                            cargoType: next,
                          }));
                        }
                        updateRow(r.rowKey, patch);
                      }}
                      className={`block w-full min-w-0 rounded border px-0.5 py-0 text-[11px] leading-tight ${
                        r.cargoType === "CT"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-neutral-300"
                      }`}
                      title={
                        r.cargoType === "CT"
                          ? "카톤 — 실측 시각화 안 함, CBM 만 컨테이너 여유에 합산"
                          : "정상 화물 — W/L/H 시각 적재"
                      }
                    >
                      {CARGO_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(
                    [
                      "widthCm",
                      "lengthCm",
                      "heightCm",
                      "quantity",
                      "weightPerUnitKg",
                    ] as const
                  ).map((field) => (
                    <td key={field} className="px-0 py-0.5">
                      <input
                        type="number"
                        min={0}
                        step={field === "quantity" ? 1 : "any"}
                        value={
                          field === "weightPerUnitKg" &&
                          isDistributed(r.rowKey, "weightPerUnit")
                            ? Number((distributedValue(r.rowKey, "weightPerUnit") ?? 0).toFixed(2))
                            : r[field]
                        }
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          const value = Number.isFinite(num) ? num : 0;
                          const patch: Partial<CargoRow> = {
                            [field]: value,
                          } as Partial<CargoRow>;
                          // unitSizes 가 있으면 W·L·H·weight 도 같이 동기화 (알고리즘은 unitSizes 우선 사용)
                          if (r.unitSizes && r.unitSizes.length > 0) {
                            const usField =
                              field === "widthCm"
                                ? "width"
                                : field === "lengthCm"
                                  ? "length"
                                  : field === "heightCm"
                                    ? "height"
                                    : field === "weightPerUnitKg"
                                      ? "weight"
                                      : null;
                            if (usField) {
                              patch.unitSizes = r.unitSizes.map((u) => ({
                                ...u,
                                [usField]: value,
                              }));
                            }
                          }
                          updateRow(r.rowKey, patch);
                        }}
                        title={
                          field === "weightPerUnitKg" &&
                          isDistributed(r.rowKey, "weightPerUnit")
                            ? `자동 분배: ${(distributedValue(r.rowKey, "weightPerUnit") ?? 0).toFixed(2)}kg (같은 부킹 안 한 행에 몰린 무게를 수량 비율로 분배)`
                            : undefined
                        }
                        className={`block w-full min-w-0 rounded border px-0.5 py-0 text-right text-[11px] leading-tight ${
                          field === "weightPerUnitKg" &&
                          isDistributed(r.rowKey, "weightPerUnit")
                            ? "border-red-400 bg-red-50 font-bold text-red-600"
                            : "border-neutral-300"
                        }`}
                      />
                    </td>
                  ))}
                  {/* 엑셀 CBM — 자동 계산 없음. 빈 칸(null)이면 파싱 실패로 간주, 행마다 ⚠ 표시 */}
                  <td className="px-0 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={
                          isDistributed(r.rowKey, "cbm")
                            ? Number((distributedValue(r.rowKey, "cbm") ?? 0).toFixed(3))
                            : (r.cbm ?? "")
                        }
                        placeholder="—"
                        onChange={(e) => {
                          const t = e.target.value;
                          if (t === "") {
                            updateRow(r.rowKey, { cbm: null });
                            return;
                          }
                          const num = Number(t);
                          updateRow(r.rowKey, {
                            cbm: Number.isFinite(num) ? num : null,
                          });
                        }}
                        className={`block w-full min-w-0 rounded border px-0.5 py-0 text-right text-[11px] leading-tight ${
                          isDistributed(r.rowKey, "cbm")
                            ? "border-red-400 bg-red-50"
                            : r.cbm == null
                            ? "border-amber-400 bg-amber-50"
                            : "border-neutral-300"
                        }`}
                      />
                      {isDistributed(r.rowKey, "cbm") ? (
                        <span
                          className="cursor-help text-[10px] font-bold text-red-600"
                          title="같은 부킹 안 한 행에만 값이 몰려있어 수량 비율로 자동 분배됨"
                        >
                          →{(distributedValue(r.rowKey, "cbm") ?? 0).toFixed(2)}
                        </span>
                      ) : r.cbm == null ? (
                        <span
                          className="cursor-help text-[11px] text-amber-600"
                          title="엑셀 CFS CBM 비어있음 — ABOUT 또는 시스템 CBM 사용. 직접 입력 가능."
                          aria-label="CFS CBM(입고완료) 파싱 실패"
                        >
                          ⚠
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {/* ABOUT — 엑셀 ABOUT 셀에서 파싱한 값 (CFS CBM 폴백) */}
                  <td className="px-0 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={
                          isDistributed(r.rowKey, "aboutCbm")
                            ? Number((distributedValue(r.rowKey, "aboutCbm") ?? 0).toFixed(3))
                            : (r.aboutCbm ?? "")
                        }
                        placeholder="—"
                        onChange={(e) => {
                          const t = e.target.value;
                          if (t === "") {
                            updateRow(r.rowKey, { aboutCbm: null });
                            return;
                          }
                          const num = Number(t);
                          updateRow(r.rowKey, {
                            aboutCbm: Number.isFinite(num) ? num : null,
                          });
                        }}
                        className={`block w-full min-w-0 rounded border px-0.5 py-0 text-right text-[11px] leading-tight ${
                          isDistributed(r.rowKey, "aboutCbm")
                            ? "border-red-400 bg-red-50"
                            : "border-neutral-300"
                        }`}
                      />
                      {isDistributed(r.rowKey, "aboutCbm") && (
                        <span
                          className="cursor-help text-[10px] font-bold text-red-600"
                          title="같은 부킹 안 한 행에만 값이 몰려있어 수량 비율로 자동 분배됨"
                        >
                          →{(distributedValue(r.rowKey, "aboutCbm") ?? 0).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* 시스템 CBM — 읽기 전용 표시. 기준 CBM 과 0.01 초과 차이면 빨간색 강조 */}
                  <td
                    className={`px-0 py-0.5 text-right text-[11px] ${
                      cbmMismatch ? "text-red-600 font-semibold" : "text-neutral-700"
                    }`}
                  >
                    <div className="flex flex-col items-end leading-none">
                      <span title={cbmMismatch ? `엑셀 ${referenceCbm} 와 차이 ${cbmDiff!.toFixed(3)}` : undefined}>
                        {sysCbm.toFixed(3)}
                      </span>
                      {hasUnitSizes && (
                        <span className="text-[10px] text-blue-600">
                          {r.unitSizes!.length}그룹
                        </span>
                      )}
                      {cbmMismatch && (
                        <span className="text-[10px] text-red-500">
                          Δ {cbmDiff!.toFixed(3)}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* 사이즈 버튼 — hover 시 무게/CBM 불일치 상세 차이 표시 */}
                  <td className="px-0 py-0.5 text-center">
                    {(() => {
                      // 사이즈 버튼 hover 툴팁 — 불일치 항목별 정확한 차이 값 동적 생성
                      let tooltipParts: string[] = [];
                      if (weightMismatch && r.unitSizes) {
                        const unitWtSum = r.unitSizes.reduce(
                          (s, u) => s + (u.weight ?? 0) * (u.quantity ?? 1),
                          0,
                        );
                        const dWt = unitWtSum - r.weightPerUnitKg;
                        tooltipParts.push(
                          `무게 불일치 — 행 ${r.weightPerUnitKg.toFixed(0)}kg vs 단위합 ${unitWtSum.toFixed(0)}kg (Δ ${dWt > 0 ? "+" : ""}${dWt.toFixed(0)} kg)`,
                        );
                      }
                      if (cbmMismatch && cbmDiff != null) {
                        const dCbm = sysCbm - (referenceCbm ?? 0);
                        tooltipParts.push(
                          `CBM 불일치 — 시스템 ${sysCbm.toFixed(3)} vs 행 ${(referenceCbm ?? 0).toFixed(3)} (Δ ${dCbm > 0 ? "+" : ""}${dCbm.toFixed(3)} m³)`,
                        );
                      }
                      const sizeTitle =
                        tooltipParts.length > 0
                          ? `[확인 필요]\n${tooltipParts.join("\n")}\n클릭하면 사이즈 모달 열림`
                          : hasUnitSizes
                            ? "다 일치 — 사이즈 모달 열기"
                            : "단위별 사이즈 입력";
                      const btnCls = rowBlink
                        ? "border-red-400 bg-red-100 text-red-800 font-bold hover:bg-red-200"
                        : hasUnitSizes
                          ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          : "border-neutral-300 text-neutral-700 hover:bg-neutral-50";
                      return (
                        <button
                          type="button"
                          onClick={() => setSizeModalRowKey(r.rowKey)}
                          className={`rounded border px-0.5 py-0 text-[11px] leading-none ${btnCls}`}
                          title={sizeTitle}
                        >
                          {rowBlink ? "⚠ 사이즈" : "사이즈"}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-0 py-0.5">
                    <RemarksEditor
                      value={remark}
                      onChange={(next) => updateRemarks(r.rowKey, next)}
                      compact
                    />
                  </td>
                  <td className="px-0 py-0.5">
                    <textarea
                      value={r.itemRemark}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemRemark: e.target.value })
                      }
                      rows={1}
                      className="block w-full min-w-0 resize-y rounded border border-neutral-300 px-0.5 py-0 text-[11px] leading-tight whitespace-pre-wrap break-words"
                      placeholder="REMARK 원문"
                    />
                  </td>
                  <td className="px-0 py-0.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowKey)}
                      className="rounded px-0.5 py-0 text-[11px] leading-none text-red-600 hover:bg-red-50"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                {rowBlink && (
                  <tr className="border-b border-red-200 bg-red-50">
                    <td className="px-1 py-0.5"></td>
                    <td colSpan={19} className="px-1 py-0.5 text-[10px] text-red-700 leading-tight">
                      ⚠ 확인 필요
                      {weightMismatch && (
                        <>
                          {" · "}
                          <b>무게</b> 행 {rawWt.toFixed(1)} · 단위합{" "}
                          {unitWtSum.toFixed(1)} (Δ {dWt > 0 ? "+" : ""}
                          {dWt.toFixed(1)})
                        </>
                      )}
                      {cbmMismatch && (
                        <>
                          {" · CFS CBM "}
                          {(r.cbm ?? 0).toFixed(3)}
                          {" · ABOUT "}
                          {(r.aboutCbm ?? 0).toFixed(3)}
                          {" · 시스템 CBM "}
                          {sysCbm.toFixed(3)} (Δ {dCbm > 0 ? "+" : ""}
                          {dCbm.toFixed(3)})
                        </>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
      <div className="border-t border-neutral-200 bg-neutral-50 px-2 py-2 text-right">
        <button
          type="button"
          onClick={addRow}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          + 행 추가
        </button>
      </div>

      <UnitSizesModal
        open={!!sizeModalRow}
        baseQuantity={sizeModalRow?.quantity ?? 1}
        baseSize={{
          width: sizeModalRow?.widthCm ?? 0,
          length: sizeModalRow?.lengthCm ?? 0,
          height: sizeModalRow?.heightCm ?? 0,
        }}
        baseWeight={
          sizeModalRow
            ? (isDistributed(sizeModalRow.rowKey, "weightPerUnit")
                ? (distributedValue(sizeModalRow.rowKey, "weightPerUnit") ?? 0)
                : sizeModalRow.weightPerUnitKg)
            : 0
        }
        baseCargoType={sizeModalRow?.cargoType}
        baseCbm={
          sizeModalRow
            ? (isDistributed(sizeModalRow.rowKey, "cbm")
                ? (distributedValue(sizeModalRow.rowKey, "cbm") ?? undefined)
                : isDistributed(sizeModalRow.rowKey, "aboutCbm")
                  ? (distributedValue(sizeModalRow.rowKey, "aboutCbm") ?? undefined)
                  : (sizeModalRow.cbm ?? sizeModalRow.aboutCbm ?? undefined))
            : undefined
        }
        initial={sizeModalRow?.unitSizes}
        itemLabel={sizeModalRow?.itemName || undefined}
        onClose={() => setSizeModalRowKey(null)}
        onSave={(sizes) => {
          if (sizeModalRowKey) {
            updateRow(sizeModalRowKey, {
              unitSizes: sizes.length > 0 ? sizes : undefined,
            });
          }
        }}
      />
    </div>
  );
}
