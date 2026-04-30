"use client";

/**
 * 화물 입력 표
 *
 * - 한 부킹 안에 들어가는 화물 행을 모아 편집
 * - "엑셀 CBM" : 엑셀 파싱/사용자 직접 입력값. 자동 계산 안 함 (빈 칸 가능)
 * - "시스템 CBM" : 가로×세로×높이×수량 / 1_000_000 으로 자동 계산. 단위 사이즈가 있으면 그룹별 합산
 * - "사이즈" 버튼 : 수량 안에서 사이즈가 다른 단위가 섞여 있을 때 단위 사이즈 그룹을 입력하는 모달 호출
 */

import { Fragment, useState } from "react";
import type { CargoType, Orientation, Remark, UnitSize } from "@/types/cargo";
import { CARGO_TYPES, calcSystemCbm } from "@/types/cargo";
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

export function CargoTable({ rows, onChange }: CargoTableProps) {
  const [sizeModalRowKey, setSizeModalRowKey] = useState<string | null>(null);
  const [hideShippers, setHideShippers] = useState(false);
  const sizeModalRow = rows.find((r) => r.rowKey === sizeModalRowKey) ?? null;

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
    });

  // 17컬럼: # / 품목 / 실화주 / 화주 / 구분 / 가로 / 세로 / 높이 / 수량 / 중량 / 엑셀CBM / ABOUT / 시스템CBM / 사이즈 / 리마크 / 메모 / 삭제
  // 화주 숨김은 컬럼 폭 변경이 아닌 시각적 모자이크(blur) 로 처리 — 레이아웃 그대로.
  const colWidths = ["3%", "7%", "7%", "7%", "4%", "4%", "4%", "4%", "3%", "5%", "5%", "5%", "5%", "5%", "9%", "20%", "3%"];
  const visibleColCount = 17;
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
      <table className="w-full table-fixed text-xs">
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="bg-neutral-50 text-[11px] text-neutral-700">
          <tr>
            <th className="px-1 py-1 text-center text-neutral-500">#</th>
            <th className="px-1 py-1 text-left">품목명</th>
            <th className="px-1 py-1 text-left">실화주</th>
            <th className="px-1 py-1 text-left">화주</th>
            <th className="px-0.5 py-1 text-center">구분</th>
            <th className="px-0.5 py-1 text-right">가로</th>
            <th className="px-0.5 py-1 text-right">세로</th>
            <th className="px-0.5 py-1 text-right">높이</th>
            <th className="px-0.5 py-1 text-right">수량</th>
            <th className="px-0.5 py-1 text-right">중량</th>
            <th className="px-0.5 py-1 text-right">엑셀CBM</th>
            <th className="px-0.5 py-1 text-right">ABOUT</th>
            <th className="px-0.5 py-1 text-right">시스템CBM</th>
            <th className="px-0.5 py-1 text-center">사이즈</th>
            <th className="px-1 py-1 text-left">리마크</th>
            <th className="px-1 py-1 text-left">메모</th>
            <th className="px-0.5 py-1"></th>
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
            rows.map((r, idx) => {
              const remark: Remark = {
                noStacking: r.noStacking,
                topOnly: r.topOnly,
                orientation: r.orientation,
                heavierBelow: r.heavierBelow,
              };
              const sysCbm = rowSystemCbm(r);
              const hasUnitSizes = !!r.unitSizes && r.unitSizes.length > 0;
              // 시스템 CBM 비교 기준: 엑셀 CBM 우선, 없으면 ABOUT
              const referenceCbm = r.cbm ?? r.aboutCbm ?? null;
              const cbmDiff =
                referenceCbm != null ? Math.abs(sysCbm - referenceCbm) : null;
              const cbmMismatch = cbmDiff != null && cbmDiff > 0.01;
              return (
                <Fragment key={r.rowKey}>
                <tr className="border-t border-neutral-200 align-top">
                  <td className="px-1 py-0.5 text-center text-[11px] text-neutral-500">
                    {idx + 1}
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={r.itemName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemName: e.target.value })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 px-1 py-px"
                      placeholder="품목"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={r.actualShipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, {
                          actualShipperName: e.target.value,
                        })
                      }
                      className={`w-full min-w-0 rounded border border-neutral-300 px-1 py-px ${shipperMaskCls}`}
                      placeholder="실화주"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={r.shipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { shipperName: e.target.value })
                      }
                      className={`w-full min-w-0 rounded border border-neutral-300 px-1 py-px ${shipperMaskCls}`}
                      placeholder="화주"
                    />
                  </td>
                  {/* 구분 — 화물 종류. CT 면 시각화 제외, CBM 만 합산 */}
                  <td className="px-0.5 py-0.5">
                    <select
                      value={r.cargoType}
                      onChange={(e) =>
                        updateRow(r.rowKey, {
                          cargoType: e.target.value as CargoType,
                        })
                      }
                      className={`w-full min-w-0 rounded border px-0.5 py-px text-[11px] ${
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
                    <td key={field} className="px-0.5 py-0.5">
                      <input
                        type="number"
                        min={0}
                        step={field === "quantity" ? 1 : "any"}
                        value={r[field]}
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          updateRow(r.rowKey, {
                            [field]: Number.isFinite(num) ? num : 0,
                          } as Partial<CargoRow>);
                        }}
                        className="w-full min-w-0 rounded border border-neutral-300 px-0.5 py-px text-right"
                      />
                    </td>
                  ))}
                  {/* 엑셀 CBM — 자동 계산 없음. 빈 칸(null)이면 파싱 실패로 간주, 행마다 ⚠ 표시 */}
                  <td className="px-0.5 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={r.cbm ?? ""}
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
                        className={`w-full min-w-0 rounded border px-0.5 py-px text-right ${
                          r.cbm == null
                            ? "border-amber-400 bg-amber-50"
                            : "border-neutral-300"
                        }`}
                      />
                      {r.cbm == null && (
                        <span
                          className="cursor-help text-[11px] text-amber-600"
                          title="엑셀 CFS CBM 비어있음 — ABOUT 또는 시스템 CBM 사용. 직접 입력 가능."
                          aria-label="엑셀 CBM 파싱 실패"
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  </td>
                  {/* ABOUT — 엑셀 ABOUT 셀에서 파싱한 값 (CFS CBM 폴백) */}
                  <td className="px-0.5 py-0.5">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={r.aboutCbm ?? ""}
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
                      className="w-full min-w-0 rounded border border-neutral-300 px-0.5 py-px text-right"
                    />
                  </td>
                  {/* 시스템 CBM — 읽기 전용 표시. 기준 CBM 과 0.01 초과 차이면 빨간색 강조 */}
                  <td
                    className={`px-0.5 py-0.5 text-right ${
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
                  {/* 사이즈 버튼 */}
                  <td className="px-0.5 py-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => setSizeModalRowKey(r.rowKey)}
                      className={`rounded border px-1 py-px text-[11px] leading-tight ${
                        hasUnitSizes
                          ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                      }`}
                      title="단위별 사이즈 입력"
                    >
                      사이즈
                    </button>
                  </td>
                  <td className="px-1 py-0.5">
                    <RemarksEditor
                      value={remark}
                      onChange={(next) => updateRemarks(r.rowKey, next)}
                      compact
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <textarea
                      value={r.itemRemark}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemRemark: e.target.value })
                      }
                      rows={2}
                      className="w-full min-w-0 resize-y rounded border border-neutral-300 px-1 py-0.5 text-[11px] leading-tight whitespace-pre-wrap break-words"
                      placeholder="REMARK 원문"
                    />
                  </td>
                  <td className="px-0.5 py-0.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowKey)}
                      className="rounded px-1 py-px text-[11px] leading-tight text-red-600 hover:bg-red-50"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
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
        baseWeight={sizeModalRow?.weightPerUnitKg ?? 0}
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
