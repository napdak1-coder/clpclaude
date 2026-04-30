/**
 * CLP 적재 알고리즘 — 물리/규칙 기반 (점수 비교 없음)
 *
 * 흐름:
 *  1) 화물 분류
 *      - 일반 (cargoType ∈ PL/WB/WC/WD/CR/CL) — 시각 적재 대상
 *          ├─ topOnly 표시 (별도 큐, 일반 배치 후 빈 top 슬롯)
 *          └─ 일반
 *      - 카톤 CT — 시각 X, 컨테이너 여유 CBM 에 합산만
 *      - 입고완료 (cargoType 무관, c.cbm != null) — 한 컨테이너에 몰아 합산
 *  2) 시스템 CBM 합산 (입고완료/CT/일반)
 *  3) 컨테이너 결정 — 오직 CBM 으로, 컨테이너 수 최소
 *  4) 입고완료 그룹 → 들어가는 가장 작은 컨테이너 1개에 몰기
 *  5) topOnly → 일반화물 입력 순서로 물리 fit
 *  6) CT 화물 CBM → 컨테이너별 남은 여유 CBM 에 합산
 */

import {
  DEFAULT_REMARK,
  type CargoSpec,
  type Remark,
} from "../../types/cargo.ts";
import type {
  ContainerSpec,
  ContainerType,
} from "../../types/container.ts";
import type {
  CLPResult,
  ContainerMode,
  ContainerPlan,
  PlacedCargo,
  Row,
} from "../../types/plan.ts";
import {
  CONTAINERS,
  getContainerCbm,
  getContainerSpec,
} from "./containers.ts";
import {
  canFitDimensions,
  canStackOn,
  effectiveSize,
  respectsOrientation,
  withinWeightLimit,
} from "./constraints.ts";

interface UnitItem {
  unitId: string;
  cargoId: string;
  shipper: string;
  name?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  remarks: Remark;
}

interface RowState {
  index: number;
  yStart: number;
  yEnd: number;
  xCursor: number;
  bottomItems: PlacedCargo[];
  topItems: PlacedCargo[];
  bottomMaxHeight: number;
  topMaxHeight: number;
}

interface ContainerState {
  index: number;
  spec: ContainerSpec;
  rows: RowState[];
  yCursor: number;
  totalWeight: number;
  /** 시각 unit (placed) 의 CBM 누적 — 패킹 중 실시간 갱신 */
  visualCbm: number;
  /** CT 화물 CBM 누적 (시각 unit 없이 합산만) */
  ctCbm: number;
  /** 입고완료 화물 CBM 누적 */
  completedCbm: number;
}

const REGULAR_TYPES = new Set(["PL", "WB", "WC", "WD", "CR", "CL"]);

/** cargo CBM 헬퍼 — unitSizes 우선, 없으면 대표 W*L*H*Q */
function cargoCbm(c: CargoSpec): number {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce(
      (s, u) => s + (u.width * u.length * u.height * u.quantity) / 1_000_000,
      0,
    );
  }
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}

/** cargo 총중량 헬퍼 — unitSizes 있으면 그룹별 합, 없으면 c.weightPerUnit (G.W/T) */
function cargoTotalWeight(c: CargoSpec): number {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce((s, u) => s + (u.weight ?? 0) * u.quantity, 0);
  }
  return c.weightPerUnit ?? 0;
}

/**
 * CargoSpec 을 단위 unit 으로 분해. unitSizes 우선, 없으면 대표 사이즈 × quantity.
 * weight 는 단위 무게 — unitSizes 있으면 그룹 weight, 없으면 c.weightPerUnit / quantity.
 */
function expandToUnits(cargoes: CargoSpec[]): UnitItem[] {
  const out: UnitItem[] = [];
  for (const c of cargoes) {
    const shipperLabel = c.shipperName ?? c.actualShipperName ?? c.itemName ?? "";
    const remarks = { ...c.remarks };
    if (c.unitSizes && c.unitSizes.length > 0) {
      const totalUnits = c.unitSizes.reduce((s, u) => s + u.quantity, 0) || c.quantity;
      const fallback = totalUnits > 0 ? (c.weightPerUnit ?? 0) / totalUnits : 0;
      let i = 0;
      for (const u of c.unitSizes) {
        const w = u.weight && u.weight > 0 ? u.weight : fallback;
        for (let k = 0; k < u.quantity; k++) {
          out.push({
            unitId: `${c.id}-${i++}`,
            cargoId: c.id,
            shipper: shipperLabel,
            name: c.itemName,
            width: u.width,
            length: u.length,
            height: u.height,
            weight: w,
            remarks,
          });
        }
      }
    } else {
      const perUnit = c.quantity > 0 ? (c.weightPerUnit ?? 0) / c.quantity : 0;
      for (let i = 0; i < c.quantity; i++) {
        out.push({
          unitId: `${c.id}-${i}`,
          cargoId: c.id,
          shipper: shipperLabel,
          name: c.itemName,
          width: c.width,
          length: c.length,
          height: c.height,
          weight: perUnit,
          remarks,
        });
      }
    }
  }
  return out;
}

/** 화물 분류 */
interface ClassifiedCargoes {
  /** 시각 적재 대상 cargo (입고완료 제외, CT 제외, 정상 6종) */
  visualCargoes: CargoSpec[];
  /** CT 카톤 — 시각 X, CBM 만 */
  ctCargoes: CargoSpec[];
  /** 입고완료 — c.cbm != null 인 모든 행, 한 컨테이너에 CBM 합산 */
  completedCargoes: CargoSpec[];
}

function classify(cargoes: CargoSpec[]): ClassifiedCargoes {
  const visualCargoes: CargoSpec[] = [];
  const ctCargoes: CargoSpec[] = [];
  const completedCargoes: CargoSpec[] = [];
  for (const c of cargoes) {
    // 입고완료 우선 — 시각 적재 자체를 안 함
    if (c.cbm != null && c.cbm > 0) {
      completedCargoes.push(c);
      continue;
    }
    if (c.cargoType === "CT") {
      ctCargoes.push(c);
      continue;
    }
    if (REGULAR_TYPES.has(c.cargoType)) {
      visualCargoes.push(c);
      continue;
    }
    // 알 수 없는 타입은 안전하게 CT 로 처리
    ctCargoes.push(c);
  }
  return { visualCargoes, ctCargoes, completedCargoes };
}

/**
 * 컨테이너 종류·개수 결정 — 점수 없이, 오직 CBM 기준.
 *
 * 흐름:
 *  - 모드 = 20ft_only / 40ft_only: ceil(totalCbm / maxCbm) 만큼 그 타입만
 *  - 모드 = auto:
 *      가능한 (n40, n20) 조합 중 totalCbm 수용 가능한 것들을 모은 뒤
 *      ① 컨테이너 수 (n40+n20) 최소 인 조합
 *      ② 동률이면 입고완료 CBM 을 단독 컨테이너 1대에 몰 수 있는 조합 우선
 *      ③ 그래도 동률이면 컨테이너 수 적게 하면서 40FT 비율 높은 쪽
 */
function decideContainers(
  totalCbm: number,
  completedCbm: number,
  mode: ContainerMode,
): ContainerType[] {
  const cbm20 = getContainerCbm(CONTAINERS["20FT"]);
  const cbm40 = getContainerCbm(CONTAINERS["40FT"]);

  if (mode === "20ft_only") {
    const count = Math.max(1, Math.ceil(totalCbm / cbm20));
    return Array.from({ length: count }, () => "20FT");
  }
  if (mode === "40ft_only") {
    const count = Math.max(1, Math.ceil(totalCbm / cbm40));
    return Array.from({ length: count }, () => "40FT");
  }

  // auto — 가능한 모든 (n40, n20) 조합
  const maxN40 = Math.max(1, Math.ceil(totalCbm / cbm40)) + 1;
  const maxN20 = Math.max(1, Math.ceil(totalCbm / cbm20)) + 1;
  type Combo = { n40: number; n20: number; total: number; capacity: number };
  const candidates: Combo[] = [];
  for (let n40 = 0; n40 <= maxN40; n40++) {
    for (let n20 = 0; n20 <= maxN20; n20++) {
      const total = n40 + n20;
      if (total === 0) continue;
      const capacity = n40 * cbm40 + n20 * cbm20;
      if (capacity < totalCbm) continue;
      candidates.push({ n40, n20, total, capacity });
    }
  }
  if (candidates.length === 0) {
    // 이론상 도달 불가 — 안전 폴백
    return ["40FT"];
  }
  // 1순위: 컨테이너 수 최소
  const minTotal = Math.min(...candidates.map((c) => c.total));
  const minCount = candidates.filter((c) => c.total === minTotal);

  // 2순위: 입고완료 CBM 을 단일 컨테이너에 수용 가능한 조합
  let prefer = minCount;
  if (completedCbm > 0) {
    const fits = minCount.filter(
      (c) =>
        (c.n20 > 0 && completedCbm <= cbm20) ||
        (c.n40 > 0 && completedCbm <= cbm40),
    );
    if (fits.length > 0) prefer = fits;
  }

  // 3순위: 잉여 용량(capacity - totalCbm) 가장 적은 조합 → 가장 알맞은 크기
  const minSlack = Math.min(...prefer.map((c) => c.capacity - totalCbm));
  prefer = prefer.filter((c) => c.capacity - totalCbm === minSlack);

  // 4순위: 40FT 비율 높은 쪽 (작은 컨 적게) 우선
  prefer.sort((a, b) => b.n40 - a.n40);
  const best = prefer[0];
  return [
    ...Array.from<ContainerType>({ length: best.n40 }, () => "40FT"),
    ...Array.from<ContainerType>({ length: best.n20 }, () => "20FT"),
  ];
}

function makeContainer(index: number, spec: ContainerSpec): ContainerState {
  return {
    index,
    spec,
    rows: [],
    yCursor: 0,
    totalWeight: 0,
    visualCbm: 0,
    ctCbm: 0,
    completedCbm: 0,
  };
}

/** 컨테이너의 남은 CBM 여유 = maxCbm - (visual + ct + completed) */
function remainingCbm(c: ContainerState): number {
  return getContainerCbm(c.spec) - (c.visualCbm + c.ctCbm + c.completedCbm);
}

function pickRotation(item: UnitItem, container: ContainerSpec): boolean | null {
  for (const rotated of [false, true]) {
    if (
      canFitDimensions(item, container, rotated) &&
      respectsOrientation(item, rotated)
    ) {
      return rotated;
    }
  }
  return null;
}

function asCargoLike(
  u: UnitItem,
): Pick<CargoSpec, "width" | "length" | "height" | "weightPerUnit" | "remarks"> {
  return {
    width: u.width,
    length: u.length,
    height: u.height,
    weightPerUnit: u.weight,
    remarks: u.remarks,
  };
}

function openRow(c: ContainerState, rowLength: number): RowState | null {
  const yEnd = c.yCursor + rowLength;
  if (yEnd > c.spec.innerLength) return null;
  const row: RowState = {
    index: c.rows.length,
    yStart: c.yCursor,
    yEnd,
    xCursor: 0,
    bottomItems: [],
    topItems: [],
    bottomMaxHeight: 0,
    topMaxHeight: 0,
  };
  c.rows.push(row);
  c.yCursor = yEnd;
  return row;
}

function placeBottom(
  row: RowState,
  c: ContainerState,
  item: UnitItem,
  rotated: boolean,
): PlacedCargo {
  const eff = effectiveSize(item, rotated);
  const placed: PlacedCargo = {
    cargoId: item.cargoId,
    shipper: item.shipper,
    name: item.name,
    layer: "bottom",
    position: { x: row.xCursor, y: row.yStart },
    size: { width: eff.width, length: eff.length, height: eff.height },
    rotated,
    weight: item.weight,
    remarks: item.remarks,
  };
  row.bottomItems.push(placed);
  row.xCursor += eff.width;
  if (eff.height > row.bottomMaxHeight) row.bottomMaxHeight = eff.height;
  const newYEnd = row.yStart + Math.max(row.yEnd - row.yStart, eff.length);
  if (newYEnd > c.spec.innerLength) {
    throw new Error("행 길이 확장이 컨테이너 길이를 초과");
  }
  row.yEnd = newYEnd;
  c.yCursor = Math.max(c.yCursor, row.yEnd);
  c.totalWeight += item.weight;
  c.visualCbm += (eff.width * eff.length * eff.height) / 1_000_000;
  return placed;
}

function tryPlaceOnTop(
  row: RowState,
  c: ContainerState,
  item: UnitItem,
  rotated: boolean,
): PlacedCargo | null {
  const eff = effectiveSize(item, rotated);
  for (const bottom of row.bottomItems) {
    const occupied = row.topItems.some(
      (t) =>
        t.position.x === bottom.position.x && t.position.y === bottom.position.y,
    );
    if (occupied) continue;
    if (eff.width > bottom.size.width || eff.length > bottom.size.length) continue;
    const bottomLike = { weightPerUnit: bottom.weight, remarks: bottom.remarks };
    if (!canStackOn(asCargoLike(item), bottomLike)) continue;
    if (bottom.size.height + eff.height > c.spec.innerHeight) continue;
    if (!withinWeightLimit(c.totalWeight, item.weight, c.spec)) continue;

    const placed: PlacedCargo = {
      cargoId: item.cargoId,
      shipper: item.shipper,
      name: item.name,
      layer: "top",
      position: { x: bottom.position.x, y: bottom.position.y },
      size: { width: eff.width, length: eff.length, height: eff.height },
      rotated,
      weight: item.weight,
      remarks: item.remarks,
    };
    row.topItems.push(placed);
    if (eff.height > row.topMaxHeight) row.topMaxHeight = eff.height;
    c.totalWeight += item.weight;
    c.visualCbm += (eff.width * eff.length * eff.height) / 1_000_000;
    return placed;
  }
  return null;
}

function tryPlaceInContainer(
  c: ContainerState,
  item: UnitItem,
): PlacedCargo | null {
  const rotated = pickRotation(item, c.spec);
  if (rotated === null) return null;
  if (!withinWeightLimit(c.totalWeight, item.weight, c.spec)) return null;
  const eff = effectiveSize(item, rotated);
  // CBM 한도 체크 — 이미 적재된 visual + ct + completed 합이 컨테이너 maxCbm 을 넘지 않게
  const itemCbm = (eff.width * eff.length * eff.height) / 1_000_000;
  if (itemCbm > remainingCbm(c)) return null;

  for (const row of c.rows) {
    const remainingWidth = c.spec.innerWidth - row.xCursor;
    if (eff.width > remainingWidth) continue;
    const projectedYEnd = row.yStart + Math.max(row.yEnd - row.yStart, eff.length);
    const nextRowStart = c.rows
      .filter((r) => r.yStart > row.yStart)
      .reduce<number>(
        (min, r) => (r.yStart < min ? r.yStart : min),
        c.spec.innerLength,
      );
    if (projectedYEnd > nextRowStart) continue;
    return placeBottom(row, c, item, rotated);
  }

  const newRow = openRow(c, eff.length);
  if (!newRow) return null;
  if (eff.width > c.spec.innerWidth) return null;
  return placeBottom(newRow, c, item, rotated);
}

/**
 * 입고완료 그룹을 한 컨테이너에 몰아넣을 위치 결정.
 * 들어가는 가장 작은(maxCbm 적은) 컨테이너 우선. 없으면 가장 큰 것.
 */
function pickCompletedContainer(
  containers: ContainerState[],
  completedCbm: number,
): ContainerState | null {
  if (completedCbm <= 0) return null;
  const sorted = [...containers].sort(
    (a, b) => getContainerCbm(a.spec) - getContainerCbm(b.spec),
  );
  for (const c of sorted) {
    if (completedCbm <= getContainerCbm(c.spec)) return c;
  }
  // 단일 컨테이너에 안 들어가면 가장 큰 컨테이너에 몰음 (잔여는 unplaced 가 아닌, 그냥 over-fill 표시)
  return sorted[sorted.length - 1] ?? null;
}

/**
 * 사용자가 명시한 컨테이너에 입고완료 채우기 (한도까지). 잔여 분은 다른 컨테이너로 분산.
 * @returns warnings 메시지 배열
 */
function distributeCompletedToTarget(
  containers: ContainerState[],
  completedCbm: number,
  targetIndex: number,
): string[] {
  const warnings: string[] = [];
  if (completedCbm <= 0) return warnings;
  const target = containers.find((c) => c.index === targetIndex);
  if (!target) return warnings;
  const cap = getContainerCbm(target.spec);
  const fill = Math.min(completedCbm, cap);
  target.completedCbm = fill;
  let overflow = completedCbm - fill;
  if (overflow > 0) {
    // 다른 컨테이너로 분산 — 들어가는 가장 작은 것 우선
    const others = containers
      .filter((c) => c.index !== targetIndex)
      .sort((a, b) => getContainerCbm(a.spec) - getContainerCbm(b.spec));
    for (const c of others) {
      if (overflow <= 0) break;
      const free = getContainerCbm(c.spec) - c.completedCbm;
      const give = Math.min(overflow, free);
      if (give > 0) {
        c.completedCbm += give;
        overflow -= give;
      }
    }
    const moved = completedCbm - fill - overflow;
    warnings.push(
      `컨테이너 ${target.index} (${target.spec.type}, 한도 ${cap}m³) 에 입고완료 ${completedCbm.toFixed(3)}m³ 중 ${fill.toFixed(3)}m³ 적재. 나머지 ${moved.toFixed(3)}m³ 는 다른 컨테이너로 자동 분산${overflow > 0 ? `, ${overflow.toFixed(3)}m³ 는 어디에도 들어가지 못함 (over-fill)` : ""}`,
    );
    if (overflow > 0) {
      // 그래도 못 들어가면 target 에 강제 over-fill
      target.completedCbm += overflow;
    }
  }
  return warnings;
}

function finalizeRow(row: RowState, spec: ContainerSpec): Row {
  const totalHeight = row.bottomMaxHeight + row.topMaxHeight;
  const topClearance = spec.innerHeight - totalHeight;
  const doorPassable = totalHeight <= spec.doorHeight;
  return {
    index: row.index,
    yStart: row.yStart,
    yEnd: row.yEnd,
    bottomItems: row.bottomItems,
    topItems: row.topItems,
    bottomMaxHeight: row.bottomMaxHeight,
    topMaxHeight: row.topMaxHeight,
    topClearance,
    doorPassable,
  };
}

function finalizeContainer(c: ContainerState): ContainerPlan {
  const rows = c.rows.map((r) => finalizeRow(r, c.spec));
  const containerCbm = getContainerCbm(c.spec);
  let visualCbm = 0;
  for (const r of rows) {
    for (const item of [...r.bottomItems, ...r.topItems]) {
      visualCbm +=
        (item.size.width * item.size.length * item.size.height) / 1_000_000;
    }
  }
  const totalLoadedCbm = visualCbm + c.ctCbm + c.completedCbm;
  const cbmFillRate =
    containerCbm > 0 ? (totalLoadedCbm / containerCbm) * 100 : 0;
  const weightFillRate =
    c.spec.maxWeightKg > 0 ? (c.totalWeight / c.spec.maxWeightKg) * 100 : 0;
  return {
    index: c.index,
    spec: c.spec,
    rows,
    totalWeight: c.totalWeight,
    totalCbm: visualCbm,
    ctCbm: c.ctCbm,
    completedCbm: c.completedCbm,
    cbmFillRate,
    weightFillRate,
  };
}

/**
 * 패킹 옵션 — 사용자가 적재 계획 상세 화면에서 특정 컨테이너 1대를
 * "입고완료 전용으로 채우기" 미리보기 할 때 사용.
 */
export interface PackOptions {
  /** 1-based 컨테이너 인덱스. 이 컨에 입고완료를 우선 몰음 */
  completedExclusiveContainerIndex?: number;
  /** 위 컨테이너 여유 CBM 에 미입고 시각 화물 허용 (기본 false → 단독) */
  allowVisualInExclusive?: boolean;
  /** 위 컨테이너 여유 CBM 에 CT 카톤 허용 (기본 false) */
  allowCtInExclusive?: boolean;
}

/**
 * 메인 진입점.
 * 점수 없이 결정적 룰로 한 번에 패킹.
 */
export function pack(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options?: PackOptions,
): CLPResult {
  // 1) 분류
  const { visualCargoes, ctCargoes, completedCargoes } = classify(cargoes);

  // 2) CBM/무게 합 (3그룹 모두 합)
  const visualCbm = visualCargoes.reduce((s, c) => s + cargoCbm(c), 0);
  const ctCbm = ctCargoes.reduce(
    (s, c) => s + (c.cbm ?? c.aboutCbm ?? cargoCbm(c)),
    0,
  );
  const completedCbm = completedCargoes.reduce((s, c) => s + (c.cbm ?? 0), 0);
  const totalCbm = visualCbm + ctCbm + completedCbm;

  // 3) 컨테이너 결정
  const types = decideContainers(totalCbm, completedCbm, mode);
  const containers: ContainerState[] = types.map((t, i) =>
    makeContainer(i + 1, getContainerSpec(t)),
  );

  // 4) 입고완료 그룹 → 단일 컨테이너에 합산
  //   옵션이 있으면 사용자가 지정한 컨테이너에 한도까지 우선 적재 + 초과분 자동 분산
  const warnings: string[] = [];
  const exclusiveIdx = options?.completedExclusiveContainerIndex;
  if (completedCbm > 0) {
    if (typeof exclusiveIdx === "number" && containers.some((c) => c.index === exclusiveIdx)) {
      warnings.push(...distributeCompletedToTarget(containers, completedCbm, exclusiveIdx));
    } else {
      const target = pickCompletedContainer(containers, completedCbm);
      if (target) target.completedCbm = completedCbm;
    }
  }

  // 5) 시각 적재: topOnly → 일반화물 입력 순서로
  const allUnits = expandToUnits(visualCargoes);
  const topOnlyUnits = allUnits.filter((u) => u.remarks.topOnly);
  const generalUnits = allUnits.filter((u) => !u.remarks.topOnly);

  // 시각 적재 가능 컨테이너 결정 — 옵션상 exclusive 컨에 시각 차단되면 그 컨 제외
  const visualContainers = containers.filter((c) => {
    if (
      typeof exclusiveIdx === "number" &&
      c.index === exclusiveIdx &&
      options?.allowVisualInExclusive !== true
    ) {
      return false;
    }
    return true;
  });

  const unplaced: UnitItem[] = [];

  // 일반 (bottom 후보) 먼저 입력 순서로 — 시각 가능한 컨테이너만 시도
  for (const u of generalUnits) {
    let placed = false;
    for (const c of visualContainers) {
      if (tryPlaceInContainer(c, u)) {
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(u);
  }

  // topOnly — 빈 top 슬롯에 (시각 가능한 컨테이너만 시도)
  for (const u of topOnlyUnits) {
    let placed = false;
    for (const c of visualContainers) {
      const rotated = pickRotation(u, c.spec);
      if (rotated === null) continue;
      for (const row of c.rows) {
        if (tryPlaceOnTop(row, c, u, rotated)) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) unplaced.push(u);
  }

  // 6) CT 화물 CBM → 컨테이너별 남은 여유 CBM 에 합산
  //    옵션상 exclusive 컨에 CT 차단이면 해당 컨테이너 건너뜀
  let remainingCt = ctCbm;
  if (remainingCt > 0) {
    const ctTargets = containers.filter((c) => {
      if (
        typeof exclusiveIdx === "number" &&
        c.index === exclusiveIdx &&
        options?.allowCtInExclusive !== true
      ) {
        return false;
      }
      return true;
    });
    for (const c of ctTargets) {
      if (remainingCt <= 0) break;
      const used = computeContainerLoadedCbm(c);
      const free = Math.max(0, getContainerCbm(c.spec) - used);
      const fill = Math.min(remainingCt, free);
      c.ctCbm += fill;
      remainingCt -= fill;
    }
  }

  // 7) 결과 정리
  const plans = containers.map(finalizeContainer);
  const count20FT = plans.filter((p) => p.spec.type === "20FT").length;
  const count40FT = plans.filter((p) => p.spec.type === "40FT").length;
  const totalWeight = plans.reduce((s, p) => s + p.totalWeight, 0);
  const visualPlanCbm = plans.reduce((s, p) => s + p.totalCbm, 0);
  const ctTotalCbm = plans.reduce((s, p) => s + p.ctCbm, 0);
  const completedTotalCbm = plans.reduce((s, p) => s + p.completedCbm, 0);
  const avgFillRate =
    plans.length > 0
      ? plans.reduce((s, p) => s + p.cbmFillRate, 0) / plans.length
      : 0;

  const unplacedOut = unplaced.map((u) => ({
    cargoId: u.cargoId,
    reason: "컨테이너에 배치할 공간/중량 여유가 없음",
  }));
  // CT 가 모두 안 들어간 부분도 표시
  if (remainingCt > 0) {
    unplacedOut.push({
      cargoId: "(CT 잔여)",
      reason: `카톤 화물 ${remainingCt.toFixed(3)} m³ 분이 컨테이너 여유 CBM 에 들어가지 않음`,
    });
  }

  return {
    containers: plans,
    unplaced: unplacedOut,
    summary: {
      count20FT,
      count40FT,
      totalWeight,
      totalCbm: visualPlanCbm,
      ctTotalCbm,
      completedTotalCbm,
      avgFillRate,
      warnings,
    },
  };
}

/** 컨테이너에 이미 적재된 모든 CBM (시각 unit + ct + completed) 합 */
function computeContainerLoadedCbm(c: ContainerState): number {
  let visual = 0;
  for (const r of c.rows) {
    for (const item of [...r.bottomItems, ...r.topItems]) {
      visual += (item.size.width * item.size.length * item.size.height) / 1_000_000;
    }
  }
  return visual + c.ctCbm + c.completedCbm;
}

// 테스트에서 내부 함수를 검증할 수 있도록 명시적으로 노출
export const __testables = {
  expandToUnits,
  classify,
  decideContainers,
  pickCompletedContainer,
  cargoCbm,
  cargoTotalWeight,
  DEFAULT_REMARK,
};
