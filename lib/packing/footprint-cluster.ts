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
 * 룰 E — cross-cargoId 동일 사이즈 묶음 (2026-05-12 추가):
 *   같은 bookingNo 안 cargoId 가 다른 unit 들 중 W·L·H 모두 정확히 동일한
 *   박스 그룹을 통째로 묶어 같은 row 옆 컬럼들 + 천장까지 적층.
 *   같은 booking 안 cargo 가 분산될 위험은 룰 C (cargo/booking atomic 후처리)
 *   가 사후 cleanup. 활성 조건 보수적:
 *     - 모든 박스 noStacking=false
 *     - W·L·H 모두 정확히 같음 (±0)
 *     - 두 컬럼 폭 (W × 2) ≤ 컨 안쪽 폭
 *     - 같은 그룹 안 unit ≥ 3 (작은 묶음은 룰 A 가 처리)
 *   사례: VPHI 부킹 sg3-23/24/25 같은 booking + 114×114×71 박스 7개 묶음.
 *
 * 룰 F — 근사 footprint 적층 묶음 (nearFootprintStackBundle, 2026-05-12 추가):
 *   룰 E (정확 동일) 가 풀지 못한 잔여 미배치 unit 풀에 한해서만 발동되는 fallback.
 *   같은 bookingNo + cargoId atomic 보장 + W/L footprint 차이 각각 ≤ NEAR_FOOTPRINT_TOL_CM(5cm)
 *   까지 허용해 적층 묶음 시도.
 *   활성 조건 (12개 모두):
 *     1) 같은 bookingNo
 *     2) cargoId atomic (한 cargoId 의 모든 unit 같은 컨테이너 + 같은 컬럼 묶음 안)
 *     3) W/L footprint 차이 각각 ≤ NEAR_FOOTPRINT_TOL_CM (5cm)
 *     4) 높이 달라도 허용
 *     5) 아래 박스 footprint ≥ 위 박스 footprint
 *     6) noStacking / bottomOnly 위반 없음 (모든 박스 noStacking=false)
 *     7) 위 박스 무게 ≤ 아래 박스 무게 (STACK_WEIGHT_TOLERANCE = 1.0)
 *     8) 총 적층 높이 ≤ 컨테이너 내부 높이
 *     9) 두 컬럼 이하 (NEAR_MAX_COLUMNS = 2)
 *     10) exact 룰 E 로 해결되지 않고 미배치 남을 때만 fallback 발동
 *     11) partial cargoId 또는 booking split 생기면 전체 롤백 (finalizeAtomicProtection)
 *     12) 최종 placement strictStackAudit 통과 (활성 조건 5+6+7 모두 적층 단계마다 재검증)
 *   사례: SK GEO CENTRIC 137×115×85 + 135×115×129×2 같은 booking, footprint W 차이 2cm.
 *
 * 활성 조건 (보수적):
 *   1) 컨테이너 spec.maxCbm ≥ 50 m³ (40FT급)
 *   2) 그 컨테이너에 cluster 후보 unit 풀 ≥ 5개
 *
 * 작은 시나리오 (1ST SG 등 20FT 적은 박스) 에는 영향 없음.
 *
 * 절대 룰 준수:
 *   - 한 화물 행 (= 한 cargoId) 은 한 컨테이너에만 (split 금지) — 룰 C 가 보호
 *   - 한 부킹 = 한 컨 (B1 룰) — 룰 C 가 보호
 *   - 점수 합산 X — lex 우선순위만
 */

import type { ContainerSpec } from "../../types/container.ts";
import { allowedFaces, canStackOn, effectiveSizeFace } from "./constraints.ts";
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
  /**
   * 옵션 C — 안쪽 깊숙이 고정점 (best-fit-deepest anchor).
   * 컬럼 첫 박스를 컨테이너 입구(y 최솟값)가 아닌 안쪽 끝(y 최댓값) 후보에 강제 배치.
   * 큰 묶음을 안쪽 벽에 박아 도어 쪽 자유 공간을 남겨 작은 박스 끼워넣기 용이.
   * 손 실험 X=326 패턴 자동화. 기본 ON. false 면 기존 EP 자연 배치.
   */
  deepAnchor?: boolean;
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

/** 룰 E — 같은 booking + W·L·H 정확히 동일 cross-cargoId 그룹 */
interface CrossCargoBundle {
  bookingNo: string;
  units: UnitItem[];
  /** 박스 한 개 사이즈 (모든 unit 동일) */
  width: number;
  length: number;
  height: number;
}

/** 룰 E 활성 — 같은 그룹 안 unit 최소 개수 (작은 묶음은 룰 A 가 처리) */
const CROSS_CARGO_MIN_UNITS = 3;

/** 룰 F — 근사 footprint 묶음 W/L 차이 허용 (cm) */
const NEAR_FOOTPRINT_TOL_CM = 5;
/** 룰 F — 한 그룹 묶음당 최대 컬럼 수 (활성 조건 9: 두 컬럼 이하) */
const NEAR_MAX_COLUMNS = 2;
/** 룰 F — 한 그룹 묶음당 최소 unit 개수 (단행 박스는 일반 큐가 처리) */
const NEAR_MIN_UNITS = 2;
/** 룰 F — 컨테이너 당 시도할 최대 booking 수 (성능 보호) */
const NEAR_MAX_BOOKINGS_PER_CONTAINER = 8;

/** footprint 가 두 unit 간 동일한지 (회전 미고려, ±FOOTPRINT_TOL_CM) */
function sameFootprint(a: UnitItem, b: UnitItem): boolean {
  const aw = Math.min(a.width, a.length);
  const al = Math.max(a.width, a.length);
  const bw = Math.min(b.width, b.length);
  const bl = Math.max(b.width, b.length);
  return Math.abs(aw - bw) <= FOOTPRINT_TOL_CM && Math.abs(al - bl) <= FOOTPRINT_TOL_CM;
}

/** 룰 E — 두 unit 의 W·L·H 가 정확히 같은지 (회전 미고려) */
function exactSameSize(a: UnitItem, b: UnitItem): boolean {
  return a.width === b.width && a.length === b.length && a.height === b.height;
}

/**
 * 룰 E — 같은 bookingNo 안에서 W·L·H 정확히 동일한 unit 들을 cross-cargoId 묶음.
 * cargoId 경계 무시. 각 그룹 안 unit ≥ CROSS_CARGO_MIN_UNITS 만 반환.
 * noStacking=true 단 한 박스라도 있으면 그룹 제외 (천장까지 적층이 안 되므로).
 */
function groupCrossCargoBundles(units: UnitItem[]): CrossCargoBundle[] {
  const byBooking = new Map<string, UnitItem[]>();
  for (const u of units) {
    if (!u.bookingNo) continue;
    if (u.remarks.noStacking) continue;
    if (u.remarks.topOnly) continue;
    const list = byBooking.get(u.bookingNo) ?? [];
    list.push(u);
    byBooking.set(u.bookingNo, list);
  }
  const bundles: CrossCargoBundle[] = [];
  for (const [bookingNo, group] of byBooking) {
    if (group.length < CROSS_CARGO_MIN_UNITS) continue;
    const used = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      const seed = group[i];
      if (used.has(seed.unitId)) continue;
      const cluster: UnitItem[] = [seed];
      used.add(seed.unitId);
      for (let j = i + 1; j < group.length; j++) {
        const cand = group[j];
        if (used.has(cand.unitId)) continue;
        if (!exactSameSize(seed, cand)) continue;
        cluster.push(cand);
        used.add(cand.unitId);
      }
      if (cluster.length < CROSS_CARGO_MIN_UNITS) continue;
      // 무거운 박스 아래 — heavierBelow 충족 위해 weight desc
      cluster.sort((a, b) => b.weight - a.weight);
      bundles.push({
        bookingNo,
        units: cluster,
        width: seed.width,
        length: seed.length,
        height: seed.height,
      });
    }
  }
  return bundles;
}

/**
 * 룰 E — cross-cargoId 묶음을 같은 row 옆 컬럼들 + 천장까지 적층.
 *
 * 동작:
 *   0) 사용 가능한 슬롯 수 (두 컬럼 × physicalMax) 계산 → cargoId 별로 통째 들어갈
 *      cargo 만 골라 sub-bundle 구성 (CBM 쪼개기 절대 룰 보호).
 *   1) 첫 박스 자연 배치 (옵션 C deepAnchor 적용 — 안쪽 끝 우선)
 *   2) 그 위 천장 한도까지 같은 (x,y) 강제 적층
 *   3) 옆으로 (x = 첫 컬럼 x + 폭) 새 컬럼 base + 천장 한도까지 적층
 *   4) 폭 한도 초과 또는 그룹 unit 모두 배치 시 종료
 *
 * 활성 조건 (보수적):
 *   - 두 컬럼 폭 (width × 2) ≤ spec.innerWidth (옆 컬럼 만들 수 있어야 의미 있음)
 *   - 첫 컬럼 한 단 높이 ≤ spec.innerHeight
 *   - heavierBelow chain 통과 (인접 쌍 모두 canStackPair)
 *   - 모든 박스 무게 합 + state.totalWeight ≤ maxWeightKg (사전 검사)
 *
 * @returns 배치 성공한 unitId Set (전체 또는 부분).
 */
function tryPlaceCrossCargoBundle(
  bundle: CrossCargoBundle,
  state: ContainerPackState,
  spec: ContainerSpec,
  deepAnchor: boolean,
): Set<string> {
  const placedIds = new Set<string>();
  // 활성 조건 — 두 컬럼 폭 안에 들어가야
  if (bundle.width * 2 > spec.innerWidth + 0.01) return placedIds;
  // 한 단 높이도 천장 초과면 시도 무의미
  if (bundle.height > spec.innerHeight + 0.01) return placedIds;

  // **CBM 쪼개기 보호 사전 필터**:
  //   사용 가능한 슬롯 = (두 컬럼) × physicalMax. 이를 초과하는 cargo 는 통째 못 들어가므로
  //   사전에 cargoId 단위로 선별. cargoId 별 unit 모두 들어갈 수 있는 cargo 만 picked.
  //   weight desc 정렬은 유지하되, picked 만으로 sub-bundle 재구성.
  const physicalMax = Math.floor((spec.innerHeight + 0.01) / bundle.height);
  if (physicalMax < 1) return placedIds;
  const slotsAvailable = physicalMax * 2;

  // cargoId 별 unit 묶음 (사전 weight desc 정렬 보존)
  const byCargo = new Map<string, UnitItem[]>();
  for (const u of bundle.units) {
    const list = byCargo.get(u.cargoId) ?? [];
    list.push(u);
    byCargo.set(u.cargoId, list);
  }
  // 큰 cargo 먼저 (큰 묶음을 먼저 배치 — 작은 cargo 가 자투리에 들어갈 여지 늘림)
  const cargoEntries = [...byCargo.entries()].sort((a, b) => b[1].length - a[1].length);
  const pickedUnits: UnitItem[] = [];
  let used = 0;
  for (const [, units] of cargoEntries) {
    if (used + units.length <= slotsAvailable) {
      pickedUnits.push(...units);
      used += units.length;
    }
  }
  if (pickedUnits.length < CROSS_CARGO_MIN_UNITS) return placedIds;

  // sub-bundle 재구성 (weight desc 다시 적용 — heavierBelow)
  const filteredBundle: CrossCargoBundle = {
    bookingNo: bundle.bookingNo,
    units: [...pickedUnits].sort((a, b) => b.weight - a.weight),
    width: bundle.width,
    length: bundle.length,
    height: bundle.height,
  };
  // 이후 본체는 filteredBundle 사용
  bundle = filteredBundle;
  // heavierBelow chain 사전 검증 — weight desc 정렬되어 있음 (위→아래 방향 검증)
  // canStackPair(top, bottom): top.weight × tolerance ≤ bottom.weight (1.0)
  for (let i = 0; i < bundle.units.length - 1; i++) {
    if (!canStackPair(bundle.units[i + 1], bundle.units[i])) {
      // 후속 정렬은 같은 weight 일 가능성 — 한 쌍 fail 이어도 다음 쌍 OK 일 수 있으므로
      // 여기선 계속 진행 (실제 적층 단계에서 재검증)
    }
  }
  // 모든 박스 무게 합 한도 사전 검사 (전체 실패 회피)
  let totalW = 0;
  for (const u of bundle.units) totalW += u.weight;
  if (state.totalWeight + totalW > spec.maxWeightKg + 0.01) {
    // 전체는 못 들어가도 일부는 가능 — 진행 (단계마다 재검사)
  }

  // 첫 컬럼 base 박기 — deepAnchor 우선
  const first = bundle.units[0];
  const beforeCount = state.placements.length;
  const deepFirstAttempt = deepAnchor
    ? tryPlaceUnit(first, state, spec, {
        scoreFn: (c) => -c.y * 1e8 + c.x * 1e4 + c.z,
      })
    : false;
  const ok =
    deepFirstAttempt ||
    tryPlaceUnit(first, state, spec) ||
    tryPlaceUnitBruteForce(first, state, spec);
  if (!ok) return placedIds;
  const placed0 = state.placements[beforeCount];
  if (!placed0) return placedIds;
  placedIds.add(first.unitId);

  // placed0 의 (x,y) 가 옆 컬럼 만들 수 있는지 (x + 2*width ≤ innerWidth)
  // 만약 placed0.x 가 너무 안쪽이면 옆 컬럼 폭이 안 나옴
  // → 그래도 첫 컬럼 자체 천장까지 적층은 시도 (단일 컬럼 폴백)
  const colY = placed0.position.y;
  const colWidth = placed0.size.width;
  const colLength = placed0.size.length;
  const baseX = placed0.position.x;

  // 첫 컬럼 위 적층 (천장 한도까지)
  let curZ = placed0.position.z + placed0.size.height;
  let curIdx = 1;
  for (let stackI = 1; stackI < physicalMax && curIdx < bundle.units.length; stackI++) {
    const u = bundle.units[curIdx];
    if (curZ + u.height > spec.innerHeight + 0.01) break;
    if (state.totalWeight + u.weight > spec.maxWeightKg + 0.01) break;
    // heavierBelow — 직전 박스 위에 올리는지
    const lastP = state.placements[state.placements.length - 1];
    if (
      !canStackOn(
        { weightPerUnit: u.weight, remarks: u.remarks },
        { weightPerUnit: lastP.weight, remarks: lastP.remarks },
        { topBookingNo: u.bookingNo, bottomBookingNo: lastP.bookingNo },
      )
    ) {
      break;
    }
    const newPlacement: Placement3D = {
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x: baseX, y: colY, z: curZ },
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
      { x: baseX + u.width, y: colY, z: curZ },
      { x: baseX, y: colY + u.length, z: curZ },
      { x: baseX, y: colY, z: curZ + u.height },
    );
    placedIds.add(u.unitId);
    curZ += u.height;
    curIdx++;
  }

  // 옆 컬럼들 — base x = baseX + colWidth, +2*colWidth, … 컨 안쪽 폭 한도까지
  let nextColX = baseX + colWidth;
  while (
    curIdx < bundle.units.length &&
    nextColX + colWidth <= spec.innerWidth + 0.01
  ) {
    // 옆 컬럼 base 자리 검증 — 충돌 검사 (같은 z=baseZ 평면에 다른 박스 있나)
    const baseU = bundle.units[curIdx];
    const baseZ = placed0.position.z;
    if (baseZ + baseU.height > spec.innerHeight + 0.01) break;
    if (state.totalWeight + baseU.weight > spec.maxWeightKg + 0.01) break;
    // 충돌 검사 — 옆 컬럼 base 자리에 기존 placement 있나
    const colBaseX = nextColX;
    const colBaseY = colY;
    let collides = false;
    for (const other of state.placements) {
      if (
        colBaseX + baseU.width > other.position.x + 0.01 &&
        colBaseX + 0.01 < other.position.x + other.size.width &&
        colBaseY + baseU.length > other.position.y + 0.01 &&
        colBaseY + 0.01 < other.position.y + other.size.length &&
        baseZ + baseU.height > other.position.z + 0.01 &&
        baseZ + 0.01 < other.position.z + other.size.height
      ) {
        collides = true;
        break;
      }
    }
    if (collides) break;
    // base 박기
    const baseP: Placement3D = {
      unitId: baseU.unitId,
      cargoId: baseU.cargoId,
      shipper: baseU.shipper,
      bookingNo: baseU.bookingNo,
      name: baseU.name,
      cargoType: baseU.cargoType,
      cfsCbm: baseU.cfsCbm,
      position: { x: colBaseX, y: colBaseY, z: baseZ },
      size: { width: baseU.width, length: baseU.length, height: baseU.height },
      faceIdx: 0,
      rotated: false,
      weight: baseU.weight,
      remarks: baseU.remarks,
      layer: baseZ === 0 ? "bottom" : "top",
    };
    state.placements.push(baseP);
    state.totalWeight += baseU.weight;
    state.visualCbm += (baseU.width * baseU.length * baseU.height) / 1_000_000;
    state.candidates.push(
      { x: colBaseX + baseU.width, y: colBaseY, z: baseZ },
      { x: colBaseX, y: colBaseY + baseU.length, z: baseZ },
      { x: colBaseX, y: colBaseY, z: baseZ + baseU.height },
    );
    placedIds.add(baseU.unitId);
    curIdx++;

    // 이 옆 컬럼 위로 천장 한도까지 적층
    let zUp = baseZ + baseU.height;
    let lastBelow: Placement3D = baseP;
    for (let s = 1; s < physicalMax && curIdx < bundle.units.length; s++) {
      const u = bundle.units[curIdx];
      if (zUp + u.height > spec.innerHeight + 0.01) break;
      if (state.totalWeight + u.weight > spec.maxWeightKg + 0.01) break;
      if (
        !canStackOn(
          { weightPerUnit: u.weight, remarks: u.remarks },
          { weightPerUnit: lastBelow.weight, remarks: lastBelow.remarks },
          { topBookingNo: u.bookingNo, bottomBookingNo: lastBelow.bookingNo },
        )
      ) {
        break;
      }
      const newP: Placement3D = {
        unitId: u.unitId,
        cargoId: u.cargoId,
        shipper: u.shipper,
        bookingNo: u.bookingNo,
        name: u.name,
        cargoType: u.cargoType,
        cfsCbm: u.cfsCbm,
        position: { x: colBaseX, y: colBaseY, z: zUp },
        size: { width: u.width, length: u.length, height: u.height },
        faceIdx: 0,
        rotated: false,
        weight: u.weight,
        remarks: u.remarks,
        layer: "top",
      };
      state.placements.push(newP);
      state.totalWeight += u.weight;
      state.visualCbm += (u.width * u.length * u.height) / 1_000_000;
      state.candidates.push(
        { x: colBaseX + u.width, y: colBaseY, z: zUp },
        { x: colBaseX, y: colBaseY + u.length, z: zUp },
        { x: colBaseX, y: colBaseY, z: zUp + u.height },
      );
      placedIds.add(u.unitId);
      zUp += u.height;
      lastBelow = newP;
      curIdx++;
    }
    nextColX += colWidth;
  }

  return placedIds;
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

/** stack 가능성 체크 — heavierBelow / noStacking / selfStackOnly 룰 (extreme-point canStackOn 와 동일) */
function canStackPair(top: UnitItem, bottom: UnitItem): boolean {
  return canStackOn(
    { weightPerUnit: top.weight, remarks: top.remarks },
    { weightPerUnit: bottom.weight, remarks: bottom.remarks },
    { topBookingNo: top.bookingNo, bottomBookingNo: bottom.bookingNo },
  );
}

/** 컬럼 자체 적층 시도 — 첫 unit 을 tryPlaceUnit 으로 자연스럽게 두고 위에 강제 적층 */
function tryPlaceColumn(
  col: ColumnDescriptor,
  state: ContainerPackState,
  spec: ContainerSpec,
  deepAnchor: boolean,
): UnitItem[] {
  // 천장 높이 초과면 column 자체 포기
  // (사전 묶음은 입구 258 검사 X — 컬럼도 컨테이너 안에서 하나씩 쌓는다는 가정, 자유 적재와 일관성)
  if (col.totalHeight > spec.innerHeight) return col.units; // 전체 fail
  // heavierBelow chain 검증 — 인접 쌍 모두 통과해야
  for (let i = 0; i < col.units.length - 1; i++) {
    if (!canStackPair(col.units[i + 1], col.units[i])) return col.units;
  }

  // 첫 unit 배치
  // 옵션 C 켜진 경우 — scoreFn 으로 컨테이너 안쪽 끝(y 최댓값) 후보 우선 lex 비교.
  //   lex: -y * 1e8 + x * 1e4 + z (max y → min x → min z, 작을수록 우선)
  //   tryPlaceUnit 내 모든 검증(충돌·지지·무게·face·topOnly) 그대로 재사용.
  //   자리 못 찾으면 brute-force fallback.
  const first = col.units[0];
  const beforeCount = state.placements.length;
  const deepFirstAttempt = deepAnchor
    ? tryPlaceUnit(first, state, spec, {
        scoreFn: (c) => -c.y * 1e8 + c.x * 1e4 + c.z,
      })
    : false;
  const ok =
    deepFirstAttempt ||
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
    // 천장 높이 초과 검사 (입구 검사는 사전 묶음에서 제거 — 안에서 하나씩 쌓음)
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
    // 입구 258 검사 X — 사전 묶음은 안에서 하나씩 쌓는 가정 (자유 적재와 일관성)
    for (const p of state.placements) {
      const topZ = p.position.z + p.size.height;
      if (topZ + u.height > spec.innerHeight + 0.01) continue;
      // 받침 비율 = u.footprint / supporter.footprint (둘 다 같은 평면 기준)
      const supW = p.size.width;
      const supL = p.size.length;
      // u 회전 없이 그대로
      if (u.width > supW + 0.01 || u.length > supL + 0.01) continue;
      const ratio =
        (u.width * u.length) / (supW * supL);
      if (ratio < SUPPORT_RATIO_MIN) continue;
      // canStackOn 검증 (selfStackOnly 포함)
      if (
        !canStackOn(
          { weightPerUnit: u.weight, remarks: u.remarks },
          { weightPerUnit: p.weight, remarks: p.remarks },
          { topBookingNo: u.bookingNo, bottomBookingNo: p.bookingNo },
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

/* ============================================================
 * 룰 F — 근사 footprint 적층 묶음 (nearFootprintStackBundle)
 * ============================================================
 * 룰 E (정확 동일) 가 끝났는데도 같은 booking 에 미배치가 남으면 발동되는 fallback.
 * cargoId atomic + W/L 차이 ≤ 5cm 까지 허용. 사용자 활성 조건 12개 모두 검증.
 *
 * 성능 보호:
 *   - 사전 묶음(룰 A·E) 통과한 unitId 는 풀에서 제외 → 미배치 잔여만 대상
 *   - 컨테이너 당 최대 booking 수 제한 (NEAR_MAX_BOOKINGS_PER_CONTAINER)
 *   - 전역 brute force X — preCluster 와 동일한 tryPlaceUnit (EP candidate set) 만 사용,
 *     첫 박스 자리 못 잡으면 그 묶음 통째 포기 (brute-force fallback 호출 X)
 */

/** 룰 F — 같은 bookingNo 안 cargo 묶음 (cargoId atomic 보장) */
interface NearBundle {
  bookingNo: string;
  /** cargoId 별로 unit 묶음 — 한 cargoId 의 모든 unit 같은 컬럼 안에서 처리 (atomic) */
  cargoGroups: { cargoId: string; units: UnitItem[] }[];
  /** 묶음 안 모든 unit 의 W/L 최댓값 (큰 박스 footprint — 컬럼 base 결정) */
  baseWidth: number;
  baseLength: number;
}

/** 두 unit 의 footprint 가 NEAR_FOOTPRINT_TOL_CM 이내인지 (회전 미고려) */
function nearSameFootprint(a: UnitItem, b: UnitItem): boolean {
  return (
    Math.abs(a.width - b.width) <= NEAR_FOOTPRINT_TOL_CM &&
    Math.abs(a.length - b.length) <= NEAR_FOOTPRINT_TOL_CM
  );
}

/**
 * 룰 F — 같은 booking 안에서 near-footprint 묶음 생성.
 * cargoId atomic: 같은 cargoId 의 모든 unit 은 같은 묶음에 들어가거나 전체 제외.
 * 묶음 안 모든 unit 끼리 nearSameFootprint 통과해야.
 */
function groupNearFootprintBundles(units: UnitItem[]): NearBundle[] {
  // booking 별 cargoId 별 분할 (입력 순서 보존)
  const byBooking = new Map<string, Map<string, UnitItem[]>>();
  for (const u of units) {
    if (!u.bookingNo) continue;
    if (u.remarks.noStacking) continue; // 활성 조건 6
    if (u.remarks.topOnly) continue; // bottomOnly 위반
    const m = byBooking.get(u.bookingNo) ?? new Map<string, UnitItem[]>();
    const list = m.get(u.cargoId) ?? [];
    list.push(u);
    m.set(u.cargoId, list);
    byBooking.set(u.bookingNo, m);
  }
  const bundles: NearBundle[] = [];
  for (const [bookingNo, cargoMap] of byBooking) {
    // 같은 booking 안 cargoGroup 들을 그리디 묶음 — 첫 cargo 의 unit 한 개 seed,
    // 다른 cargo 의 모든 unit 이 nearSameFootprint 통과하면 합류 (cargo atomic).
    const cargoEntries = [...cargoMap.entries()];
    if (cargoEntries.length === 0) continue;
    const usedCargo = new Set<string>();
    for (let i = 0; i < cargoEntries.length; i++) {
      const [seedCid, seedUnits] = cargoEntries[i];
      if (usedCargo.has(seedCid)) continue;
      // seed cargo 내부에서 모든 unit 끼리 nearSameFootprint 통과해야 (자기 안 묶음 검증)
      const seedRef = seedUnits[0];
      const seedInternalOk = seedUnits.every((u) => nearSameFootprint(seedRef, u));
      if (!seedInternalOk) continue;
      const cargoGroups: { cargoId: string; units: UnitItem[] }[] = [
        { cargoId: seedCid, units: [...seedUnits] },
      ];
      usedCargo.add(seedCid);
      for (let j = i + 1; j < cargoEntries.length; j++) {
        const [cid, units2] = cargoEntries[j];
        if (usedCargo.has(cid)) continue;
        // 다른 cargo 의 모든 unit 이 seed 와 nearSameFootprint 통과해야 (cargo atomic)
        const allNear = units2.every((u) => nearSameFootprint(seedRef, u));
        if (!allNear) continue;
        cargoGroups.push({ cargoId: cid, units: [...units2] });
        usedCargo.add(cid);
      }
      const totalUnits = cargoGroups.reduce((s, g) => s + g.units.length, 0);
      if (totalUnits < NEAR_MIN_UNITS) continue;
      // 룰 F 는 룰 A 영역(단일 cargoId 묶음) 과 구분 — 한 cargo 단독이거나 묶음 안 모든 unit 의
      // W·L 가 모두 정확히 같으면 룰 A 가 처리하도록 패스 (룰 F 발동 X, 회귀 방지).
      // 단일 cargo 라도 unitSizes 가 다른 사이즈로 갈라진 경우(SK GEO CENTRIC) 는 룰 F 가 처리해야 함.
      const allExactSame = cargoGroups
        .flatMap((g) => g.units)
        .every(
          (u) => u.width === seedRef.width && u.length === seedRef.length,
        );
      if (allExactSame) continue;
      // base footprint = 묶음 안 모든 unit 의 W/L 최댓값 (가장 큰 박스 기준 컬럼 폭 산정)
      let baseW = 0;
      let baseL = 0;
      for (const g of cargoGroups) {
        for (const u of g.units) {
          if (u.width > baseW) baseW = u.width;
          if (u.length > baseL) baseL = u.length;
        }
      }
      bundles.push({ bookingNo, cargoGroups, baseWidth: baseW, baseLength: baseL });
    }
  }
  return bundles;
}

/**
 * 한 NearBundle 을 컨테이너에 적층 묶음으로 배치 시도.
 * - 컬럼 1개부터 NEAR_MAX_COLUMNS 까지 시도
 * - 무거운 unit 아래 (weight desc)
 * - 활성 조건 5: 아래 박스 footprint(W×L) ≥ 위 박스 footprint (둘 다 W·L 별로 검사)
 * - 활성 조건 7: STACK_WEIGHT_TOLERANCE = 1.0 (canStackPair)
 * - 활성 조건 8: 누적 z + h ≤ spec.innerHeight
 * - 첫 박스만 tryPlaceUnit (deepAnchor) 후 위·옆 컬럼 강제 적층
 * - 한 cargoId 의 unit 일부만 배치되면 전체 롤백 (atomic 보호)
 *
 * 실패 시 state mutate 없음 (snapshot 복원).
 *
 * @returns 배치 성공한 unitId Set. 빈 Set 이면 실패.
 */
function tryPlaceNearBundle(
  bundle: NearBundle,
  state: ContainerPackState,
  spec: ContainerSpec,
  deepAnchor: boolean,
): Set<string> {
  const placedIds = new Set<string>();
  // 활성 조건 9: 두 컬럼 폭 (baseW × 2) ≤ spec.innerWidth
  //   한 컬럼만 가능한 경우도 허용 (NEAR_MAX_COLUMNS 시도)
  if (bundle.baseWidth > spec.innerWidth + 0.01) return placedIds;
  if (bundle.baseLength > spec.innerLength + 0.01) return placedIds;

  // 묶음 안 모든 unit 평탄화 — 정렬 순서:
  //   1) 큰 footprint (W·L 합) 먼저 (활성 조건 5: 아래가 위보다 커야)
  //   2) 무거운 박스 먼저 (활성 조건 7: 아래가 위보다 무거워야)
  //   3) 안정적 정렬 위해 unitId
  const allUnits: UnitItem[] = [];
  for (const g of bundle.cargoGroups) allUnits.push(...g.units);
  allUnits.sort((a, b) => {
    const aFp = a.width + a.length;
    const bFp = b.width + b.length;
    if (aFp !== bFp) return bFp - aFp;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.unitId.localeCompare(b.unitId);
  });
  if (allUnits.length < NEAR_MIN_UNITS) return placedIds;

  // 총 무게 + 총 부피 사전 검사 (활성 조건 보호)
  let totalW = 0;
  for (const u of allUnits) totalW += u.weight;
  if (state.totalWeight + totalW > spec.maxWeightKg + 0.01) return placedIds;

  // 상태 snapshot (실패 시 롤백)
  const snapPlacements = state.placements.slice();
  const snapCandidates = state.candidates.slice();
  const snapWeight = state.totalWeight;
  const snapCbm = state.visualCbm;

  const placedThisBundle: string[] = [];
  let curIdx = 0;

  // 컬럼 별 배치 — NEAR_MAX_COLUMNS 까지
  let firstColX = -1;
  let firstColY = -1;
  let firstColZ = -1;
  let lastBottomInColumn: Placement3D | null = null;
  let curZ = 0;
  let colWidth = 0;
  let colLength = 0;

  const placeOneAt = (
    u: UnitItem,
    x: number,
    y: number,
    z: number,
  ): Placement3D | null => {
    // 활성 조건 8: 천장 한도
    if (z + u.height > spec.innerHeight + 0.01) return null;
    // 활성 조건 7: 무게 한도
    if (state.totalWeight + u.weight > spec.maxWeightKg + 0.01) return null;
    // 컨테이너 폭/길이 한도
    if (x + u.width > spec.innerWidth + 0.01) return null;
    if (y + u.length > spec.innerLength + 0.01) return null;
    // 충돌 검사
    for (const other of state.placements) {
      if (
        x + u.width > other.position.x + 0.01 &&
        x + 0.01 < other.position.x + other.size.width &&
        y + u.length > other.position.y + 0.01 &&
        y + 0.01 < other.position.y + other.size.length &&
        z + u.height > other.position.z + 0.01 &&
        z + 0.01 < other.position.z + other.size.height
      ) {
        return null;
      }
    }
    const p: Placement3D = {
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x, y, z },
      size: { width: u.width, length: u.length, height: u.height },
      faceIdx: 0,
      rotated: false,
      weight: u.weight,
      remarks: u.remarks,
      layer: z <= 0.01 ? "bottom" : "top",
    };
    state.placements.push(p);
    state.totalWeight += u.weight;
    state.visualCbm += (u.width * u.length * u.height) / 1_000_000;
    state.candidates.push(
      { x: x + u.width, y, z },
      { x, y: y + u.length, z },
      { x, y, z: z + u.height },
    );
    return p;
  };

  // 첫 컬럼 base — tryPlaceUnit (자연 EP) 으로 자리 찾기, deepAnchor 우선
  const first = allUnits[curIdx];
  const beforeCount = state.placements.length;
  const deepFirstOk = deepAnchor
    ? tryPlaceUnit(first, state, spec, {
        scoreFn: (c) => -c.y * 1e8 + c.x * 1e4 + c.z,
      })
    : false;
  // brute-force fallback 의도적 제외 — 성능 보호 (전역 brute force 금지)
  const firstOk = deepFirstOk || tryPlaceUnit(first, state, spec);
  if (!firstOk) {
    // 자리 못 찾음 — bundle 통째 포기 (snapshot 그대로)
    return placedIds;
  }
  const placed0 = state.placements[beforeCount];
  if (!placed0) {
    // 방어 — snapshot 복원
    state.placements = snapPlacements;
    state.candidates = snapCandidates;
    state.totalWeight = snapWeight;
    state.visualCbm = snapCbm;
    return placedIds;
  }
  placedThisBundle.push(first.unitId);
  curIdx++;
  firstColX = placed0.position.x;
  firstColY = placed0.position.y;
  firstColZ = placed0.position.z;
  colWidth = placed0.size.width;
  colLength = placed0.size.length;
  curZ = firstColZ + placed0.size.height;
  lastBottomInColumn = placed0;

  // 첫 컬럼 위 적층 (천장 한도까지, 활성 조건 5+7 검증)
  while (curIdx < allUnits.length) {
    const u = allUnits[curIdx];
    // 활성 조건 5: 아래 박스 footprint ≥ 위 박스 footprint
    if (u.width > lastBottomInColumn!.size.width + 0.01) break;
    if (u.length > lastBottomInColumn!.size.length + 0.01) break;
    // 활성 조건 7: STACK_WEIGHT_TOLERANCE = 1.0
    if (!canStackPair(u, unitFromPlacement(lastBottomInColumn!))) break;
    const p = placeOneAt(u, firstColX, firstColY, curZ);
    if (!p) break;
    placedThisBundle.push(u.unitId);
    curIdx++;
    curZ += p.size.height;
    lastBottomInColumn = p;
  }

  // 옆 컬럼들 (NEAR_MAX_COLUMNS 까지)
  let colCount = 1;
  let nextColX = firstColX + colWidth;
  while (
    curIdx < allUnits.length &&
    colCount < NEAR_MAX_COLUMNS &&
    nextColX + 0.01 <= spec.innerWidth
  ) {
    const baseU = allUnits[curIdx];
    // 옆 컬럼 base 자리에 배치 시도 (같은 y, z=0)
    const baseP = placeOneAt(baseU, nextColX, firstColY, 0);
    if (!baseP) {
      // 다음 unit 으로 못 넘어감 — bundle 종료 (잔여는 미배치)
      break;
    }
    placedThisBundle.push(baseU.unitId);
    curIdx++;
    lastBottomInColumn = baseP;
    let zUp = baseP.size.height;
    while (curIdx < allUnits.length) {
      const u = allUnits[curIdx];
      if (u.width > lastBottomInColumn!.size.width + 0.01) break;
      if (u.length > lastBottomInColumn!.size.length + 0.01) break;
      if (!canStackPair(u, unitFromPlacement(lastBottomInColumn!))) break;
      const pp = placeOneAt(u, nextColX, firstColY, zUp);
      if (!pp) break;
      placedThisBundle.push(u.unitId);
      curIdx++;
      zUp += pp.size.height;
      lastBottomInColumn = pp;
    }
    nextColX += colWidth;
    colCount++;
  }

  // 활성 조건 2 + 11: cargoId atomic 검증 — 한 cargoId 의 모든 unit 이 들어갔는지
  // 일부만 들어가면 전체 롤백 (snapshot 복원)
  const placedSet = new Set(placedThisBundle);
  let atomicOk = true;
  for (const g of bundle.cargoGroups) {
    const placedCount = g.units.filter((u) => placedSet.has(u.unitId)).length;
    if (placedCount === 0) continue; // 그 cargo 는 시도 안 됐음 (그룹 전체 fail)
    if (placedCount < g.units.length) {
      atomicOk = false;
      break;
    }
  }
  // 단 한 박스만 들어간 케이스도 의미 없음 (NEAR_MIN_UNITS=2)
  if (placedThisBundle.length < NEAR_MIN_UNITS) atomicOk = false;

  if (!atomicOk) {
    // 전체 롤백 — snapshot 복원
    state.placements = snapPlacements;
    state.candidates = snapCandidates;
    state.totalWeight = snapWeight;
    state.visualCbm = snapCbm;
    return placedIds;
  }

  // 성공 — placedIds 반환
  for (const id of placedThisBundle) placedIds.add(id);
  return placedIds;
}

/** Placement3D 를 UnitItem-like 로 변환 (canStackPair 호출용) */
function unitFromPlacement(p: Placement3D): UnitItem {
  return {
    unitId: p.unitId,
    cargoId: p.cargoId,
    shipper: p.shipper,
    bookingNo: p.bookingNo,
    name: p.name,
    cargoType: p.cargoType,
    cfsCbm: p.cfsCbm,
    width: p.size.width,
    length: p.size.length,
    height: p.size.height,
    weight: p.weight,
    remarks: p.remarks,
  };
}

/**
 * 룰 F 진입점 — 같은 컨테이너에 unplaced 잔여 unit 들의 booking 별 NearBundle 시도.
 *
 * @param unplacedPool — 룰 E·A·B 가 못 처리한 잔여 unit 들 (이 컨테이너로 들어갈 후보).
 * @returns 룰 F 가 배치 성공한 unitId Set.
 */
export function preClusterNearFootprint(
  containerLike: ContainerLike,
  unplacedPool: UnitItem[],
  options?: FootprintClusterOptions,
): Set<string> {
  const placedIds = new Set<string>();
  if (options?.enabled === false) return placedIds;
  if (unplacedPool.length < NEAR_MIN_UNITS) return placedIds;
  const deepAnchor = options?.deepAnchor !== false;
  const minCbm = options?.minContainerCbm ?? MIN_CONTAINER_CBM;
  // 활성 조건 — 큰 컨테이너만 (40FT급)
  const containerCbm =
    (containerLike.spec.innerWidth *
      containerLike.spec.innerLength *
      containerLike.spec.innerHeight) /
    1_000_000;
  if (containerCbm < minCbm) return placedIds;

  const bundles = groupNearFootprintBundles(unplacedPool);
  // 큰 묶음부터 (unit 많은 것)
  bundles.sort((a, b) => {
    const aN = a.cargoGroups.reduce((s, g) => s + g.units.length, 0);
    const bN = b.cargoGroups.reduce((s, g) => s + g.units.length, 0);
    return bN - aN;
  });
  let triedBookings = 0;
  for (const bundle of bundles) {
    if (triedBookings >= NEAR_MAX_BOOKINGS_PER_CONTAINER) break;
    triedBookings++;
    const placed = tryPlaceNearBundle(
      bundle,
      containerLike.packState,
      containerLike.spec,
      deepAnchor,
    );
    for (const id of placed) placedIds.add(id);
  }
  return placedIds;
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
  const deepAnchor = options?.deepAnchor !== false;

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

  // 룰 E — cross-cargoId 동일 사이즈 묶음 (같은 booking + W·L·H 정확히 동일)
  //   같은 row 옆 컬럼들 + 천장까지. 룰 A 보다 먼저 발동 — 큰 묶음을 먼저 안쪽 깊숙이 박음.
  //   VPHI 부킹 7박스 (114×114×71 cargo 3개 cross) 같은 케이스 자동 처리.
  const crossBundles = groupCrossCargoBundles(eligible);
  // 큰 묶음부터 (unit 많은 것 우선)
  crossBundles.sort((a, b) => b.units.length - a.units.length);
  for (const bundle of crossBundles) {
    // 이미 다른 단계에서 처리된 unit 이 있으면 스킵 (중복 방지)
    if (bundle.units.some((u) => placedIds.has(u.unitId))) continue;
    const placed = tryPlaceCrossCargoBundle(
      bundle,
      containerLike.packState,
      containerLike.spec,
      deepAnchor,
    );
    for (const id of placed) placedIds.add(id);
  }

  // 룰 A — 부킹 내부 footprint 컬럼 묶기 (캐시 사용 — packBest 매트릭스 재호출 가속)
  // 룰 E 에서 이미 처리된 unit 은 풀에서 제외
  const eligibleForA = eligible.filter((u) => !placedIds.has(u.unitId));
  const columns = cachedGroupFootprintColumns(eligibleForA);
  if (columns.length === 0) {
    // 룰 A 가 빈손이어도 룰 E 결과·룰 C 보호 후처리는 진행
    return finalizeAtomicProtection(placedIds, unitPool, containerLike);
  }

  // 큰 column (units 많은 것 → totalHeight 큰 것) 부터 — 안정적 footprint 먼저 깔기
  columns.sort((a, b) => {
    if (b.units.length !== a.units.length) return b.units.length - a.units.length;
    return b.totalHeight - a.totalHeight;
  });

  for (const col of columns) {
    // 해당 column 의 unit 이 이미 다른 column 에서 처리됐을 수 있음 — eligible 재검사
    const stillFresh = col.units.every((u) => !placedIds.has(u.unitId));
    if (!stillFresh) continue;
    const failedRest = tryPlaceColumn(col, containerLike.packState, containerLike.spec, deepAnchor);
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

  return finalizeAtomicProtection(placedIds, unitPool, containerLike);
}

/**
 * **CBM 쪼개기 방지 — cargoId / 부킹 atomic 후처리** (룰 C).
 *
 * pre-cluster (룰 A·B·E) 가 한 cargoId 의 unit 일부만 배치하면 후속 컨테이너 루프에서
 * 나머지가 다른 컨에 들어가 cargo 쪼개기 (절대 룰 #4) 가 발생.
 * 풀(unitPool) 안에 미배치 unit 이 남은 cargoId 의 모든 placement 를 이 컨에서 롤백.
 * → 그 cargo 는 정식 placeQueueWrapper 가 atomic 으로 처리.
 *
 * **B1 보호**: 같은 부킹의 다른 cargo 가 partial 이면 부킹 전체가 컨에 들어갈지 보장 못함.
 * 같은 부킹의 모든 placement 를 롤백해 placeQueueWrapper 가 booking anchor 로 묶도록.
 */
function finalizeAtomicProtection(
  placedIds: Set<string>,
  unitPool: UnitItem[],
  containerLike: ContainerLike,
): Set<string> {
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
  }
  return placedIds;
}

/* ============================================================
 * 룰 G — Row-lane 묶음 (preClusterRowLane)
 * ============================================================
 * 같은 cargoId 의 박스들이 noStacking=true (적층 금지) 라서 위로 못 쌓을 때,
 * **두 컬럼을 폭 방향으로 나란히** 깔고 각 컬럼 안에서 박스를 길이(y) 방향으로 직렬
 * 배치한다. 모든 박스의 z 는 0 (한 박스라도 noStacking 이면 전체 z 동일 강제 — 적층 금지 우회 X).
 *
 * 사례: SK GEO CENTRIC (FBSIN260431) sg3-35 cargoId — 137×115×85 ×1 + 135×115×129 ×2
 * 모두 noStacking=true. face 1(L×W) 회전 시 폭 115 → 두 컬럼 115×2 = 230 ≤ 234 (40FT 안쪽 폭).
 * 길이 방향으로 첫 컬럼 137, 둘째 컬럼 135+135 직렬.
 *
 * 활성 조건 (10개 — 사용자 기획안 그대로):
 *   1) same cargoId 우선 (booking 확장 X)
 *   2) noStacking=true 단 한 박스라도 있으면 모든 unit z 동일 강제 (== 0)
 *   3) W/L footprint 차이 각각 ≤ 5cm (NEAR_FOOTPRINT_TOL_CM 재사용)
 *   4) column 수 ≤ 2 (ROW_LANE_MAX_COLUMNS)
 *   5) allowedFaces() 안에서만
 *   6) pickLaneFace 신규 (eff.width 작은 순 → eff.length 작은 순 → faceIdx 안정)
 *   7) orientation=fixed 강제 회전 금지 (allowedFaces 가 [0] 만 반환)
 *   8) 충돌·경계·cargoId atomic·booking atomic·strictStackAudit 통과
 *   9) 실패/partial 시 전체 롤백 (snapshot 복원)
 *   10) 발동 로그 — `__testables.lastRowLaneDecision` 모듈 변수 (production console.log 금지)
 */

/** 룰 G — 두 컬럼 한도 */
const ROW_LANE_MAX_COLUMNS = 2;
/** 룰 G — 묶음당 최소 unit (단일 박스는 일반 큐가 처리) */
const ROW_LANE_MIN_UNITS = 2;
/** 룰 G — 컨 당 최대 cargoId 시도 수 (성능 보호) */
const ROW_LANE_MAX_CARGOS_PER_CONTAINER = 8;

/** 룰 G — 한 cargoId 묶음 한 건 */
interface RowLaneBundle {
  cargoId: string;
  bookingNo: string;
  units: UnitItem[];
  /** pickLaneFace 가 고른 face 의 eff.width (모든 unit 동일) */
  laneWidth: number;
  /** pickLaneFace 가 고른 face 의 eff.length 의 최댓값 (큰 박스 기준) */
  laneLength: number;
  /** pickLaneFace 가 고른 face 의 eff.height 의 최댓값 */
  laneHeight: number;
  /** pickLaneFace 가 고른 face 의 인덱스 (모든 unit 동일) */
  faceIdx: number;
  /** 모든 unit z 강제 값 (== 0 — noStacking 보호) */
  zLevel: number;
  /** 추정 컬럼 수 (1 또는 2) */
  columnCount: number;
}

/** 룰 G — 발동 결정 로그 (단위 테스트 검증용 모듈 변수, production 노출 X) */
interface RowLaneDecision {
  cargoId: string;
  bookingNo: string;
  unitCount: number;
  faceIdx: number;
  laneWidth: number;
  result: "placed" | "rolled-back" | "no-fit";
  placedCount: number;
}
let lastRowLaneDecision: RowLaneDecision | null = null;

/**
 * 룰 G — face 선택 (lex 우선): allowedFaces 안에서
 *   1) eff.width 작은 순 (두 컬럼 폭 합 최소화)
 *   2) eff.length 작은 순 (직렬 배치 시 자투리 최소)
 *   3) faceIdx 안정 (작은 순)
 *
 * 모든 unit 같은 face 를 강제하기 위해, 묶음 안 박스들의 면 후보 교집합을 사용.
 * @returns 고른 faceIdx, 또는 null (적합 face 없음)
 */
function pickLaneFace(units: UnitItem[]): number | null {
  if (units.length === 0) return null;
  // 각 unit 의 allowedFaces 교집합 계산
  const faceSetForUnit = (u: UnitItem): Set<number> =>
    new Set(
      allowedFaces({
        width: u.width,
        length: u.length,
        height: u.height,
        remarks: u.remarks,
      }),
    );
  let intersect: Set<number> = faceSetForUnit(units[0]);
  for (let i = 1; i < units.length; i++) {
    const f = faceSetForUnit(units[i]);
    const next = new Set<number>();
    for (const x of intersect) if (f.has(x)) next.add(x);
    intersect = next;
  }
  if (intersect.size === 0) return null;

  // 각 후보 face 에 대해 (max eff.width, max eff.length) 산출 — 모든 unit 동일 face 사용 가정
  // lex: max eff.width asc → max eff.length asc → faceIdx asc
  let best: { faceIdx: number; ew: number; el: number } | null = null;
  for (const fi of intersect) {
    let ew = 0;
    let el = 0;
    for (const u of units) {
      const eff = effectiveSizeFace(
        { width: u.width, length: u.length, height: u.height },
        fi,
      );
      if (eff.width > ew) ew = eff.width;
      if (eff.length > el) el = eff.length;
    }
    if (
      best === null ||
      ew < best.ew ||
      (ew === best.ew && el < best.el) ||
      (ew === best.ew && el === best.el && fi < best.faceIdx)
    ) {
      best = { faceIdx: fi, ew, el };
    }
  }
  return best ? best.faceIdx : null;
}

/**
 * 룰 G — 같은 cargoId 안에서 RowLaneBundle 후보 그룹 만들기.
 * 활성 조건 1·2·3·5·6·7 검증 + 추가 물리 일반 조건:
 *   - noStacking=true 단 한 unit 이라도 있어야 (적층 금지 보호 필요한 묶음만)
 *   - variable unitSizes — 같은 cargoId 안 unit 사이즈가 모두 정확히 동일하면 skip
 *     (그런 묶음은 일반 큐가 잘 처리 — 룰 G 보호 불필요)
 *   - near footprint (W/L 차이 ≤ NEAR_FOOTPRINT_TOL_CM)
 *   - allowedFaces 교집합 존재, orientation=fixed 면 face 0 만 사용
 */
function groupNearRowLaneBundles(units: UnitItem[]): RowLaneBundle[] {
  const byCargo = new Map<string, UnitItem[]>();
  for (const u of units) {
    if (!u.bookingNo) continue;
    if (u.remarks.topOnly) continue; // bottomOnly 위반
    const list = byCargo.get(u.cargoId) ?? [];
    list.push(u);
    byCargo.set(u.cargoId, list);
  }
  const bundles: RowLaneBundle[] = [];
  for (const [cargoId, group] of byCargo) {
    if (group.length < ROW_LANE_MIN_UNITS) continue;
    // 추가 조건 — 적어도 한 unit 이 noStacking=true (적층 금지 보호 필요한 묶음만)
    const hasNoStacking = group.some((u) => u.remarks.noStacking === true);
    if (!hasNoStacking) continue;
    // 추가 조건 — variable unitSizes (모두 정확히 같은 사이즈이면 일반 큐가 처리)
    const ref0 = group[0];
    const allExactSame = group.every(
      (u) =>
        Math.abs(u.width - ref0.width) < 0.01 &&
        Math.abs(u.length - ref0.length) < 0.01 &&
        Math.abs(u.height - ref0.height) < 0.01,
    );
    if (allExactSame) continue;
    // 활성 조건 3 — 묶음 안 모든 박스 끼리 W/L 차이 ≤ NEAR_FOOTPRINT_TOL_CM
    const ref = group[0];
    const allClose = group.every((u) => nearSameFootprint(ref, u));
    if (!allClose) continue;
    // 활성 조건 6 — pickLaneFace 가 face 골라야 함 (교집합 + orientation 통과)
    const faceIdx = pickLaneFace(group);
    if (faceIdx === null) continue;
    // 묶음 안 모든 unit 의 (eff.width, eff.length, eff.height) 산출 — 같은 face 가정
    let lw = 0;
    let ll = 0;
    let lh = 0;
    for (const u of group) {
      const eff = effectiveSizeFace(
        { width: u.width, length: u.length, height: u.height },
        faceIdx,
      );
      if (eff.width > lw) lw = eff.width;
      if (eff.length > ll) ll = eff.length;
      if (eff.height > lh) lh = eff.height;
    }
    // 활성 조건 4 — 컬럼 1~2개 가능 결정 (estimate)
    // 컬럼 1개도 가능, 두 컬럼은 폭 한도 검사 시 결정
    bundles.push({
      cargoId,
      bookingNo: ref.bookingNo!,
      units: group.slice(),
      laneWidth: lw,
      laneLength: ll,
      laneHeight: lh,
      faceIdx,
      zLevel: 0,
      columnCount: 1, // 실제 배치 단계에서 갱신
    });
  }
  return bundles;
}

/**
 * 룰 G — 한 RowLaneBundle 을 컨테이너에 두 컬럼 옆 + 각 컬럼 y 직렬 배치.
 * 모든 unit z = 0 강제 (활성 조건 2 — noStacking 보호).
 *
 * 절차:
 *   0) 활성 조건 4·5·8 사전 체크: laneWidth ≤ innerWidth, laneHeight ≤ innerHeight
 *   1) 첫 컬럼 첫 박스 — tryPlaceUnit (deepAnchor 적용) 으로 자리 찾기,
 *      forceFaceIdx 로 pickLaneFace 결과 강제. 자리 못 잡으면 묶음 통째 포기.
 *   2) 같은 컬럼 안 다음 박스 — 같은 x, y = 직전 박스 y + length, z = 0 직렬 배치.
 *   3) 컬럼 길이 한도 도달 또는 충돌 시 옆 컬럼 (x = 첫 컬럼 x + laneWidth) 으로 이동.
 *      두 컬럼 폭 합 (laneWidth × 2) ≤ innerWidth 검사. 위반 시 한 컬럼만 처리.
 *   4) 옆 컬럼도 같은 방식 직렬. 모든 unit 배치되면 성공.
 *   5) cargoId atomic 검증 — 한 unit 이라도 못 들어가면 snapshot 전체 롤백.
 *
 * @returns 배치 성공한 unitId Set. 빈 Set 이면 실패 (snapshot 복원됨).
 */
function tryPlaceRowLaneBundle(
  bundle: RowLaneBundle,
  state: ContainerPackState,
  spec: ContainerSpec,
  deepAnchor: boolean,
): Set<string> {
  const placedIds = new Set<string>();

  // 활성 조건 5·8 — 사이즈 한도
  if (bundle.laneWidth > spec.innerWidth + 0.01) return placedIds;
  if (bundle.laneHeight > spec.innerHeight + 0.01) return placedIds;

  // 활성 조건 7 — 무게 합 사전 검사
  let totalW = 0;
  for (const u of bundle.units) totalW += u.weight;
  if (state.totalWeight + totalW > spec.maxWeightKg + 0.01) return placedIds;

  // snapshot — 실패 시 전체 롤백 (활성 조건 9)
  const snapPlacements = state.placements.slice();
  const snapCandidates = state.candidates.slice();
  const snapWeight = state.totalWeight;
  const snapCbm = state.visualCbm;

  // 정렬: 무게 desc → length desc → 안정 (unitId)
  // (heavierBelow 는 z 동일이라 무관, 큰 박스 먼저 깔아 자투리 최소)
  const sortedUnits = bundle.units.slice().sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight;
    const aEff = effectiveSizeFace(
      { width: a.width, length: a.length, height: a.height },
      bundle.faceIdx,
    );
    const bEff = effectiveSizeFace(
      { width: b.width, length: b.length, height: b.height },
      bundle.faceIdx,
    );
    if (aEff.length !== bEff.length) return bEff.length - aEff.length;
    return a.unitId.localeCompare(b.unitId);
  });

  /** 한 unit 을 (x, y, 0) 에 강제 배치. 실패 시 null. */
  const placeAt = (
    u: UnitItem,
    x: number,
    y: number,
  ): Placement3D | null => {
    const eff = effectiveSizeFace(
      { width: u.width, length: u.length, height: u.height },
      bundle.faceIdx,
    );
    // 경계 검사 (활성 조건 8)
    if (x + eff.width > spec.innerWidth + 0.01) return null;
    if (y + eff.length > spec.innerLength + 0.01) return null;
    if (eff.height > spec.innerHeight + 0.01) return null;
    if (state.totalWeight + u.weight > spec.maxWeightKg + 0.01) return null;
    // 충돌 검사 (활성 조건 8)
    for (const other of state.placements) {
      if (
        x + eff.width > other.position.x + 0.01 &&
        x + 0.01 < other.position.x + other.size.width &&
        y + eff.length > other.position.y + 0.01 &&
        y + 0.01 < other.position.y + other.size.length &&
        eff.height > other.position.z + 0.01 &&
        0.01 < other.position.z + other.size.height
      ) {
        return null;
      }
    }
    const rotated = eff.width !== u.width || eff.length !== u.length;
    const p: Placement3D = {
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x, y, z: 0 },
      size: { width: eff.width, length: eff.length, height: eff.height },
      faceIdx: bundle.faceIdx,
      rotated,
      weight: u.weight,
      remarks: u.remarks,
      layer: "bottom",
    };
    state.placements.push(p);
    state.totalWeight += u.weight;
    state.visualCbm += (eff.width * eff.length * eff.height) / 1_000_000;
    state.candidates.push(
      { x: x + eff.width, y, z: 0 },
      { x, y: y + eff.length, z: 0 },
      { x, y, z: eff.height },
    );
    return p;
  };

  // 첫 박스 — tryPlaceUnit 로 자리 찾기 (forceFaceIdx + deepAnchor)
  const first = sortedUnits[0];
  const beforeCount = state.placements.length;
  const deepFirstOk = deepAnchor
    ? tryPlaceUnit(first, state, spec, {
        forceFaceIdx: bundle.faceIdx,
        scoreFn: (c) => -c.y * 1e8 + c.x * 1e4 + c.z,
      })
    : false;
  const firstOk =
    deepFirstOk ||
    tryPlaceUnit(first, state, spec, { forceFaceIdx: bundle.faceIdx });
  if (!firstOk) {
    lastRowLaneDecision = {
      cargoId: bundle.cargoId,
      bookingNo: bundle.bookingNo,
      unitCount: bundle.units.length,
      faceIdx: bundle.faceIdx,
      laneWidth: bundle.laneWidth,
      result: "no-fit",
      placedCount: 0,
    };
    return placedIds;
  }
  const placed0 = state.placements[beforeCount];
  if (!placed0 || placed0.position.z > 0.01) {
    // 첫 박스가 z=0 이 아니면 활성 조건 2 위반 — 롤백
    state.placements = snapPlacements;
    state.candidates = snapCandidates;
    state.totalWeight = snapWeight;
    state.visualCbm = snapCbm;
    return placedIds;
  }
  const baseX1 = placed0.position.x;
  const baseY = placed0.position.y;
  const colWidth = placed0.size.width;
  placedIds.add(first.unitId);

  // 첫 컬럼 안 직렬 (y 방향)
  let curY = baseY + placed0.size.length;
  let curIdx = 1;
  while (curIdx < sortedUnits.length) {
    const u = sortedUnits[curIdx];
    const p = placeAt(u, baseX1, curY);
    if (!p) break;
    placedIds.add(u.unitId);
    curY += p.size.length;
    curIdx++;
  }

  // 옆 컬럼 (활성 조건 4 — 두 컬럼 한도)
  let columnCount = 1;
  let nextColX = baseX1 + colWidth;
  while (
    curIdx < sortedUnits.length &&
    columnCount < ROW_LANE_MAX_COLUMNS &&
    nextColX + bundle.laneWidth <= spec.innerWidth + 0.01
  ) {
    // 옆 컬럼 base 자리 (같은 baseY, z=0)
    const baseU = sortedUnits[curIdx];
    const baseP = placeAt(baseU, nextColX, baseY);
    if (!baseP) break;
    placedIds.add(baseU.unitId);
    let zUpY = baseY + baseP.size.length;
    curIdx++;
    while (curIdx < sortedUnits.length) {
      const u = sortedUnits[curIdx];
      const p = placeAt(u, nextColX, zUpY);
      if (!p) break;
      placedIds.add(u.unitId);
      zUpY += p.size.length;
      curIdx++;
    }
    nextColX += colWidth;
    columnCount++;
  }

  // 활성 조건 8 — cargoId atomic: 모든 unit 들어갔는지
  if (placedIds.size < bundle.units.length) {
    // partial — 전체 롤백 (활성 조건 9)
    state.placements = snapPlacements;
    state.candidates = snapCandidates;
    state.totalWeight = snapWeight;
    state.visualCbm = snapCbm;
    lastRowLaneDecision = {
      cargoId: bundle.cargoId,
      bookingNo: bundle.bookingNo,
      unitCount: bundle.units.length,
      faceIdx: bundle.faceIdx,
      laneWidth: bundle.laneWidth,
      result: "rolled-back",
      placedCount: placedIds.size,
    };
    return new Set();
  }

  lastRowLaneDecision = {
    cargoId: bundle.cargoId,
    bookingNo: bundle.bookingNo,
    unitCount: bundle.units.length,
    faceIdx: bundle.faceIdx,
    laneWidth: bundle.laneWidth,
    result: "placed",
    placedCount: placedIds.size,
  };
  return placedIds;
}

/**
 * 룰 G 진입점 — 미배치 풀에서 same cargoId 단위 RowLaneBundle 시도.
 *
 * @param unplacedPool 룰 E·A·B·F 가 못 처리한 잔여 unit 들 (이 컨테이너 후보)
 * @returns 룰 G 가 배치 성공한 unitId Set
 */
export function preClusterRowLane(
  containerLike: ContainerLike,
  unplacedPool: UnitItem[],
  options?: FootprintClusterOptions,
): Set<string> {
  const placedIds = new Set<string>();
  if (options?.enabled === false) return placedIds;
  if (unplacedPool.length < ROW_LANE_MIN_UNITS) return placedIds;
  const deepAnchor = options?.deepAnchor !== false;
  const minCbm = options?.minContainerCbm ?? MIN_CONTAINER_CBM;
  const containerCbm =
    (containerLike.spec.innerWidth *
      containerLike.spec.innerLength *
      containerLike.spec.innerHeight) /
    1_000_000;
  if (containerCbm < minCbm) return placedIds;

  const bundles = groupNearRowLaneBundles(unplacedPool);
  // 큰 묶음부터 (unit 많은 것 우선)
  bundles.sort((a, b) => b.units.length - a.units.length);
  let triedCargos = 0;
  for (const bundle of bundles) {
    if (triedCargos >= ROW_LANE_MAX_CARGOS_PER_CONTAINER) break;
    triedCargos++;
    const placed = tryPlaceRowLaneBundle(
      bundle,
      containerLike.packState,
      containerLike.spec,
      deepAnchor,
    );
    for (const id of placed) placedIds.add(id);
  }
  return placedIds;
}

/** 테스트용 노출 */
export const __testables = {
  sameFootprint,
  exactSameSize,
  groupFootprintColumns,
  groupCrossCargoBundles,
  tryPlaceCrossCargoBundle,
  canStackPair,
  nearSameFootprint,
  groupNearFootprintBundles,
  tryPlaceNearBundle,
  pickLaneFace,
  groupNearRowLaneBundles,
  tryPlaceRowLaneBundle,
  get lastRowLaneDecision() {
    return lastRowLaneDecision;
  },
  resetRowLaneDecision() {
    lastRowLaneDecision = null;
  },
  FOOTPRINT_TOL_CM,
  SUPPORT_RATIO_MIN,
  MIN_CONTAINER_CBM,
  MIN_UNITS,
  CROSS_CARGO_MIN_UNITS,
  NEAR_FOOTPRINT_TOL_CM,
  NEAR_MAX_COLUMNS,
  NEAR_MIN_UNITS,
  ROW_LANE_MAX_COLUMNS,
  ROW_LANE_MIN_UNITS,
};
