"use client";

/**
 * 컨테이너에 실제로 들어간 화물 목록 (cargoId 단위 그룹)
 *
 * 시각 화물 (rows[].bottomItems / topItems) + bulkItems (CT/입고완료) 을 모두 합쳐
 * 한 표에 나열한다. 한 cargoId 가 같은 컨테이너 안에서 여러 형태(하단/상단/CT/완료)에
 * 분산될 수 있어 묶음 합산하고, 분류는 한 행에 함께 표기한다.
 *
 * 한 cargo 가 여러 컨테이너로 분산된 경우 — 각 컨테이너 표에 자기 몫(cbm)만 표시되고,
 * 분할 라벨로 "이 컨 X.XX m³ / 전체 Y.YY m³" 안내한다. 사이즈·수량·단위무게는 원본 cargo
 * 값이라 분할되어도 동일하게 표시된다 (그게 더 직관적).
 *
 * 구버전 플랜(bulkItems 없음) 자동 감지 — 빈 표 + ctCbm/completedCbm 만 있는 경우 사용자에게
 * 다시 시뮬레이션하라고 안내한다.
 */

import type { BulkItem, ContainerPlan, PlacedCargo } from "@/types/plan";
import type { CargoType } from "@/types/cargo";

interface ItemGroup {
  cargoId: string;
  shipper: string;
  name: string;
  cargoType: CargoType | null;
  /** 시각 unit 개수. CT/완료는 0 */
  visualUnitCount: number;
  /** 대표 사이즈 (cm). 시각=첫 unit 사이즈, CT/완료=원본 cargo 사이즈 */
  width: number | null;
  length: number | null;
  height: number | null;
  /** 원본 cargo 수량 (CT/완료) — 시각은 visualUnitCount 우선 */
  cargoQuantity: number | null;
  /** 단위당 중량 (CT/완료) — UI 에서 cargoQuantity * unitWeight 로 총 중량 표시 */
  unitWeight: number | null;
  /** 시각 unit 의 중량 누적 */
  visualWeight: number;
  /** 이 컨테이너에 할당된 CBM (시각=좌표 합, CT/완료=BulkItem.cbm 합) */
  cbm: number;
  /** 원본 cargo 총 CBM (CT/완료, 분할 시 비교용). 시각 화물은 동일 cbm 으로 처리 */
  totalCbm: number;
  /**
   * 시스템 CBM = (W × L × H × quantity) / 1,000,000.
   * 입력 폼의 "시스템 CBM" 컬럼과 같은 의미 — 사이즈로부터 자동 계산.
   * 시각 화물은 placed unit 누적으로 이 값을 채우고, CT/완료는 원본 cargo 사이즈/수량 기준.
   */
  systemCbm: number;
  /**
   * CFS CBM (입고완료) — 사용자가 입력한 cbm 값.
   * 입고완료 그룹의 BulkItem 만 가지며, 시각/CT 는 보통 null.
   */
  cfsCbm: number | null;
  /** 그룹 분류 — visual / ct / completed / mixed */
  groupKind: "visual" | "ct" | "completed" | "mixed";
  /** 시각 unit 만 있을 때 층 정보 */
  layer: "bottom" | "top" | "mixed" | "-";
}

function emptyGroup(): Omit<ItemGroup, "cargoId" | "shipper" | "name"> {
  return {
    cargoType: null,
    visualUnitCount: 0,
    width: null,
    length: null,
    height: null,
    cargoQuantity: null,
    unitWeight: null,
    visualWeight: 0,
    cbm: 0,
    totalCbm: 0,
    systemCbm: 0,
    cfsCbm: null,
    groupKind: "visual",
    layer: "-",
  };
}

function combineKind(
  prev: ItemGroup["groupKind"],
  next: "visual" | "ct" | "completed",
): ItemGroup["groupKind"] {
  if (prev === next) return prev;
  return "mixed";
}

function groupAll(plan: ContainerPlan): ItemGroup[] {
  const map = new Map<string, ItemGroup>();
  let touched = false;
  const ensure = (cargoId: string, shipper: string, name: string): ItemGroup => {
    let g = map.get(cargoId);
    if (!g) {
      g = { cargoId, shipper, name, ...emptyGroup() };
      map.set(cargoId, g);
    }
    return g;
  };

  const collectVisual = (items: PlacedCargo[], layer: "bottom" | "top") => {
    for (const it of items) {
      touched = true;
      const cbmPerUnit =
        (it.size.width * it.size.length * it.size.height) / 1_000_000;
      const g = ensure(it.cargoId, it.shipper ?? "", it.name ?? "");
      g.groupKind =
        g.visualUnitCount === 0 && g.cbm === 0
          ? "visual"
          : combineKind(g.groupKind, "visual");
      if (g.width == null) {
        g.width = it.size.width;
        g.length = it.size.length;
        g.height = it.size.height;
      }
      // cargoType / cfsCbm 은 placed unit 마다 동일하지만 첫 unit 기준으로 보존
      // (구버전 PlacedCargo 는 cargoType 이 없을 수 있어 옵셔널 처리)
      if (g.cargoType == null && it.cargoType != null) g.cargoType = it.cargoType;
      if (g.cfsCbm == null && it.cfsCbm != null) g.cfsCbm = it.cfsCbm;
      g.visualUnitCount += 1;
      g.visualWeight += it.weight;
      g.cbm += cbmPerUnit;
      g.totalCbm += cbmPerUnit;
      // 시각 화물의 시스템 CBM = 실제 배치된 unit 들의 cube 합 (즉 분량과 동일)
      g.systemCbm += cbmPerUnit;
      if (g.layer === "-") g.layer = layer;
      else if (g.layer !== layer && g.layer !== "mixed") g.layer = "mixed";
    }
  };

  for (const r of plan.rows) {
    collectVisual(r.bottomItems, "bottom");
    collectVisual(r.topItems, "top");
  }

  for (const b of plan.bulkItems ?? []) {
    touched = true;
    const g = ensure(b.cargoId, b.shipper, b.name ?? "");
    if (g.cargoType == null) g.cargoType = b.cargoType;
    if (g.width == null && b.width > 0) {
      g.width = b.width;
      g.length = b.length;
      g.height = b.height;
    }
    if (g.cargoQuantity == null) g.cargoQuantity = b.quantity;
    if (g.unitWeight == null) g.unitWeight = b.weightPerUnit;
    g.cbm += b.cbm;
    // totalCbm/systemCbm/cfsCbm 은 cargo 본연의 값이라 분할되어도 한 번만 잡고 다시 안 누적
    g.totalCbm = Math.max(g.totalCbm, b.totalCbm);
    const cargoSystemCbm = (b.width * b.length * b.height * b.quantity) / 1_000_000;
    g.systemCbm = Math.max(g.systemCbm, cargoSystemCbm);
    if (b.cfsCbm != null) {
      g.cfsCbm = b.cfsCbm;
    }
    g.groupKind =
      g.visualUnitCount === 0 && g.cbm === b.cbm
        ? b.group
        : combineKind(g.groupKind, b.group);
  }

  if (!touched) return [];
  return Array.from(map.values()).sort((a, b) => {
    const s = (a.shipper || "").localeCompare(b.shipper || "");
    if (s !== 0) return s;
    const n = (a.name || "").localeCompare(b.name || "");
    if (n !== 0) return n;
    return a.cargoId.localeCompare(b.cargoId);
  });
}

function kindLabel(k: ItemGroup["groupKind"]): { text: string; cls: string } {
  switch (k) {
    case "visual":
      return { text: "시각", cls: "bg-emerald-100 text-emerald-800" };
    case "ct":
      return { text: "CT", cls: "bg-amber-100 text-amber-800" };
    case "completed":
      return { text: "입고완료", cls: "bg-blue-100 text-blue-800" };
    case "mixed":
      return { text: "혼재", cls: "bg-purple-100 text-purple-800" };
  }
}

function layerLabel(l: ItemGroup["layer"]): string {
  if (l === "bottom") return "하단";
  if (l === "top") return "상단";
  if (l === "mixed") return "하단·상단";
  return "-";
}

/** 표시용 수량 — 시각 unit 우선, 없으면 원본 cargo 수량 */
function displayQty(g: ItemGroup): number | null {
  if (g.visualUnitCount > 0) return g.visualUnitCount;
  return g.cargoQuantity;
}

/** 표시용 총 중량 — 시각 unit 합 우선, 없으면 cargoQuantity * unitWeight */
function displayWeight(g: ItemGroup): number | null {
  if (g.visualWeight > 0) return g.visualWeight;
  if (g.cargoQuantity != null && g.unitWeight != null) {
    return g.cargoQuantity * g.unitWeight;
  }
  return null;
}

/** 분할 여부 — 같은 cargoId 가 여러 컨테이너에 들어간 경우 (이 컨 cbm < 원본 totalCbm) */
function isSplit(g: ItemGroup): boolean {
  return g.totalCbm > 0 && Math.abs(g.cbm - g.totalCbm) > 0.001;
}

/**
 * 구버전 플랜 자동 감지 — bulkItems 가 undefined 인데 ctCbm/completedCbm 이 있는 경우.
 * 새 알고리즘으로 다시 pack 을 실행해야 화물 단위 정보가 보인다.
 */
function isLegacyPlan(plan: ContainerPlan): boolean {
  const hasBulkData = plan.ctCbm > 0 || plan.completedCbm > 0;
  const noBulkItems = !plan.bulkItems || plan.bulkItems.length === 0;
  const noVisual = plan.rows.length === 0;
  return hasBulkData && noBulkItems && noVisual;
}

export function ContainerItemList({ plan }: { plan: ContainerPlan }) {
  const groups = groupAll(plan);
  const legacy = isLegacyPlan(plan);
  const totalAllocated = groups.reduce((s, g) => s + g.cbm, 0);
  const totalSystem = groups.reduce((s, g) => s + g.systemCbm, 0);
  const totalCfs = groups.reduce((s, g) => s + (g.cfsCbm ?? 0), 0);
  const visualGroups = groups.filter((g) => g.visualUnitCount > 0).length;
  const ctGroups = groups.filter(
    (g) => g.groupKind === "ct" || g.groupKind === "mixed",
  ).length;
  const completedGroups = groups.filter(
    (g) => g.groupKind === "completed" || g.groupKind === "mixed",
  ).length;

  return (
    <div className="rounded border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
        <span className="font-semibold text-neutral-800">
          화물 목록 — 컨테이너 #{plan.index} ({plan.spec.type})
        </span>
        <span className="text-neutral-600">
          총 {groups.length}종 · 분량 {totalAllocated.toFixed(2)} m³
          <span className="ml-2 text-neutral-500">
            (시스템 {totalSystem.toFixed(2)}
            {totalCfs > 0 && ` · 엑셀 ${totalCfs.toFixed(2)}`})
          </span>
          {visualGroups > 0 && (
            <span className="ml-2 text-emerald-700">시각 {visualGroups}</span>
          )}
          {ctGroups > 0 && (
            <span className="ml-2 text-amber-700">CT {ctGroups}</span>
          )}
          {completedGroups > 0 && (
            <span className="ml-2 text-blue-700">입고완료 {completedGroups}</span>
          )}
        </span>
      </div>
      {legacy && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⓘ 구버전 시뮬레이션 결과입니다. 화물 단위 표시는 새 알고리즘 결과부터 보입니다 — 부킹 페이지로 돌아가 다시 시뮬레이션을 실행해 주세요.
        </div>
      )}
      {groups.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-neutral-500">
          이 컨테이너에 들어간 화물이 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-100 text-neutral-700">
              <tr>
                <th className="px-2 py-1 text-left font-medium">분류</th>
                <th
                  className="px-2 py-1 text-center font-medium"
                  title="사용자 입력 화물 종류 (PL/WB/WC/WD/CR/CL/CT)"
                >
                  구분
                </th>
                <th className="px-2 py-1 text-left font-medium">화주</th>
                <th className="px-2 py-1 text-left font-medium">품목</th>
                <th className="px-2 py-1 text-right font-medium">
                  사이즈 (W×L×H, cm)
                </th>
                <th className="px-2 py-1 text-right font-medium">수량</th>
                <th
                  className="px-2 py-1 text-right font-medium"
                  title="W × L × H × 수량 / 1,000,000 으로 자동 계산"
                >
                  시스템 CBM
                </th>
                <th
                  className="px-2 py-1 text-right font-medium"
                  title="엑셀 CFS CBM 셀 또는 사용자가 직접 입력한 값. 채워져 있으면 입고완료 화물 (미입고 화물은 빈 칸)"
                >
                  엑셀 CBM
                </th>
                <th
                  className="px-2 py-1 text-right font-medium"
                  title="이 컨테이너에 실제 들어간 분량 (분할 시 부분값)"
                >
                  분량 (이 컨)
                </th>
                <th className="px-2 py-1 text-right font-medium">중량 (kg)</th>
                <th className="px-2 py-1 text-center font-medium">층</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const kind = kindLabel(g.groupKind);
                const qty = displayQty(g);
                const wt = displayWeight(g);
                const split = isSplit(g);
                const sizeText =
                  g.width != null && g.length != null && g.height != null
                    ? `${g.width}×${g.length}×${g.height}`
                    : "-";
                const labelName = g.name || g.shipper || g.cargoId.slice(0, 8);
                // 시스템 ↔ CFS 차이 강조 (0.01 m³ 초과면 빨간색)
                const cbmMismatch =
                  g.cfsCbm != null &&
                  g.systemCbm > 0 &&
                  Math.abs(g.systemCbm - g.cfsCbm) > 0.01;
                return (
                  <tr key={g.cargoId} className="border-t border-neutral-200">
                    <td className="px-2 py-1 align-top">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${kind.cls}`}
                      >
                        {kind.text}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-center align-top font-mono text-[11px] text-neutral-700">
                      {g.cargoType ?? "-"}
                    </td>
                    <td className="px-2 py-1 align-top text-neutral-800">
                      {g.shipper || "-"}
                    </td>
                    <td className="px-2 py-1 align-top text-neutral-800">
                      {labelName}
                    </td>
                    <td className="px-2 py-1 text-right align-top font-mono text-neutral-700">
                      {sizeText}
                    </td>
                    <td className="px-2 py-1 text-right align-top font-mono">
                      {qty != null ? qty : "-"}
                    </td>
                    <td
                      className={`px-2 py-1 text-right align-top font-mono ${
                        cbmMismatch ? "text-red-600 font-semibold" : ""
                      }`}
                      title={
                        cbmMismatch
                          ? `엑셀 CBM ${g.cfsCbm!.toFixed(3)} 과 ${Math.abs(g.systemCbm - g.cfsCbm!).toFixed(3)} 차이`
                          : undefined
                      }
                    >
                      {g.systemCbm > 0 ? g.systemCbm.toFixed(3) : "-"}
                    </td>
                    <td className="px-2 py-1 text-right align-top font-mono text-blue-700">
                      {g.cfsCbm != null ? g.cfsCbm.toFixed(3) : "-"}
                    </td>
                    <td className="px-2 py-1 text-right align-top font-mono">
                      <div>{g.cbm.toFixed(3)}</div>
                      {split && (
                        <div className="text-[10px] text-purple-700">
                          분할 (전체 {g.totalCbm.toFixed(2)})
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right align-top font-mono">
                      {wt != null ? wt.toFixed(1) : "-"}
                    </td>
                    <td className="px-2 py-1 text-center align-top text-[11px] text-neutral-700">
                      {layerLabel(g.layer)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
