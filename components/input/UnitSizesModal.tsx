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
import { correctInflatedUnitWeights } from "@/lib/excel";

interface UnitSizesModalProps {
  open: boolean;
  /** 행의 대표 수량 — 모달이 처음 열릴 때 1행 채울 때만 사용 */
  baseQuantity: number;
  baseSize: { width: number; length: number; height: number };
  /** 행의 단위 중량 (kg/개) — 새 그룹 추가 / 초기 행 채울 때 기본값으로 사용 */
  baseWeight?: number;
  /** 행의 기본 화물 종류 (PL/CT 등) — 사이즈 그룹마다 다른 화종 미지정 시 이 값 사용. 사용자가 다르게 선택하면 그 값으로 덮어씀. */
  baseCargoType?: CargoType;
  /**
   * 행 기준 CBM (cfs cbm 우선, 없으면 aboutCbm). 주로 CT 행에서 unit cbm 자동 분배에 사용.
   * 새 그룹 생성 시 unit cbm = baseCbm / 그룹 수 로 자동 채움 (CT 박스가 사이즈 없이 부피만 명시하는 케이스).
   */
  baseCbm?: number;
  initial?: UnitSize[];
  itemLabel?: string;
  onClose: () => void;
  onSave: (sizes: UnitSize[]) => void;
}

interface DraftRow extends UnitSize {
  rowKey: string;
  weight: number;
}

function makeDraft(u: UnitSize, fallbackWeight = 0): DraftRow {
  // unit.weight 0/미지정 + fallbackWeight 있으면 폴백 적용 (행 단위 분배 무게 등)
  const w =
    typeof u.weight === "number" && u.weight > 0 ? u.weight : fallbackWeight;
  return {
    ...u,
    weight: w,
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
  // 자동 cbm 분배 — 사이즈 없는 행(W/L/H 중 0)이면 cargoType 무관하게 행 cbm/about 을 그룹 수로 분배.
  // 사이즈 있는 행은 박스 W×L×H 계산이 우선이라 자동 cbm 분배 X.
  // (algorithm.ts:classify 룰과 일치 — 사이즈 0 이면 CT 트랙으로 처리)
  const sizeMissing =
    !base.baseSize.width ||
    base.baseSize.width <= 0 ||
    !base.baseSize.length ||
    base.baseSize.length <= 0 ||
    !base.baseSize.height ||
    base.baseSize.height <= 0;
  const baseCbm =
    sizeMissing && base.baseCbm && base.baseCbm > 0 ? base.baseCbm : 0;
  // 기존 unitSizes 가 있고 무게가 0이면 행의 단위중량 기본값(분배된 baseWeight 또는 perUnit)으로 보강
  if (base.initial && base.initial.length > 0) {
    // 모든 unitSize.weight 가 행의 weightPerUnitKg 와 같으면 (잘못 파싱된 케이스) quantity 비율로 분배.
    // 샘플 JSON 처럼 ExcelImport 거치지 않은 raw 데이터의 unit weight 가 행 총무게와 같이 들어있는 결함 보정.
    const corrected =
      correctInflatedUnitWeights(
        { quantity: base.baseQuantity, weightPerUnitKg: base.baseWeight ?? 0 },
        base.initial,
      ) ?? base.initial;
    return corrected.map((u) => {
      // unit weight 가 0 이면 perUnit (박스 1개 무게 = 행 총 무게 / 수량) 폴백.
      // 이전엔 baseWeight(행 총 무게) 를 직접 폴백해 박스 1개 무게가 행 총 무게로 잘못 설정됨 (2026-05-13 수정).
      return makeDraft(u, perUnit);
    });
  }
  // 행 수량(N) 만큼 qty=1 그룹을 자동 생성 — 사용자가 단위별로 다른 사이즈/무게 입력 용이.
  // 너무 많으면 가독성 떨어지므로 50 초과 시 단일 그룹(qty=N) 으로 폴백.
  const n = Math.max(1, base.baseQuantity || 1);
  if (n > 50) {
    const grp: DraftRow = {
      rowKey: crypto.randomUUID(),
      width: base.baseSize.width || 0,
      length: base.baseSize.length || 0,
      height: base.baseSize.height || 0,
      quantity: n,
      weight: perUnit,
    };
    if (baseCbm > 0) grp.cbm = Number(baseCbm.toFixed(4));
    return [grp];
  }
  // 그룹 수가 여러 개일 때 행 cbm 을 균등 분배 (반올림 오차는 마지막 그룹에 흡수)
  const perGroupCbm = baseCbm > 0 ? baseCbm / n : 0;
  return Array.from({ length: n }, (_, idx) => {
    const grp: DraftRow = {
      rowKey: crypto.randomUUID(),
      width: base.baseSize.width || 0,
      length: base.baseSize.length || 0,
      height: base.baseSize.height || 0,
      quantity: 1,
      weight: perUnit,
    };
    if (perGroupCbm > 0) {
      // 마지막 그룹은 합 보정 (반올림 오차 흡수)
      const v =
        idx === n - 1 ? baseCbm - perGroupCbm * (n - 1) : perGroupCbm;
      grp.cbm = Number(v.toFixed(4));
    }
    return grp;
  });
}

function unitCbm(u: {
  width: number;
  length: number;
  height: number;
  quantity: number;
  cbm?: number;
}): number {
  // 사용자가 직접 입력한 cbm 우선 (주로 CT 박스 — 사이즈 없는 카톤). 없으면 W×L×H×Q 계산값.
  if (typeof u.cbm === "number" && u.cbm > 0) return u.cbm;
  return (u.width * u.length * u.height * u.quantity) / 1_000_000;
}

function unitWeightTotal(u: { weight: number; quantity: number }): number {
  return u.weight * u.quantity;
}

export function UnitSizesModal(props: UnitSizesModalProps) {
  const { open, baseQuantity, baseWeight, baseCargoType, onClose, onSave, itemLabel } = props;
  const [drafts, setDrafts] = useState<DraftRow[]>(() => defaultDraft(props));

  // 모달이 열릴 때만 초기값 적용. baseSize/baseWeight/baseQuantity 변경 시 자동 reset 하지 않음
  // (모달 안 사용자 입력이 메인 행 변경으로 사라지는 결함 방지 — 2026-05-13 수정).
  // 다른 행을 선택해서 다시 열면 open=false → true 전이로 자연스럽게 재초기화됨.
  useEffect(() => {
    if (open) setDrafts(defaultDraft(props));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.initial]);

  if (!open) return null;

  const updateRow = (rowKey: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => prev.map((d) => (d.rowKey === rowKey ? { ...d, ...patch } : d)));

  const perUnitDefault = unitWeightDefault(baseWeight ?? 0, baseQuantity);
  const addRow = () =>
    setDrafts((prev) => [
      ...prev,
      {
        rowKey: crypto.randomUUID(),
        // 새 그룹은 메인 행 사이즈로 시작 (빈 행이 저장 단계 filter 에서 제외되는 결함 방지 — 2026-05-13 수정)
        width: props.baseSize.width || 0,
        length: props.baseSize.length || 0,
        height: props.baseSize.height || 0,
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
  // 행 기준 CBM(cfs/about, props.baseCbm) 과 단위 CBM 합 일치 확인 (오차 0.01 m³)
  const cbmDiffAbs =
    props.baseCbm && props.baseCbm > 0
      ? Math.abs(totalCbm - props.baseCbm)
      : 0;
  const cbmMismatch =
    props.baseCbm && props.baseCbm > 0 ? cbmDiffAbs > 0.01 : false;

  const handleSave = () => {
    const cleaned: UnitSize[] = drafts
      .filter((d) => {
        if (d.quantity <= 0) return false;
        // CT 박스(사이즈 없는 카톤) 는 0×0×0 허용 — unitSize 안에 일부 unit 만 CT 로 분리하는 케이스.
        // splitCargoesByUnitCargoType 이 cargoType 별로 cargo 를 분리해 CT 박스는 CBM 만 합산함.
        const effectiveCargoType = d.cargoType ?? baseCargoType;
        if (effectiveCargoType === "CT") return true;
        return d.width > 0 && d.length > 0 && d.height > 0;
      })
      .map((d) => {
        const u: UnitSize = {
          width: d.width,
          length: d.length,
          height: d.height,
          quantity: d.quantity,
          weight: d.weight >= 0 ? d.weight : 0,
        };
        // 박스별 화물 종류 — 행 기본값(baseCargoType)과 다를 때만 보존 (line 232~236 의 저장 규칙과 일치).
        // 이전엔 이 필드를 빠뜨려 사용자가 unit 별 cargoType 변경 후 저장이 손실됐음 (2026-05-13 수정).
        if (d.cargoType) u.cargoType = d.cargoType;
        // 직접 입력 CBM — 주로 CT 박스 (사이즈 없는 카톤) 가 부피만 명시할 때 (2026-05-13 추가)
        if (typeof d.cbm === "number" && d.cbm > 0) u.cbm = d.cbm;
        return u;
      });
    onSave(cleaned);
    onClose();
  };

  /** 행 무게 균등 분배 — 모든 unit weight 를 perUnit (= baseWeight / baseQuantity) 로 일괄 설정 */
  const handleEvenWeightDistribute = () => {
    if (!baseWeight || baseWeight <= 0 || baseQuantity <= 0) return;
    const perUnit = Number((baseWeight / baseQuantity).toFixed(3));
    setDrafts((prev) => prev.map((d) => ({ ...d, weight: perUnit })));
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
                <th className="px-1 py-1 text-right">박스 1개 무게 (kg)</th>
                <th className="px-1 py-1 text-right">화종</th>
                <th className="px-1 py-1 text-right">그룹 총 CBM (m³)</th>
                <th className="px-1 py-1 text-right">그룹 총 무게 (kg)</th>
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
                  <td className="px-1 py-1 text-right">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={d.cbm ?? ""}
                      placeholder={(
                        (d.width * d.length * d.height * d.quantity) /
                        1_000_000
                      ).toFixed(4)}
                      onChange={(e) => {
                        const t = e.target.value;
                        const num = Number(t);
                        updateRow(d.rowKey, {
                          cbm:
                            t === "" || !Number.isFinite(num) || num <= 0
                              ? undefined
                              : num,
                        });
                      }}
                      title="직접 입력 우선 (주로 CT 박스). 비우면 W×L×H×수량 계산값 사용."
                      className="w-24 rounded border border-neutral-300 px-1 py-0.5 text-right"
                    />
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
              시스템 CBM{" "}
              <b className={cbmMismatch ? "text-red-600" : "text-neutral-900"}>
                {totalCbm.toFixed(4)}
              </b>{" "}
              m³
              {props.baseCbm != null && props.baseCbm > 0 && (
                <>
                  &nbsp;/&nbsp;행 기준 CBM{" "}
                  <b className="text-neutral-900">{props.baseCbm.toFixed(4)}</b> m³
                  {cbmMismatch ? (
                    <span className="ml-1 text-red-600">
                      ⚠ 불일치 (Δ {(totalCbm - props.baseCbm).toFixed(3)} m³)
                    </span>
                  ) : (
                    <span className="ml-1 text-emerald-600">✅ 일치</span>
                  )}
                </>
              )}
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
                  &nbsp;/&nbsp;엑셀 총 중량 <b className="text-neutral-900">{baseWeight.toFixed(1)}</b> kg
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
              onClick={handleEvenWeightDistribute}
              disabled={!baseWeight || baseWeight <= 0 || baseQuantity <= 0}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title={`모든 unit 무게를 행 총 무게 / 수량 = ${baseWeight && baseQuantity ? (baseWeight / baseQuantity).toFixed(3) : "—"} kg 으로 일괄 설정`}
            >
              무게 균등 분배
            </button>
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
