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
  type UnitSize,
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
import { strictStackAudit } from "./audit.ts";
import { resetBruteForceBudget, clearBruteForceFailureCache } from "./extreme-point.ts";
import { distributeBookingValues } from "../distribute-booking-values.ts";
import {
  preClusterFootprint,
  preClusterNearFootprint,
  preClusterRowLane,
  type FootprintClusterOptions,
} from "./footprint-cluster.ts";
import {
  anchorLongAxisCargoes,
  type LongAxisAnchorOptions,
} from "./long-axis-anchor.ts";
import {
  computeContainerRows,
  computeRowResiduals,
  tryFitInRowResiduals,
} from "./row-residual.ts";

interface UnitItem {
  unitId: string;
  cargoId: string;
  shipper: string;
  /** 부킹 번호 (House B/L) — 같은 booking 화물 묶음 클러스터링용 */
  bookingNo?: string;
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
    const shipperLabel = c.actualShipperName ?? c.shipperName ?? c.itemName ?? "";
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
            bookingNo: c.bookingNo,
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
          bookingNo: c.bookingNo,
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
  // 룰 1 — Bulk shipment 감지:
  // 모든 화물이 c.cbm (CFS CBM) 을 입력했으면 = "전부 입고완료" 출하 케이스.
  // 실무자 분배는 input 순서대로 컨테이너 채움 + booking 묶음 보존이라 시각 적재
  // 트랙으로 가지 않고 CT 벌크 트랙(allocateBulkGroup의 sticky+anchor+overflow 룰) 사용.
  // 호치민 TOTAL 같이 모든 행에 CFS CBM 만 있는 양식 매칭.
  // 단일 화물은 제외 (단건 시각 적재 의도 보호 — 기존 테스트 케이스 호환)
  const allHaveCbm =
    cargoes.length >= 2 && cargoes.every((c) => (c.cbm ?? 0) > 0);
  if (allHaveCbm) {
    return { visualCargoes: [], ctCargoes: [...cargoes], completedCargoes: [] };
  }

  // 룰 2 — 일반 케이스: 사이즈 있으면 시각, 없으면 CT 벌크.
  // 1cm 미만은 placeholder (DB CHECK 우회용) 로 간주해 CT 로 라우팅.
  const SIZE_MIN_CM = 1;
  const visualCargoes: CargoSpec[] = [];
  const ctCargoes: CargoSpec[] = [];
  for (const c of cargoes) {
    const hasMainSize =
      c.width >= SIZE_MIN_CM &&
      c.length >= SIZE_MIN_CM &&
      c.height >= SIZE_MIN_CM;
    const hasUnitSizes =
      c.unitSizes != null &&
      c.unitSizes.length > 0 &&
      c.unitSizes.every(
        (u) =>
          u.width >= SIZE_MIN_CM &&
          u.length >= SIZE_MIN_CM &&
          u.height >= SIZE_MIN_CM,
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

  // 2.5순위: 안전마진 — 제거 (2026-05-11). 사유: maxCbm 60 (40FT) 자체가 이미
  // 공식 67 CBM 의 약 90% 안전마진 포함. 추가 안전마진은 이중 적용으로 과보수.
  // 망작 같은 60.032 CBM 케이스 흡수 위해 alternative 토스트 안으로 대체.
  // const SAFETY_BUFFER_CBM = 1.5;
  // const safe = prefer.filter((c) => c.capacity - totalCbm >= SAFETY_BUFFER_CBM);
  // if (safe.length > 0) prefer = safe;

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
  /** visual 배치 단계에서 이미 anchor 가 설정된 booking → container 맵 */
  initialBookingAnchor?: Map<string, ContainerState>,
): { unplacedItems: { cargo: CargoSpec; cbm: number }[] } {
  // 컨테이너 cap 의 soft overflow 비율. 운영 한도(60/28) 는 보수적이어서
  // 실무에서 5% 정도는 통상 허용. 부킹 묶음 보존을 위해 약간의 overflow 허용.
  const SOFT_OVERFLOW = 1.05;
  const unplacedItems: { cargo: CargoSpec; cbm: number }[] = [];

  // booking-aware: 같은 booking_no 의 cargo 가 어느 컨에 안착했는지 추적
  // visual 트랙에서 이미 배치된 booking 도 시작 시점에 미리 채워둠 (split 방지)
  const bookingAnchor = new Map<string, ContainerState>(initialBookingAnchor ?? []);

  // sticky container index — 한 번 다음 컨으로 넘어가면 되돌아가지 않음.
  // 실무자 분배 패턴 재현 (input 순서 + 컨테이너 채움 순서대로). 작은 cargo 가
  // 앞 컨의 빈 자리에 squeeze in 되어 booking 흐름을 깨는 것을 방지.
  let stickyIdx = 0;

  const placeOne = (
    cont: ContainerState,
    cg: CargoSpec,
    fill: number,
    cargoTotalCbm: number,
    shipperLabel: string,
  ): void => {
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
  };

  for (const cg of cargoes) {
    const cargoTotalCbm = cbmGetter(cg);
    let remaining = cargoTotalCbm;
    if (remaining <= 0) continue;
    const shipperLabel =
      cg.actualShipperName ?? cg.shipperName ?? cg.itemName ?? "";

    // 1) booking anchor 우선 — sticky 무관 (booking 묶음 보존)
    const anchor = cg.bookingNo ? bookingAnchor.get(cg.bookingNo) : null;
    if (anchor) {
      const used = computeContainerLoadedCbm(anchor);
      const cap = getContainerCbm(anchor.spec);
      const softFree = Math.max(0, cap * SOFT_OVERFLOW - used);
      if (softFree >= remaining) {
        placeOne(anchor, cg, remaining, cargoTotalCbm, shipperLabel);
        remaining = 0;
      }
    }

    // 2) sticky 시작점부터 시도 — softCap 안에 통째로 들어가야 함
    // **CBM 쪼개기 절대 금지**: 한 화물 행은 한 컨테이너에만 들어간다.
    // 어느 컨테이너에도 통째로 안 들어가면 unplaced 로 분류 (split fallback 없음).
    // 물리/실무 상식: 한 House B/L 화물 행을 두 컨에 나눠 출고할 수 없음.
    if (remaining > 0) {
      for (let i = stickyIdx; i < ordered.length && remaining > 0; i++) {
        const cont = ordered[i];
        const used = computeContainerLoadedCbm(cont);
        const cap = getContainerCbm(cont.spec);
        const softFree = Math.max(0, cap * SOFT_OVERFLOW - used);
        if (softFree >= remaining) {
          placeOne(cont, cg, remaining, cargoTotalCbm, shipperLabel);
          remaining = 0;
          if (i > stickyIdx) stickyIdx = i;
          if (cg.bookingNo && !bookingAnchor.has(cg.bookingNo)) {
            bookingAnchor.set(cg.bookingNo, cont);
          }
        }
        // 안 맞으면 다음 컨테이너 시도 (continue) — split 안 함
      }
    }

    if (remaining > 0.0001) {
      // 어느 컨에도 통째로 안 들어감 → 미배치. 사용자가 컨테이너 추가 또는 화물 조정 필요.
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
    // strictStackAudit 용 placement 좌표·무게 사본 (display 변환 무관, 원본 보존)
    placements: c.packState.placements.map((p) => ({
      cargoId: p.cargoId,
      shipper: p.shipper,
      weight: p.weight,
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      size: { width: p.size.width, length: p.size.length, height: p.size.height },
    })),
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
    | "shortest-height"
    | "heaviest";
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
  /**
   * Footprint cluster 사전 묶음 옵션 — 기본 활성 (큰 컨테이너에서만 발동).
   *
   * 룰 A: 같은 부킹의 동일 footprint unit 자체 컬럼 사전 적층.
   * 룰 B: 그 컬럼 위에 다른 부킹의 작은 footprint 박스 흡수 (받침 ≥ 70%).
   *
   * 활성 조건 (기본): 컨테이너 부피 ≥ 50 m³ + unit 풀 ≥ 5개.
   * 작은 시나리오 (1ST SG 등) 자동 비활성.
   *
   * 비활성: { enabled: false }
   */
  footprintCluster?: FootprintClusterOptions;
  /**
   * 장축 모서리 박음(long-axis anchor) 사전 패스 옵션 — **기본 비활성 (default off)**.
   *
   * 활성 조건: 호출자가 명시적으로 { enabled: true } 로 켤 때만 발동.
   * 그리고 화물 unit 중 최대 변 ≥ threshold (기본 300cm) 인 cargoId 가 있어야 의미 있음.
   *
   * 동작: 컨테이너 length 축에 가장 긴 변이 정렬되도록 강제 회전 + (x=0,y=0,z=0) 부터
   *       X 모서리 라인을 따라 차례 anchor. 한 cargoId atomic, 한 부킹 = 한 컨 보호.
   *
   * packBest 가 일반 매트릭스에서 미배치가 발생하면 자동 fallback 으로
   * { enabled: true } 1회 추가 시도. 일반 시나리오(이미 0 미배치) 는 영향 X.
   *
   * 활성: { enabled: true }
   */
  longAxisAnchor?: LongAxisAnchorOptions;
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

  // **Row 같은 평면 옆 컬럼 적층 (2026-05-12 추가)** — 첫 컬럼이 plannedStack 만큼 다 찼고
  // group 에 같은 cargoId + 같은 사이즈 unit 이 더 남았으면, 같은 row (y=첫 컬럼 y, z=0) 의
  // 옆 칸 (x = 첫 컬럼 x + 폭) 에 두 번째 컬럼 적층 시도.
  // 활성 조건: noStacking=false (이미 위에서 검사됨), 같은 사이즈 (allUnitsSameSize 보장).
  // VPHI 같은 케이스에서 같은 row 두 컬럼 옆에 적층하는 사용자 답안 패턴 재현.
  // 보수적: 같은 cargoId 안에서만, 한 row 안에서만 시도 (다른 row 줄바꿈은 기존 polish 단계에 위임).
  if (placed.length >= plannedStack && placed.length < group.length && chosenFace !== null) {
    // 첫 컬럼 baseline (placed[0]) 의 위치
    const baseFirst = host.packState.placements.find(
      (p) => p.unitId === placed[0].unitId,
    );
    if (baseFirst) {
      const colWidth = baseFirst.size.width;
      const colY = baseFirst.position.y;
      const colZ0 = 0;
      let nextColX = baseFirst.position.x + colWidth;
      // 컨 폭 안에 다음 컬럼 들어가나?
      while (
        placed.length < group.length &&
        nextColX + colWidth <= host.spec.innerWidth + STACK_EPS
      ) {
        // 이 컬럼 base 자리 후보 — 같은 (nextColX, colY, z=0) 강제
        const colBaseScore = (cand: { x: number; y: number; z: number }): number => {
          const exact =
            Math.abs(cand.x - nextColX) < STACK_EPS &&
            Math.abs(cand.y - colY) < STACK_EPS &&
            Math.abs(cand.z - colZ0) < STACK_EPS;
          return exact ? 0 : Number.POSITIVE_INFINITY;
        };
        const baseUnit = group[placed.length];
        if (
          !tryPlaceUnit(baseUnit, host.packState, host.spec, {
            scoreFn: colBaseScore,
            forceFaceIdx: chosenFace,
          })
        ) {
          break; // 다음 컬럼 base 못 박음 → 종료
        }
        let colAnchor = host.packState.placements[host.packState.placements.length - 1];
        placed.push(baseUnit);
        // 이 컬럼 위로 plannedStack-1 개 더 적층 시도
        for (let j = 1; j < plannedStack && placed.length < group.length; j++) {
          const u = group[placed.length];
          const tx = colAnchor.position.x;
          const ty = colAnchor.position.y;
          const tz = colAnchor.position.z + colAnchor.size.height;
          const stackScore = (cand: { x: number; y: number; z: number }): number => {
            const exact =
              Math.abs(cand.x - tx) < STACK_EPS &&
              Math.abs(cand.y - ty) < STACK_EPS &&
              Math.abs(cand.z - tz) < STACK_EPS;
            return exact ? 0 : Number.POSITIVE_INFINITY;
          };
          if (
            tryPlaceUnit(u, host.packState, host.spec, {
              scoreFn: stackScore,
              forceFaceIdx: chosenFace,
            })
          ) {
            colAnchor = host.packState.placements[host.packState.placements.length - 1];
            placed.push(u);
          } else {
            break;
          }
        }
        nextColX += colWidth;
      }
    }
  }

  const placedIds = new Set(placed.map((p) => p.unitId));
  return {
    placed,
    remaining: group.filter((u) => !placedIds.has(u.unitId)),
  };
}

/**
 * **자리 바꾸기 패스 (Stage 4 reposition)** — 미배치 화물이 있을 때 시도.
 *
 * 동작:
 *  1) 미배치 cargo u 마다, 각 컨테이너 c 마다, 그 안에 배치된 다른 cargo X 마다:
 *     a) c 의 packState 스냅샷
 *     b) packState 리셋 후 X 를 제외한 모든 cargo 재배치 (LDF 순)
 *     c) u 배치 시도 (cargo-atomic)
 *     d) X 다시 배치 시도 (cargo-atomic, 같은 컨)
 *     e) 다 성공하면 commit, 아니면 스냅샷 복원
 *  2) 발동 조건: unplaced > 0 (정상 케이스에선 발동 X)
 *  3) 점수 합산 X — 단순 lex (성공 했나? 미배치 줄었나?)
 *  4) fixedAssignment 존중 — 강제 매핑된 cargo 는 evict 후보에서 제외
 *
 * 비용: O(미배치 × 컨 × 배치cargo × 평균-replay-cost). 미배치 발생 시만 호출.
 */
function repositionUnplaced(
  containers: ContainerState[],
  unplaced: UnitItem[],
  unitsByCargoId: Map<string, UnitItem[]>,
  fixedMap: Record<string, number>,
): UnitItem[] {
  if (unplaced.length === 0) return unplaced;

  const restoreState = (state: ContainerPackState, snap: ContainerPackState): void => {
    state.placements = snap.placements;
    state.candidates = snap.candidates;
    state.totalWeight = snap.totalWeight;
    state.visualCbm = snap.visualCbm;
  };

  // 미배치 cargoId 별로 그룹화
  const unplacedByCargo = new Map<string, UnitItem[]>();
  for (const u of unplaced) {
    const list = unplacedByCargo.get(u.cargoId) ?? [];
    list.push(u);
    unplacedByCargo.set(u.cargoId, list);
  }

  const stillUnplaced: UnitItem[] = [];

  // LDF 정렬 (큰 부피부터 시도 — 작은 cargo 가 못 들어가면 큰 게 더 못 들어가므로 우선)
  const sortLDF = (units: UnitItem[]): UnitItem[] => {
    return [...units].sort((a, b) => {
      const va = b.width * b.length * b.height;
      const vb = a.width * a.length * a.height;
      return va - vb;
    });
  };

  // unplaced cargoId 정렬: 작은 부피부터 (끼우기 쉬운 것부터)
  const cargoOrder = [...unplacedByCargo.entries()].sort((a, b) => {
    const va = a[1][0].width * a[1][0].length * a[1][0].height;
    const vb = b[1][0].width * b[1][0].length * b[1][0].height;
    return va - vb;
  });

  for (const [unplacedCid, unplacedUnits] of cargoOrder) {
    let placed = false;

    // 각 컨테이너 시도 (fixedMap 존중)
    const eligibleConts = containers.filter((c) => {
      const f = fixedMap[unplacedCid];
      return f == null || f === c.index;
    });

    for (const cont of eligibleConts) {
      // 이 컨테이너에 배치된 cargoId 들 수집
      const cargosInCont = new Set<string>();
      for (const p of cont.packState.placements) cargosInCont.add(p.cargoId);
      if (cargosInCont.size === 0) continue;

      // evict 후보 우선순위: 미배치 cargo 의 부피가 크면 큰 cargo 먼저, 작으면 작은 cargo 먼저
      // (큰 cargo 끼우려면 큰 자리 필요 → 큰 cargo evict 가 더 효과)
      const unplacedVol =
        unplacedUnits[0].width *
        unplacedUnits[0].length *
        unplacedUnits[0].height *
        unplacedUnits.length;
      const evictCandidates = [...cargosInCont]
        .filter((cid) => cid !== unplacedCid)
        .filter((cid) => {
          const f = fixedMap[cid];
          return f == null || f === cont.index;
        })
        .sort((a, b) => {
          const ua = unitsByCargoId.get(a) ?? [];
          const ub = unitsByCargoId.get(b) ?? [];
          const va = (ua[0]?.width ?? 0) * (ua[0]?.length ?? 0) * (ua[0]?.height ?? 0) * ua.length;
          const vb = (ub[0]?.width ?? 0) * (ub[0]?.length ?? 0) * (ub[0]?.height ?? 0) * ub.length;
          // 미배치 부피와 비슷한 크기를 우선 (절댓값 차이 작은 순)
          return Math.abs(va - unplacedVol) - Math.abs(vb - unplacedVol);
        });

      // 단일 evict 시도만 (다중 evict 는 효과 미미 + 비용 큼 — 미사용)
      const evictTrials: string[][] = evictCandidates.map((cid) => [cid]);

      for (const evictGroup of evictTrials) {
        const evictSet = new Set(evictGroup);
        const snap = structuredClone(cont.packState);

        // Step 1: packState 리셋 후 evict 제외 모든 cargo 재배치 (LDF)
        const replayCargoIds = [...cargosInCont].filter((c) => !evictSet.has(c));
        const replayUnits = sortLDF(
          replayCargoIds.flatMap((cid) => unitsByCargoId.get(cid) ?? []),
        );

        cont.packState = makeContainerState();
        let allReplayed = true;
        for (const u of replayUnits) {
          if (
            !tryPlaceUnit(u, cont.packState, cont.spec) &&
            !tryPlaceUnitBruteForce(u, cont.packState, cont.spec)
          ) {
            allReplayed = false;
            break;
          }
        }
        if (!allReplayed) {
          restoreState(cont.packState, snap);
          continue;
        }

        // Step 2: 미배치 cargo 시도 (bundle stack 우선 — column 효율)
        let unplacedOk = true;
        if (unplacedUnits.length >= 2 && !unplacedUnits[0].remarks.noStacking) {
          let remainingGroup = unplacedUnits.slice();
          while (remainingGroup.length >= 2) {
            const result = tryBundleStack(remainingGroup, [cont]);
            if (result.placed.length === 0) break;
            remainingGroup = result.remaining;
          }
          for (const u of remainingGroup) {
            if (
              !tryPlaceUnit(u, cont.packState, cont.spec) &&
              !tryPlaceUnitBruteForce(u, cont.packState, cont.spec)
            ) {
              unplacedOk = false;
              break;
            }
          }
        } else {
          for (const u of unplacedUnits) {
            if (
              !tryPlaceUnit(u, cont.packState, cont.spec) &&
              !tryPlaceUnitBruteForce(u, cont.packState, cont.spec)
            ) {
              unplacedOk = false;
              break;
            }
          }
        }
        if (!unplacedOk) {
          restoreState(cont.packState, snap);
          continue;
        }

        // Step 3: evict 된 모든 cargo 다시 배치 (같은 컨, 큰 것부터, bundle stack 우선)
        let evictOk = true;
        const evictGroupSorted = [...evictGroup].sort((a, b) => {
          const ua = unitsByCargoId.get(a) ?? [];
          const ub = unitsByCargoId.get(b) ?? [];
          const va = (ua[0]?.width ?? 0) * (ua[0]?.length ?? 0) * (ua[0]?.height ?? 0) * ua.length;
          const vb = (ub[0]?.width ?? 0) * (ub[0]?.length ?? 0) * (ub[0]?.height ?? 0) * ub.length;
          return vb - va; // descending — 큰 evict 먼저
        });
        for (const eCid of evictGroupSorted) {
          const evictUnits = unitsByCargoId.get(eCid) ?? [];
          if (evictUnits.length >= 2 && !evictUnits[0].remarks.noStacking) {
            let remainingEvict = evictUnits.slice();
            while (remainingEvict.length >= 2) {
              const result = tryBundleStack(remainingEvict, [cont]);
              if (result.placed.length === 0) break;
              remainingEvict = result.remaining;
            }
            for (const u of remainingEvict) {
              if (
                !tryPlaceUnit(u, cont.packState, cont.spec) &&
                !tryPlaceUnitBruteForce(u, cont.packState, cont.spec)
              ) {
                evictOk = false;
                break;
              }
            }
          } else {
            for (const u of evictUnits) {
              if (
                !tryPlaceUnit(u, cont.packState, cont.spec) &&
                !tryPlaceUnitBruteForce(u, cont.packState, cont.spec)
              ) {
                evictOk = false;
                break;
              }
            }
          }
          if (!evictOk) break;
        }
        if (!evictOk) {
          restoreState(cont.packState, snap);
          continue;
        }

        // SUCCESS
        placed = true;
        break;
      }

      if (placed) break;
    }

    if (!placed) {
      stillUnplaced.push(...unplacedUnits);
    }
  }

  return stillUnplaced;
}

/**
 * 메인 진입점.
 * 점수 없이 결정적 룰로 한 번에 패킹.
 */
/**
 * 한 cargo 의 unitSizes 안에 cargoType 다른 박스가 섞여 있으면 cargoType 별로 cargo 분리.
 * 예: cargo[PL, unitSizes={A:PL, B:PL, C:CT}] → cargo[PL,{A,B}] + cargo[CT,{C}]
 *
 * 분리 후 각 새 cargo 는:
 *  - id 에 cargoType 소문자 suffix (예: 원본-pl, 원본-ct) — 추적용
 *  - cargoType 갱신, unitSizes 그룹화 (각 unit.cargoType 은 비움)
 *  - quantity = 그룹 박스 수 합
 *  - cbm/aboutCbm = 원본 × 그룹 박스 수 / 전체 박스 수 (비율 분배)
 *  - weightPerUnit = 그대로 (단위당 무게 비율 무관)
 *
 * unitSizes 가 비었거나 cargoType 모두 같으면 입력 그대로 통과 (회귀 X).
 */
export function splitCargoesByUnitCargoType(
  cargoes: CargoSpec[],
): CargoSpec[] {
  const out: CargoSpec[] = [];
  for (const cargo of cargoes) {
    if (!cargo.unitSizes || cargo.unitSizes.length === 0) {
      out.push(cargo);
      continue;
    }
    // cargoType 별로 unitSizes 그룹화 (미지정은 cargo.cargoType 으로 폴백)
    const groups = new Map<CargoType, UnitSize[]>();
    for (const u of cargo.unitSizes) {
      const t: CargoType = u.cargoType ?? cargo.cargoType;
      const list = groups.get(t) ?? [];
      list.push(u);
      groups.set(t, list);
    }
    if (groups.size <= 1) {
      // 모두 같은 cargoType — 분리 X, 그대로
      out.push(cargo);
      continue;
    }
    // 분리
    const totalQty = cargo.unitSizes.reduce((s, u) => s + u.quantity, 0);
    for (const [type, units] of groups) {
      const subQty = units.reduce((s, u) => s + u.quantity, 0);
      const ratio = totalQty > 0 ? subQty / totalQty : 0;
      out.push({
        ...cargo,
        id: `${cargo.id}-${String(type).toLowerCase()}`,
        cargoType: type,
        unitSizes: units.map((u) => ({ ...u, cargoType: undefined })),
        quantity: subQty,
        cbm: cargo.cbm != null ? cargo.cbm * ratio : cargo.cbm,
        aboutCbm:
          cargo.aboutCbm != null ? cargo.aboutCbm * ratio : cargo.aboutCbm,
      });
    }
  }
  return out;
}

export function pack(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options?: PackOptions,
): CLPResult {
  // brute-force 호출 budget 카운터 리셋 (per pack-attempt)
  resetBruteForceBudget();

  // unitSizes 안 cargoType 다른 박스 분리 (없으면 그대로)
  cargoes = splitCargoesByUnitCargoType(cargoes);

  // 같은 부킹 + 같은 화주 안에서 한 행만 무게/CBM/ABOUT 몰려있으면 수량 비율로 자동 분배
  cargoes = distributeBookingValues(cargoes).cargoes;

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
        case "heaviest": {
          // 무거운 거 먼저 — 무거운 박스가 z=0 (바닥) 자리 우선 점유 → 가벼운 박스가
          // 위로 자연 쌓임. 컬럼 안 무거운 거 아래 자동 정렬.
          // 동률(같은 무게)은 부피 desc → 긴 변 desc 로 tiebreak (ldf 와 동일).
          if (b.weight !== a.weight) return b.weight - a.weight;
          const va = a.width * a.length * a.height;
          const vb = b.width * b.length * b.height;
          if (vb !== va) return vb - va;
          const longA = Math.max(a.width, a.length, a.height);
          const longB = Math.max(b.width, b.length, b.height);
          return longB - longA;
        }
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
  // 클러스터링 — 1) booking → 2) shipper → 3) cargoId → 4) LDF rank
  // 같은 booking 화물 묶음 우선 (실무 출고/검수/통관 단위)
  const sortClustered = (units: UnitItem[]): UnitItem[] => {
    const ldf = sortBig(units);
    const bookingFirst = new Map<string, number>();
    const shipperFirst = new Map<string, number>();
    const cargoFirst = new Map<string, number>();
    const ldfRank = new Map<string, number>();
    ldf.forEach((u, idx) => {
      // bookingNo 없는 unit 은 빈 문자열로 처리 — 같이 묶이지만 priority 마지막
      const bk = u.bookingNo ?? "";
      if (!bookingFirst.has(bk)) bookingFirst.set(bk, idx);
      if (!shipperFirst.has(u.shipper)) shipperFirst.set(u.shipper, idx);
      if (!cargoFirst.has(u.cargoId)) cargoFirst.set(u.cargoId, idx);
      ldfRank.set(u.unitId, idx);
    });
    return [...ldf].sort((a, b) => {
      const aBk = a.bookingNo ?? "";
      const bBk = b.bookingNo ?? "";
      // 빈 booking 은 후순위 (있는 것 먼저)
      if ((aBk === "") !== (bBk === "")) return aBk === "" ? 1 : -1;
      const ba = bookingFirst.get(aBk) ?? 0;
      const bb = bookingFirst.get(bBk) ?? 0;
      if (ba !== bb) return ba - bb;
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

  // **부킹 인접 룰 (visual 트랙)** — 같은 bookingNo 의 cargo 가 한 컨에 처음 안착하면
  // 그 컨을 anchor 로 기록. 같은 booking 의 후속 cargo 는 anchor 컨 만 후보로 강제.
  // 효과: AUTO 모드에서 booking 분리 (같은 House B/L 다른 컨테이너) 방지.
  // fixedMap (사용자 명시) 는 더 우선. anchor 컨에 안 들어가면 cargo 전체 unplaced (split 금지).
  const bookingAnchor = new Map<string, ContainerState>();

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

  // 동종(같은 spec) 컨테이너 그룹 안에서 현재 적재량(visual+ct) 낮은 쪽을 앞으로 — 균형 분배
  // 다른 spec 끼리는 base 순서 유지 (예: 40FT vs 20FT 의 routing 우선순위는 그대로)
  const balanceSortSameType = (list: ContainerState[]): ContainerState[] => {
    if (list.length < 2) return list;
    const out = [...list];
    out.sort((a, b) => {
      // base 순서 보존 — 같은 spec 일 때만 적재량 비교
      if (a.spec.type !== b.spec.type) return list.indexOf(a) - list.indexOf(b);
      const loadA = a.packState.visualCbm + a.ctCbm;
      const loadB = b.packState.visualCbm + b.ctCbm;
      if (loadA !== loadB) return loadA - loadB;
      return list.indexOf(a) - list.indexOf(b);
    });
    return out;
  };

  const candidatesFor = (u: UnitItem): ContainerState[] => {
    const idx = fixedMap[u.cargoId];
    if (typeof idx === "number") {
      const target = visualContainers.find((c) => c.index === idx);
      return target ? [target] : [];
    }
    // booking anchor — 같은 booking 이 이전에 어느 컨에 안착했으면 그 컨만 후보
    // (fixedMap 보다는 후순위, autoDesignatedIdx 보다는 우선)
    if (u.bookingNo) {
      const anchorCont = bookingAnchor.get(u.bookingNo);
      if (anchorCont && visualContainers.includes(anchorCont)) {
        return [anchorCont];
      }
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
        return designated ? [designated] : balanceSortSameType(orderedContainers);
      }
      return designated
        ? [...balanceSortSameType(others), designated]
        : balanceSortSameType(orderedContainers);
    }
    return balanceSortSameType(orderedContainers);
  };

  // (4) 모드별 placement
  //   "wrapper" — 클러스터링/묶음 stack/sub-bucket/brute-force fallback 모두 적용
  //   "pure"    — 단순 LDF + tryPlaceUnit (작은 케이스에서 wrapper 가 손해보는 경우용)
  const mode_placement = options?.placementMode ?? "wrapper";
  // **CBM 쪼개기 절대 금지** (Visual 트랙):
  // 한 cargoId 의 모든 unit 은 한 컨테이너 안에 통째로 들어가야 한다.
  // 후보 컨테이너에 packState 스냅샷을 떠 두고, 모든 unit 배치 시도 후
  // 하나라도 실패하면 스냅샷으로 복원 → 다음 후보로 이동. 어느 후보도
  // 통째 못 받으면 그 cargo 의 모든 unit 을 unplaced 로 분류.
  // 통로 A (allocateBulkGroup) 의 안전마진/통째 fit 룰을 통로 B 에도 동일 적용.
  const restoreState = (state: ContainerPackState, snap: ContainerPackState): void => {
    state.placements = snap.placements;
    state.candidates = snap.candidates;
    state.totalWeight = snap.totalWeight;
    state.visualCbm = snap.visualCbm;
  };

  // booking anchor 갱신 — cargo 가 컨테이너에 atomic 통째로 들어간 직후 호출.
  // 같은 booking 의 첫 cargo 만 anchor 로 등록 (이미 있으면 무시). 후속 같은 booking
  // cargo 는 candidatesFor 에서 anchor 컨만 후보로 받음.
  const recordBookingAnchor = (u: UnitItem, cont: ContainerState): void => {
    if (u.bookingNo && !bookingAnchor.has(u.bookingNo)) {
      bookingAnchor.set(u.bookingNo, cont);
    }
  };

  // **묶음 완화 룰 (column stack 우선화)**:
  // 같은 cargoId 의 unit 이 한 column 에 못 쌓이고 fallback 으로 갈 때,
  // 이미 배치된 같은 cargoId placement 의 **위 (top z)** 좌표를 우선 시도.
  // 못 올리면 그 다음으로 anchor 옆자리 시도.
  // 효과: 같은 화주 박스가 옆으로 펼쳐지지 않고 위로 column stack 우선됨.
  const tryPlaceUnitWithProximity = (
    u: UnitItem,
    state: ContainerPackState,
    spec: ContainerSpec,
    anchor: { x: number; y: number; z: number } | undefined,
  ): boolean => {
    if (!anchor) return tryPlaceUnit(u, state, spec);
    // anchor (이전 박스 위) 와 가까운 extreme point 선호 (Manhattan 3D 거리)
    const scoreFn = (c: { x: number; y: number; z: number }): number => {
      return Math.abs(c.x - anchor.x) + Math.abs(c.y - anchor.y) + Math.abs(c.z - anchor.z);
    };
    return tryPlaceUnit(u, state, spec, { scoreFn });
  };
  const placeQueuePure = (queue: UnitItem[]): void => {
    // Pure 모드는 클러스터링 무시하고 LDF 만 — 작은 케이스에서 wrapper 모드 손해보는 경우용
    const ldfQueue = sortBig(queue);
    // cargoId 단위로 묶어서 atomic 배치 (쪼개기 금지)
    const cargoOrder: string[] = [];
    const cargoUnits = new Map<string, UnitItem[]>();
    for (const u of ldfQueue) {
      if (!cargoUnits.has(u.cargoId)) {
        cargoUnits.set(u.cargoId, []);
        cargoOrder.push(u.cargoId);
      }
      cargoUnits.get(u.cargoId)!.push(u);
    }
    for (const cid of cargoOrder) {
      const units = cargoUnits.get(cid)!;
      const candidates = candidatesFor(units[0]);

      // **atomic 완화** — 단일 candidate 일 때 cross-container split 위험 X.
      //   직접 배치, 실패 unit 만 unplaced 처리 (partial OK).
      if (candidates.length === 1) {
        const c = candidates[0];
        recordBookingAnchor(units[0], c); // booking anchor 갱신
        let anchor: { x: number; y: number; z: number } | undefined;
        for (const u of units) {
          const ok = tryPlaceUnitWithProximity(u, c.packState, c.spec, anchor) ||
                     tryPlaceUnitBruteForce(u, c.packState, c.spec);
          if (!ok) {
            unplaced.push(u);
          } else if (!anchor) {
            const lastP = c.packState.placements[c.packState.placements.length - 1];
            if (lastP) anchor = {
              x: lastP.position.x,
              y: lastP.position.y,
              z: lastP.position.z + lastP.size.height,
            };
          }
        }
        continue;
      }

      let placedAll = false;
      for (const c of candidates) {
        const snap = structuredClone(c.packState);
        let allOk = true;
        let anchor: { x: number; y: number; z: number } | undefined;
        for (const u of units) {
          // 묶음 완화 — 같은 cargoId 의 첫 unit 위 (top z) 를 anchor 로 잡아 column stack 우선
          const ok = tryPlaceUnitWithProximity(u, c.packState, c.spec, anchor) ||
                     tryPlaceUnitBruteForce(u, c.packState, c.spec);
          if (!ok) {
            allOk = false;
            break;
          }
          if (!anchor) {
            const lastP = c.packState.placements[c.packState.placements.length - 1];
            if (lastP) anchor = {
              x: lastP.position.x,
              y: lastP.position.y,
              z: lastP.position.z + lastP.size.height,
            };
          }
        }
        if (allOk) {
          placedAll = true;
          recordBookingAnchor(units[0], c); // booking anchor 갱신
          break;
        }
        restoreState(c.packState, snap);
      }
      if (!placedAll) {
        for (const u of units) unplaced.push(u);
      }
    }
  };

  // (4-wrapper) 묶음 우선 + 자유 배치 fallback — **cargoId-atomic**
  //
  // 순서 (cargoId 별로 통째 배치):
  //   ① 같은 cargoId 의 sized-bucket 들을 모음
  //   ② 후보 컨테이너 우선순위대로 한 컨씩 시도하며 packState 스냅샷
  //   ③ 그 컨에 모든 unit (bundle stack + 솔로 fallback) 통째로 시도
  //   ④ 다 들어가면 commit, 하나라도 실패하면 스냅샷으로 복원 → 다음 후보
  //   ⑤ 어느 후보도 통째 못 받으면 cargo 전체 unplaced (쪼개기 금지)
  const placeQueueWrapper = (queue: UnitItem[]): void => {
    // 그룹 분할: 같은 cargoId 안에서도 (w,l,h) 가 다른 unit 이 섞여 있을 수 있다
    // (unitSizes 케이스). 사이즈별로 sub-bucket 만들어 묶음 적격성 판단.
    const groups = groupByCargoId(queue);
    type Bucket = { units: UnitItem[]; bundleEligible: boolean };
    type CargoGroup = { cargoId: string; buckets: Bucket[]; firstUnit: UnitItem };
    const cargoGroups: CargoGroup[] = [];
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
      const buckets: Bucket[] = [];
      for (const b of sizeBuckets.values()) {
        buckets.push({
          units: b,
          bundleEligible: b.length >= 2 && !b[0].remarks.noStacking,
        });
      }
      cargoGroups.push({ cargoId: g[0].cargoId, buckets, firstUnit: g[0] });
    }

    // cargo-group 들 정렬:
    //   1순위 — 자동마감 active 시 입고완료 cargo 가 먼저 (designated 컨 자리 선점)
    //   2순위 — LDF/클러스터 순서 (queue 인덱스)
    const queueIdx = new Map<string, number>();
    queue.forEach((u, i) => queueIdx.set(u.unitId, i));
    cargoGroups.sort((a, b) => {
      const aCompleted = completedCargoIds.has(a.cargoId);
      const bCompleted = completedCargoIds.has(b.cargoId);
      if (aCompleted !== bCompleted) {
        if (autoDesignatedIdx != null) return aCompleted ? -1 : 1;
      }
      const ai = Math.min(
        ...a.buckets.flatMap((bk) => bk.units.map((u) => queueIdx.get(u.unitId) ?? 0)),
      );
      const bi = Math.min(
        ...b.buckets.flatMap((bk) => bk.units.map((u) => queueIdx.get(u.unitId) ?? 0)),
      );
      return ai - bi;
    });

    // **atomic 완화 + unit-LDF interleave 모드 (fixedAssignment 전용)**:
    // fixedAssignment 로 컨테이너 강제된 cargo 만 unit-LDF interleave.
    // autoConsolidate / topOnly routing 같은 자연 single-cand 케이스는 제외 (회귀 방지).
    // → 사용자 강제 분배에서 cross-container split 위험 X. partial cargo placement 허용.
    const singleCandPerContainer = new Map<ContainerState, CargoGroup[]>();
    const multiCandGroups: CargoGroup[] = [];
    const hasFixed = Object.keys(fixedMap).length > 0;
    for (const cg of cargoGroups) {
      const cands = candidatesFor(cg.firstUnit);
      // fixedMap 으로 강제된 cargo 만 unit-LDF 모드 적용
      if (cands.length === 1 && hasFixed && typeof fixedMap[cg.cargoId] === "number") {
        const list = singleCandPerContainer.get(cands[0]) ?? [];
        list.push(cg);
        singleCandPerContainer.set(cands[0], list);
      } else {
        multiCandGroups.push(cg);
      }
    }
    // 컨테이너별 unit-LDF interleave (fixedAssignment 그룹만)
    for (const [cand, groups] of singleCandPerContainer) {
      // Step 1: 같은 cargoId multi-unit 의 column stack 우선 (bundle stack)
      const fallbackUnits: UnitItem[] = [];
      for (const cg of groups) {
        for (const bucket of cg.buckets) {
          if (bucket.bundleEligible) {
            let remaining = bucket.units;
            while (remaining.length >= 2) {
              const result = tryBundleStack(remaining, [cand]);
              if (result.placed.length === 0) break;
              remaining = result.remaining;
            }
            for (const u of remaining) fallbackUnits.push(u);
          } else {
            for (const u of bucket.units) fallbackUnits.push(u);
          }
        }
      }
      // Step 2: 남은 unit LDF (막대형 우선, tall-first, 부피 desc)
      const pool = fallbackUnits;
      // 정렬 우선순위:
      //   1순위: 막대형 (가장 긴 변이 컨테이너 폭 234 초과) — 회전·column stack 강제 필요
      //   2순위: tall-first (h≥100) — 자리 fix 우선
      //   3순위: 부피 desc (LDF) — 큰 박스부터
      // 실험 검증: 1ST SG 39/39, 3ST SG 막대형 (세아특수강 322×42×41) 컬럼 stack 필요
      const unitLdf = [...pool].sort((a, b) => {
        const aLongest = Math.max(a.width, a.length, a.height);
        const bLongest = Math.max(b.width, b.length, b.height);
        const aRod = aLongest > 234 ? 1 : 0;
        const bRod = bLongest > 234 ? 1 : 0;
        if (aRod !== bRod) return bRod - aRod;
        const aTall = a.height >= 100 ? 1 : 0;
        const bTall = b.height >= 100 ? 1 : 0;
        if (aTall !== bTall) return bTall - aTall;
        return (b.width * b.length * b.height) - (a.width * a.length * a.height);
      });
      for (const u of unitLdf) {
        const ok = tryPlaceUnit(u, cand.packState, cand.spec) ||
                   tryPlaceUnitBruteForce(u, cand.packState, cand.spec);
        if (!ok) unplaced.push(u);
        else recordBookingAnchor(u, cand); // booking anchor 갱신
      }
    }
    // 나머지 cargo 는 기존 atomic 루프로 처리
    if (multiCandGroups.length === 0) return;

    // cargoId 별 atomic 배치 (multi-cand 만)
    for (const cg of multiCandGroups) {
      const candidates = candidatesFor(cg.firstUnit);

      // **atomic 완화** — 단일 candidate 케이스는 위에서 처리됨. 여기 안 올 것.
      if (candidates.length === 1) {
        const cand = candidates[0];
        recordBookingAnchor(cg.firstUnit, cand); // booking anchor 갱신
        const candList = [cand];
        // bundle stack — 같은 cargoId 의 column stack 우선
        const fbUnits: UnitItem[] = [];
        for (const bucket of cg.buckets) {
          if (bucket.bundleEligible) {
            let remaining = bucket.units;
            while (remaining.length >= 2) {
              const result = tryBundleStack(remaining, candList);
              if (result.placed.length === 0) break;
              remaining = result.remaining;
            }
            for (const u of remaining) fbUnits.push(u);
          } else {
            for (const u of bucket.units) fbUnits.push(u);
          }
        }
        // 같은 cargoId 의 첫 placement 위 (top z) 를 anchor 로
        const localAnchor = new Map<string, { x: number; y: number; z: number }>();
        for (const p of cand.packState.placements) {
          if (!localAnchor.has(p.cargoId)) {
            localAnchor.set(p.cargoId, {
              x: p.position.x,
              y: p.position.y,
              z: p.position.z + p.size.height,
            });
          }
        }
        fbUnits.sort(
          (a, b) => (queueIdx.get(a.unitId) ?? 0) - (queueIdx.get(b.unitId) ?? 0),
        );
        for (const u of fbUnits) {
          const anchor = localAnchor.get(u.cargoId);
          const ok = tryPlaceUnitWithProximity(u, cand.packState, cand.spec, anchor) ||
                     tryPlaceUnitBruteForce(u, cand.packState, cand.spec);
          if (!ok) {
            unplaced.push(u);
          } else if (!anchor) {
            const lastP = cand.packState.placements[cand.packState.placements.length - 1];
            if (lastP) localAnchor.set(u.cargoId, {
              x: lastP.position.x,
              y: lastP.position.y,
              z: lastP.position.z + lastP.size.height,
            });
          }
        }
        continue; // 다음 cargoGroup
      }

      let placedAll = false;
      for (const cand of candidates) {
        const snap = structuredClone(cand.packState);
        const candList = [cand]; // 단일 컨테이너로 강제

        // bucket 처리: bundle stack → 남은 솔로 → fallback
        const fallbackUnits: UnitItem[] = [];
        let allOk = true;
        for (const bucket of cg.buckets) {
          if (bucket.bundleEligible) {
            let remainingGroup = bucket.units;
            while (remainingGroup.length >= 2) {
              const result = tryBundleStack(remainingGroup, candList);
              if (result.placed.length === 0) break;
              remainingGroup = result.remaining;
            }
            for (const u of remainingGroup) fallbackUnits.push(u);
          } else {
            for (const u of bucket.units) fallbackUnits.push(u);
          }
        }
        // fallback unit — 단일 컨테이너로만 시도
        // 묶음 완화 — 이미 배치된 같은 cargoId placement 와 가까운 extreme point 우선
        fallbackUnits.sort(
          (a, b) => (queueIdx.get(a.unitId) ?? 0) - (queueIdx.get(b.unitId) ?? 0),
        );
        // 같은 cargoId 의 첫 placement 위 (top z) 를 anchor 로 (bundle 결과 포함)
        // 효과: 후속 unit 이 이전 박스 위 (column stack) 우선 시도
        const cargoAnchor = new Map<string, { x: number; y: number; z: number }>();
        for (const p of cand.packState.placements) {
          if (!cargoAnchor.has(p.cargoId)) {
            cargoAnchor.set(p.cargoId, {
              x: p.position.x,
              y: p.position.y,
              z: p.position.z + p.size.height,
            });
          }
        }
        for (const u of fallbackUnits) {
          const anchor = cargoAnchor.get(u.cargoId);
          const ok = tryPlaceUnitWithProximity(u, cand.packState, cand.spec, anchor) ||
                     tryPlaceUnitBruteForce(u, cand.packState, cand.spec);
          if (!ok) {
            allOk = false;
            break;
          }
          if (!anchor) {
            const lastP = cand.packState.placements[cand.packState.placements.length - 1];
            if (lastP) cargoAnchor.set(u.cargoId, {
              x: lastP.position.x,
              y: lastP.position.y,
              z: lastP.position.z + lastP.size.height,
            });
          }
        }

        if (allOk) {
          placedAll = true;
          recordBookingAnchor(cg.firstUnit, cand); // booking anchor 갱신
          break;
        }
        restoreState(cand.packState, snap);
      }

      if (!placedAll) {
        for (const bucket of cg.buckets) {
          for (const u of bucket.units) unplaced.push(u);
        }
      }
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
    // **Footprint cluster 사전 묶음 (룰 A + 룰 B)** — wrapper 모드 전용, 큰 컨테이너만
    //
    // 큰 컨테이너 (40FT TOTAL 등) 에서 마지막 1~2 박스 미배치 잔존 문제를
    // 사전 footprint 컬럼 묶음으로 해결. 기본 활성, options.footprintCluster.enabled=false 로 비활성.
    //
    // 동일 부킹 내 동일 footprint (±5cm) unit 들을 자체 column 적층 (heavierBelow 통과 +
    // door 높이 ≤ doorHeight) → 그 column 위에 다른 부킹의 작은 footprint 박스 흡수
    // (받침 ≥ 70%, 한 부킹 = 한 컨 보호).
    //
    // 활성 조건 (보수적): 컨테이너 ≥ 50 m³ + unit 풀 ≥ 5개. 1ST SG 같은 작은 시나리오 영향 X.
    const fpClusterEnabled = options?.footprintCluster?.enabled !== false;
    const placedByPreCluster = new Set<string>();

    // **장축 모서리 박음 (long-axis anchor) 사전 패스** — wrapper 모드 전용.
    //
    // footprint-cluster 보다 먼저 발동. 단행 막대형(311cm 같은) 박스가 작은 박스에
    // 자리를 빼앗기지 않도록 컨테이너 length 축 모서리 라인을 따라 가장 먼저 anchor.
    // 한 cargoId atomic + 한 부킹 = 한 컨 보호 + CBM 쪼개기 금지.
    // 활성 조건 (강화): unit 중 최대 변 ≥ threshold (기본 300cm) **AND** 컨 길이의 25%
    // 이상 **AND** 막대 형상 비율 (min/max) ≤ 0.25 인 진짜 가는 막대형만
    // (long-axis-anchor.ts findLongAxisCargoes 에서 추가 검사 — 큐브형 회귀 방지).
    // 기본 활성 (default ON, 2026-05-08 변경). 사용자가 명시적으로 enabled: false 지정해야 OFF.
    // packBest 의 fallback (미배치 발생 시 재시도) 도 그대로 유지 (이중 보호).
    const longAxisEnabled = options?.longAxisAnchor?.enabled !== false;
    if (longAxisEnabled && mode_placement === "wrapper") {
      for (const cont of orderedContainers) {
        const pool = generalUnits.filter((u) => {
          if (placedByPreCluster.has(u.unitId)) return false;
          const cands = candidatesFor(u);
          return cands.includes(cont);
        });
        if (pool.length === 0) continue;
        const placedIds = anchorLongAxisCargoes(
          cont,
          pool,
          options?.longAxisAnchor,
        );
        for (const id of placedIds) {
          placedByPreCluster.add(id);
          const u = pool.find((x) => x.unitId === id);
          if (u) recordBookingAnchor(u, cont);
        }
      }
    }

    if (fpClusterEnabled && mode_placement === "wrapper") {
      for (const cont of orderedContainers) {
        // 이 컨테이너에 후보로 들어갈 수 있는 generalUnits 풀 산출
        const pool = generalUnits.filter((u) => {
          if (placedByPreCluster.has(u.unitId)) return false;
          const cands = candidatesFor(u);
          return cands.includes(cont);
        });
        if (pool.length === 0) continue;
        const placedIds = preClusterFootprint(
          cont,
          pool,
          options?.footprintCluster,
        );
        for (const id of placedIds) {
          placedByPreCluster.add(id);
          // booking anchor 갱신 — placement 직접 push 했으므로 컨테이너 결정 기록
          const u = pool.find((x) => x.unitId === id);
          if (u) recordBookingAnchor(u, cont);
        }
      }
    }
    const placeQueue =
      mode_placement === "pure" ? placeQueuePure : placeQueueWrapper;
    placeQueue(generalUnits.filter((u) => !placedByPreCluster.has(u.unitId)));
    placeQueue(topOnlyUnits.filter((u) => !placedByPreCluster.has(u.unitId)));
  }

  // 5.44) **룰 G — Row-lane 묶음 (preClusterRowLane)** — wrapper 전용 fallback (룰 F 직전)
  //
  // 같은 cargoId 의 박스가 noStacking=true 라서 위로 못 쌓을 때, 두 컬럼을 폭 방향 옆으로
  // 깔고 각 컬럼 안에서 박스를 길이(y) 방향으로 직렬 배치. 모든 박스 z=0 강제.
  // pickLaneFace 가 eff.width 작은 면을 골라 두 컬럼 폭 합 ≤ 컨 안쪽 폭 보장.
  //
  // 사례: SK GEO CENTRIC (FBSIN260431) sg3-35 — 137×115×85 ×1 + 135×115×129 ×2 noStacking=true.
  //   face 1(L×W) 회전 → 폭 115, 두 컬럼 230 ≤ 234. 첫 컬럼 137 ×1, 둘째 컬럼 135+135 직렬.
  //
  // 활성 조건 10개 모두 검증 (footprint-cluster.ts 룰 G 섹션 참조). 회귀 위험 없음 — 룰 F 보다
  // 먼저 시도하되 cargoId atomic 보호 (실패 시 전체 롤백) 로 다른 단계 영향 없음.
  if (
    unplaced.length > 0 &&
    mode_placement === "wrapper" &&
    options?.footprintCluster?.enabled !== false
  ) {
    // 미배치 cargoId 별 unit 모음
    const unplacedByCargoIdG = new Map<string, UnitItem[]>();
    for (const u of unplaced) {
      const list = unplacedByCargoIdG.get(u.cargoId) ?? [];
      list.push(u);
      unplacedByCargoIdG.set(u.cargoId, list);
    }
    // 미배치 cargo 가 가야 할 컨테이너 결정 (fixedMap 우선, 없으면 booking anchor, 없으면 모든 컨테이너)
    const cargoTargetContG = new Map<string, ContainerState>();
    for (const cid of unplacedByCargoIdG.keys()) {
      const fix = fixedMap[cid];
      if (typeof fix === "number") {
        const target = containers.find((c) => c.index === fix);
        if (target) {
          cargoTargetContG.set(cid, target);
          continue;
        }
      }
      // fallback 1: 같은 booking 이 이미 안착한 컨테이너
      const us = unplacedByCargoIdG.get(cid);
      const bk = us?.[0]?.bookingNo;
      if (bk) {
        const anchor = bookingAnchor.get(bk);
        if (anchor && containers.includes(anchor)) {
          cargoTargetContG.set(cid, anchor);
        }
      }
    }
    // fallback 2: 위 두 단계로도 매핑 안 된 cargo → 모든 컨테이너에 시도 (자리 잡으면 첫 컨에 배치)
    const targetContsG = new Set<ContainerState>(cargoTargetContG.values());
    const unmappedCargoIdsG = new Set<string>();
    for (const cid of unplacedByCargoIdG.keys()) {
      if (!cargoTargetContG.has(cid)) {
        unmappedCargoIdsG.add(cid);
        // 모든 컨테이너를 후보에 추가 (첫 컨테이너부터 시도)
        for (const cont of containers) targetContsG.add(cont);
      }
    }
    for (const cont of targetContsG) {
      // 이 컨에 가야 할 미배치 unit 만 풀에 (룰 G 는 same cargoId 만)
      const cargoIdsForThisContG = new Set<string>();
      for (const [cid, c] of cargoTargetContG) {
        if (c === cont) cargoIdsForThisContG.add(cid);
      }
      const poolG: UnitItem[] = [];
      for (const cid of cargoIdsForThisContG) {
        const us = unplacedByCargoIdG.get(cid);
        if (us) poolG.push(...us);
      }
      // unmapped cargo (fixedMap·anchor 둘 다 없는 것) 매 컨테이너마다 시도
      for (const cid of unmappedCargoIdsG) {
        const us = unplacedByCargoIdG.get(cid);
        if (us && us.every((u) => unplaced.includes(u))) {
          poolG.push(...us);
        }
      }
      if (poolG.length === 0) continue;
      const placedIdsG = preClusterRowLane(
        cont,
        poolG,
        options?.footprintCluster,
      );
      if (placedIdsG.size > 0) {
        const remainingG = unplaced.filter((u) => !placedIdsG.has(u.unitId));
        unplaced.length = 0;
        for (const u of remainingG) unplaced.push(u);
        for (const id of placedIdsG) {
          const u = poolG.find((x) => x.unitId === id);
          if (u) recordBookingAnchor(u, cont);
        }
      }
    }
  }

  // 5.45) **룰 F — 근사 footprint 적층 묶음 (nearFootprintStackBundle)** — wrapper 전용 fallback
  //
  // 활성 조건 10: 룰 E (exact W·L·H 동일) 후 unplaced 가 남았을 때만 발동.
  // 같은 booking + cargoId atomic + W/L 차이 ≤ 5cm 까지 허용 (높이 다름 OK).
  // 활성 조건 5+6+7+8 모두 적층 단계마다 재검증. partial cargoId 발생 시 전체 롤백.
  // 성능 보호 — 미배치 cargo 가 가야 할 컨테이너에 대해서만 시도, 전역 brute force X.
  //
  // 사례: SK GEO CENTRIC (FBSIN260431) — 같은 booking + 137×115×85 ×1 + 135×115×129 ×2,
  //   footprint W 차이 2cm. 그러나 noStacking=true 면 활성 조건 6 위반으로 묶음 안 됨.
  //   (이 케이스는 위 5.44 룰 G 가 처리)
  if (
    unplaced.length > 0 &&
    mode_placement === "wrapper" &&
    options?.footprintCluster?.enabled !== false
  ) {
    // 미배치 cargoId 별 unit 모음 (이번 라운드 fallback 대상)
    const unplacedByCargoId = new Map<string, UnitItem[]>();
    for (const u of unplaced) {
      const list = unplacedByCargoId.get(u.cargoId) ?? [];
      list.push(u);
      unplacedByCargoId.set(u.cargoId, list);
    }
    // 미배치 cargo 가 가야 할 컨테이너 결정 (fixedMap 우선)
    const cargoTargetCont = new Map<string, ContainerState>();
    for (const cid of unplacedByCargoId.keys()) {
      const fix = fixedMap[cid];
      if (typeof fix === "number") {
        const target = containers.find((c) => c.index === fix);
        if (target) cargoTargetCont.set(cid, target);
      }
    }
    // 컨테이너별로 fallback 시도
    const targetConts = new Set<ContainerState>(cargoTargetCont.values());
    for (const cont of targetConts) {
      // 이 컨테이너로 갈 unplaced cargoId 들 + 같은 booking 의 이미 배치된 unit (지지대 검증용은 아님)
      // pool = 이 컨에 들어가야 할 미배치 unit + 같은 booking 의 미배치 unit (없으면 빈 풀)
      const cargoIdsForThisCont = new Set<string>();
      for (const [cid, c] of cargoTargetCont) {
        if (c === cont) cargoIdsForThisCont.add(cid);
      }
      const pool: UnitItem[] = [];
      for (const cid of cargoIdsForThisCont) {
        const us = unplacedByCargoId.get(cid);
        if (us) pool.push(...us);
      }
      // 같은 booking 의 다른 미배치 unit 도 끌어들임 (cargo cross 묶음 후보)
      const bookingsInPool = new Set(pool.map((u) => u.bookingNo).filter(Boolean));
      for (const u of unplaced) {
        if (pool.includes(u)) continue;
        if (!u.bookingNo) continue;
        if (!bookingsInPool.has(u.bookingNo)) continue;
        // 같은 booking 의 다른 미배치 unit — 같은 컨테이너 후보 검증
        const fix = fixedMap[u.cargoId];
        if (typeof fix === "number") {
          const target = containers.find((c) => c.index === fix);
          if (target !== cont) continue; // 다른 컨이면 끌어들이지 X
        }
        pool.push(u);
      }
      if (pool.length === 0) continue;
      const placedIds = preClusterNearFootprint(
        cont,
        pool,
        options?.footprintCluster,
      );
      if (placedIds.size > 0) {
        // 이미 배치된 unit 들을 unplaced 에서 제거
        const remaining = unplaced.filter((u) => !placedIds.has(u.unitId));
        unplaced.length = 0;
        for (const u of remaining) unplaced.push(u);
        // booking anchor 갱신
        for (const id of placedIds) {
          const u = pool.find((x) => x.unitId === id);
          if (u) recordBookingAnchor(u, cont);
        }
      }
    }
  }

  // 5.5) Stage 4 자리 바꾸기 패스 — 미배치 발생 시만 발동
  //   이미 배치된 cargo 1개 빼서 다시 배치하고 빈 자리에 미배치 cargo 끼우기.
  //   다중 라운드 — 첫 라운드 진전 시 후속 라운드에서 cascading 배치 시도.
  if (unplaced.length > 0) {
    const unitsByCargoId = new Map<string, UnitItem[]>();
    for (const u of allUnits) {
      const list = unitsByCargoId.get(u.cargoId) ?? [];
      list.push(u);
      unitsByCargoId.set(u.cargoId, list);
    }
    let prevCount = unplaced.length + 1;
    for (let round = 0; round < 5 && unplaced.length > 0 && unplaced.length < prevCount; round++) {
      prevCount = unplaced.length;
      const newUnplaced = repositionUnplaced(containers, unplaced, unitsByCargoId, fixedMap);
      unplaced.length = 0;
      for (const u of newUnplaced) unplaced.push(u);
    }
  }

  // 5.6) **Rescue repack** — Stage 4 후에도 미배치 남으면 컨테이너 단위로 전체 재배치
  //   원리: 미배치 cargo 가 있을 때, 해당 cargo 가 가야 할 컨테이너에 이미 배치된 모든 unit
  //   을 꺼내서 + 미배치 unit 들과 합쳐 unit-LDF 로 재배치 시도.
  //   - 같은 컨테이너 안에선 cross-container split 위험 X
  //   - 모든 unit fit 시 commit, 하나라도 fail 시 전체 rollback
  //   - 미배치 발생 시만 발동 — 기존 PASS 샘플 회귀 X
  if (unplaced.length > 0) {
    // 미배치 unit 의 cargoId 별 모음
    const unplacedByCargo = new Map<string, UnitItem[]>();
    for (const u of unplaced) {
      const list = unplacedByCargo.get(u.cargoId) ?? [];
      list.push(u);
      unplacedByCargo.set(u.cargoId, list);
    }
    // unitsByCargoId 빌드 (allUnits 에서)
    const unitsByCid = new Map<string, UnitItem[]>();
    for (const u of allUnits) {
      const list = unitsByCid.get(u.cargoId) ?? [];
      list.push(u);
      unitsByCid.set(u.cargoId, list);
    }
    // 각 미배치 cargo 가 어느 컨테이너로 가야 하는지 결정 (fixedMap 우선)
    const cargoTargetContainer = new Map<string, ContainerState>();
    for (const cargoId of unplacedByCargo.keys()) {
      const fix = fixedMap[cargoId];
      if (typeof fix === "number") {
        const target = containers.find((c) => c.index === fix);
        if (target) cargoTargetContainer.set(cargoId, target);
      }
      // fixedMap 없으면 — rescue 적용 X (cross-container 위험)
    }
    // 컨테이너별로 rescue
    const targetContainers = new Set<ContainerState>(cargoTargetContainer.values());
    const stillUnplaced: UnitItem[] = [];
    const handledCargoIds = new Set<string>();
    for (const cont of targetContainers) {
      const snap = structuredClone(cont.packState);
      // 이 컨테이너에 들어가야 할 cargoId 들 (fixedMap 기준)
      const targetCargoIds = new Set<string>();
      for (const [cid] of unplacedByCargo) {
        if (cargoTargetContainer.get(cid) === cont) {
          targetCargoIds.add(cid);
          handledCargoIds.add(cid);
        }
      }
      // 이 컨테이너에 이미 배치된 cargoId 들도 포함
      for (const p of cont.packState.placements) targetCargoIds.add(p.cargoId);
      // rescue 대상 unit 풀: 모든 cargoId 의 unit 통합 (중복 제거 자동)
      // allUnits 순서대로 필터링 (expandToUnits 결과 = 결정적 입력 순서)
      const pool: UnitItem[] = allUnits.filter((u) => targetCargoIds.has(u.cargoId));
      if (pool.length === 0) continue;
      // tall-first 정렬 — 높은 박스(h≥100) 먼저, 그 다음 LDF
      const ldf = [...pool].sort((a, b) => {
        const aTall = a.height >= 100 ? 1 : 0;
        const bTall = b.height >= 100 ? 1 : 0;
        if (aTall !== bTall) return bTall - aTall;
        return (b.width * b.length * b.height) - (a.width * a.length * a.height);
      });
      // 컨 reset 후 재배치
      cont.packState = makeContainerState();
      const localUnplaced: UnitItem[] = [];
      for (const u of ldf) {
        const ok = tryPlaceUnit(u, cont.packState, cont.spec) ||
                   tryPlaceUnitBruteForce(u, cont.packState, cont.spec);
        if (!ok) localUnplaced.push(u);
      }
      // 하나라도 미배치 발생 시 (rescue 가 더 좋아진 경우만 commit)
      const beforeCount = unplacedByCargo.size === 0 ? 0 :
        [...unplacedByCargo].filter(([cid]) => cargoTargetContainer.get(cid) === cont).reduce((s, [, us]) => s + us.length, 0);
      if (localUnplaced.length < beforeCount) {
        // 개선됨 — commit. 남은 미배치만 stillUnplaced 로
        for (const u of localUnplaced) stillUnplaced.push(u);
      } else {
        // 같거나 악화 — rollback
        cont.packState = snap;
        // 원래 미배치 그대로
        for (const [cid, units] of unplacedByCargo) {
          if (cargoTargetContainer.get(cid) === cont) {
            for (const u of units) stillUnplaced.push(u);
          }
        }
      }
    }
    // unplaced 갱신: handled cargo 의 잔존 + handled 안 된 (target 못 정한) cargo 의 원본 미배치
    unplaced.length = 0;
    for (const u of stillUnplaced) unplaced.push(u);
    for (const [cid, units] of unplacedByCargo) {
      if (!handledCargoIds.has(cid)) {
        for (const u of units) unplaced.push(u);
      }
    }
  }

  // 5.7) **Stage 6 — 행 기반 잔여공간 fitting**
  //   rescue repack 후에도 미배치가 남으면, 컨테이너 현재 placements 를 Y 축으로
  //   클러스터링하여 행을 추출하고 각 행의 잔여공간에 미배치 unit 을 fitting 시도.
  //   - cargoId 원자성: 같은 cargoId 의 모든 unit 이 한 컨에 모두 들어갈 때만 commit
  //   - 실패 시 structuredClone 스냅샷으로 전체 롤백 (흔적 없음)
  //   - 발동 조건: unplaced.length > 0 (기존 0 미배치 샘플 영향 X)
  if (unplaced.length > 0) {
    // cargoId 별로 묶음 (cargoId·boxIndex 사전식 정렬)
    const stage6ByCargo = new Map<string, UnitItem[]>();
    for (const u of unplaced) {
      const list = stage6ByCargo.get(u.cargoId) ?? [];
      list.push(u);
      stage6ByCargo.set(u.cargoId, list);
    }
    // cargoId 사전식 정렬
    const stage6CargoIds = [...stage6ByCargo.keys()].sort();
    const stage6StillUnplaced: UnitItem[] = [];

    for (const cargoId of stage6CargoIds) {
      const units = stage6ByCargo.get(cargoId)!;
      // unitId 사전식 정렬 (결정성 보장)
      units.sort((a, b) => a.unitId.localeCompare(b.unitId));

      let placed = false;
      for (const cont of containers) {
        // 스냅샷 저장
        const snap = structuredClone(cont.packState);
        // 행 잔여공간 계산
        const rows = computeContainerRows(cont.packState);
        const residuals = computeRowResiduals(rows, cont.spec);

        // 이 cargoId 의 모든 unit 을 행 잔여공간에 fitting 시도
        let allOk = true;
        for (const u of units) {
          const ok = tryFitInRowResiduals(u, residuals, cont.packState, cont.spec);
          if (!ok) {
            allOk = false;
            break;
          }
        }

        if (allOk) {
          // 모두 성공 → commit (state 이미 mutate 됨)
          placed = true;
          break;
        } else {
          // 하나라도 실패 → 스냅샷 복원
          cont.packState = snap;
        }
      }

      if (!placed) {
        for (const u of units) stage6StillUnplaced.push(u);
      }
    }

    // unplaced 갱신
    unplaced.length = 0;
    for (const u of stage6StillUnplaced) unplaced.push(u);
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
    // visual 단계에서 이미 배치된 booking → container 맵 미리 빌드.
    // 같은 booking 의 visual 항목이 컨테이너 X 에 들어갔다면, 같은 booking 의 CT 항목도 X 로 가야 함
    // (booking split 방지). cargoId → bookingNo 매핑 후 placements 의 cargoId 로 컨테이너 추적.
    const cargoIdToBooking = new Map<string, string>();
    for (const c of cargoes) {
      if (c.bookingNo) cargoIdToBooking.set(c.id, c.bookingNo);
    }
    const visualBookingAnchor = new Map<string, ContainerState>();
    for (const cont of containers) {
      for (const p of cont.packState.placements) {
        const bn = cargoIdToBooking.get(p.cargoId);
        if (bn && !visualBookingAnchor.has(bn)) {
          visualBookingAnchor.set(bn, cont);
        }
      }
    }
    const result = allocateBulkGroup(
      ctCargoes,
      "ct",
      ctTargets,
      (c) => c.cbm ?? c.aboutCbm ?? cargoCbm(c),
      visualBookingAnchor,
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

  // 장축 모서리 박음 fallback 은 packBest 단계에서만 동작.
  // pack() 본체 내장 fallback 은 단독 pack() 단일 호출 시에도 매트릭스가 돌아가
  // 성능 회귀(3ST SG 5분+) 가 발생하므로 제거. 보호는 packBest 의 anchor 루프 1곳만.

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
    shipper: c.actualShipperName ?? c.shipperName ?? c.itemName ?? "",
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
/**
 * packBest 전용 옵션 — 일반 PackOptions 에 매트릭스 가벼운 모드 토글 추가.
 *  - lightMode=false (기본): 7전략 × 2컨순서 × 2자동마감 × 2배치 = 56시도 (회귀 0 보장)
 *  - lightMode=true: 핵심 12 시도만 (시간 예산 부족 환경, 단독 검증, 빠른 회귀용).
 *    내용: ldf/longest-side/tallest 정렬 × biggest-first × consolidate true/false × wrapper/pure
 */
export interface PackBestOptions extends PackOptions {
  /**
   * true 면 매트릭스 56 → 12 로 줄여 빠른 검증 가능.
   * 기본 false — 회귀 0 보장 매트릭스 유지.
   */
  lightMode?: boolean;
}

export function packBest(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options?: PackBestOptions,
): CLPResult {
  // brute-force 실패 cache 비우기 — 매 packBest 호출 사이에 잔여 영향 차단
  clearBruteForceFailureCache();

  const lightMode = options?.lightMode === true;
  // lightMode: 가장 효과 좋은 2개 정렬만 (ldf=대각선 우선, longest-side=장축 우선)
  const strategies: PackOptions["sortStrategy"][] = lightMode
    ? ["ldf", "longest-side", "heaviest"]
    : [
        "ldf",
        "longest-side",
        "tallest",
        "widest",
        "input",
        "shortest",
        "shortest-height",
        "heaviest",
      ];

  // 결과 평가 룰 (점수 없이 lexicographic 우선순위 비교):
  //   1순위 — 미배치 화물 수량 (적을수록 좋음)
  //   2순위 — B1 위반 (CBM 쪼개기, cargoId 분산 ≥ 2 컨) 카운트 (적을수록 좋음, 절대 룰 #4)
  //   3순위 — B2 위반 (부킹 분산 ≥ 2 컨) 카운트 (적을수록 좋음, 절대 룰 #4)
  //   4순위 — 입고완료 화물 마감 등급 (1컨최소=2, 1컨다른크기=1, 중립=0, 분산=음수)
  //   5순위 — 평균 충전률 (높을수록 좋음)
  //   6순위 — 동종 컨 CBM 편차 (작을수록 균형 우선)
  //
  // B1/B2 우선순위는 2026-05-08 추가. 균형 스왑 단계가 fixedAssignment 로 cargoId 분산을
  // 일으키면서도 충전률/균형 우수해서 best 로 채택되는 결함 차단. 옵션 C 도입과 함께 노출.
  interface EvalKey {
    unplacedCount: number;
    b1Violations: number; // cargoId 분산 ≥ 2 컨 카운트
    b2Violations: number; // bookingNo 분산 ≥ 2 컨 카운트
    consolidationTier: number; // 2=1컨최소, 1=1컨다른크기, 0=중립(입고완료 0건), 음수=분산(컨 수에 비례)
    fillRatePct: number;
    balancePenalty: number; // 컨테이너 간 CBM 편차 max — 작을수록 균형, 우선
  }
  const countDistributionViolations = (
    r: CLPResult,
  ): { b1: number; b2: number } => {
    const cargoCi = new Map<string, Set<number>>();
    const bookingCi = new Map<string, Set<number>>();
    r.containers.forEach((c) => {
      for (const row of c.rows ?? []) {
        for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
          if (it.cargoId) {
            const s = cargoCi.get(it.cargoId) ?? new Set<number>();
            s.add(c.index);
            cargoCi.set(it.cargoId, s);
          }
          if ((it as { bookingNo?: string }).bookingNo) {
            const bn = (it as { bookingNo?: string }).bookingNo!;
            const s = bookingCi.get(bn) ?? new Set<number>();
            s.add(c.index);
            bookingCi.set(bn, s);
          }
        }
      }
      for (const b of c.bulkItems ?? []) {
        if (b.cargoId) {
          const s = cargoCi.get(b.cargoId) ?? new Set<number>();
          s.add(c.index);
          cargoCi.set(b.cargoId, s);
        }
        if ((b as { bookingNo?: string }).bookingNo) {
          const bn = (b as { bookingNo?: string }).bookingNo!;
          const s = bookingCi.get(bn) ?? new Set<number>();
          s.add(c.index);
          bookingCi.set(bn, s);
        }
      }
    });
    let b1 = 0;
    for (const s of cargoCi.values()) if (s.size > 1) b1++;
    let b2 = 0;
    for (const s of bookingCi.values()) if (s.size > 1) b2++;
    return { b1, b2 };
  };
  const evalKey = (r: CLPResult): EvalKey => {
    const unplacedCount = r.unplaced.reduce(
      (s, u) => s + (u.quantity ?? 1),
      0,
    );
    const { b1, b2 } = countDistributionViolations(r);
    const completedContainersMap = new Map<number, ContainerPlan>();
    for (const c of r.containers) {
      for (const row of c.rows) {
        for (const it of [...row.bottomItems, ...row.topItems]) {
          if (it.cfsCbm != null && it.cfsCbm > 0)
            completedContainersMap.set(c.index, c);
        }
      }
    }
    let consolidationTier = 0;
    if (completedContainersMap.size === 1) {
      const target = [...completedContainersMap.values()][0];
      const targetVol =
        target.spec.innerWidth *
        target.spec.innerLength *
        target.spec.innerHeight;
      const isSmallest = r.containers.every(
        (o) =>
          o.index === target.index ||
          o.spec.innerWidth * o.spec.innerLength * o.spec.innerHeight >=
            targetVol,
      );
      consolidationTier = isSmallest ? 2 : 1;
    } else if (completedContainersMap.size > 1) {
      // 분산일수록 더 나쁨 — 컨 수가 많을수록 음수 더 작음
      consolidationTier = -(completedContainersMap.size - 1);
    }
    // 동종(같은 spec) 컨테이너 그룹별 CBM 편차 max — 다른 spec 끼리는 비교 의미 없음
    const sameTypeGroups = new Map<string, number[]>();
    for (const c of r.containers) {
      const key = c.spec.type;
      const cbms = sameTypeGroups.get(key) ?? [];
      cbms.push(c.totalCbm + c.ctCbm);
      sameTypeGroups.set(key, cbms);
    }
    let balancePenalty = 0;
    for (const cbms of sameTypeGroups.values()) {
      if (cbms.length < 2) continue;
      balancePenalty = Math.max(
        balancePenalty,
        Math.max(...cbms) - Math.min(...cbms),
      );
    }
    return {
      unplacedCount,
      b1Violations: b1,
      b2Violations: b2,
      consolidationTier,
      fillRatePct: r.summary.avgFillRate,
      balancePenalty,
    };
  };
  // a 가 b 보다 더 좋은 결과면 true
  const isBetterResult = (a: EvalKey, b: EvalKey): boolean => {
    // Rule 1: 미배치 적은 게 무조건 우선
    if (a.unplacedCount !== b.unplacedCount)
      return a.unplacedCount < b.unplacedCount;
    // Rule 2: B1 위반 적은 쪽 우선 (절대 룰 #4 — CBM 쪼개기 금지)
    if (a.b1Violations !== b.b1Violations)
      return a.b1Violations < b.b1Violations;
    // Rule 3: B2 위반 적은 쪽 우선 (부킹 분산 금지)
    if (a.b2Violations !== b.b2Violations)
      return a.b2Violations < b.b2Violations;
    // Rule 4: 입고완료 마감 등급 높은 쪽 우선 (2 > 1 > 0 > 음수)
    if (a.consolidationTier !== b.consolidationTier)
      return a.consolidationTier > b.consolidationTier;
    // Rule 5: 충전률 높은 쪽 우선
    if (Math.abs(a.fillRatePct - b.fillRatePct) > 0.001)
      return a.fillRatePct > b.fillRatePct;
    // Rule 6: 동종 컨테이너 간 CBM 편차 작은 쪽 (균형 분배 우선)
    return a.balancePenalty < b.balancePenalty;
  };

  // lightMode: biggest-first 만 (smallest-first 는 회귀 시나리오에서 거의 best 안 됨)
  const containerOrders: PackOptions["containerOrder"][] = lightMode
    ? ["biggest-first"]
    : ["biggest-first", "smallest-first"];
  // placementModes: lightMode 는 wrapper 만 (pure 는 거의 동률)
  const placementModes: PackOptions["placementMode"][] = lightMode
    ? ["wrapper"]
    : ["wrapper", "pure"];
  // 사용자 명시 옵션이 있으면 자동마감은 비활성 모드만 시도 (사용자 옵션 존중)
  const userPinned =
    options?.fixedAssignment != null ||
    typeof options?.completedExclusiveContainerIndex === "number" ||
    options?.autoConsolidateCompleted === false;
  // lightMode: 자동마감 true 만 (false 는 입고완료 분산 → 거의 best 안 됨)
  const consolidateModes: boolean[] = userPinned
    ? [false]
    : lightMode
      ? [true]
      : [true, false];
  const tryAllStrategies = (input: CargoSpec[]): CLPResult => {
    let best: CLPResult | null = null;
    let bestKey: EvalKey | null = null;
    // 조기 종료 — 어느 시도든 미배치 0 도달하면 매트릭스 잔여 시나리오 전부 스킵.
    // 여전히 best 가 더 좋아질 여지(균형/충전률)가 있으나, 사용자 1순위인 미배치 0 만족 시
    // 추가 시도의 비용 > 이득이므로 즉시 break (시간 예산 보호 — 8분 환경 한계).
    outer: for (const strat of strategies) {
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
            const key = evalKey(r);
            if (bestKey === null || isBetterResult(key, bestKey)) {
              bestKey = key;
              best = r;
            }
            if (bestKey !== null && bestKey.unplacedCount === 0) break outer;
          }
        }
      }
    }
    // **장축 모서리 박음 fallback** — 일반 매트릭스에서 미배치가 남았으면
    // longAxisAnchor: { enabled: true } 로 한 번 더 시도. 단행 막대형 박스 보호 룰.
    // 호출자가 명시적으로 longAxisAnchor.enabled 를 지정했으면 (true/false 둘 다)
    // 그 의도를 존중하고 fallback 발동 X.
    const userPickedLongAxis = options?.longAxisAnchor?.enabled !== undefined;
    if (
      !userPickedLongAxis &&
      bestKey !== null &&
      bestKey.unplacedCount > 0
    ) {
      anchor: for (const strat of strategies) {
        for (const co of containerOrders) {
          for (const consolidate of consolidateModes) {
            for (const pm of placementModes) {
              const r = pack(input, mode, {
                ...options,
                sortStrategy: strat,
                containerOrder: co,
                autoConsolidateCompleted: consolidate,
                placementMode: pm,
                longAxisAnchor: { ...options?.longAxisAnchor, enabled: true },
              });
              const key = evalKey(r);
              if (isBetterResult(key, bestKey)) {
                bestKey = key;
                best = r;
              }
              if (bestKey !== null && bestKey.unplacedCount === 0)
                break anchor;
            }
          }
        }
      }
    }
    return best ?? pack(input, mode, options);
  };

  // 1단계: 기본 전략 그룹
  let current = tryAllStrategies(cargoes);
  let currentKey = evalKey(current);

  // 2단계: 백트래킹 — 미배치 화물 우선 input 순으로 강제 (input strategy 만)
  // lightMode: 백트래킹 12 → 1회로 (시간 예산 보호; (a) input front 만 한 번 시도)
  const MAX_BACKTRACK = lightMode ? 1 : 12;
  let inputOrder = [...cargoes];
  // 같은 unplaced cargoId 셋이 두 번 이상 등장하면 백트래킹 중단 (개발자 권고: 무한 회전 차단)
  const seenUnplacedSets = new Set<string>();
  for (let iter = 0; iter < MAX_BACKTRACK; iter++) {
    if (current.unplaced.length === 0) break;
    const unplacedIds = current.unplaced.map((u) => u.cargoId);
    if (unplacedIds.length === 0) break;
    // 같은 미배치 셋 반복 감지 — 두 번째 등장이면 break (헛수고 차단)
    const setKey = [...unplacedIds].sort().join("|");
    if (seenUnplacedSets.has(setKey)) break;
    seenUnplacedSets.add(setKey);
    let improved = false;

    // (a) 미배치 전체를 맨 앞으로 — input strategy 사용
    const allFront = [
      ...inputOrder.filter((c) => unplacedIds.includes(c.id)),
      ...inputOrder.filter((c) => !unplacedIds.includes(c.id)),
    ];
    const candA = pack(allFront, mode, { ...options, sortStrategy: "input" });
    const candAKey = evalKey(candA);
    if (isBetterResult(candAKey, currentKey)) {
      current = candA;
      currentKey = candAKey;
      inputOrder = allFront;
      improved = true;
      continue;
    }

    // (b) 미배치 화물 1개씩 맨 앞으로 swap — 전체 전략 best 채택
    // lightMode: (b) 스킵 — 매 unplacedId 마다 매트릭스 재호출이라 매우 느림
    if (!lightMode) {
      for (const uid of unplacedIds) {
        const reordered = [
          ...inputOrder.filter((c) => c.id === uid),
          ...inputOrder.filter((c) => c.id !== uid),
        ];
        const cand = tryAllStrategies(reordered);
        const candKey = evalKey(cand);
        if (isBetterResult(candKey, currentKey)) {
          current = cand;
          currentKey = candKey;
          inputOrder = reordered;
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
    // 조기 종료 — 미배치 0 도달이면 백트래킹 루프 즉시 종료
    if (current.unplaced.length === 0) break;
  }

  // 3단계: 동종(같은 spec) 컨 간 balance-swap — 미배치 0 + 동종 컨 2+ 인 경우만 시도.
  //   현재 분배에서 cargo 1개 또는 swap 한 쌍 이동으로 balance 개선되면 채택.
  //   fixedAssignment 옵션으로 강제 후 재pack → 룰 통과 + balance 개선이면 갱신.
  //   lightMode: 시간 예산 부족 시 균형 스왑 단계 통째 스킵 (미배치 0 보장이 우선).
  if (!lightMode && current.unplaced.length === 0 && current.containers.length >= 2) {
    const cargoToContainer = new Map<string, number>();
    for (const c of current.containers) {
      for (const row of c.rows) {
        for (const it of [...row.bottomItems, ...row.topItems]) {
          cargoToContainer.set(it.cargoId, c.index);
        }
      }
      for (const b of c.bulkItems ?? []) {
        if (!cargoToContainer.has(b.cargoId))
          cargoToContainer.set(b.cargoId, c.index);
      }
    }
    // 같은 spec 끼리 (idx, type) pair 추출
    const sameTypePairs: [number, number][] = [];
    for (let i = 0; i < current.containers.length; i++) {
      for (let j = i + 1; j < current.containers.length; j++) {
        if (current.containers[i].spec.type === current.containers[j].spec.type) {
          sameTypePairs.push([
            current.containers[i].index,
            current.containers[j].index,
          ]);
        }
      }
    }
    const SWAP_THRESHOLD_CBM = 3;
    let swapImproved = true;
    let swapIters = 0;
    const MAX_SWAP_ITERS = 8;
    while (swapImproved && swapIters < MAX_SWAP_ITERS) {
      swapImproved = false;
      swapIters++;
      for (const [idxA, idxB] of sameTypePairs) {
        const aPlan = current.containers.find((c) => c.index === idxA);
        const bPlan = current.containers.find((c) => c.index === idxB);
        if (!aPlan || !bPlan) continue;
        const cbmA = aPlan.totalCbm + aPlan.ctCbm;
        const cbmB = bPlan.totalCbm + bPlan.ctCbm;
        if (Math.abs(cbmA - cbmB) <= SWAP_THRESHOLD_CBM) continue;
        // cargoes by side
        const cargosA = [...cargoToContainer.entries()]
          .filter(([, ci]) => ci === idxA)
          .map(([cid]) => cid);
        const cargosB = [...cargoToContainer.entries()]
          .filter(([, ci]) => ci === idxB)
          .map(([cid]) => cid);
        // 단일 이동 시도 (큰 컨테이너 → 작은 컨테이너) — 모든 후보 평가, best balance 채택
        const fromBigger = cbmA > cbmB ? cargosA : cargosB;
        const toSmaller = cbmA > cbmB ? idxB : idxA;
        let bestCand: CLPResult | null = null;
        let bestCandKey: EvalKey | null = null;
        let bestCargoId: string | null = null;
        for (const cid of fromBigger) {
          const newMap: Record<string, number> = {};
          for (const [k, v] of cargoToContainer) newMap[k] = v;
          newMap[cid] = toSmaller;
          const cand = pack(cargoes, mode, {
            ...options,
            fixedAssignment: newMap,
            fixedContainers: current.containers.map((c) => c.spec.type),
          });
          const candKey = evalKey(cand);
          if (isBetterResult(candKey, currentKey)) {
            if (bestCandKey === null || isBetterResult(candKey, bestCandKey)) {
              bestCandKey = candKey;
              bestCand = cand;
              bestCargoId = cid;
            }
          }
        }
        if (bestCand && bestCargoId) {
          current = bestCand;
          currentKey = bestCandKey!;
          cargoToContainer.set(bestCargoId, toSmaller);
          swapImproved = true;
          break;
        }
      }
    }
  }

  // alternative 토스트 — 빈 트럭(visual + bulk 0)이 있으면 제거 버전을 alternative 로 보존.
  // 사용자가 화면에서 보고 "변경" 누르면 빈 트럭 제거된 결과로 교체. 자동 적용 X.
  // 예: 망작 케이스 — 40FT(21행) + 20FT(0행) → alternative = 40FT(21행) (트럭 1대 절감)
  const isEmptyContainer = (c: ContainerPlan): boolean => {
    const visualCount = (c.rows ?? []).reduce(
      (s, r) =>
        s +
        ((r.bottomItems?.length ?? 0) + (r.topItems?.length ?? 0)),
      0,
    );
    const bulkCount = (c.bulkItems ?? []).length;
    return visualCount + bulkCount === 0;
  };
  const emptyContainers = current.containers.filter(isEmptyContainer);
  if (emptyContainers.length > 0 && current.containers.length - emptyContainers.length > 0) {
    const nonEmpty = current.containers.filter((c) => !isEmptyContainer(c));
    const removedTypes = emptyContainers.map((c) => c.spec.type);
    const removedSummary = removedTypes.join(" + ");
    const altSetSummary = nonEmpty.map((c) => c.spec.type).join(" + ");
    current.alternative = {
      containers: nonEmpty,
      unplaced: current.unplaced,
      description: `${altSetSummary} (트럭 ${emptyContainers.length}대 절감 가능 — ${removedSummary} 빈 트럭)`,
    };
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
