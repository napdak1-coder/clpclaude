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
  type CargoType,
  type Remark,
} from "../../types/cargo.ts";
import type {
  ContainerSpec,
  ContainerType,
} from "../../types/container.ts";
import type {
  BulkItem,
  CLPResult,
  ContainerMode,
  ContainerPlan,
  PlacedCargo,
  Row,
  UnplacedItem,
} from "../../types/plan.ts";
import {
  CONTAINERS,
  getContainerCbm,
  getContainerSpec,
} from "./containers.ts";
import {
  allowedFaces,
  canStackOn,
  effectiveSizeFace,
  withinWeightLimit,
} from "./constraints.ts";

interface UnitItem {
  unitId: string;
  cargoId: string;
  shipper: string;
  name?: string;
  cargoType: CargoType;
  /** 사용자 입력 CFS CBM (= cargo.cbm). 그룹 내 모든 unit 이 동일값 공유. */
  cfsCbm: number | null;
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
  /** CT/입고완료 분배 항목 (cargoId 단위로 트래킹) */
  bulkItems: BulkItem[];
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
            cargoType: c.cargoType,
            cfsCbm: c.cbm ?? null,
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
          cargoType: c.cargoType,
          cfsCbm: c.cbm ?? null,
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

/**
 * 화물 분류
 *
 * 변경 (2026-04-30): 입고완료(c.cbm 입력) 도 정상 6종이면 시각 적재 대상으로 보낸다.
 * 사용자 양식상 입고완료 화물도 W×L×H 사이즈가 있어 컨테이너 안 어디에 들어가는지
 * 시각화가 의미 있다. CFS CBM(c.cbm) 입력값은 화면에 별도 컬럼으로만 표시 (참고용).
 *
 * 오직 cargoType === "CT" (또는 알 수 없는 타입) 만 bulk(시각 X, CBM 합산만) 로 빠진다.
 * completedCargoes 는 호환을 위해 인터페이스에 남겨두지만 항상 빈 배열이다.
 */
interface ClassifiedCargoes {
  /** 시각 적재 대상 — CT 제외 모든 화물 (정상 6종, 입고완료 포함) */
  visualCargoes: CargoSpec[];
  /** CT 카톤 — 시각 X, CBM 만 컨테이너 여유에 합산 */
  ctCargoes: CargoSpec[];
  /** (deprecated) 항상 빈 배열 — 입고완료도 visualCargoes 로 보냄 */
  completedCargoes: CargoSpec[];
}

function classify(cargoes: CargoSpec[]): ClassifiedCargoes {
  const visualCargoes: CargoSpec[] = [];
  const ctCargoes: CargoSpec[] = [];
  const completedCargoes: CargoSpec[] = [];
  for (const c of cargoes) {
    if (c.cargoType === "CT") {
      ctCargoes.push(c);
      continue;
    }
    if (REGULAR_TYPES.has(c.cargoType)) {
      visualCargoes.push(c);
      continue;
    }
    // 알 수 없는 타입은 안전하게 CT 로 처리 (시각 X)
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
    bulkItems: [],
  };
}

/** 컨테이너의 남은 CBM 여유 = maxCbm - (visual + ct + completed) */
function remainingCbm(c: ContainerState): number {
  return getContainerCbm(c.spec) - (c.visualCbm + c.ctCbm + c.completedCbm);
}

/**
 * 화물의 6면 중 컨테이너에 들어가는 첫 면 (effectiveSize 결과) 반환.
 * 입구 통과 여부는 알고리즘 외부에서 doorPassable 로 별도 체크하므로 여기선 차원만 검사.
 * orientation 제한(fixed/long_along_length)은 allowedFaces 가 처리.
 */
function pickFace(
  item: UnitItem,
  container: ContainerSpec,
): { width: number; length: number; height: number; faceIdx: number } | null {
  const cargoLike = asCargoLike(item);
  for (const idx of allowedFaces(cargoLike)) {
    const eff = effectiveSizeFace(cargoLike, idx);
    if (
      eff.width <= container.innerWidth &&
      eff.length <= container.innerLength &&
      eff.height <= container.innerHeight
    ) {
      return { ...eff, faceIdx: idx };
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
  eff: { width: number; length: number; height: number },
): PlacedCargo {
  // 평면 회전 여부 — 시각화상 의미만 갖는 boolean (eff.width 가 원본 W 와 다르면 회전)
  const rotated = eff.width !== item.width || eff.length !== item.length;
  const placed: PlacedCargo = {
    cargoId: item.cargoId,
    shipper: item.shipper,
    name: item.name,
    cargoType: item.cargoType,
    cfsCbm: item.cfsCbm,
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

/**
 * 한 column(같은 x, y 위치) 에 이미 쌓인 stack 의 최상단 item + 누적 높이.
 * stack 이 비어있으면 bottom 자체를 최상단으로 본다 (높이 = bottom.size.height).
 */
function getStackTop(
  row: RowState,
  bottom: PlacedCargo,
): { topItem: PlacedCargo; stackHeight: number } {
  const sameColumnTops = row.topItems.filter(
    (t) =>
      t.position.x === bottom.position.x && t.position.y === bottom.position.y,
  );
  if (sameColumnTops.length === 0) {
    return { topItem: bottom, stackHeight: bottom.size.height };
  }
  // 가장 마지막에 추가된 top 이 가장 위 (push 순서 = 쌓는 순서)
  const topItem = sameColumnTops[sameColumnTops.length - 1];
  const stackHeight =
    bottom.size.height +
    sameColumnTops.reduce((s, t) => s + t.size.height, 0);
  return { topItem, stackHeight };
}

/**
 * 다단 적재 시도 (3층, 4층 …).
 *
 * 각 bottom column 의 stack 최상단을 보고:
 *  - 새 item 이 그 최상단보다 작거나 같은 가로/세로
 *  - canStackOn(new, topOfStack) — 다단금지/중량조건 통과
 *  - stackHeight + new.height ≤ innerHeight (천장 안 닿음)
 *  - 컨테이너 중량 한도 내
 * 모두 통과하면 최상단 위에 새 layer 로 push.
 */
function tryPlaceOnTop(
  row: RowState,
  c: ContainerState,
  item: UnitItem,
  eff: { width: number; length: number; height: number },
): PlacedCargo | null {
  let bestBottom: PlacedCargo | null = null;
  let bestStackHeight = -1;
  for (const bottom of row.bottomItems) {
    const { topItem, stackHeight } = getStackTop(row, bottom);
    if (eff.width > topItem.size.width || eff.length > topItem.size.length) continue;
    const topLike = { weightPerUnit: topItem.weight, remarks: topItem.remarks };
    if (!canStackOn(asCargoLike(item), topLike)) continue;
    if (stackHeight + eff.height > c.spec.innerHeight) continue;
    if (!withinWeightLimit(c.totalWeight, item.weight, c.spec)) continue;
    if (stackHeight > bestStackHeight) {
      bestStackHeight = stackHeight;
      bestBottom = bottom;
    }
  }
  if (!bestBottom) return null;

  const rotated = eff.width !== item.width || eff.length !== item.length;
  const placed: PlacedCargo = {
    cargoId: item.cargoId,
    shipper: item.shipper,
    name: item.name,
    cargoType: item.cargoType,
    cfsCbm: item.cfsCbm,
    layer: "top",
    position: { x: bestBottom.position.x, y: bestBottom.position.y },
    size: { width: eff.width, length: eff.length, height: eff.height },
    rotated,
    weight: item.weight,
    remarks: item.remarks,
  };
  row.topItems.push(placed);
  const newStackTotal = bestStackHeight - bestBottom.size.height + eff.height;
  if (newStackTotal > row.topMaxHeight) row.topMaxHeight = newStackTotal;
  c.totalWeight += item.weight;
  c.visualCbm += (eff.width * eff.length * eff.height) / 1_000_000;
  return placed;
}

/**
 * 일반 화물 1 unit 을 컨테이너에 시도.
 *
 * Best-fit 정책:
 *  - 기존 모든 row 를 후보로 평가 → 끼워넣고 남는 가로 여유(slack)가 가장 작은 row 선택
 *    (tightness 큰 곳 = 끝까지 알차게 채움)
 *  - slack 동률이면 row 길이 확장이 가장 적은 곳 선택
 *  - 어떤 기존 row 도 안 맞으면 새 row 열어서 placeBottom
 *
 * Top fallback 은 호출자(pack) 가 본 함수 실패 시 별도로 시도한다 — 본 함수는 bottom 만 본다.
 */
function tryPlaceInContainer(
  c: ContainerState,
  item: UnitItem,
): PlacedCargo | null {
  const eff = pickFace(item, c.spec);
  if (!eff) return null;
  if (!withinWeightLimit(c.totalWeight, item.weight, c.spec)) return null;
  const itemCbm = (eff.width * eff.length * eff.height) / 1_000_000;
  if (itemCbm > remainingCbm(c)) return null;

  // ① 기존 row 의 가로 여유에 끼우기 (best-fit)
  let bestRow: RowState | null = null;
  let bestSlackWidth = Number.POSITIVE_INFINITY;
  let bestLengthGrowth = Number.POSITIVE_INFINITY;
  for (const row of c.rows) {
    const remainingWidth = c.spec.innerWidth - row.xCursor;
    if (eff.width > remainingWidth) continue;
    const currentLen = row.yEnd - row.yStart;
    const projectedLen = Math.max(currentLen, eff.length);
    const projectedYEnd = row.yStart + projectedLen;
    const nextRowStart = c.rows
      .filter((r) => r.yStart > row.yStart)
      .reduce<number>(
        (min, r) => (r.yStart < min ? r.yStart : min),
        c.spec.innerLength,
      );
    if (projectedYEnd > nextRowStart) continue;
    const slackWidth = remainingWidth - eff.width;
    const lengthGrowth = projectedLen - currentLen;
    if (
      slackWidth < bestSlackWidth ||
      (slackWidth === bestSlackWidth && lengthGrowth < bestLengthGrowth)
    ) {
      bestSlackWidth = slackWidth;
      bestLengthGrowth = lengthGrowth;
      bestRow = row;
    }
  }
  if (bestRow) return placeBottom(bestRow, c, item, eff);

  // ② 행 안 빈 length 영역에 끼우기 (2D row gap fill)
  //    한 row 안에 짧은 화물이 있을 때 그 화물 안쪽(yEnd 쪽) 빈 사각형에 추가 화물 배치.
  //    occupied bottom 들의 (x+w, y+l) 모서리 점을 후보로 빈 사각형 검사.
  for (const row of c.rows) {
    const placed = tryPlaceInRowGap(row, c, item, eff, itemCbm);
    if (placed) return placed;
  }

  // ③ 새 row — 마지막 폴백
  if (eff.width > c.spec.innerWidth) return null;
  const newRow = openRow(c, eff.length);
  if (!newRow) return null;
  return placeBottom(newRow, c, item, eff);
}

/**
 * 행 안 빈 length 영역에 화물 끼우기 (단순 guillotine fit).
 *
 * 각 occupied bottom 의 (x, y+length) 위치 — 그 화물 바로 안쪽(컨테이너 안쪽 방향) 빈 영역.
 * 새 화물이 그 영역에 들어가고 다른 occupied 와 충돌 안 하면 배치.
 *
 * row.yEnd 는 변경하지 않음 (이미 충분히 큼). row 의 mass center 가 아닌 빈 자리만 채움.
 */
function tryPlaceInRowGap(
  row: RowState,
  c: ContainerState,
  item: UnitItem,
  eff: { width: number; length: number; height: number },
  itemCbm: number,
): PlacedCargo | null {
  const rowEnd = row.yEnd;
  if (eff.length === 0 || eff.width === 0) return null;

  // 후보 위치 = 각 occupied bottom 의 안쪽 모서리 (x, y+length) + 행 시작 (0, yStart)
  const candidates: Array<{ x: number; y: number }> = [
    { x: 0, y: row.yStart },
  ];
  for (const b of row.bottomItems) {
    candidates.push({ x: b.position.x, y: b.position.y + b.size.length });
    candidates.push({ x: b.position.x + b.size.width, y: b.position.y });
  }

  for (const cand of candidates) {
    if (cand.x + eff.width > c.spec.innerWidth) continue;
    if (cand.y + eff.length > rowEnd) continue;
    if (cand.y < row.yStart) continue;

    // 충돌 검사 — 후보 사각형이 다른 occupied 와 겹치는지
    let collides = false;
    for (const b of row.bottomItems) {
      const bx1 = b.position.x;
      const by1 = b.position.y;
      const bx2 = bx1 + b.size.width;
      const by2 = by1 + b.size.length;
      const nx1 = cand.x;
      const ny1 = cand.y;
      const nx2 = nx1 + eff.width;
      const ny2 = ny1 + eff.length;
      if (nx1 < bx2 && nx2 > bx1 && ny1 < by2 && ny2 > by1) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    // 배치 — placeBottom 과 유사하지만 row.xCursor / row.yEnd 변경 안 함 (gap 채움)
    const rotated = eff.width !== item.width || eff.length !== item.length;
    const placed: PlacedCargo = {
      cargoId: item.cargoId,
      shipper: item.shipper,
      name: item.name,
      cargoType: item.cargoType,
      cfsCbm: item.cfsCbm,
      layer: "bottom",
      position: { x: cand.x, y: cand.y },
      size: { width: eff.width, length: eff.length, height: eff.height },
      rotated,
      weight: item.weight,
      remarks: item.remarks,
    };
    row.bottomItems.push(placed);
    if (eff.height > row.bottomMaxHeight) row.bottomMaxHeight = eff.height;
    c.totalWeight += item.weight;
    c.visualCbm += itemCbm;
    return placed;
  }
  return null;
}

/**
 * 일반 화물 1 unit 의 상단 적재 시도 (모든 컨테이너 / 모든 row 의 stack 위에 올리기).
 * 6면 회전 활용 — 컨테이너마다 다른 면이 fit 될 수 있어 컨테이너별 pickFace.
 */
function tryPlaceOnTopAcross(
  containers: ContainerState[],
  item: UnitItem,
): PlacedCargo | null {
  for (const c of containers) {
    const eff = pickFace(item, c.spec);
    if (!eff) continue;
    for (const row of c.rows) {
      const placed = tryPlaceOnTop(row, c, item, eff);
      if (placed) return placed;
    }
  }
  return null;
}

/**
 * CT/입고완료 cargo 그룹을 컨테이너에 분배.
 *
 * - cargo 입력 순서대로 처리
 * - 각 cargo 는 컨테이너 우선순위(ordered) 대로 가능한 만큼 채우고, 남으면 다음 컨테이너로
 * - 한 컨테이너의 free CBM 으로 다 못 받으면 자동 분할 (BulkItem 이 컨테이너마다 1개씩 생김)
 * - 모든 컨테이너가 차도 남은 분은 unplacedItems 로 반환
 */
function allocateBulkGroup(
  cargoes: CargoSpec[],
  group: "ct" | "completed",
  ordered: ContainerState[],
  cbmGetter: (c: CargoSpec) => number,
): { unplacedItems: { cargo: CargoSpec; cbm: number }[] } {
  const unplacedItems: { cargo: CargoSpec; cbm: number }[] = [];
  for (const cg of cargoes) {
    const cargoTotalCbm = cbmGetter(cg);
    let remaining = cargoTotalCbm;
    if (remaining <= 0) continue;
    const shipperLabel =
      cg.shipperName ?? cg.actualShipperName ?? cg.itemName ?? "";
    for (const cont of ordered) {
      if (remaining <= 0) break;
      const used = computeContainerLoadedCbm(cont);
      const free = Math.max(0, getContainerCbm(cont.spec) - used);
      if (free <= 0) continue;
      const fill = Math.min(remaining, free);
      cont.bulkItems.push({
        cargoId: cg.id,
        shipper: shipperLabel,
        name: cg.itemName,
        cargoType: cg.cargoType,
        cbm: fill,
        totalCbm: cargoTotalCbm,
        width: cg.width,
        length: cg.length,
        height: cg.height,
        quantity: cg.quantity,
        weightPerUnit: cg.weightPerUnit,
        cfsCbm: cg.cbm ?? null,
        group,
      });
      if (group === "ct") cont.ctCbm += fill;
      else cont.completedCbm += fill;
      remaining -= fill;
    }
    if (remaining > 0.0001) {
      unplacedItems.push({ cargo: cg, cbm: remaining });
    }
  }
  return { unplacedItems };
}

/**
 * 입고완료 분배용 컨테이너 우선순위 결정.
 *
 * - exclusive 가 지정됐으면 그 컨테이너 먼저, 그 다음 나머지를 작은 순으로
 * - 아니면 totalCbm 을 1대에 다 받을 수 있는 가장 작은 컨테이너를 1순위로
 *   (1대로 다 못 받으면 가장 큰 컨테이너 1순위 → 나머지를 작은 순)
 */
function orderForCompleted(
  containers: ContainerState[],
  completedCbm: number,
  exclusiveIdx: number | undefined,
): ContainerState[] {
  if (containers.length === 0) return [];
  const sortedAsc = [...containers].sort(
    (a, b) => getContainerCbm(a.spec) - getContainerCbm(b.spec),
  );
  if (typeof exclusiveIdx === "number") {
    const target = containers.find((c) => c.index === exclusiveIdx);
    if (target) {
      return [target, ...sortedAsc.filter((c) => c.index !== exclusiveIdx)];
    }
  }
  const fits = sortedAsc.find(
    (c) => completedCbm <= getContainerCbm(c.spec),
  );
  const primary = fits ?? sortedAsc[sortedAsc.length - 1];
  return [primary, ...sortedAsc.filter((c) => c.index !== primary.index)];
}

function finalizeRow(row: RowState, spec: ContainerSpec): Row {
  // 다단 적재(3층+) 지원 — 각 column 별 stack 합 high 의 max 가 행 실제 높이
  let totalHeight = row.bottomMaxHeight;
  for (const b of row.bottomItems) {
    const stackTops = row.topItems.filter(
      (t) => t.position.x === b.position.x && t.position.y === b.position.y,
    );
    const colHeight =
      b.size.height + stackTops.reduce((s, t) => s + t.size.height, 0);
    if (colHeight > totalHeight) totalHeight = colHeight;
  }
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
    bulkItems: c.bulkItems,
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
  /**
   * 사용자가 미리 정한 컨테이너 종류·개수.
   * 지정하면 mode/decideContainers 결과를 무시하고 이 배열대로 컨테이너 생성.
   * 길이 = 컨테이너 대수, 각 원소는 "20FT" / "40FT".
   */
  fixedContainers?: ContainerType[];
  /**
   * 사용자가 짠 화물 → 컨테이너 강제 분배.
   * key = cargoId, value = 1-based 컨테이너 인덱스 (fixedContainers 또는 자동 생성된 컨테이너 기준).
   * 매핑된 cargoId 의 unit 들은 해당 컨테이너에서만 시각/상단 적재 시도. 못 끼우면 unplaced.
   * 매핑 없는 cargoId 는 평소대로 모든 visualContainers 후보 시도.
   */
  fixedAssignment?: Record<string, number>;
  /**
   * unit 정렬 전략 — 기본 "ldf" (부피 큰 순).
   * 다중 시뮬레이션(packBest) 에서 여러 전략을 비교할 때 사용.
   */
  sortStrategy?:
    | "ldf"
    | "input"
    | "longest-side"
    | "tallest"
    | "widest"
    | "shortest"
    | "shortest-height";
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

  // 2) CBM/무게 합 (CT 만 bulk, 나머지는 시각)
  const visualCbm = visualCargoes.reduce((s, c) => s + cargoCbm(c), 0);
  const ctCbm = ctCargoes.reduce(
    (s, c) => s + (c.cbm ?? c.aboutCbm ?? cargoCbm(c)),
    0,
  );
  const completedCbm = completedCargoes.reduce((s, c) => s + (c.cbm ?? 0), 0); // 항상 0 (호환용)
  const totalCbm = visualCbm + ctCbm + completedCbm;
  // 정보용: 입고완료(c.cbm 입력) 화물의 사용자 입력 CBM 합 — 시각화 위치 무관, summary 표시 전용
  const completedInfoCbm = visualCargoes
    .filter((c) => c.cbm != null && c.cbm > 0)
    .reduce((s, c) => s + (c.cbm ?? 0), 0);

  // 3) 컨테이너 결정 — 사용자 지정 fixedContainers 가 있으면 그대로 사용
  const types =
    options?.fixedContainers && options.fixedContainers.length > 0
      ? options.fixedContainers
      : decideContainers(totalCbm, completedCbm, mode);
  const containers: ContainerState[] = types.map((t, i) =>
    makeContainer(i + 1, getContainerSpec(t)),
  );

  // 4) 입고완료 그룹 → 단일 컨테이너에 합산 (필요 시 분산 + 분할)
  //   옵션이 있으면 사용자가 지정한 컨테이너에 한도까지 우선 적재 + 초과분 자동 분산
  const warnings: string[] = [];
  /** CT/입고완료 분배 후 들어가지 못한 분 — 결과 unplaced 에 합쳐 표시 */
  const bulkUnplaced: UnplacedItem[] = [];
  const exclusiveIdx = options?.completedExclusiveContainerIndex;
  if (completedCargoes.length > 0 && completedCbm > 0) {
    const ordered = orderForCompleted(containers, completedCbm, exclusiveIdx);
    const before = ordered.map((c) => c.completedCbm);
    const result = allocateBulkGroup(
      completedCargoes,
      "completed",
      ordered,
      (c) => c.cbm ?? 0,
    );
    // 분산 발생 시 사용자에게 알림
    const filled = ordered.filter(
      (c, i) => c.completedCbm - before[i] > 0.0001,
    );
    if (filled.length > 1) {
      const detail = filled
        .map(
          (c, i) =>
            `#${c.index} ${c.spec.type}: ${(c.completedCbm - before[ordered.indexOf(c)]).toFixed(3)}m³`,
        )
        .join(", ");
      warnings.push(
        `입고완료 ${completedCbm.toFixed(3)}m³ 가 단일 컨테이너에 안 들어가 분산됨 (${detail})`,
      );
    }
    for (const u of result.unplacedItems) {
      bulkUnplaced.push(makeUnplacedFromCargo(u.cargo, u.cbm, "completed"));
    }
  }

  // 5) 시각 적재
  //
  // 순서:
  //  ① 큰 화물 우선 정렬 (LDF — Largest Dimension First) — 부피·긴 변·중량 순.
  //     큰 화물부터 들어가야 행 구조가 안정적이고 작은 화물이 빈 자리를 채움.
  //  ② topOnly 화물은 별도 큐 — 마지막에 빈 top 슬롯에만.
  //  ③ 일반 화물은 best-fit bottom → 실패 시 top fallback (다른 화물 위에 쌓기).
  //     일반화물의 noStacking 자체 플래그는 "내 위에 못 쌓는다" 의미라 자기는 어디든 갈 수 있음.
  //     아래 화물의 stack 가능 여부는 canStackOn 이 검증.
  const allUnits = expandToUnits(visualCargoes);
  const sortBig = (units: UnitItem[]): UnitItem[] => {
    const strat = options?.sortStrategy ?? "ldf";
    if (strat === "input") return [...units];
    return [...units].sort((a, b) => {
      switch (strat) {
        case "longest-side": {
          const la = Math.max(a.width, a.length, a.height);
          const lb = Math.max(b.width, b.length, b.height);
          return lb - la;
        }
        case "tallest":
          return b.height - a.height;
        case "widest":
          return Math.max(b.width, b.length) - Math.max(a.width, a.length);
        case "shortest": {
          // 부피 작은 순 (오름차순) — 작은 화물이 먼저 들어가서 자리 잡고 큰 화물이 빈 자리 채움
          const va = a.width * a.length * a.height;
          const vb = b.width * b.length * b.height;
          return va - vb;
        }
        case "shortest-height":
          // 낮은 높이 화물 먼저 — bottom 깔리고 다단 잘 됨
          return a.height - b.height;
        case "ldf":
        default: {
          const va = a.width * a.length * a.height;
          const vb = b.width * b.length * b.height;
          if (vb !== va) return vb - va;
          const longA = Math.max(a.width, a.length, a.height);
          const longB = Math.max(b.width, b.length, b.height);
          if (longB !== longA) return longB - longA;
          return b.weight - a.weight;
        }
      }
    });
  };
  const topOnlyUnits = sortBig(allUnits.filter((u) => u.remarks.topOnly));
  const generalUnits = sortBig(allUnits.filter((u) => !u.remarks.topOnly));

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

  // 사용자 강제 분배 매핑 — 매핑된 cargoId 는 해당 컨테이너만 후보로 한정
  const fixedMap = options?.fixedAssignment ?? {};
  const candidatesFor = (u: UnitItem): ContainerState[] => {
    const idx = fixedMap[u.cargoId];
    if (typeof idx === "number") {
      const target = visualContainers.find((c) => c.index === idx);
      return target ? [target] : [];
    }
    return visualContainers;
  };

  // 일반 화물 — bottom 우선, 실패 시 top fallback
  for (const u of generalUnits) {
    const candidates = candidatesFor(u);
    let placed = false;
    for (const c of candidates) {
      if (tryPlaceInContainer(c, u)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      const top = tryPlaceOnTopAcross(candidates, u);
      if (top) placed = true;
    }
    if (!placed) unplaced.push(u);
  }

  // topOnly — 빈 top 슬롯에 (시각 가능한 컨테이너만 시도)
  for (const u of topOnlyUnits) {
    const candidates = candidatesFor(u);
    const top = tryPlaceOnTopAcross(candidates, u);
    if (!top) unplaced.push(u);
  }

  // 6) CT 화물 CBM → 컨테이너별 남은 여유 CBM 에 합산 (cargo 단위 분할 추적)
  //    옵션상 exclusive 컨에 CT 차단이면 해당 컨테이너 건너뜀
  if (ctCargoes.length > 0 && ctCbm > 0) {
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
    const result = allocateBulkGroup(
      ctCargoes,
      "ct",
      ctTargets,
      (c) => c.cbm ?? c.aboutCbm ?? cargoCbm(c),
    );
    for (const u of result.unplacedItems) {
      bulkUnplaced.push(makeUnplacedFromCargo(u.cargo, u.cbm, "ct"));
    }
  }

  // 7) 결과 정리
  const plans = containers.map(finalizeContainer);
  const count20FT = plans.filter((p) => p.spec.type === "20FT").length;
  const count40FT = plans.filter((p) => p.spec.type === "40FT").length;
  const totalWeight = plans.reduce((s, p) => s + p.totalWeight, 0);
  const visualPlanCbm = plans.reduce((s, p) => s + p.totalCbm, 0);
  const ctTotalCbm = plans.reduce((s, p) => s + p.ctCbm, 0);
  // 입고완료는 시각으로 들어가므로 컨테이너 단위 completedCbm 은 0 — 정보성 합계로 대체
  const completedTotalCbm = completedInfoCbm;
  const avgFillRate =
    plans.length > 0
      ? plans.reduce((s, p) => s + p.cbmFillRate, 0) / plans.length
      : 0;

  // 시각 unit 미배치 — 같은 cargoId 끼리 1행으로 그룹화 (수량 합 + system cbm 합 + 중량 합)
  const visualUnplacedMap = new Map<string, UnplacedItem>();
  for (const u of unplaced) {
    const cbmPerUnit = (u.width * u.length * u.height) / 1_000_000;
    const existing = visualUnplacedMap.get(u.cargoId);
    if (existing) {
      existing.quantity = (existing.quantity ?? 0) + 1;
      existing.systemCbm = (existing.systemCbm ?? 0) + cbmPerUnit;
      existing.unfitCbm = (existing.unfitCbm ?? 0) + cbmPerUnit;
      existing.weight = (existing.weight ?? 0) + u.weight;
    } else {
      visualUnplacedMap.set(u.cargoId, {
        cargoId: u.cargoId,
        reason: "컨테이너에 배치할 공간/중량 여유가 없음",
        shipper: u.shipper,
        name: u.name,
        cargoType: u.cargoType,
        width: u.width,
        length: u.length,
        height: u.height,
        quantity: 1,
        systemCbm: cbmPerUnit,
        cfsCbm: u.cfsCbm,
        unfitCbm: cbmPerUnit,
        weight: u.weight,
        group: "visual",
      });
    }
  }
  const unplacedOut: UnplacedItem[] = [
    ...Array.from(visualUnplacedMap.values()),
    ...bulkUnplaced,
  ];

  // CT 카톤은 시각 좌표가 없어 컨테이너 그림에 안 그려진다.
  // 사용자가 어느 컨테이너에 카톤이 얼마나 들어갔는지 한눈에 보도록 정보성 알림 추가.
  if (ctTotalCbm > 0) {
    const ctPerContainer = plans
      .filter((p) => p.ctCbm > 0)
      .map((p) => `#${p.index}(${p.spec.type}) ${p.ctCbm.toFixed(2)}m³`)
      .join(", ");
    if (ctPerContainer) {
      warnings.push(
        `CT 카톤(시각 미배치) 컨테이너별 포함량 — ${ctPerContainer} (총 ${ctTotalCbm.toFixed(2)}m³)`,
      );
    }
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

/**
 * cargo + 못 들어간 CBM → UnplacedItem (CT/입고완료 bulk 미배치용).
 * 사이즈/수량/중량/cfsCbm 등 화면 표시용 메타데이터를 cargo 에서 그대로 가져온다.
 */
function makeUnplacedFromCargo(
  c: CargoSpec,
  unfitCbm: number,
  group: "ct" | "completed",
): UnplacedItem {
  const groupLabel = group === "ct" ? "CT 카톤" : "입고완료";
  const systemCbm = (c.width * c.length * c.height * c.quantity) / 1_000_000;
  return {
    cargoId: c.id,
    reason: `${groupLabel} ${unfitCbm.toFixed(3)}m³ 분이 컨테이너 여유 CBM 에 들어가지 않음`,
    shipper: c.shipperName ?? c.actualShipperName ?? c.itemName ?? "",
    name: c.itemName,
    cargoType: c.cargoType,
    width: c.width,
    length: c.length,
    height: c.height,
    quantity: c.quantity,
    systemCbm,
    cfsCbm: c.cbm ?? null,
    unfitCbm,
    weight: c.weightPerUnit ?? 0,
    group,
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

/**
 * 다중 시뮬레이션 + 백트래킹 — 여러 정렬 전략 + 미배치 화물 우선 재배치 반복.
 *
 * 절차:
 *  1) 5가지 정렬 전략(LDF/longest-side/tallest/widest/input) 으로 패킹 후 best 선택
 *  2) 미배치 발생 시 [미배치 화물 ID] 를 입력 cargoes 의 맨 앞으로 옮긴 후 다시 5 전략 시도
 *     — 미배치 화물이 다른 큰 화물 자리를 차지하게 유도. 빠진 큰 화물도 재배치 시도됨 (입력 순서가 바뀐 것)
 *  3) 개선이 멈추거나 미배치 = 0 또는 max iteration 도달 시 종료
 *
 * 백트래킹의 의미: 행 단위 사고가 아니라 컨테이너 전체를 두고 화물 입력 순서를 바꿔
 *                 가상 방 배치 시뮬레이션을 여러 번 해서 가장 좋은 결과를 채택.
 */
export function packBest(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options?: PackOptions,
): CLPResult {
  const strategies: PackOptions["sortStrategy"][] = [
    "ldf",
    "longest-side",
    "tallest",
    "widest",
    "input",
    "shortest",
    "shortest-height",
  ];

  const evaluate = (r: CLPResult): number => {
    const unp = r.unplaced.reduce((s, u) => s + (u.quantity ?? 1), 0);
    return -unp * 100000 + r.summary.avgFillRate;
  };

  const tryAllStrategies = (input: CargoSpec[]): CLPResult => {
    let best: CLPResult | null = null;
    let bestScore = -Infinity;
    for (const strat of strategies) {
      const r = pack(input, mode, { ...options, sortStrategy: strat });
      const score = evaluate(r);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best ?? pack(input, mode, options);
  };

  // 1단계: 기본 5 전략
  let current = tryAllStrategies(cargoes);
  let currentScore = evaluate(current);

  // 2단계: 백트래킹 — 미배치 화물 우선 input 순으로 강제 (input strategy 만)
  // 5 전략 sort 가 입력 순서를 무시하기 때문에 input strategy 단독으로 swap 효과 발생 유도.
  // 한 화물씩 cargoes 의 맨 앞으로 옮긴 input 들을 시도 + 미배치 전체를 맨 앞으로 옮긴 input 시도.
  const MAX_BACKTRACK = 12;
  let inputOrder = [...cargoes];
  for (let iter = 0; iter < MAX_BACKTRACK; iter++) {
    if (current.unplaced.length === 0) break;
    const unplacedIds = current.unplaced.map((u) => u.cargoId);
    if (unplacedIds.length === 0) break;
    let improved = false;

    // (a) 미배치 전체를 맨 앞으로 — input strategy 사용
    const allFront = [
      ...inputOrder.filter((c) => unplacedIds.includes(c.id)),
      ...inputOrder.filter((c) => !unplacedIds.includes(c.id)),
    ];
    const candA = pack(allFront, mode, { ...options, sortStrategy: "input" });
    if (evaluate(candA) > currentScore) {
      current = candA;
      currentScore = evaluate(candA);
      inputOrder = allFront;
      improved = true;
      continue;
    }

    // (b) 미배치 화물 1개씩 맨 앞으로 swap — 5 전략 best 채택
    for (const uid of unplacedIds) {
      const reordered = [
        ...inputOrder.filter((c) => c.id === uid),
        ...inputOrder.filter((c) => c.id !== uid),
      ];
      const cand = tryAllStrategies(reordered);
      const score = evaluate(cand);
      if (score > currentScore) {
        current = cand;
        currentScore = score;
        inputOrder = reordered;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  return current;
}

// 테스트에서 내부 함수를 검증할 수 있도록 명시적으로 노출
export const __testables = {
  expandToUnits,
  classify,
  decideContainers,
  orderForCompleted,
  allocateBulkGroup,
  cargoCbm,
  cargoTotalWeight,
  DEFAULT_REMARK,
};
