/**
 * 3D Bin Packing — extreme-point 방식 (자유 좌표 적재)
 *
 * "행(row)" 단위 제약을 폐기하고 컨테이너 전체를 한 덩어리 3D 공간으로 본다.
 * 각 화물은 자유 좌표 (x, y, z) 에 배치되며, 행 구분선은 적재가 끝난 후
 * 화면용으로만 따로 계산한다 (display-rows 모듈, Phase 2).
 *
 * 알고리즘 흐름:
 *  1) 후보점 리스트 = [(0, 0, 0)] — 컨테이너 입구 좌하단 안쪽 구석
 *  2) 각 화물 unit 에 대해 (모든 후보점) × (6면 회전) 조합 평가
 *  3) 제약을 모두 만족하는 후보 중 가장 안쪽-아래-왼쪽 (낮은 z, 낮은 y, 낮은 x) 에 배치
 *      - 컨테이너 안 (innerWidth/Length/Height)
 *      - 다른 화물과 3D AABB 충돌 없음
 *      - z > 0 이면 아래 화물(들) top 이 base 4모서리+중심을 모두 덮음 (full support)
 *      - z > 0 이면 모든 supporter 가 canStackOn 통과 (다단금지/heavierBelow 검증)
 *      - 컨테이너 중량 한도 미만 (withinWeightLimit)
 *      - topOnly 화물은 z == 0 (바닥) 에 못 둠
 *      - orientation 제한 — allowedFaces 가 처리 (free / long_along_length / fixed)
 *  4) 배치 후 새 후보점 3개 추가: (x+w, y, z), (x, y+l, z), (x, y, z+h)
 *  5) 사용한 후보점 제거 + 같은 좌표 중복 제거 + 컨테이너 밖 제거
 *
 * 출력 Placement3D 는 기존 PlacedCargo 와 호환 + position.z + faceIdx 추가.
 * layer 는 z == 0 이면 "bottom", z > 0 이면 "top" — 기존 시각화 색깔과 호환.
 */

import type { CargoSpec, CargoType, Remark } from "../../types/cargo.ts";
import type { ContainerSpec } from "../../types/container.ts";
import {
  allowedFaces,
  canStackOn,
  effectiveSizeFace,
  withinWeightLimit,
} from "./constraints.ts";

/** 부동소수점 비교 허용 오차 (cm) */
const EPS = 0.01;

/** 알고리즘 입력 단위 — cargo 한 건을 quantity / unitSizes 로 분해한 것 */
export interface UnitItem {
  unitId: string;
  cargoId: string;
  shipper: string;
  name?: string;
  cargoType: CargoType;
  /** 사용자 입력 CFS CBM (cargo.cbm). 그룹 내 모든 unit 동일값. */
  cfsCbm: number | null;
  width: number;
  length: number;
  height: number;
  /** 단위 중량 kg (그룹 weight 또는 weightPerUnit/quantity) */
  weight: number;
  remarks: Remark;
}

/** 자유 좌표 적재 결과 한 건. PlacedCargo + z 좌표 + faceIdx */
export interface Placement3D {
  unitId: string;
  cargoId: string;
  shipper: string;
  name?: string;
  cargoType: CargoType;
  cfsCbm: number | null;
  /** 컨테이너 입구 기준 cm — x=폭방향, y=길이방향, z=높이방향 */
  position: { x: number; y: number; z: number };
  /** 회전 후 실효 사이즈 cm */
  size: { width: number; length: number; height: number };
  /** 6면 중 어느 면을 바닥으로 두었는지 (0~5) — 디버그·검증용 */
  faceIdx: number;
  /** 회전 여부 (eff.width 가 원본 width 와 다르면 true) — 기존 PlacedCargo 호환용 */
  rotated: boolean;
  weight: number;
  remarks: Remark;
  /** z == 0 이면 "bottom", z > 0 이면 "top" — 시각화 색깔용 */
  layer: "bottom" | "top";
}

interface Candidate {
  x: number;
  y: number;
  z: number;
}

export interface ExtremePointResult {
  placements: Placement3D[];
  unplaced: UnitItem[];
  totalWeight: number;
  /** 적재된 화물의 시각 CBM 합 (m³) */
  visualCbm: number;
}

export interface PackExtremePointOptions {
  /**
   * 후보점 정렬 점수 함수 — 작을수록 우선 선택.
   * 기본: z * 1e8 + y * 1e4 + x  (가장 안쪽-아래-왼쪽 우선)
   */
  scoreFn?: (cand: Candidate) => number;
  /**
   * 강제 회전 면 인덱스 (0~5). 지정하면 그 face 만 시도, 다른 face 는 skip.
   * 묶음 stack(같은 cargoId N≥2)에서 컬럼 정렬을 위해 사용.
   * 지정한 face 가 allowedFaces 에 없으면 placement 실패.
   */
  forceFaceIdx?: number;
}

/* ============================================================
 * 보조 함수
 * ============================================================ */

/** 두 박스의 AABB 3축 충돌 검사 */
function collides3D(
  ax: number,
  ay: number,
  az: number,
  aw: number,
  al: number,
  ah: number,
  b: Placement3D,
): boolean {
  return (
    ax + aw > b.position.x + EPS &&
    ax + EPS < b.position.x + b.size.width &&
    ay + al > b.position.y + EPS &&
    ay + EPS < b.position.y + b.size.length &&
    az + ah > b.position.z + EPS &&
    az + EPS < b.position.z + b.size.height
  );
}

/** 새 base 가 z 레벨에 있을 때 그 base 를 지지할 후보 supporter 들 (top z 일치 + 2D footprint 겹침) */
function findSupporters(
  pos: Candidate,
  w: number,
  l: number,
  existing: Placement3D[],
): Placement3D[] {
  if (pos.z <= EPS) return []; // 바닥 = 지지됨, supporters 없음
  return existing.filter((p) => {
    const topZ = p.position.z + p.size.height;
    if (Math.abs(topZ - pos.z) > EPS) return false;
    return (
      pos.x + w > p.position.x + EPS &&
      pos.x + EPS < p.position.x + p.size.width &&
      pos.y + l > p.position.y + EPS &&
      pos.y + EPS < p.position.y + p.size.length
    );
  });
}

/** base 의 4모서리 + 중심점이 supporter 들의 top 영역에 모두 덮이는지 (overhang 거부) */
function isFullySupported(
  pos: Candidate,
  w: number,
  l: number,
  supporters: Placement3D[],
): boolean {
  const points = [
    { x: pos.x + EPS, y: pos.y + EPS },
    { x: pos.x + w - EPS, y: pos.y + EPS },
    { x: pos.x + EPS, y: pos.y + l - EPS },
    { x: pos.x + w - EPS, y: pos.y + l - EPS },
    { x: pos.x + w / 2, y: pos.y + l / 2 },
  ];
  return points.every((pt) =>
    supporters.some(
      (s) =>
        pt.x >= s.position.x - EPS &&
        pt.x <= s.position.x + s.size.width + EPS &&
        pt.y >= s.position.y - EPS &&
        pt.y <= s.position.y + s.size.length + EPS,
    ),
  );
}

function asCargoLikeForFace(item: UnitItem) {
  return {
    width: item.width,
    length: item.length,
    height: item.height,
    weightPerUnit: item.weight,
    remarks: item.remarks,
  };
}

function asCargoLikeForStack(item: UnitItem | Placement3D) {
  return {
    weightPerUnit: item.weight,
    remarks: item.remarks,
  };
}

/* ============================================================
 * 컨테이너 상태 관리 (per-container 단위 배치용)
 * ============================================================ */

export interface ContainerPackState {
  placements: Placement3D[];
  candidates: Candidate[];
  totalWeight: number;
  visualCbm: number;
}

export function makeContainerState(): ContainerPackState {
  return {
    placements: [],
    candidates: [{ x: 0, y: 0, z: 0 }],
    totalWeight: 0,
    visualCbm: 0,
  };
}

/**
 * 한 unit 을 주어진 컨테이너 상태에 배치 시도. 성공 시 state mutate, true 반환.
 * 배치 못 하면 false (state 변경 없음).
 *
 * 알고리즘 본체는 packExtremePoint 와 동일 — 다중 컨테이너 분배 시 호출자가
 * 컨테이너별로 state 를 들고 unit 들을 한 개씩 배정할 수 있게 분리.
 */
export function tryPlaceUnit(
  unit: UnitItem,
  state: ContainerPackState,
  spec: ContainerSpec,
  options?: PackExtremePointOptions,
): boolean {
  if (!withinWeightLimit(state.totalWeight, unit.weight, spec)) return false;

  const cargoLike = asCargoLikeForFace(unit);
  const faces = allowedFaces(cargoLike);
  const score =
    options?.scoreFn ?? ((c: Candidate) => c.z * 1e8 + c.y * 1e4 + c.x);

  interface Choice {
    cand: Candidate;
    eff: { width: number; length: number; height: number };
    faceIdx: number;
  }
  let best: Choice | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of state.candidates) {
    for (const faceIdx of faces) {
      if (
        options?.forceFaceIdx !== undefined &&
        faceIdx !== options.forceFaceIdx
      ) {
        continue;
      }
      const eff = effectiveSizeFace(cargoLike, faceIdx);

      if (cand.x + eff.width > spec.innerWidth + EPS) continue;
      if (cand.y + eff.length > spec.innerLength + EPS) continue;
      if (cand.z + eff.height > spec.innerHeight + EPS) continue;

      if (unit.remarks.topOnly && cand.z <= EPS) continue;

      let hit = false;
      for (const p of state.placements) {
        if (
          collides3D(
            cand.x,
            cand.y,
            cand.z,
            eff.width,
            eff.length,
            eff.height,
            p,
          )
        ) {
          hit = true;
          break;
        }
      }
      if (hit) continue;

      if (cand.z > EPS) {
        const supporters = findSupporters(
          cand,
          eff.width,
          eff.length,
          state.placements,
        );
        if (supporters.length === 0) continue;
        if (!isFullySupported(cand, eff.width, eff.length, supporters))
          continue;
        let stackOk = true;
        for (const s of supporters) {
          if (!canStackOn(asCargoLikeForFace(unit), asCargoLikeForStack(s))) {
            stackOk = false;
            break;
          }
        }
        if (!stackOk) continue;
      }

      const sc = score(cand);
      if (sc < bestScore) {
        bestScore = sc;
        best = { cand, eff, faceIdx };
      }
    }
  }

  if (!best) return false;

  const rotated = best.eff.width !== unit.width || best.eff.length !== unit.length;
  const placed: Placement3D = {
    unitId: unit.unitId,
    cargoId: unit.cargoId,
    shipper: unit.shipper,
    name: unit.name,
    cargoType: unit.cargoType,
    cfsCbm: unit.cfsCbm,
    position: { x: best.cand.x, y: best.cand.y, z: best.cand.z },
    size: {
      width: best.eff.width,
      length: best.eff.length,
      height: best.eff.height,
    },
    faceIdx: best.faceIdx,
    rotated,
    weight: unit.weight,
    remarks: unit.remarks,
    layer: best.cand.z <= EPS ? "bottom" : "top",
  };
  state.placements.push(placed);
  state.totalWeight += unit.weight;
  state.visualCbm +=
    (best.eff.width * best.eff.length * best.eff.height) / 1_000_000;

  // 후보점 갱신 — Crainic-style EP projection (6 corners + projected EPs)
  // 단순 6 모서리만으로는 빈 공간 일부를 놓침. 각 outer corner 를 인접 surface 로
  // projection 해서 추가 EP 생성. 학술 reference: Crainic et al. (2008).
  state.candidates = state.candidates.filter((c) => c !== best!.cand);
  const bx = best.cand.x;
  const by = best.cand.y;
  const bz = best.cand.z;
  const bw = best.eff.width;
  const bl = best.eff.length;
  const bh = best.eff.height;

  // 6 base corners
  const baseCands: Candidate[] = [
    { x: bx + bw, y: by, z: bz },
    { x: bx, y: by + bl, z: bz },
    { x: bx, y: by, z: bz + bh },
    { x: bx + bw, y: by + bl, z: bz },
    { x: bx + bw, y: by, z: bz + bh },
    { x: bx, y: by + bl, z: bz + bh },
  ];

  // Projection helpers — 각 corner 를 한 축 방향으로 인접 surface 까지 projection
  // 결과: 그 surface 위 anchor 위치 EP 생성
  const projectMaxY = (px: number, pz: number): number => {
    let m = 0;
    for (const p of state.placements) {
      const py2 = p.position.y + p.size.length;
      if (py2 > by + EPS) continue; // must be 'in front' of new box (smaller y)
      // p must contain (px, pz) in its (x,z) range
      if (px < p.position.x - EPS) continue;
      if (px > p.position.x + p.size.width + EPS) continue;
      if (pz < p.position.z - EPS) continue;
      if (pz > p.position.z + p.size.height + EPS) continue;
      if (py2 > m) m = py2;
    }
    return m;
  };
  const projectMaxX = (py: number, pz: number): number => {
    let m = 0;
    for (const p of state.placements) {
      const px2 = p.position.x + p.size.width;
      if (px2 > bx + EPS) continue;
      if (py < p.position.y - EPS) continue;
      if (py > p.position.y + p.size.length + EPS) continue;
      if (pz < p.position.z - EPS) continue;
      if (pz > p.position.z + p.size.height + EPS) continue;
      if (px2 > m) m = px2;
    }
    return m;
  };
  const projectMaxZ = (px: number, py: number): number => {
    let m = 0;
    for (const p of state.placements) {
      const pz2 = p.position.z + p.size.height;
      if (pz2 > bz + EPS) continue;
      if (px < p.position.x - EPS) continue;
      if (px > p.position.x + p.size.width + EPS) continue;
      if (py < p.position.y - EPS) continue;
      if (py > p.position.y + p.size.length + EPS) continue;
      if (pz2 > m) m = pz2;
    }
    return m;
  };

  // Project each outer corner along 2 perpendicular axes (Crainic 6-EP set)
  // (x+w, y, z) — outer in +x: project -y and -z
  // (x, y+l, z) — outer in +y: project -x and -z
  // (x, y, z+h) — outer in +z: project -x and -y
  const projCands: Candidate[] = [
    { x: bx + bw, y: projectMaxY(bx + bw, bz), z: bz },
    { x: bx + bw, y: by, z: projectMaxZ(bx + bw, by) },
    { x: projectMaxX(by + bl, bz), y: by + bl, z: bz },
    { x: bx, y: by + bl, z: projectMaxZ(bx, by + bl) },
    { x: projectMaxX(by, bz + bh), y: by, z: bz + bh },
    { x: bx, y: projectMaxY(bx, bz + bh), z: bz + bh },
  ];

  for (const nc of [...baseCands, ...projCands]) {
    if (nc.x >= spec.innerWidth - EPS) continue;
    if (nc.y >= spec.innerLength - EPS) continue;
    if (nc.z >= spec.innerHeight - EPS) continue;
    if (nc.x < -EPS || nc.y < -EPS || nc.z < -EPS) continue;
    const dup = state.candidates.some(
      (c) =>
        Math.abs(c.x - nc.x) < EPS &&
        Math.abs(c.y - nc.y) < EPS &&
        Math.abs(c.z - nc.z) < EPS,
    );
    if (dup) continue;
    state.candidates.push(nc);
  }
  return true;
}

/**
 * Brute-force fallback placement — extreme-point candidate set 이 못 찾는 빈 공간을
 * grid scan 으로 탐색.
 *
 * - x/y: 5cm 간격 grid scan
 * - z: 0 + 모든 기존 placement 의 top z (실제로 stack 가능한 z 레벨만)
 * - 모든 face 시도
 * - 정상 tryPlaceUnit 와 동일한 모든 제약 확인 (충돌·지지·중량·도어·rules)
 * - 성공 시 state mutate (placements 추가, candidates 도 새 corner 들 추가)
 *
 * 비용 O(W/5 × L/5 × Z_levels × faces × placements) — 미배치 시에만 호출, 1대당 한 번.
 */
export function tryPlaceUnitBruteForce(
  unit: UnitItem,
  state: ContainerPackState,
  spec: ContainerSpec,
  options?: PackExtremePointOptions,
): boolean {
  if (!withinWeightLimit(state.totalWeight, unit.weight, spec)) return false;
  const cargoLike = asCargoLikeForFace(unit);
  const faces = allowedFaces(cargoLike);
  const score =
    options?.scoreFn ?? ((c: Candidate) => c.z * 1e8 + c.y * 1e4 + c.x);
  // 5cm grid — fallback 만 호출되므로 비용은 낮지만 정밀도와 trade-off.
  // 더 정밀한 탐색이 필요하면 STEP=2 로 줄이면 되지만 packBest 14 조합 × 백트래킹 누적되면 ~수십초.
  const STEP = 5;

  // z 레벨 = 0 + 모든 placement 의 top z (중복 제거)
  const zLevelSet = new Set<number>([0]);
  for (const p of state.placements) zLevelSet.add(p.position.z + p.size.height);
  const zLevels = Array.from(zLevelSet).sort((a, b) => a - b);

  let best: { x: number; y: number; z: number; eff: ReturnType<typeof effectiveSizeFace>; faceIdx: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const faceIdx of faces) {
    if (
      options?.forceFaceIdx !== undefined &&
      faceIdx !== options.forceFaceIdx
    )
      continue;
    const eff = effectiveSizeFace(cargoLike, faceIdx);
    if (eff.width > spec.innerWidth + EPS) continue;
    if (eff.length > spec.innerLength + EPS) continue;
    if (eff.height > spec.innerHeight + EPS) continue;

    const xMax = spec.innerWidth - eff.width;
    const yMax = spec.innerLength - eff.length;

    for (const z of zLevels) {
      if (z + eff.height > spec.innerHeight + EPS) continue;
      if (unit.remarks.topOnly && z <= EPS) continue;

      for (let x = 0; x <= xMax + EPS; x += STEP) {
        for (let y = 0; y <= yMax + EPS; y += STEP) {
          let hit = false;
          for (const p of state.placements) {
            if (collides3D(x, y, z, eff.width, eff.length, eff.height, p)) {
              hit = true;
              break;
            }
          }
          if (hit) continue;

          if (z > EPS) {
            const sups = findSupporters(
              { x, y, z },
              eff.width,
              eff.length,
              state.placements,
            );
            if (sups.length === 0) continue;
            if (!isFullySupported({ x, y, z }, eff.width, eff.length, sups))
              continue;
            let stackOk = true;
            for (const s of sups) {
              if (!canStackOn(cargoLike, asCargoLikeForStack(s))) {
                stackOk = false;
                break;
              }
            }
            if (!stackOk) continue;
          }

          const sc = score({ x, y, z });
          if (sc < bestScore) {
            bestScore = sc;
            best = { x, y, z, eff, faceIdx };
          }
        }
      }
    }
  }

  if (!best) return false;

  const rotated =
    best.eff.width !== unit.width || best.eff.length !== unit.length;
  const placed: Placement3D = {
    unitId: unit.unitId,
    cargoId: unit.cargoId,
    shipper: unit.shipper,
    name: unit.name,
    cargoType: unit.cargoType,
    cfsCbm: unit.cfsCbm,
    position: { x: best.x, y: best.y, z: best.z },
    size: {
      width: best.eff.width,
      length: best.eff.length,
      height: best.eff.height,
    },
    faceIdx: best.faceIdx,
    rotated,
    weight: unit.weight,
    remarks: unit.remarks,
    layer: best.z <= EPS ? "bottom" : "top",
  };
  state.placements.push(placed);
  state.totalWeight += unit.weight;
  state.visualCbm +=
    (best.eff.width * best.eff.length * best.eff.height) / 1_000_000;

  // 후보점도 추가 (다음 unit 이 이 placement 의 corner 들을 활용 가능하도록)
  const corners: Candidate[] = [
    { x: best.x + best.eff.width, y: best.y, z: best.z },
    { x: best.x, y: best.y + best.eff.length, z: best.z },
    { x: best.x, y: best.y, z: best.z + best.eff.height },
    { x: best.x + best.eff.width, y: best.y + best.eff.length, z: best.z },
    { x: best.x + best.eff.width, y: best.y, z: best.z + best.eff.height },
    { x: best.x, y: best.y + best.eff.length, z: best.z + best.eff.height },
  ];
  for (const nc of corners) {
    if (nc.x >= spec.innerWidth - EPS) continue;
    if (nc.y >= spec.innerLength - EPS) continue;
    if (nc.z >= spec.innerHeight - EPS) continue;
    const dup = state.candidates.some(
      (c) =>
        Math.abs(c.x - nc.x) < EPS &&
        Math.abs(c.y - nc.y) < EPS &&
        Math.abs(c.z - nc.z) < EPS,
    );
    if (dup) continue;
    state.candidates.push(nc);
  }
  return true;
}

/* ============================================================
 * 메인 (단일 컨테이너 batch packer)
 * ============================================================ */

/**
 * 한 컨테이너에 unit 리스트를 자유 좌표로 적재.
 * units 의 순서가 적재 우선순위 — 호출자가 사전 정렬해서 넘긴다 (큰 화물 먼저 등).
 *
 * 분류·컨테이너 결정·CT bulk 분배 등은 호출자(상위 pack)가 책임진다.
 * 본 함수는 "이 컨테이너에 이 unit 들을 넣어봐" 만 수행한다.
 */
export function packExtremePoint(
  units: UnitItem[],
  spec: ContainerSpec,
  options?: PackExtremePointOptions,
): ExtremePointResult {
  const state = makeContainerState();
  const unplaced: UnitItem[] = [];

  for (const u of units) {
    if (!tryPlaceUnit(u, state, spec, options)) {
      unplaced.push(u);
    }
  }

  return {
    placements: state.placements,
    unplaced,
    totalWeight: state.totalWeight,
    visualCbm: state.visualCbm,
  };
}

/* ============================================================
 * 유틸 — cargo 분해
 * ============================================================ */

/**
 * CargoSpec 리스트를 UnitItem 리스트로 분해.
 * unitSizes 우선, 없으면 대표 W/L/H × quantity. weight 는 그룹 단위 또는 weightPerUnit/quantity.
 *
 * (algorithm.ts 의 expandToUnits 와 동일 로직 — Phase 3 통합 예정)
 */
export function expandCargoesToUnits(cargoes: CargoSpec[]): UnitItem[] {
  const out: UnitItem[] = [];
  for (const c of cargoes) {
    const shipperLabel =
      c.shipperName ?? c.actualShipperName ?? c.itemName ?? "";
    const remarks = { ...c.remarks };
    if (c.unitSizes && c.unitSizes.length > 0) {
      const totalUnits =
        c.unitSizes.reduce((s, u) => s + u.quantity, 0) || c.quantity;
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
