/**
 * CLP 적재 휴리스틱 알고리즘
 *
 * 최적해(NP-hard 3D bin-packing)를 풀지 않고 "현장에서 통할 만한" 결과를 빠르게 만든다.
 *  - Row 단위 그리디 배치 (행 = 컨테이너 길이방향 슬라이스)
 *  - 무거운 화물부터 → 큰 사이즈부터
 *  - 상단적재(topOnly)는 일반 화물 배치 후 별도 패스
 *
 * 추후 GA/ILP로 교체할 수 있도록 입출력은 명확한 타입으로만 표현.
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

/** 알고리즘 내부에서 다루는 1개 단위 화물 (quantity=1로 풀어 놓은 것) */
interface UnitItem {
  unitId: string;       // 컨테이너 안에서 식별 (cargoId-인덱스)
  cargoId: string;      // 원본 CargoSpec.id
  shipper: string;
  name?: string;
  width: number;
  length: number;
  height: number;
  weight: number;       // 단위 중량
  remarks: Remark;
}

/** Row 누적 상태 (배치 중 갱신) */
interface RowState {
  index: number;
  yStart: number;
  yEnd: number;
  /** 폭 방향 누적 — 다음 화물이 시작될 x 좌표 */
  xCursor: number;
  bottomItems: PlacedCargo[];
  topItems: PlacedCargo[];
  bottomMaxHeight: number;
  topMaxHeight: number;
}

/** 컨테이너 누적 상태 */
interface ContainerState {
  index: number;
  spec: ContainerSpec;
  rows: RowState[];
  /** 다음 행이 시작될 y 좌표 */
  yCursor: number;
  totalWeight: number;
}

/**
 * CargoSpec을 quantity 만큼 풀어 단위 아이템 배열을 만든다.
 * shipperName이 CargoSpec에 없으므로 알고리즘 호출자가 별도로 채워두지 않는 한 ""로 둔다.
 */
function expand(cargoes: CargoSpec[]): UnitItem[] {
  const out: UnitItem[] = [];
  for (const c of cargoes) {
    for (let i = 0; i < c.quantity; i += 1) {
      out.push({
        unitId: `${c.id}-${i}`,
        cargoId: c.id,
        // 라벨 우선순위: 화주 → 실화주 → 품목명
        shipper: c.shipperName ?? c.actualShipperName ?? c.itemName ?? "",
        name: c.itemName,
        width: c.width,
        length: c.length,
        height: c.height,
        weight: c.weightPerUnit,
        remarks: { ...c.remarks },
      });
    }
  }
  return out;
}

/**
 * 정렬: 무거운→큰 순서. topOnly는 별도 큐에서 처리.
 * 중량 동률이면 길이→폭 순으로 큰 것 먼저.
 */
function sortMainQueue(items: UnitItem[]): UnitItem[] {
  return [...items].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.length !== a.length) return b.length - a.length;
    return b.width - a.width;
  });
}

/** UnitItem을 CargoSpec 일부로 어댑트 (제약 함수 호환) */
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

/**
 * 회전 옵션 두 가지를 시도해서 컨테이너 내부에 들어가고 방향제약도 만족하는 회전 선택.
 * 우선순위: 회전 안 함 → 회전.
 * 둘 다 불가하면 null.
 */
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

/** 새 컨테이너 상태 */
function makeContainer(index: number, spec: ContainerSpec): ContainerState {
  return {
    index,
    spec,
    rows: [],
    yCursor: 0,
    totalWeight: 0,
  };
}

/**
 * 새 Row를 연다. yStart는 현재 yCursor, yEnd는 첫 화물의 길이로 결정된다.
 * 화물을 함께 배치하므로 첫 화물 정보를 받는다.
 */
function openRow(
  c: ContainerState,
  rowLength: number,
): RowState | null {
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

/**
 * Row의 bottom에 화물을 추가한다. 사이즈/중량 제약이 통과한 상태에서 호출됨.
 */
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
  // 길이방향이 더 긴 화물이 들어오면 row의 yEnd 확장
  const newYEnd = row.yStart + Math.max(row.yEnd - row.yStart, eff.length);
  if (newYEnd > c.spec.innerLength) {
    // 컨테이너를 벗어나면 호출자가 미리 막아야 함 — 방어적 체크
    throw new Error("행 길이 확장이 컨테이너 길이를 초과");
  }
  row.yEnd = newYEnd;
  c.yCursor = Math.max(c.yCursor, row.yEnd);
  c.totalWeight += item.weight;
  return placed;
}

/**
 * 어떤 bottom 화물 위에 top으로 쌓을 수 있는지 시도.
 * - 동일 bottom 위에는 1개만 (단순화)
 * - heightClearance 검사: bottomMaxHeight + 화물 높이 ≤ 내부 높이
 * - 다단금지/중량조건 검사
 */
function tryPlaceOnTop(
  row: RowState,
  c: ContainerState,
  item: UnitItem,
  rotated: boolean,
): PlacedCargo | null {
  const eff = effectiveSize(item, rotated);
  for (const bottom of row.bottomItems) {
    // 이미 위에 다른 화물이 있는지
    const occupied = row.topItems.some(
      (t) =>
        t.position.x === bottom.position.x && t.position.y === bottom.position.y,
    );
    if (occupied) continue;

    // 폭/길이가 bottom보다 크면 안정성 문제 — 단순화: bottom 사이즈 이하만 허용
    if (eff.width > bottom.size.width || eff.length > bottom.size.length) {
      continue;
    }

    // 다단/중량 검사
    const bottomLike = {
      weightPerUnit: bottom.weight,
      remarks: bottom.remarks,
    };
    if (!canStackOn(asCargoLike(item), bottomLike)) continue;

    // 높이 검사 — 내부 높이 초과 금지
    if (bottom.size.height + eff.height > c.spec.innerHeight) continue;

    // 중량 한도 검사
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
    return placed;
  }
  return null;
}

/**
 * 단일 화물을 컨테이너에 배치 시도. 성공하면 PlacedCargo, 실패면 null.
 * 시도 순서: 기존 행에 폭 추가 → 새 행 개설.
 */
function tryPlaceInContainer(
  c: ContainerState,
  item: UnitItem,
): PlacedCargo | null {
  const rotated = pickRotation(item, c.spec);
  if (rotated === null) return null;
  if (!withinWeightLimit(c.totalWeight, item.weight, c.spec)) return null;

  const eff = effectiveSize(item, rotated);

  // 1) 기존 행 중 폭이 남은 행에 추가
  for (const row of c.rows) {
    const remainingWidth = c.spec.innerWidth - row.xCursor;
    if (eff.width > remainingWidth) continue;
    // 행의 길이 제약 — 새 화물이 행보다 길면 yEnd 확장이 필요
    const projectedYEnd = row.yStart + Math.max(row.yEnd - row.yStart, eff.length);
    // 다음 행과 충돌 방지 (행을 확장해도 다음 행 yStart 침범 금지)
    const nextRowStart = c.rows
      .filter((r) => r.yStart > row.yStart)
      .reduce<number>(
        (min, r) => (r.yStart < min ? r.yStart : min),
        c.spec.innerLength,
      );
    if (projectedYEnd > nextRowStart) continue;
    return placeBottom(row, c, item, rotated);
  }

  // 2) 새 행 개설
  const newRow = openRow(c, eff.length);
  if (!newRow) return null;
  if (eff.width > c.spec.innerWidth) {
    // 방어적 — 폭이 안 맞으면 행에 못 둠
    return null;
  }
  return placeBottom(newRow, c, item, rotated);
}

/**
 * 컨테이너 후보들에 일반 큐 → topOnly 큐를 차례로 배치한다.
 * 미배치 아이템은 unplaced로 반환.
 */
function packIntoContainers(
  containers: ContainerState[],
  mainQueue: UnitItem[],
  topOnlyQueue: UnitItem[],
): { unplaced: UnitItem[] } {
  const unplaced: UnitItem[] = [];

  // 메인 큐: 각 화물을 첫 번째로 들어가는 컨테이너에 배치
  for (const item of mainQueue) {
    let placed = false;
    for (const c of containers) {
      const result = tryPlaceInContainer(c, item);
      if (result) {
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(item);
  }

  // topOnly 큐: 기존 row의 빈 top 슬롯을 찾아 배치
  for (const item of topOnlyQueue) {
    let placed = false;
    for (const c of containers) {
      const rotated = pickRotation(item, c.spec);
      if (rotated === null) continue;
      for (const row of c.rows) {
        const result = tryPlaceOnTop(row, c, item, rotated);
        if (result) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) unplaced.push(item);
  }

  return { unplaced };
}

/**
 * 컨테이너 조합 후보 생성.
 * - auto: 부피 기준 컨테이너 수 추정 + 약간의 여유분
 * - 20ft_only / 40ft_only: 해당 타입만 사용, 부피/중량 기준으로 개수 결정
 */
function candidateCombinations(
  cargoes: CargoSpec[],
  mode: ContainerMode,
): ContainerType[][] {
  const totalCbm = cargoes.reduce(
    (s, c) => s + (c.cbm ?? (c.width * c.length * c.height * c.quantity) / 1_000_000),
    0,
  );
  const totalWeight = cargoes.reduce(
    (s, c) => s + c.weightPerUnit * c.quantity,
    0,
  );

  const cbm20 = getContainerCbm(CONTAINERS["20FT"]);
  const cbm40 = getContainerCbm(CONTAINERS["40FT"]);
  const max20 = CONTAINERS["20FT"].maxWeightKg;
  const max40 = CONTAINERS["40FT"].maxWeightKg;

  if (mode === "20ft_only") {
    // 부피와 중량 둘 다 충족하도록 max
    const byCbm = Math.ceil(totalCbm / cbm20);
    const byWeight = Math.ceil((totalWeight + 1) / max20);
    const count = Math.max(1, byCbm, byWeight);
    return [Array.from({ length: count }, () => "20FT" as ContainerType)];
  }
  if (mode === "40ft_only") {
    const byCbm = Math.ceil(totalCbm / cbm40);
    const byWeight = Math.ceil((totalWeight + 1) / max40);
    const count = Math.max(1, byCbm, byWeight);
    return [Array.from({ length: count }, () => "40FT" as ContainerType)];
  }

  // auto — 40FT 우선, 부족분만 20FT로
  const candidates: ContainerType[][] = [];
  const count40Base = Math.max(0, Math.floor(totalCbm / cbm40));
  // 후보 1: 40FT만 (올림)
  const only40Count = Math.max(
    1,
    Math.ceil(totalCbm / cbm40),
    Math.ceil((totalWeight + 1) / max40),
  );
  candidates.push(
    Array.from({ length: only40Count }, () => "40FT" as ContainerType),
  );
  // 후보 2: 40FT count40Base + 20FT 1개
  if (count40Base > 0) {
    candidates.push([
      ...Array.from({ length: count40Base }, () => "40FT" as ContainerType),
      "20FT",
    ]);
  }
  // 후보 3: 20FT만 (올림)
  const only20Count = Math.max(
    1,
    Math.ceil(totalCbm / cbm20),
    Math.ceil((totalWeight + 1) / max20),
  );
  candidates.push(
    Array.from({ length: only20Count }, () => "20FT" as ContainerType),
  );
  return candidates;
}

/**
 * RowState를 외부에 보여줄 Row로 변환하면서 천장 여유/입구 통과 가능성 계산.
 */
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

/** 한 컨테이너의 적재 상태를 결과 형태로 정리 */
function finalizeContainer(c: ContainerState): ContainerPlan {
  const rows = c.rows.map((r) => finalizeRow(r, c.spec));
  const containerCbm = getContainerCbm(c.spec);
  let usedCbm = 0;
  for (const r of rows) {
    for (const item of [...r.bottomItems, ...r.topItems]) {
      usedCbm +=
        (item.size.width * item.size.length * item.size.height) / 1_000_000;
    }
  }
  const cbmFillRate = containerCbm > 0 ? (usedCbm / containerCbm) * 100 : 0;
  const weightFillRate =
    c.spec.maxWeightKg > 0 ? (c.totalWeight / c.spec.maxWeightKg) * 100 : 0;
  return {
    index: c.index,
    spec: c.spec,
    rows,
    totalWeight: c.totalWeight,
    totalCbm: usedCbm,
    cbmFillRate,
    weightFillRate,
  };
}

/**
 * 메인 진입점.
 * 컨테이너 조합 후보를 차례로 시도하여 unplaced가 가장 적고 충전률이 높은 결과를 채택한다.
 */
export function pack(cargoes: CargoSpec[], mode: ContainerMode): CLPResult {
  const items = expand(cargoes);
  const topOnly = items.filter((i) => i.remarks.topOnly);
  const main = sortMainQueue(items.filter((i) => !i.remarks.topOnly));

  const combinations = candidateCombinations(cargoes, mode);

  let best: { plan: CLPResult; score: number } | null = null;

  for (const combo of combinations) {
    const containers: ContainerState[] = combo.map((type, idx) =>
      makeContainer(idx + 1, getContainerSpec(type)),
    );
    const { unplaced } = packIntoContainers(containers, main, topOnly);

    const plans = containers.map(finalizeContainer);
    const count20FT = plans.filter((p) => p.spec.type === "20FT").length;
    const count40FT = plans.filter((p) => p.spec.type === "40FT").length;
    const totalWeight = plans.reduce((s, p) => s + p.totalWeight, 0);
    const totalCbm = plans.reduce((s, p) => s + p.totalCbm, 0);
    const avgFillRate =
      plans.length > 0
        ? plans.reduce((s, p) => s + p.cbmFillRate, 0) / plans.length
        : 0;

    const result: CLPResult = {
      containers: plans,
      unplaced: unplaced.map((u) => ({
        cargoId: u.cargoId,
        reason: "컨테이너에 배치할 공간/중량 여유가 없음",
      })),
      summary: {
        count20FT,
        count40FT,
        totalWeight,
        totalCbm,
        avgFillRate,
      },
    };

    // 점수: 미배치 페널티가 가장 크고, 그 다음 충전률, 그 다음 컨테이너 수(적을수록 좋음)
    const score =
      -unplaced.length * 10000 + avgFillRate - plans.length * 0.5;

    if (!best || score > best.score) {
      best = { plan: result, score };
    }
  }

  if (!best) {
    // 빈 화물 등으로 후보가 없는 경우 — 빈 결과 반환
    return {
      containers: [],
      unplaced: [],
      summary: {
        count20FT: 0,
        count40FT: 0,
        totalWeight: 0,
        totalCbm: 0,
        avgFillRate: 0,
      },
    };
  }
  return best.plan;
}

// 테스트에서 내부 함수를 검증할 수 있도록 명시적으로 노출
export const __testables = {
  expand,
  sortMainQueue,
  pickRotation,
  candidateCombinations,
  DEFAULT_REMARK,
};
