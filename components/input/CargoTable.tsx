"use client";

/**
 * 화물 입력 표
 *
 * - 한 부킹 안에 들어가는 화물 행을 모아 편집
 * - CBM 은 (w*l*h*qty)/1_000_000 로 자동 계산하되 사용자가 덮어쓸 수 있도록 별도 입력
 */

import type { Orientation, Remark } from "@/types/cargo";
import { RemarksEditor } from "./RemarksEditor";

/**
 * 표가 다루는 행 — API 입력 스키마(CargoItemInput) 와 1:1 대응
 * 단, 표 내부 추적용 임시 키(rowKey) 만 추가
 */
export interface CargoRow {
  rowKey: string;
  id?: string;
  sortOrder?: number;
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
  cbm: number | null;
  cbmAuto: boolean;
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
    itemName: "",
    actualShipperName: "",
    shipperName: "",
    widthCm: 0,
    lengthCm: 0,
    heightCm: 0,
    quantity: 1,
    weightPerUnitKg: 0,
    cbm: 0,
    cbmAuto: true,
    noStacking: false,
    topOnly: false,
    orientation: "free",
    heavierBelow: false,
    itemRemark: "",
  };
}

function autoCbm(
  r: Pick<CargoRow, "widthCm" | "lengthCm" | "heightCm" | "quantity">,
): number {
  const v = (r.widthCm * r.lengthCm * r.heightCm * r.quantity) / 1_000_000;
  return Number.isFinite(v) ? Number(v.toFixed(4)) : 0;
}

export function CargoTable({ rows, onChange }: CargoTableProps) {
  const updateRow = (rowKey: string, patch: Partial<CargoRow>) => {
    onChange(
      rows.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const merged = { ...r, ...patch };
        // 사이즈/수량이 바뀌면 자동 모드일 때 CBM 재계산
        if (
          merged.cbmAuto &&
          ("widthCm" in patch ||
            "lengthCm" in patch ||
            "heightCm" in patch ||
            "quantity" in patch)
        ) {
          merged.cbm = autoCbm(merged);
        }
        return merged;
      }),
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

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-700">
          <tr>
            <th className="px-2 py-2 text-left">품목명</th>
            <th className="px-2 py-2 text-left">실화주</th>
            <th className="px-2 py-2 text-left">화주</th>
            <th className="px-2 py-2 text-right">가로(cm)</th>
            <th className="px-2 py-2 text-right">세로(cm)</th>
            <th className="px-2 py-2 text-right">높이(cm)</th>
            <th className="px-2 py-2 text-right">수량</th>
            <th className="px-2 py-2 text-right">중량(kg/개)</th>
            <th className="px-2 py-2 text-right">CBM</th>
            <th className="px-2 py-2 text-left">리마크</th>
            <th className="px-2 py-2 text-left">메모</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={12}
                className="px-2 py-6 text-center text-neutral-500"
              >
                아래 &quot;행 추가&quot; 버튼으로 화물을 입력하세요.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const remark: Remark = {
                noStacking: r.noStacking,
                topOnly: r.topOnly,
                orientation: r.orientation,
                heavierBelow: r.heavierBelow,
              };
              return (
                <tr key={r.rowKey} className="border-t border-neutral-200">
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.itemName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemName: e.target.value })
                      }
                      className="w-32 rounded border border-neutral-300 px-1 py-0.5"
                      placeholder="합판"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.actualShipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, {
                          actualShipperName: e.target.value,
                        })
                      }
                      className="w-32 rounded border border-neutral-300 px-1 py-0.5"
                      placeholder="실화주명"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.shipperName}
                      onChange={(e) =>
                        updateRow(r.rowKey, { shipperName: e.target.value })
                      }
                      className="w-32 rounded border border-neutral-300 px-1 py-0.5"
                      placeholder="화주명"
                    />
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
                    <td key={field} className="px-2 py-1">
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
                        className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-right"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={r.cbm ?? 0}
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          updateRow(r.rowKey, {
                            cbm: Number.isFinite(num) ? num : 0,
                            cbmAuto: false,
                          });
                        }}
                        className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-right"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateRow(r.rowKey, {
                            cbmAuto: true,
                            cbm: autoCbm(r),
                          })
                        }
                        className={`text-[10px] underline ${
                          r.cbmAuto ? "text-blue-600" : "text-neutral-400"
                        }`}
                        title="사이즈에서 자동 계산"
                      >
                        자동
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <RemarksEditor
                      value={remark}
                      onChange={(next) => updateRemarks(r.rowKey, next)}
                      compact
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.itemRemark}
                      onChange={(e) =>
                        updateRow(r.rowKey, { itemRemark: e.target.value })
                      }
                      className="w-40 rounded border border-neutral-300 px-1 py-0.5"
                      placeholder="(예: 깨지기 쉬움)"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowKey)}
                      className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
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
    </div>
  );
}
