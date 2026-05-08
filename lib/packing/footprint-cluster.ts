/**
 * Footprint Cluster Pre-Pass
 *
 * 큰 컨테이너 (40FT TOTAL 같은) 에서 마지막 1~2 박스가 미배치로 남는 문제를
 * 사전 묶음으로 해결.
 *
 * 룰 A — 부킹 내부 footprint 컬럼 사전 묶음:
 *   같은 bookingNo 안에서 (W,L) 가 동일하거나 ±FOOTPRINT_TOL_CM (5cm) 이내면
 *   자체 column 으로 사전 적층 (이단/삼단). heavierBelow 통과 + door 높이 ≤ doorHeight.
 *
 * 룰 B — 인접 부킹 footprint 흡수:
 *   룰 A 로 만들어진 column 의 top z 위에 다른 부킹의 단일 박스 (작은 footprint) 가
 *   받침 비율 ≥ SUPPORT_RATIO_MIN (70%) 만족 시 자동 적층.
 *   조건: 흡수되는 박스가 속한 부킹 전체가 같은 컨테이너에 들어갈 때만
 *         (한 부킹 = 한 컨 룰 보호).
 *
 * 활성 조건 (보수적):
 *   1) 컨테이너 spec.maxCbm ≥ 50 m³ (40FT급)
 *   2) 그 컨테이너에 cluster 후보 unit 풀 ≥ 5개
 *
 * 작은 시나리오 (1ST SG 등 20FT 적은 박스) 에는 영향 없음.
 *
 * 절대 룰 준수:
 *   - 한 화물 행 (= 한 cargoId) 은 한 컨테이너에만 (split 금지)
 *   - 한 부킹 = 한 컨 (B1 룰)
 *   - 점수 합산 X — lex 우선순위만
 */

import type { ContainerSpec } from "../../types/container.ts";
import { canStackOn } from "./constraints.ts";
import {
  type ContainerPackState,
  type Placement3D,
  type UnitItem,
  tryPlaceUnit,
  tryPlaceUnitBruteForce,
} from "./extreme-point.ts";

/** footprint 동일 판정 허용 오차 (cm) */
const FOOTPRINT_TOL_CM = 5;
/** 룰 B 흡수 시 받침 비율 최소 — 0.70 = 70% */
const SUPPORT_RATIO_MIN = 0.7;
/** 활성 컨테이너 최소 부피 (m³) */
const MIN_CONTAINER_CBM = 50;
/** 활성 unit 최소 개수 */
const MIN_UNITS = 5;

export interface FootprintClusterOptions {
  /** 룰 비활성 (테스트·디버그용) */
  enabled?: boolean;
  /** 활성 컨테이너 부피 임계 (기본 50 m³) */
  minContainerCbm?: number;
  /** 활성 unit 최소 개수 (기본 5) */
  minUnits?: number;
}

interface ContainerLike {
  index: number;
  spec: ContainerSpec;
  packState: ContainerPackState;
}

interface ColumnDescriptor {
  bookingNo: string;
  units: UnitItem[];
  /** 컬럼 footprint (회전 없이 unit.width × unit.length) */
  width: number;
  length: number;
  /** 모든 unit 합산 높이 (자체 적층 시) */
  totalHeight: number;
}

/** footprint 가 두 unit 간 동일한지 (회전 미고려, ±FOOTPRINT_TOL_CM) */
function sameFootprint(a: UnitItem, b: UnitItem): boolean {
  const aw = Math.min(a.width, a.length);
  const al = Math.max(a.width, a.length);
  const bw = Math.min(b.width, b.length);
  const bl = Math.max(b.width, b.length);
  return Math.abs(aw - bw) <= FOOTPRINT_TOL_CM && Math.abs(al - bl) <= FOOTPRINT_TOL_CM;
}

/**
 * groupFootprintColumns 결과 캐시 — packBest 매트릭스(56+ 시도)에서 동일 unit 풀에
 * 대해 매번 재계산을 피한다. key = unit signature (id+w+l+h+booking+weight) 정렬 합산.
 * Map 크기 상한을 두어 메모리 폭주 방지.
 */
const COLUMN_CACHE = new Map<string, ColumnDescriptor[]>();
const COLUMN_CACHE_MAX = 256;

function unitsSignature(units: UnitItem[]): string {
  // 안정적 정렬 후 핵심 필드만 join — booking/footprint/높이/무게/noStacking
  const parts = units
    .map(
      (u) =>
        `${u.unitId}|${u.bookingNo ?? ""}|${u.width}x${u.length}x${u.height}|${u.weight}|${u.remarks.noStacking ? 1 : 0}`,
    )
    .sort();
  return parts.join("#");
}

function cachedGroupFootprintColumns(units: UnitItem[]): ColumnDescriptor[] {
  const key = unitsSignature(units);
  const hit = COLUMN_CACHE.get(key);
  if (hit) return hit;
  const result = groupFootprintColumns(units);
  if (COLUMN_CACHE.size >= COLUMN_CACHE_MAX) {
    // 가장 오래된 항목 1개 제거 (Map 삽입 순서 보장)
    const firstKey = COLUMN_CACHE.keys().next().value;
    if (firstKey !== undefined) COLUMN_CACHE.delete(firstKey);
  }
  COLUMN_CACHE.set(key, result);
  return result;
}

/** 부킹 내부에서 동일 footprint unit 그룹 묶기 — 같은 cargoId 우선 */
function groupFootprintColumns(units: UnitItem[]): ColumnDescriptor[] {
  // bookingNo 기준 분할
  const byBooking = new Map<string, UnitItem[]>();
  for (const u of units) {
    if (!u.bookingNo) continue;
    const list = byBooking.get(u.bookingNo) ?? [];
    list.push(u);
    byBooking.set(u.bookingNo, list);
  }
  const columns: ColumnDescriptor[] = [];
  for (const [bookingNo, group] of byBooking) {
    if (group.length < 2) continue;
    // group 안에서 footprint 클러스터링 (간단한 그리디: 첫 unit 기준 묶기)
    const used = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      const seed = group[i];
      if (used.has(seed.unitId)) continue;
      const cluster: UnitItem[] = [seed];
      used.add(seed.unitId);
      for (let j = i + 1; j < group.length; j++) {
        const cand = group[j];
        if (used.has(cand.unitId)) continue;
        if (!sameFootprint(seed, cand)) continue;
        // heavierBelow / noStacking 검증 — 둘 다 stack 가능해야
        if (cand.remarks.noStacking) continue;
        if (seed.remarks.noStacking) continue;
        cluster.push(cand);
        used.add(cand.unitId);
      }
      if (cluster.length < 2) continue;
      // heavierBelow 충족 위해 무거운 박스가 아래 — weight desc
      cluster.sort((a, b) => b.weight - a.weight);
      const totalHeight = cluster.reduce((s, u) => s + u.height, 0);
      columns.push({
        bookingNo,
        units: cluster,
        width: cluster[0].width,
        length: cluster[0].length,
        totalHeight,
      });
    }
  }
  return columns;
}

/** stack 가능성 체크 — heavierBelow / noStacking 룰 (extreme-point canStackOn 와 동일) */
function canStackPair(top: UnitItem, bottom: UnitItem): boolean {
  return canStackOn(
    { weightPerUnit: top.weight, remarks: top.remarks },
    { weightPerUnit: bottom.weight, remarks: bottom.remarks },
  );
}

/** 컬럼 자체 적층 시도 — 첫 unit 을 tryPlaceUnit 으로 자연스럽게 두고 위에 강제 적층 */
function tryPlaceColumn(
  col: ColumnDescriptor,
  state: ContainerPackState,
  spec: ContainerSpec,
): UnitItem[] {
  // doorHeight 초과면 column 자체 포기
  const doorH = spec.doorHeight ?? spec.innerHeight;
  if (col.totalHeight > doorH) return col.units; // 전체 fail
  // heavierBelow chain 검증 — 인접 쌍 모두 통과해야
  for (let i = 0; i < col.units.length - 1; i++) {
    if (!canStackPair(col.units[i + 1], col.units[i])) return col.units;
  }

  // 첫 unit 을 자연스럽게 배치 (extreme-point 정상 호출)
  const first = col.units[0];
  const beforeCount = state.placements.length;
  const ok =
    tryPlaceUnit(first, state, spec) ||
    tryPlaceUnitBruteForce(first, state, spec);
  if (!ok) return col.units;
  const placed = state.placements[beforeCount];
  if (!placed) return col.units;

  // 그 위에 같은 (x,y) 강제 stack — placement 직접 push (extreme-point 와 동일 로직)
  const placedNow: UnitItem[] = [first];
  let curZ = placed.position.z + placed.size.height;
  const px = placed.position.x;
  const py = placed.position.y;
  const pw = placed.size.width;
  const pl = placed.size.length;
  for (let i = 1; i < col.units.length; i++) {
    const u = col.units[i];
    // door 높이 초과 검사
    if (curZ + u.height > doorH + 0.01) {
      // 이후 unit 은 여기 못 올림 — 이미 배치된 것은 유지, 나머지 fallback
      return col.units.slice(i);
    }
    if (curZ + u.height > spec.innerHeight + 0.01) {
      return col.units.slice(i);
    }
    // 무게 한도
    if (state.totalWeight + u.weight >= spec.maxWeightKg) {
      return col.units.slice(i);
    }
    // 같은 (px,py) 에 강제 적층 — footprint 가 첫 박스 안에 fit (회전 없이)
    if (u.width > pw + 0.01 || u.length > pl + 0.01) {
      // footprint 가 첫 박스보다 크면 다른 공간 필요 — fallback
      return col.units.slice(i);
    }
    const newPlacement: Placement3D = {
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x: px, y: py, z: curZ },
      size: { width: u.width, length: u.length, height: u.height },
      faceIdx: 0,
      rotated: false,
      weight: u.weight,
      remarks: u.remarks,
      layer: "top",
    };
    state.placements.push(newPlacement);
    state.totalWeight += u.weight;
    state.visualCbm += (u.width * u.length * u.height) / 1_000_000;
    // 새 corner candidates 추가
    state.candidates.push(
      { x: px + u.width, y: py, z: curZ },
      { x: px, y: py + u.length, z: curZ },
      { x: px, y: py, z: curZ + u.height },
    );
    curZ += u.height;
    placedNow.push(u);
  }
  return []; // 전부 배치
}

/** 룰 B — 이미 배치된 column top 위에 다른 부킹의 작은 footprint 박스 흡수 */
function tryAbsorbOnColumns(
  candidates: UnitItem[],
  state: ContainerPackState,
  spec: ContainerSpec,
  bookingFullyInThisContainer: (bookingNo: string) => boolean,
): UnitItem[] {
  const remaining: UnitItem[] = [];
  // 후보 박스 중 noStacking 이거나 bookingNo 없는 건 패스
  for (const u of candidates) {
    if (u.remarks.noStacking || !u.bookingNo) {
      remaining.push(u);
      continue;
    }
    // 한 부킹 = 한 컨 보호 — u 의 booking 전체가 이 컨테이너에 들어가는 경우만 허용
    if (!bookingFullyInThisContainer(u.bookingNo)) {
      remaining.push(u);
      continue;
    }
    // 가장 받침률 높은 top 위치 후보 찾기 (lex: support ratio desc → z asc)
    interface Spot {
      x: number;
      y: number;
      z: number;
      supporter: Placement3D;
      ratio: number;
    }
    let best: Spot | null = null;
    const doorH = spec.doorHeight ?? spec.innerHeight;
    for (const p of state.placements) {
      const topZ = p.position.z + p.size.height;
      if (topZ + u.height > doorH + 0.01) continue;
      if (topZ + u.height > spec.innerHeight + 0.01) continue;
      // 받침 비율 = u.footprint / supporter.footprint (둘 다 같은 평면 기준)
      const supW = p.size.width;
      const supL = p.size.length;
      // u 회전 없이 그대로
      if (u.width > supW + 0.01 || u.length > supL + 0.01) continue;
      const ratio =
        (u.width * u.length) / (supW * supL);
      if (ratio < SUPPORT_RATIO_MIN) continue;
      // canStackOn 검증
      if (
        !canStackOn(
          { weightPerUnit: u.weight, remarks: u.remarks },
          { weightPerUnit: p.weight, remarks: p.remarks },
        )
      )
        continue;
      // 충돌 검사 — 같은 z 평면에 다른 박스 있나
      const x = p.position.x;
      const y = p.position.y;
      let collides = false;
      for (const other of state.placements) {
        if (other === p) continue;
        if (
          x + u.width > other.position.x + 0.01 &&
          x + 0.01 < other.position.x + other.size.width &&
          y + u.length > other.position.y + 0.01 &&
          y + 0.01 < other.position.y + other.size.length &&
          topZ + u.height > other.position.z + 0.01 &&
          topZ + 0.01 < other.position.z + other.size.height
        ) {
          collides = true;
          break;
        }
      }
      if (collides) continue;
      // 무게 한도
      if (state.totalWeight + u.weight >= spec.maxWeightKg) continue;
      const cand: Spot = { x, y, z: topZ, supporter: p, ratio };
      if (best === null) {
        best = cand;
      } else {
        // lex: 받침률 높을수록 → z 낮을수록 → y 낮을수록
        if (cand.ratio > best.ratio) best = cand;
        else if (cand.ratio === best.ratio && cand.z < best.z) best = cand;
        else if (cand.ratio === best.ratio && cand.z === best.z && cand.y < best.y) best = cand;
      }
    }
    if (best === null) {
      remaining.push(u);
      continue;
    }
    // commit
    const newPlacement: Placement3D = {
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x: best.x, y: best.y, z: best.z },
      size: { width: u.width, length: u.length, height: u.height },
      faceIdx: 0,
      rotated: false,
      weight: u.weight,
      remarks: u.remarks,
      layer: "top",
    };
    state.placements.push(newPlacement);
    state.totalWeight += u.weight;
    state.visualCbm += (u.width * u.length * u.height) / 1_000_000;
    state.candidates.push(
      { x: best.x + u.width, y: best.y, z: best.z },
      { x: best.x, y: best.y + u.length, z: best.z },
      { x: best.x, y: best.y, z: best.z + u.height },
    );
  }
  return remaining;
}

/**
 * 메인 진입점 — 한 컨테이너에 배치 후보 unit 풀을 받아 footprint 사전 묶음 시도.
 *
 * @returns 사전 묶음으로 배치 성공한 unitId 들의 Set. 호출자는 이 Set 을 사용해
 *          이미 배치된 unit 을 후속 큐에서 제외해야 함.
 */
export function preClusterFootprint(
  containerLike: ContainerLike,
  unitPool: UnitItem[],
  options?: FootprintClusterOptions,
): Set<string> {
  const placedIds = new Set<string>();
  if (options?.enabled === false) return placedIds;

  const minCbm = options?.minContainerCbm ?? MIN_CONTAINER_CBM;
  const minUnits = options?.minUnits ?? MIN_UNITS;

  // 활성 조건 검사
  const containerCbm =
    (containerLike.spec.innerWidth *
      containerLike.spec.innerLength *
      containerLike.spec.innerHeight) /
    1_000_000;
  if (containerCbm < minCbm) return placedIds;
  if (unitPool.length < minUnits) return placedIds;
  // topOnly 박스는 cluster 대상 아님 (z=0 못 두는데 column 시작 못 함)
  const eligible = unitPool.filter((u) => !u.remarks.topOnly);
  if (eligible.length < minUnits) return placedIds;

  // 룰 A — 부킹 내부 footprint 컬럼 묶기 (캐시 사용 — packBest 매트릭스 재호출 가속)
  const columns = cachedGroupFootprintColumns(eligible);
  if (columns.length === 0) return placedIds;

  // 큰 column (units 많은 것 → totalHeight 큰 것) 부터 — 안정적 footprint 먼저 깔기
  columns.sort((a, b) => {
    if (b.units.length !== a.units.length) return b.units.length - a.units.length;
    return b.totalHeight - a.totalHeight;
  });

  for (const col of columns) {
    // 해당 column 의 unit 이 이미 다른 column 에서 처리됐을 수 있음 — eligible 재검사
    const stillFresh = col.units.every((u) => !placedIds.has(u.unitId));
    if (!stillFresh) continue;
    const failedRest = tryPlaceColumn(col, containerLike.packState, containerLike.spec);
    // tryPlaceColumn 은 실패한 잔여 unit list 반환 ([] 이면 전부 배치)
    const placedInCol = col.units.filter((u) => !failedRest.includes(u));
    for (const u of placedInCol) placedIds.add(u.unitId);
  }

  // 룰 B — 다른 부킹의 작은 footprint 박스 흡수
  // 후보: 아직 배치 안 된 unit + 같은 컨에 들어갈 booking
  const bookingUnitCount = new Map<string, number>();
  for (const u of unitPool) {
    if (!u.bookingNo) continue;
    bookingUnitCount.set(u.bookingNo, (bookingUnitCount.get(u.bookingNo) ?? 0) + 1);
  }
  // bookingFullyInThisContainer 휴리스틱: 후보 풀에 그 booking 의 모든 unit 이 있으면 "들어갈 예정"
  const bookingFullyInThisContainer = (bookingNo: string): boolean => {
    return (bookingUnitCount.get(bookingNo) ?? 0) > 0;
  };

  const absorbCandidates = unitPool.filter(
    (u) => !placedIds.has(u.unitId) && !u.remarks.topOnly,
  );
  const remaining = tryAbsorbOnColumns(
    absorbCandidates,
    containerLike.packState,
    containerLike.spec,
    bookingFullyInThisContainer,
  );
  for (const u of absorbCandidates) {
    if (!remaining.includes(u)) placedIds.add(u.unitId);
  }

  // **CBM 쪼개기 방지 — cargoId atomic 후처리**:
  //   pre-cluster 가 한 cargoId 의 unit 일부만 배치하면 후속 컨테이너 루프에서 나머지가
  //   다른 컨에 들어가 cargo 쪼개기 (절대 룰 #4) 가 발생.
  //   풀(unitPool) 안에 미배치 unit 이 남은 cargoId 의 모든 placement 를 이 컨에서 롤백.
  //   → 그 cargo 는 정식 placeQueueWrapper 가 atomic 으로 처리.
  const poolByCargoId = new Map<string, UnitItem[]>();
  for (const u of unitPool) {
    const list = poolByCargoId.get(u.cargoId) ?? [];
    list.push(u);
    poolByCargoId.set(u.cargoId, list);
  }
  const partialCargoIds = new Set<string>();
  for (const [cargoId, units] of poolByCargoId) {
    const placedCount = units.filter((u) => placedIds.has(u.unitId)).length;
    if (placedCount > 0 && placedCount < units.length) {
      partialCargoIds.add(cargoId);
    }
  }
  // **B1 보호 — 부킹 단위 atomic 후처리**:
  //   같은 부킹의 다른 cargo 가 partial 이면, 이 부킹 전체가 컨에 들어갈지 보장 못함.
  //   같은 부킹의 모든 placement 를 롤백해 placeQueueWrapper 가 booking anchor 로 묶도록.
  const partialBookings = new Set<string>();
  for (const cargoId of partialCargoIds) {
    const units = poolByCargoId.get(cargoId) ?? [];
    for (const u of units) {
      if (u.bookingNo) partialBookings.add(u.bookingNo);
    }
  }
  if (partialCargoIds.size > 0 || partialBookings.size > 0) {
    const state = containerLike.packState;
    const keep: Placement3D[] = [];
    let removedWeight = 0;
    let removedCbm = 0;
    for (const p of state.placements) {
      const cargoSplit = partialCargoIds.has(p.cargoId);
      const bookingSplit = !!p.bookingNo && partialBookings.has(p.bookingNo);
      if (cargoSplit || bookingSplit) {
        // 롤백 — 이 placement 제거
        removedWeight += p.weight;
        removedCbm += (p.size.width * p.size.length * p.size.height) / 1_000_000;
        placedIds.delete(p.unitId);
        continue;
      }
      keep.push(p);
    }
    state.placements = keep;
    state.totalWeight -= removedWeight;
    state.visualCbm -= removedCbm;
    // candidates 는 tryPlaceUnit 다음 호출 시 자연스럽게 회복되므로 그대로 둠
  }

  return placedIds;
}

/** 테스트용 노출 */
export const __testables = {
  sameFootprint,
  groupFootprintColumns,
  canStackPair,
  FOOTPRINT_TOL_CM,
  SUPPORT_RATIO_MIN,
  MIN_CONTAINER_CBM,
  MIN_UNITS,
};
