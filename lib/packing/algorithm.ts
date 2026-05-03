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
  UnplacedItem,
} from "../../types/plan.ts";
import {
  CONTAINERS,
  getContainerCbm,
  getContainerSpec,
} from "./containers.ts";
import {
  makeContainerState,
  tryPlaceUnit,
  tryPlaceUnitBruteForce,
  type ContainerPackState,
} from "./extreme-point.ts";
import { allowedFaces, effectiveSizeFace } from "./constraints.ts";
import { computeDisplayRows } from "./display-rows.ts";

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

interface ContainerState {
  index: number;
  spec: ContainerSpec;
  /** extreme-point packer 상태 (placements, candidates, totalWeight, visualCbm) */
  packState: ContainerPackState;
  /** CT 화물 CBM 누적 (시각 unit 없이 합산만) */
  ctCbm: number;
  /** 입고완료 화물 CBM 누적 */
  completedCbm: number;
  /** CT/입고완료 분배 항목 (cargoId 단위로 트래킹) */
  bulkItems: BulkItem[];
}

const REGULAR_TYPES = new Set(["PL", "WB", "WC", "WD", "CR", "CL", "PK"]);

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

/**
 * 분류 룰 — **사이즈 우선** (cargoType 라벨보다 사이즈가 우선).
 *
 * - W & L & H > 0 (또는 unitSizes 가 모두 양수) → 시각 적재 대상 (cargoType 무관)
 * - 사이즈 없음 (w/l/h ≤ 0 + unitSizes 도 없거나 비어있음) → CT bulk (CBM 만 합산)
 *
 * 즉 cargoType=CT 라도 사이즈가 적혀 있으면 시각화한다 (사용자 룰: "사이즈 적힌 건 다 시각").
 * 진짜 카톤(사이즈 입력 없이 CBM 만 옴) 만 bulk 로 빠진다.
 *
 * REGULAR_TYPES / cargoType 은 화면 라벨/색 구분 등에만 사용.
 */
function classify(cargoes: CargoSpec[]): ClassifiedCargoes {
  const visualCargoes: CargoSpec[] = [];
  const ctCargoes: CargoSpec[] = [];
  for (const c of cargoes) {
    const hasMainSize = c.width > 0 && c.length > 0 && c.height > 0;
    const hasUnitSizes =
      c.unitSizes != null &&
      c.unitSizes.length > 0 &&
      c.unitSizes.every(
        (u) => u.width > 0 && u.length > 0 && u.height > 0,
      );
    if (hasMainSize || hasUnitSizes) {
      visualCargoes.push(c);
    } else {
      ctCargoes.push(c);
    }
  }
  return { visualCargoes, ctCargoes, completedCargoes: [] };
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
    packState: makeContainerState(),
    ctCbm: 0,
    completedCbm: 0,
    bulkItems: [],
  };
}

/** 컨테이너의 남은 CBM 여유 = maxCbm - (visual + ct + completed) */
function remainingCbm(c: ContainerState): number {
  return (
    getContainerCbm(c.spec) -
    (c.packState.visualCbm + c.ctCbm + c.completedCbm)
  );
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

function finalizeContainer(c: ContainerState): ContainerPlan {
  // 자유 좌표 placements → 화면용 Row[] 변환 (display-rows 가 layered display 적용)
  const rows = computeDisplayRows(c.packState.placements, c.spec);
  const containerCbm = getContainerCbm(c.spec);
  const visualCbm = c.packState.visualCbm;
  const totalLoadedCbm = visualCbm + c.ctCbm + c.completedCbm;
  const cbmFillRate =
    containerCbm > 0 ? (totalLoadedCbm / containerCbm) * 100 : 0;
  const weightFillRate =
    c.spec.maxWeightKg > 0
      ? (c.packState.totalWeight / c.spec.maxWeightKg) * 100
      : 0;
  return {
    index: c.index,
    spec: c.spec,
    rows,
    totalWeight: c.packState.totalWeight,
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
  /**
   * 컨테이너 후보 순서 — 자유 분배 시 어떤 컨테이너를 먼저 시도할지.
   *  - "biggest-first" (기본): 입력 순서 그대로 (보통 40FT > 20FT)
   *  - "smallest-first" (best-fit): 작은 컨테이너 우선
   * packBest 가 양쪽 다 시도해 best 선택.
   */
  containerOrder?: "biggest-first" | "smallest-first";
  /**
   * 입고완료(cfs cbm 입력된) 화물 자동 마감 모드 — 기본 true.
   *
   * true 면 입고완료 화물의 총 CBM 을 한 컨테이너 한도 안에 수용 가능한지 자동 판단해
   * 그 컨테이너에 입고완료 화물 우선 배치 + 비-입고완료는 다른 컨테이너 우선.
   * 사용자 명시 옵션(fixedAssignment / completedExclusiveContainerIndex) 이 있으면 그게 우선.
   *
   * 예: 사용자 5종 입고완료 23 m³ → 20FT(28 m³)에 자동 마감, 다른 화물은 40FT 로.
   */
  autoConsolidateCompleted?: boolean;
  /**
   * placeQueue 모드 — 기본 "wrapper".
   *  - "wrapper" : 클러스터링/버블 stack/sub-bucket/brute-force fallback 모두 적용 (기본)
   *  - "pure"    : 단순 LDF + tryPlaceUnit. wrapper 가 손해보는 작은 케이스용.
   * packBest 가 양쪽 다 시도해 best 선택.
   */
  placementMode?: "wrapper" | "pure";
}

/** cm 단위 미세 좌표 비교 — extreme-point 내부 EPS 와 같은 수준이면 충분 */
const STACK_EPS = 0.01;

/** insertion order 보존하며 cargoId 별 그룹화 */
function groupByCargoId(units: UnitItem[]): UnitItem[][] {
  const map = new Map<string, UnitItem[]>();
  for (const u of units) {
    let g = map.get(u.cargoId);
    if (!g) {
      g = [];
      map.set(u.cargoId, g);
    }
    g.push(u);
  }
  return Array.from(map.values());
}

/** 같은 cargoId 그룹 내 모든 unit 의 (w,l,h) 가 동일한가 — 묶음 stack 전제 */
function allUnitsSameSize(group: UnitItem[]): boolean {
  const first = group[0];
  return group.every(
    (u) =>
      u.width === first.width &&
      u.length === first.length &&
      u.height === first.height,
  );
}

/**
 * 묶음 stack 용 최적 회전(face) 결정.
 *  - 컨테이너 (innerWidth, innerLength) 안에 들어가는 face 만
 *  - eff.height 가 작을수록 더 많이 stack 가능 → maxStack desc, h asc
 *  - groupSize 보다 더 많이 쌓을 수 있으면 그만큼만 사용 (의미 없는 큰 stack 회피)
 *  - maxStack < 2 면 묶음 이점이 없으므로 null 반환 (단독 배치가 더 나음)
 */
function pickBundleFace(
  unit: UnitItem,
  spec: ContainerSpec,
  groupSize: number,
): { faceIdx: number; effHeight: number; maxStack: number } | null {
  const faces = allowedFaces({
    width: unit.width,
    length: unit.length,
    height: unit.height,
    remarks: unit.remarks,
  });
  let best: { faceIdx: number; h: number; maxStack: number } | null = null;
  for (const faceIdx of faces) {
    const eff = effectiveSizeFace(unit, faceIdx);
    if (eff.height <= 0) continue;
    if (eff.width > spec.innerWidth + STACK_EPS) continue;
    if (eff.length > spec.innerLength + STACK_EPS) continue;
    const physicalMax = Math.floor(
      (spec.innerHeight + STACK_EPS) / eff.height,
    );
    const maxStack = Math.min(groupSize, physicalMax);
    if (maxStack < 2) continue;
    if (
      !best ||
      maxStack > best.maxStack ||
      (maxStack === best.maxStack && eff.height < best.h)
    ) {
      best = { faceIdx, h: eff.height, maxStack };
    }
  }
  return best
    ? { faceIdx: best.faceIdx, effHeight: best.h, maxStack: best.maxStack }
    : null;
}

/**
 * 같은 cargoId 의 N≥2 unit 을 한 컬럼에 세로 stack 으로 배치 시도.
 *
 *  1. 모든 unit (w,l,h) 동일 + groupSize ≥ 2 + noStacking=false 일 때만 진행.
 *  2. pickBundleFace 가 찾은 회전(face) 으로 첫 unit 배치 — 컨테이너 결정.
 *     실패 시 face 강제 없는 일반 배치로 fallback (단독 placement).
 *  3. 두 번째부터 maxStack 까지: anchor 바로 위 (x,y 동일, z=anchor.z+h) 만 허용
 *     하는 scoreFn + 동일 face 강제. 한 번이라도 실패 시 stack 종료.
 *  4. 묶음 placement 가 끝난 unit 외의 나머지는 호출자가 자유 배치 fallback.
 */
function tryBundleStack(
  group: UnitItem[],
  candidates: ContainerState[],
): { placed: UnitItem[]; remaining: UnitItem[] } {
  if (group.length < 2 || group[0].remarks.noStacking) {
    return { placed: [], remaining: group };
  }
  if (!allUnitsSameSize(group)) {
    return { placed: [], remaining: group };
  }
  const first = group[0];
  let host: ContainerState | null = null;
  let chosenFace: number | null = null;
  let plannedStack = 0;
  for (const c of candidates) {
    const best = pickBundleFace(first, c.spec, group.length);
    if (best) {
      if (
        tryPlaceUnit(first, c.packState, c.spec, {
          forceFaceIdx: best.faceIdx,
        })
      ) {
        host = c;
        chosenFace = best.faceIdx;
        plannedStack = best.maxStack;
        break;
      }
    }
    // face 강제 실패 또는 후보 없음 → 일반 배치 (단독)
    if (tryPlaceUnit(first, c.packState, c.spec)) {
      host = c;
      chosenFace = null;
      plannedStack = 1;
      break;
    }
  }
  if (!host) return { placed: [], remaining: group };
  let anchor =
    host.packState.placements[host.packState.placements.length - 1];
  const placed: UnitItem[] = [first];
  if (chosenFace === null || plannedStack <= 1) {
    return { placed, remaining: group.slice(1) };
  }
  for (let i = 1; i < plannedStack; i++) {
    const u = group[i];
    const targetX = anchor.position.x;
    const targetY = anchor.position.y;
    const targetZ = anchor.position.z + anchor.size.height;
    const scoreFn = (cand: { x: number; y: number; z: number }): number => {
      const exact =
        Math.abs(cand.x - targetX) < STACK_EPS &&
        Math.abs(cand.y - targetY) < STACK_EPS &&
        Math.abs(cand.z - targetZ) < STACK_EPS;
      return exact ? 0 : Number.POSITIVE_INFINITY;
    };
    if (
      tryPlaceUnit(u, host.packState, host.spec, {
        scoreFn,
        forceFaceIdx: chosenFace,
      })
    ) {
      anchor =
        host.packState.placements[host.packState.placements.length - 1];
      placed.push(u);
    } else {
      break;
    }
  }
  const placedIds = new Set(placed.map((p) => p.unitId));
  return {
    placed,
    remaining: group.filter((u) => !placedIds.has(u.unitId)),
  };
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
  // 같은 화주는 인접 배치, 같은 cargoId 는 더 인접 — LDF 우선순위 보존
  const sortClustered = (units: UnitItem[]): UnitItem[] => {
    const ldf = sortBig(units);
    const shipperFirst = new Map<string, number>();
    const cargoFirst = new Map<string, number>();
    const ldfRank = new Map<string, number>();
    ldf.forEach((u, idx) => {
      if (!shipperFirst.has(u.shipper)) shipperFirst.set(u.shipper, idx);
      if (!cargoFirst.has(u.cargoId)) cargoFirst.set(u.cargoId, idx);
      ldfRank.set(u.unitId, idx);
    });
    return [...ldf].sort((a, b) => {
      const sa = shipperFirst.get(a.shipper) ?? 0;
      const sb = shipperFirst.get(b.shipper) ?? 0;
      if (sa !== sb) return sa - sb;
      const ca = cargoFirst.get(a.cargoId) ?? 0;
      const cb = cargoFirst.get(b.cargoId) ?? 0;
      if (ca !== cb) return ca - cb;
      return (ldfRank.get(a.unitId) ?? 0) - (ldfRank.get(b.unitId) ?? 0);
    });
  };
  const topOnlyUnits = sortClustered(allUnits.filter((u) => u.remarks.topOnly));
  const generalUnits = sortClustered(allUnits.filter((u) => !u.remarks.topOnly));

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
  // 컨테이너 후보 정렬: options.containerOrder 따라 (기본 = original 순서)
  const containerOrder = options?.containerOrder ?? "biggest-first";
  const orderedContainers =
    containerOrder === "smallest-first"
      ? [...visualContainers].sort(
          (a, b) =>
            a.spec.innerWidth * a.spec.innerLength * a.spec.innerHeight -
            b.spec.innerWidth * b.spec.innerLength * b.spec.innerHeight,
        )
      : visualContainers;

  // 입고완료 자동 마감 — 입고완료 화물(c.cbm 입력) 들의 총 CBM 을 수용 가능한
  // "가장 작은 컨테이너" 1대 자동 선택해 그 컨에 우선 배치.
  // 사용자가 fixedAssignment 또는 completedExclusiveContainerIndex 명시했으면 자동 비활성.
  const autoConsolidate =
    (options?.autoConsolidateCompleted ?? true) &&
    Object.keys(fixedMap).length === 0 &&
    typeof exclusiveIdx !== "number";
  const completedCargoIds = new Set(
    visualCargoes
      .filter((c) => c.cbm != null && c.cbm > 0)
      .map((c) => c.id),
  );
  let autoDesignatedIdx: number | null = null;
  if (autoConsolidate && completedCargoIds.size > 0 && completedInfoCbm > 0) {
    const completedWeight = visualCargoes
      .filter((c) => completedCargoIds.has(c.id))
      .reduce((s, c) => s + cargoTotalWeight(c), 0);
    // 작은 컨테이너부터 — 입고완료 CBM/중량 둘 다 수용 가능한 첫 컨
    const ascByCbm = [...visualContainers].sort(
      (a, b) => getContainerCbm(a.spec) - getContainerCbm(b.spec),
    );
    const fit = ascByCbm.find(
      (c) =>
        getContainerCbm(c.spec) >= completedInfoCbm &&
        c.spec.maxWeightKg >= completedWeight,
    );
    if (fit) autoDesignatedIdx = fit.index;
  }

  const candidatesFor = (u: UnitItem): ContainerState[] => {
    const idx = fixedMap[u.cargoId];
    if (typeof idx === "number") {
      const target = visualContainers.find((c) => c.index === idx);
      return target ? [target] : [];
    }
    if (autoDesignatedIdx != null) {
      const designated = visualContainers.find(
        (c) => c.index === autoDesignatedIdx,
      );
      const others = orderedContainers.filter(
        (c) => c.index !== autoDesignatedIdx,
      );
      // 하이브리드 routing — 입고완료 strict + 비-입고완료 마감 컨 fallback 허용
      // (단 placeQueue 가 입고완료 cargo 를 먼저 처리하므로 5종 자리 보존됨)
      //   입고완료     → designated 만 (다른 컨 fallback X)
      //   비-입고완료  → designated 제외 우선, designated fallback 허용 (잉여 공간 활용)
      if (completedCargoIds.has(u.cargoId)) {
        return designated ? [designated] : orderedContainers;
      }
      return designated ? [...others, designated] : orderedContainers;
    }
    return orderedContainers;
  };

  // (4) 모드별 placement
  //   "wrapper" — 클러스터링/묶음 stack/sub-bucket/brute-force fallback 모두 적용
  //   "pure"    — 단순 LDF + tryPlaceUnit (작은 케이스에서 wrapper 가 손해보는 경우용)
  const mode_placement = options?.placementMode ?? "wrapper";
  const placeQueuePure = (queue: UnitItem[]): void => {
    // Pure 모드는 클러스터링 무시하고 LDF 만 — 작은 케이스에서 wrapper 모드 손해보는 경우용
    const ldfQueue = sortBig(queue);
    for (const u of ldfQueue) {
      const candidates = candidatesFor(u);
      let placed = false;
      for (const c of candidates) {
        if (tryPlaceUnit(u, c.packState, c.spec)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        for (const c of candidates) {
          if (tryPlaceUnitBruteForce(u, c.packState, c.spec)) {
            placed = true;
            break;
          }
        }
      }
      if (!placed) unplaced.push(u);
    }
  };

  // (4-wrapper) 묶음 우선 + 자유 배치 fallback
  //
  // 순서:
  //   ① bundle-eligible 그룹(같은 cargoId, 같은 사이즈, qty≥2, !noStacking) 부터 묶음 stack
  //      → 큰 그룹이 column 자리를 먼저 확보 (예: YKMC 4-stack 118×114 column 보존)
  //   ② 묶음 실패분 + non-bundleable 그룹 → 일반 LDF placement
  //   ③ 모두 실패 시 unplaced
  //
  // 큰 그룹을 먼저 배치하는 이유: 4-stack 같은 묶음은 한 column 통째로 필요한데,
  // 그 자리가 작은 화물 부스러기로 차면 묶음을 만들 수 없다.
  const placeQueueWrapper = (queue: UnitItem[]): void => {
    // 그룹 분할: 같은 cargoId 안에서도 (w,l,h) 가 다른 unit 이 섞여 있을 수 있다
    // (unitSizes 케이스). 사이즈별로 sub-bucket 만들어 묶음 적격성 판단.
    const groups = groupByCargoId(queue);
    type Bucket = { units: UnitItem[]; bundleEligible: boolean };
    const buckets: Bucket[] = [];
    for (const g of groups) {
      const sizeBuckets = new Map<string, UnitItem[]>();
      for (const u of g) {
        const key = `${u.width}x${u.length}x${u.height}`;
        let b = sizeBuckets.get(key);
        if (!b) {
          b = [];
          sizeBuckets.set(key, b);
        }
        b.push(u);
      }
      for (const b of sizeBuckets.values()) {
        buckets.push({
          units: b,
          bundleEligible: b.length >= 2 && !b[0].remarks.noStacking,
        });
      }
    }

    // bucket 들 정렬:
    //   1순위 — 자동마감 active 시 입고완료 cargo 가 먼저 (designated 컨 자리 선점)
    //   2순위 — LDF/클러스터 순서 (queue 인덱스)
    const queueIdx = new Map<string, number>();
    queue.forEach((u, i) => queueIdx.set(u.unitId, i));
    buckets.sort((a, b) => {
      const aCompleted = completedCargoIds.has(a.units[0].cargoId);
      const bCompleted = completedCargoIds.has(b.units[0].cargoId);
      if (aCompleted !== bCompleted) {
        // 자동마감 active 시 입고완료 우선
        if (autoDesignatedIdx != null) return aCompleted ? -1 : 1;
      }
      const ai = Math.min(...a.units.map((u) => queueIdx.get(u.unitId) ?? 0));
      const bi = Math.min(...b.units.map((u) => queueIdx.get(u.unitId) ?? 0));
      return ai - bi;
    });

    const fallbackUnits: UnitItem[] = [];

    // 각 bucket: bundle eligible 이면 multi-column bundle 시도, 아니면 솔로 fallback 큐로
    for (const bucket of buckets) {
      if (bucket.bundleEligible) {
        let remainingGroup = bucket.units;
        while (remainingGroup.length >= 2) {
          const result = tryBundleStack(
            remainingGroup,
            candidatesFor(remainingGroup[0]),
          );
          if (result.placed.length === 0) break;
          remainingGroup = result.remaining;
        }
        for (const u of remainingGroup) fallbackUnits.push(u);
      } else {
        for (const u of bucket.units) fallbackUnits.push(u);
      }
    }

    // 모든 fallback unit 을 원래 큐 순서대로 정렬 후 배치
    fallbackUnits.sort(
      (a, b) => (queueIdx.get(a.unitId) ?? 0) - (queueIdx.get(b.unitId) ?? 0),
    );
    for (const u of fallbackUnits) {
      const candidates = candidatesFor(u);
      let placed = false;
      for (const c of candidates) {
        if (tryPlaceUnit(u, c.packState, c.spec)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        for (const c of candidates) {
          if (tryPlaceUnitBruteForce(u, c.packState, c.spec)) {
            placed = true;
            break;
          }
        }
      }
      if (!placed) unplaced.push(u);
    }
  };
  // 자동마감 strict 모드 + completed cargoes 존재 시 split-execute:
  //   입고완료 unit (designated 컨 가는 것) → pure mode (단순 LDF)
  //   비-입고완료 unit (others 컨 가는 것) → wrapper mode (clustering + bundle)
  // 두 그룹이 서로 다른 컨테이너로 strict routing 되므로 packing 충돌 없음.
  // 각 그룹이 독립적으로 자기 컨테이너에 best fit.
  if (autoDesignatedIdx != null && completedCargoIds.size > 0) {
    const completedGen = generalUnits.filter((u) =>
      completedCargoIds.has(u.cargoId),
    );
    const otherGen = generalUnits.filter(
      (u) => !completedCargoIds.has(u.cargoId),
    );
    const completedTop = topOnlyUnits.filter((u) =>
      completedCargoIds.has(u.cargoId),
    );
    const otherTop = topOnlyUnits.filter(
      (u) => !completedCargoIds.has(u.cargoId),
    );
    placeQueuePure(completedGen);
    placeQueueWrapper(otherGen);
    placeQueuePure(completedTop);
    placeQueueWrapper(otherTop);
  } else {
    const placeQueue =
      mode_placement === "pure" ? placeQueuePure : placeQueueWrapper;
    placeQueue(generalUnits);
    placeQueue(topOnlyUnits);
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
  return c.packState.visualCbm + c.ctCbm + c.completedCbm;
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
    // 입고완료 분리도 보너스 — 입고완료 화물(cfsCbm 입력) 들이 한 컨테이너에 모일수록 +.
    // 추가: 가장 작은 컨테이너에 모일 때 더 큰 보너스 (마감 컨테이너 정책 우선).
    const completedContainersMap = new Map<number, ContainerPlan>();
    for (const c of r.containers) {
      for (const row of c.rows) {
        for (const it of [...row.bottomItems, ...row.topItems]) {
          if (it.cfsCbm != null && it.cfsCbm > 0)
            completedContainersMap.set(c.index, c);
        }
      }
    }
    let consolidationBonus = 0;
    if (completedContainersMap.size === 1) {
      const target = [...completedContainersMap.values()][0];
      const targetVol =
        target.spec.innerWidth * target.spec.innerLength * target.spec.innerHeight;
      // target 이 모든 컨테이너 중 가장 작은가?
      const isSmallest = r.containers.every(
        (o) =>
          o.index === target.index ||
          o.spec.innerWidth * o.spec.innerLength * o.spec.innerHeight >=
            targetVol,
      );
      consolidationBonus = isSmallest ? 2000 : 1000;
    } else if (completedContainersMap.size > 1) {
      consolidationBonus = -200 * (completedContainersMap.size - 1);
    }
    return -unp * 100000 + consolidationBonus + r.summary.avgFillRate;
  };

  const containerOrders: PackOptions["containerOrder"][] = [
    "biggest-first",
    "smallest-first",
  ];
  const placementModes: PackOptions["placementMode"][] = ["wrapper", "pure"];
  // 사용자 명시 옵션이 있으면 자동마감은 비활성 모드만 시도 (사용자 옵션 존중)
  const userPinned =
    options?.fixedAssignment != null ||
    typeof options?.completedExclusiveContainerIndex === "number" ||
    options?.autoConsolidateCompleted === false;
  const consolidateModes: boolean[] = userPinned ? [false] : [true, false];
  const tryAllStrategies = (input: CargoSpec[]): CLPResult => {
    let best: CLPResult | null = null;
    let bestScore = -Infinity;
    for (const strat of strategies) {
      for (const co of containerOrders) {
        for (const consolidate of consolidateModes) {
          for (const pm of placementModes) {
            const r = pack(input, mode, {
              ...options,
              sortStrategy: strat,
              containerOrder: co,
              autoConsolidateCompleted: consolidate,
              placementMode: pm,
            });
            const score = evaluate(r);
            if (score > bestScore) {
              bestScore = score;
              best = r;
            }
          }
        }
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
