"use client";

/**
 * 단위 사이즈 입력 모달
 *
 * - 한 화물 행의 quantity 안에서 사이즈가 다른 단위들이 섞여 있을 때 사용
 * - (가로, 세로, 높이, 수량) 그룹을 여러 개 등록할 수 있다
 * - 시스템 CBM = Σ (가로×세로×높이×수량) / 1_000_000  (cm → m³ 변환)
 *
 * 예) 162×107×66 cm × 4개 그룹 하나 → 1.62×1.07×0.66 = 1.144 × 4 = 4.576 m³
 */

import { useEffect, useState } from "react";
import type { UnitSize, CargoType } from "@/types/cargo";
import { CARGO_TYPES } from "@/types/cargo";

interface UnitSizesModalProps {
  open: boolean;
  /** 행의 대표 수량 — 모달이 처음 열릴 때 1행 채울 때만 사용 */
  baseQuantity: number;
  baseSize: { width: number; length: number; height: number };
  /** 행의 단위 중량 (kg/개) — 새 그룹 추가 / 초기 행 채울 때 기본값으로 사용 */
  baseWeight?: number;
  /** 행의 기본 화물 종류 (PL/CT 등) — 사이즈 그룹마다 다른 화종 미지정 시 이 값 사용. 사용자가 다르게 선택하면 그 값으로 덮어씀. */
  baseCargoType?: CargoType;
  initial?: UnitSize[];
  itemLabel?: string;
  onClose: () => void;
  onSave: (sizes: UnitSize[]) => void;
}

interface DraftRow extends UnitSize {
  rowKey: string;
  weight: number;
}

function makeDraft(u: UnitSize): DraftRow {
  return {
    ...u,
    weight: typeof u.weight === "number" ? u.weight : 0,
    rowKey: crypto.randomUUID(),
  };
}

/**
 * 단위중량 자동 배분 — 행의 중량은 총중량(엑셀 G.W/T) 으로 간주.
 *  단위중량 = 행 총중량 / 행 수량  (수량 0 이면 0)
 */
function unitWeightDefault(totalWeight: number, totalQty: number): number {
  if (!totalWeight || totalWeight <= 0) return 0;
  if (!totalQty || totalQty <= 0) return 0;
  const v = totalWeight / totalQty;
  return Number.isFinite(v) ? Number(v.toFixed(3)) : 0;
}

function defaultDraft(base: UnitSizesModalProps): DraftRow[] {
  const perUnit = unitWeightDefault(base.baseWeight ?? 0, base.baseQuantity);
  // 기존 unitSizes 가 있고 무게가 0이면 행의 단위중량 기본값으로 보강
  if (base.initial && base.initial.length > 0) {
    return base.initial.map((u) => {
      const draft = makeDraft(u);
      if ((!draft.weight || draft.weight <= 0) && perUnit > 0) {
        draft.weight = perUnit;
      }
      return draft;
    });
  }
  // 행 수량(N) 만큼 qty=1 그룹을 자동 생성 — 사용자가 단위별로 다른 사이즈/무게 입력 용이.
  // 너무 많으면 가독성 떨어지므로 50 초과 시 단일 그룹(qty=N) 으로 폴백.
  const n = Math.max(1, base.baseQuantity || 1);
  if (n > 50) {
    return [
      {
        rowKey: crypto.randomUUID(),
        width: base.baseSize.width || 0,
        length: base.baseSize.length || 0,
        height: base.baseSize.height || 0,
        quantity: n,
        weight: perUnit,
      },
    ];
  }
  return Array.from({ length: n }, () => ({
    rowKey: crypto.randomUUID(),
    width: base.baseSize.width || 0,
    length: base.baseSize.length || 0,
    height: base.baseSize.height || 0,
    quantity: 1,
    weight: perUnit,
  }));
}

function unitCbm(u: { width: number; length: number; height: number; quantity: number }): number {
  return (u.width * u.length * u.height * u.quantity) / 1_000_000;
}

function unitWeightTotal(u: { weight: number; quantity: number }): number {
  return u.weight * u.quantity;
}

export function UnitSizesModal(props: UnitSizesModalProps) {
  const { open, baseQuantity, baseWeight, baseCargoType, onClose, onSave, itemLabel } = props;
  const [drafts, setDrafts] = useState<DraftRow[]>(() => defaultDraft(props));

  // 모달이 열릴 때마다 초기값을 다시 적용 (서로 다른 행을 편집해도 맞물림)
  useEffect(() => {
    if (open) setDrafts(defaultDraft(props));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.initial, props.baseQuantity, props.baseSize.width, props.baseSize.length, props.baseSize.height, props.baseWeight]);

  if (!open) return null;

  const updateRow = (rowKey: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => prev.map((d) => (d.rowKey === rowKey ? { ...d, ...patch } : d)));

  const perUnitDefault = unitWeightDefault(baseWeight ?? 0, baseQuantity);
  const addRow = () =>
    setDrafts((prev) => [
      ...prev,
      {
        rowKey: crypto.randomUUID(),
        width: 0,
        length: 0,
        height: 0,
        quantity: 1,
        weight: perUnitDefault,
      },
    ]);

  const removeRow = (rowKey: string) =>
    setDrafts((prev) => prev.filter((d) => d.rowKey !== rowKey));

  const totalQty = drafts.reduce((s, d) => s + (Number.isFinite(d.quantity) ? d.quantity : 0), 0);
  const totalCbm = drafts.reduce((s, d) => s + unitCbm(d), 0);
  const totalWeight = drafts.reduce((s, d) => s + unitWeightTotal(d), 0);
  const qtyMismatch = totalQty !== baseQuantity;
  // 엑셀 중량(=baseWeight) 과 단위 중량 합이 일치하는지 확인 (오차 0.5kg)
  const weightMismatch =
    baseWeight && baseWeight > 0
      ? Math.abs(totalWeight - baseWeight) > 0.5
      : false;

  const handleSave = () => {
    const cleaned: UnitSize[] = drafts
      .filter((d) => d.width > 0 && d.length > 0 && d.height > 0 && d.quantity > 0)
      .map((d) => ({
        width: d.width,
        length: d.length,
        height: d.height,
        quantity: d.quantity,
        weight: d.weight >= 0 ? d.weight : 0,
      }));
    onSave(cleaned);
    onClose();
  };

  const handleClear = () => {
    onSave([]);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">단위 사이즈 입력</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {itemLabel ? `[${itemLabel}] ` : ""}수량 {baseQuantity}개 안에서 사이즈가 다르면 그룹별로 입력하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-600">
              <tr>
                <th className="px-1 py-1 text-right">가로(cm)</th>
                <th className="px-1 py-1 text-right">세로(cm)</th>
                <th className="px-1 py-1 text-right">높이(cm)</th>
                <th className="px-1 py-1 text-right">수량</th>
                <th className="px-1 py-1 text-right">단위중량(kg)</th>
                <th className="px-1 py-1 text-right">화종</th>
                <th className="px-1 py-1 text-right">CBM</th>
                <th className="px-1 py-1 text-right">총 무게(kg)</th>
                <th className="px-1 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.rowKey} className="border-t border-neutral-100">
                  {(["width", "length", "height", "quantity", "weight"] as const).map((field) => (
                    <td key={field} className="px-1 py-1">
                      <input
                        type="number"
                        min={0}
                        step={field === "quantity" ? 1 : "any"}
                        value={d[field]}
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          updateRow(d.rowKey, {
                            [field]: Number.isFinite(num) ? num : 0,
                          } as Partial<DraftRow>);
                        }}
                        className="w-24 rounded border border-neutral-300 px-1 py-0.5 text-right"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">
                    <select
                      value={d.cargoType ?? baseCargoType ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        // 행 기본 화종과 같은 값이면 undefined 저장 (중복 보존 안 함)
                        const next =
                          v === "" || v === baseCargoType
                            ? undefined
                            : (v as CargoType);
                        updateRow(d.rowKey, { cargoType: next });
                      }}
                      className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-right"
                      title="박스별 화물 종류 (행 기본값과 다를 때만 저장)"
                    >
                      {CARGO_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right text-neutral-700">
                    {unitCbm(d).toFixed(4)}
                  </td>
                  <td className="px-1 py-1 text-right text-neutral-700">
                    {unitWeightTotal(d).toFixed(1)}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(d.rowKey)}
                      disabled={drafts.length === 1}
                      className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:text-neutral-300"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
            >
              + 사이즈 그룹 추가
            </button>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
          <div className="flex flex-col text-xs text-neutral-700">
            <span>
              총 수량 <b className={qtyMismatch ? "text-red-600" : "text-neutral-900"}>{totalQty}</b>
              <span className="text-neutral-400"> / 행 수량 {baseQuantity}</span>
              {qtyMismatch && (
                <span className="ml-2 text-red-600">⚠ 행 수량과 합이 다릅니다</span>
              )}
            </span>
            <span>
              시스템 CBM <b className="text-neutral-900">{totalCbm.toFixed(4)}</b> m³
              {totalWeight > 0 && (
                <>
                  &nbsp;·&nbsp;총 무게{" "}
                  <b className={weightMismatch ? "text-red-600" : "text-neutral-900"}>
                    {totalWeight.toFixed(1)}
                  </b>{" "}
                  kg
                </>
              )}
              {baseWeight && baseWeight > 0 && (
                <>
                  &nbsp;/&nbsp;엑셀 중량 <b className="text-neutral-900">{baseWeight.toFixed(1)}</b> kg
                  {weightMismatch ? (
                    <span className="ml-1 text-red-600">⚠ 불일치 (Δ {Math.abs(totalWeight - baseWeight).toFixed(1)})</span>
                  ) : (
                    <span className="ml-1 text-emerald-600">✅ 일치</span>
                  )}
                </>
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
              title="단위 사이즈 비움 — 시스템 CBM 은 행의 대표 사이즈로 계산"
            >
              비우기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
