/**
 * Stage 6 — 행 기반 잔여공간 fitting
 *
 * 미배치 unit 을 컨테이너 현재 placements 로부터 Y 축 기준 "행(row)"을 추출하고,
 * 각 행의 잔여 공간(바닥 우측 빈 폭, 천장 여유)에 fitting 시도한다.
 *
 * 공개 함수:
 *   computeContainerRows   — placements → 행 목록
 *   computeRowResiduals    — 행 목록 → 잔여공간 목록
 *   tryFitInRowResiduals   — unit 을 잔여공간에 배치 시도 (state mutate)
 */

import type { ContainerSpec } from "../../types/container.ts";
import {
  type ContainerPackState,
  type Placement3D,
  type UnitItem,
  tryPlaceUnit,
  tryPlaceUnitBruteForce,
} from "./extreme-point.ts";

const EPS = 0.01;

/** Y 축 기준 한 "행" — yStart~yEnd 사이에 걸쳐 있는 placements 집합 */
export interface ContainerRow {
  yStart: number;
  yEnd: number;
  placements: Placement3D[];
}

/** 한 행의 잔여 공간 */
export interface RowResidual {
  row: ContainerRow;
  /** 행 내 placement 들 중 x+width 최대값 → 그 오른쪽이 바닥 빈 공간 시작점 */
  floorFreeXStart: number;
  /** innerWidth - floorFreeXStart (≥0) */
  floorFreeWidth: number;
  /** innerHeight - 행 내 max(z + height) → 천장 여유 */
  ceilClearance: number;
}

/**
 * state.placements 를 Y 축 경계로 클러스터링하여 행 목록 반환.
 * 경계: 모든 placement 의 yStart / yEnd 값 수집 → 정렬 → 인접 구간 병합 →
 * 각 구간에 걸쳐 있는(겹치는) placement 할당.
 */
export function computeContainerRows(
  state: ContainerPackState,
): ContainerRow[] {
  if (state.placements.length === 0) return [];

  // 모든 Y 경계 수집
  const ys = new Set<number>();
  for (const p of state.placements) {
    ys.add(p.position.y);
    ys.add(p.position.y + p.size.length);
  }
  const sorted = [...ys].sort((a, b) => a - b);

  // 인접 구간을 행으로 변환
  const rows: ContainerRow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const yStart = sorted[i];
    const yEnd = sorted[i + 1];
    if (yEnd - yStart < EPS) continue;

    // 이 구간에 걸쳐 있는 placements
    const placements = state.placements.filter(
      (p) =>
        p.position.y < yEnd - EPS && p.position.y + p.size.length > yStart + EPS,
    );
    if (placements.length > 0) {
      rows.push({ yStart, yEnd, placements });
    }
  }
  return rows;
}

/**
 * 각 행의 잔여공간 계산.
 * - floorFreeXStart: 행 내 max(x + width)
 * - ceilClearance: innerHeight - max(z + height)
 */
export function computeRowResiduals(
  rows: ContainerRow[],
  spec: ContainerSpec,
): RowResidual[] {
  return rows.map((row) => {
    let maxXEnd = 0;
    let maxZEnd = 0;
    for (const p of row.placements) {
      const xEnd = p.position.x + p.size.width;
      const zEnd = p.position.z + p.size.height;
      if (xEnd > maxXEnd) maxXEnd = xEnd;
      if (zEnd > maxZEnd) maxZEnd = zEnd;
    }
    const floorFreeXStart = maxXEnd;
    const floorFreeWidth = Math.max(0, spec.innerWidth - floorFreeXStart);
    const ceilClearance = Math.max(0, spec.innerHeight - maxZEnd);
    return { row, floorFreeXStart, floorFreeWidth, ceilClearance };
  });
}

/**
 * unit 을 행 잔여공간에 배치 시도.
 * - 각 잔여공간(바닥 우측 빈 폭 / 천장 여유)마다 6면 회전 중 들어가는 면 시도
 * - tryPlaceUnit → tryPlaceUnitBruteForce (기존 검증 자동 포함)
 * - 성공 시 state mutate + true 반환, 실패 시 state 변경 없이 false 반환
 */
export function tryFitInRowResiduals(
  unit: UnitItem,
  residuals: RowResidual[],
  state: ContainerPackState,
  spec: ContainerSpec,
): boolean {
  // 바닥 우측 빈 폭에 들어가는 잔여공간 우선 시도 (y 오름차순 = 가까운 행 우선)
  for (const residual of residuals) {
    // 바닥 빈 폭 체크: unit 의 어느 방향이든 floorFreeWidth 안에 들어가는지
    const { floorFreeWidth, floorFreeXStart, row, ceilClearance } = residual;

    // scoreFn: 이 잔여공간 좌표(floorFreeXStart, row.yStart, z=0)에 배치를 유도
    // tryPlaceUnit 의 후보점 평가에서 해당 좌표 우선 — 완전 강제는 아니지만
    // 이미 placement 들이 있으므로 극점 후보 중 해당 위치가 포함됨.
    // 바닥 잔여 공간에 unit 크기가 들어가는지 빠른 사전 검사
    const fits =
      (unit.width <= floorFreeWidth + EPS && unit.length <= row.yEnd - row.yStart + EPS) ||
      (unit.length <= floorFreeWidth + EPS && unit.width <= row.yEnd - row.yStart + EPS) ||
      (unit.height <= floorFreeWidth + EPS && unit.length <= row.yEnd - row.yStart + EPS) ||
      (unit.height <= floorFreeWidth + EPS && unit.width <= row.yEnd - row.yStart + EPS) ||
      (unit.width <= floorFreeWidth + EPS && unit.height <= row.yEnd - row.yStart + EPS) ||
      (unit.length <= floorFreeWidth + EPS && unit.height <= row.yEnd - row.yStart + EPS);

    // 천장 여유 체크: unit 의 최소 높이가 ceilClearance 안에 들어가는지
    const minDim = Math.min(unit.width, unit.length, unit.height);
    const fitsCeil = minDim <= ceilClearance + EPS;

    if (!fits && !fitsCeil) continue;

    // scoreFn: 이 행의 yStart 와 floorFreeXStart 에 가깝게 배치 유도
    const targetX = floorFreeXStart;
    const targetY = row.yStart;

    const ok =
      tryPlaceUnit(unit, state, spec, {
        scoreFn: (cand) => {
          // 해당 행 위치에 가까울수록 낮은 점수 (우선 시도)
          const dy = Math.abs(cand.y - targetY);
          const dx = Math.abs(cand.x - targetX);
          return cand.z * 1e8 + dy * 1e4 + dx;
        },
      }) ||
      tryPlaceUnitBruteForce(unit, state, spec, {
        scoreFn: (cand) => {
          const dy = Math.abs(cand.y - targetY);
          const dx = Math.abs(cand.x - targetX);
          return cand.z * 1e8 + dy * 1e4 + dx;
        },
      });

    if (ok) return true;
  }
  return false;
}
