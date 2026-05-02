"use client";

/**
 * 9번 알고리즘 결과 미리보기 — 기존 ContainerView2D 그대로 사용
 *
 * 자유 좌표 적재(extreme-point) 결과를 종전 화면 구조와 100% 동일하게 표시.
 * placements 를 자연 그룹핑으로 Row[] 로 묶어 ContainerView2D 에 넘긴다.
 */

import { useEffect, useMemo, useState } from "react";
import { ContainerView2D } from "@/components/plan/ContainerView2D";
import { getContainerSpec } from "@/lib/packing/containers";
import { computeDisplayRows, totalDisplayLengthCm } from "@/lib/packing/display-rows";
import {
  expandCargoesToUnits,
  packExtremePoint,
  type UnitItem,
} from "@/lib/packing/extreme-point";
import type { CargoSpec, CargoType } from "@/types/cargo";
import type { ContainerPlan } from "@/types/plan";

interface SampleRow {
  cargoType: string;
  itemName?: string | null;
  actualShipperName?: string | null;
  shipperName?: string | null;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  quantity: number;
  weightPerUnitKg: number;
  cbm: number | null;
  aboutCbm: number | null;
  noStacking: boolean;
  topOnly: boolean;
  orientation: "free" | "long_along_length" | "fixed";
  heavierBelow: boolean;
  itemRemark?: string | null;
}

function rowToCargo(r: SampleRow, idx: number): CargoSpec {
  return {
    id: `c-${idx}`,
    shipmentId: "mock",
    sortOrder: idx,
    cargoType: (r.cargoType as CargoType) ?? "PL",
    itemName: r.itemName ?? undefined,
    actualShipperName: r.actualShipperName ?? undefined,
    shipperName: r.shipperName ?? undefined,
    width: r.widthCm,
    length: r.lengthCm,
    height: r.heightCm,
    quantity: r.quantity,
    weightPerUnitKg: r.weightPerUnitKg,
    cbm: r.cbm ?? undefined,
    aboutCbm: r.aboutCbm ?? undefined,
    remarks: {
      noStacking: r.noStacking,
      topOnly: r.topOnly,
      orientation: r.orientation,
      heavierBelow: r.heavierBelow,
      notes: r.itemRemark ?? undefined,
    },
  };
}

function sortLDF(units: UnitItem[]): UnitItem[] {
  return [...units].sort((a, b) => {
    const va = a.width * a.length * a.height;
    const vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    return b.weight - a.weight;
  });
}

export default function MockupPage() {
  const [cargoes, setCargoes] = useState<CargoSpec[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/samples/singapore-total");
        if (!res.ok) throw new Error(`샘플 로드 실패 (${res.status})`);
        const json = (await res.json()) as { success: boolean; data?: { rows: SampleRow[] } };
        if (!json.success || !json.data) throw new Error("샘플 데이터 없음");
        setCargoes(json.data.rows.map(rowToCargo));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "로드 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const result = useMemo(() => {
    if (!cargoes) return null;
    const visualCargoes = cargoes.filter((c) => c.cargoType !== "CT");
    const units = expandCargoesToUnits(visualCargoes);
    const sorted = sortLDF(units);
    const realSpec = getContainerSpec("40FT");
    const packed = packExtremePoint(sorted, realSpec);
    const rows = computeDisplayRows(packed.placements, realSpec);
    const displayLen = Math.max(realSpec.innerLength, totalDisplayLengthCm(rows));
    const spec = { ...realSpec, innerLength: displayLen };
    const plan: ContainerPlan = {
      index: 1,
      spec,
      rows,
      totalWeight: packed.totalWeight,
      totalCbm: packed.visualCbm,
      ctCbm: 0,
      completedCbm: 0,
      bulkItems: [],
      cbmFillRate: spec.maxCbm > 0 ? (packed.visualCbm / spec.maxCbm) * 100 : 0,
      weightFillRate:
        spec.maxWeightKg > 0 ? (packed.totalWeight / spec.maxWeightKg) * 100 : 0,
    };
    return { plan, unplacedCount: packed.unplaced.length, totalUnits: sorted.length };
  }, [cargoes]);

  if (loading) return <div className="p-6 text-sm text-neutral-500">샘플 로드 중…</div>;
  if (err) return <div className="p-6 text-sm text-red-700">에러: {err}</div>;
  if (!result) return null;

  const { plan, unplacedCount, totalUnits } = result;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4">
      <header className="mb-3">
        <h1 className="text-xl font-bold">9번 알고리즘 미리보기 — 종전 화면 그대로</h1>
        <p className="mt-1 text-xs text-neutral-600">
          싱가폴 TOTAL 샘플 · 40FT 1대 · extreme-point 자유 좌표 packing 결과를
          기존 ContainerView2D 형식으로 표시.
        </p>
      </header>

      <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs">
        총 {totalUnits} 단위 중 적재 <b>{totalUnits - unplacedCount}</b> · 미배치{" "}
        <b className={unplacedCount > 0 ? "text-red-600" : "text-emerald-700"}>{unplacedCount}</b> ·
        행 <b>{plan.rows.length}</b>개 · 시각 CBM {plan.totalCbm.toFixed(2)} m³ ·
        중량 {plan.totalWeight.toFixed(0)} kg ·
        충전률 {plan.cbmFillRate.toFixed(1)}%
      </div>

      <ContainerView2D plan={plan} scale={{ x: 1.79, y: 0.385 }} />
    </main>
  );
}
