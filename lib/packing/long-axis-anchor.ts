/**
 * Long-Axis Anchor Pre-Pass (장축 모서리 박음)
 *
 * 동기:
 *   3ST SG TOTAL 자동 분배에서 311×15×15 cm 같은 단행 막대형 박스가 미배치되는 문제.
 *   원인: 작은 박스가 먼저 자리를 잡아 311cm 연속 슬롯이 사라짐. 정렬 우선순위
 *   (booking → shipper → cargoId → 부피) 상 단행 막대형은 후순위로 밀림.
 *
 * 룰 정의:
 *   - 활성 조건: 화물 unit 중 **최대 변 ≥ THRESHOLD_CM (300cm)** 인 박스
 *   - 동작: 컨테이너 길이 방향(X 모서리, y=0/z=0) 에 가장 먼저 강제 anchor.
 *           회전은 가장 긴 변이 컨테이너 길이방향(L) 과 일치하도록 강제 (long-along-X).
 *   - 한 화물 행 (= 한 cargoId) unit 들은 같이 anchor (CBM 쪼개기 금지).
 *   - 한 부킹 = 한 컨 룰 보호 — 같은 부킹의 다른 화물도 같은 컨테이너에 들어가야 진행.
 *
 * 동작 단계 (per cargoId, longest-side desc 정렬):
 *   1) cargoId 의 모든 unit 중 가장 긴 변을 컨테이너 length 축에 정렬하는 face 선택.
 *      그 face 의 width/length/height 가 컨 inner 안에 들어가야 함.
 *   2) 첫 unit 을 (x=0, y=0, z=0) 부터 시도 → 같은 cargoId 의 후속 unit 은 그 옆 (x+=w)
 *      또는 위 (z+=h) 에 stack column 형태로 anchor.
 *   3) 모든 unit 통째로 들어가지 않으면 다음 컨테이너 후보로 이동 (스냅샷 복원).
 *
 * 주의 (CLAUDE.md 절대 룰):
 *   - CBM 쪼개기 금지 (한 cargoId 은 한 컨)
 *   - 점수 합산 금지 (lex comparator만)
 *   - 한 부킹 = 한 컨 (B1) 유지
 *   - 정답 hint X — 일반 룰만, 특정 화물명 hardcode X
 */

import type { ContainerSpec } from "../../types/container.ts";
import { allowedFaces, effectiveSizeFace } from "./constraints.ts";
import {
  type ContainerPackState,
  type Placement3D,
  type UnitItem,
} from "./extreme-point.ts";

/** 장축 anchor 활성 임계 (cm) — 최대 변 이 이 값 이상이면 룰 발동 */
const DEFAULT_THRESHOLD_CM = 300;
/** 부동소수점 비교 허용 오차 (cm) */
const EPS = 0.01;

export interface LongAxisAnchorOptions {
  /** 룰 비활성 (테스트·디버그용) — 기본 활성 */
  enabled?: boolean;
  /** 최대 변 임계 (cm) — 기본 300 */
  threshold?: number;
}

interface ContainerLike {
  index: number;
  spec: ContainerSpec;
  packState: ContainerPackState;
}

/** 화물의 unit 들 중 최대 변 길이 (전체 unit 의 max(w,l,h) 의 max) */
function maxSideOf(units: UnitItem[]): number {
  let m = 0;
  for (const u of units) {
    const local = Math.max(u.width, u.length, u.height);
    if (local > m) m = local;
  }
  return m;
}

/**
 * 화물의 막대형(slender) 비율 — 모든 unit 의 min/max 중 최대값.
 * 0 에 가까울수록 가는 막대 (예: 311×15×15 → 15/311=0.048).
 * 큐브형(예: 114×114×71 → 71/114=0.62) 은 큰 값 → 막대형 아님.
 */
function maxSlendernessRatioOf(units: UnitItem[]): number {
  let worst = 0;
  for (const u of units) {
    const lo = Math.min(u.width, u.length, u.height);
    const hi = Math.max(u.width, u.length, u.height);
    if (hi <= 0) continue;
    const r = lo / hi;
    if (r > worst) worst = r;
  }
  return worst;
}

/**
 * 막대형(slenderness) 비율 임계 — min/max ≤ 0.40 인 경우만 진짜 막대형.
 *  - 0.40 — 막대형(326×116, 비율 0.34) 까지 포함, 큐브형(0.5+) 차단 유지
 *  - 통과 예시: 311×15×15 = 0.048, 326×116×110 FLOWBUS = 0.337
 *  - 탈락 예시: 114×114×71 VPHI = 0.62 (큐브형 회귀 방지)
 *  - 변경 이력 (2026-05-12): 0.25 → 0.40 (row-lane bundle 활성 위해 FLOWBUS 포함)
 */
const SLENDERNESS_THRESHOLD = 0.40;

/**
 * 장축 anchor 후보 화물 골라내기 — 최대 변 ≥ threshold 인 cargoId 그룹 반환.
 * cargoId 단위 그룹화 + longest-side desc 정렬 (가장 긴 화물부터 anchor).
 *
 * 활성 조건 강화 (옵션 A, 2026-05-08):
 *   - 최대 변 ≥ threshold (기본 300cm) **AND**
 *   - (innerLength 주어지면) 최대 변 ≥ 0.25 × innerLength **AND**
 *   - 막대 형상 비율 (min/max) ≤ 0.25 — 진짜 가는 막대형만 (큐브형 제외, 회귀 방지)
 *     예: 311×15×15 = 0.048 (통과), 114×114×71 VPHI = 0.62 (탈락)
 *   목적: default ON 회귀 방지 — 큐브형 박스가 막대형 anchor 룰에 잘못 끼는 것 차단.
 */
export function findLongAxisCargoes(
  units: UnitItem[],
  threshold = DEFAULT_THRESHOLD_CM,
  innerLength?: number,
): Map<string, UnitItem[]> {
  const byCargo = new Map<string, UnitItem[]>();
  for (const u of units) {
    const list = byCargo.get(u.cargoId) ?? [];
    list.push(u);
    byCargo.set(u.cargoId, list);
  }
  const result = new Map<string, UnitItem[]>();
  // longest side desc 로 정렬한 entries
  const entries: { cargoId: string; units: UnitItem[]; maxSide: number }[] = [];
  // 강화 조건: 컨 길이의 25% 이상 막대형 (innerLength 가 있으면)
  const longRatioThreshold = innerLength != null ? innerLength * 0.25 : 0;
  for (const [cid, list] of byCargo) {
    const ms = maxSideOf(list);
    if (ms < threshold) continue;
    if (innerLength != null && ms < longRatioThreshold) continue;
    // 막대 형상 비율 (min/max) ≤ 0.25 인 진짜 가는 막대형만
    const slenderness = maxSlendernessRatioOf(list);
    if (slenderness > SLENDERNESS_THRESHOLD) continue;
    entries.push({ cargoId: cid, units: list, maxSide: ms });
  }
  entries.sort((a, b) => b.maxSide - a.maxSide);
  for (const e of entries) result.set(e.cargoId, e.units);
  return result;
}

/**
 * 컨테이너 길이방향(L) 에 unit 의 가장 긴 변을 배치하는 face 선택.
 * eff.length = 가장 긴 변 (즉 컨테이너 length 축에 정렬), 컨 inner 안에 들어가는 face.
 * 우선순위: eff.length 가 컨 length 안에 들어가는 face 중 eff.height 작은 순 (낮게 깔림).
 */
function pickLongAlongLengthFace(
  unit: UnitItem,
  spec: ContainerSpec,
): { faceIdx: number; eff: { width: number; length: number; height: number } } | null {
  const cargoLike = {
    width: unit.width,
    length: unit.length,
    height: unit.height,
    remarks: unit.remarks,
  };
  const faces = allowedFaces(cargoLike);
  const targetLong = Math.max(unit.width, unit.length, unit.height);
  let best:
    | { faceIdx: number; eff: ReturnType<typeof effectiveSizeFace> }
    | null = null;
  for (const faceIdx of faces) {
    const eff = effectiveSizeFace(cargoLike, faceIdx);
    // 가장 긴 변이 length 축에 정렬된 face
    if (Math.abs(eff.length - targetLong) > EPS) continue;
    // 컨 inner 안에 들어가야
    if (eff.width > spec.innerWidth + EPS) continue;
    if (eff.length > spec.innerLength + EPS) continue;
    if (eff.height > spec.innerHeight + EPS) continue;
    if (best === null || eff.height < best.eff.height) {
      best = { faceIdx, eff };
    }
  }
  return best;
}

/** AABB 충돌 검사 — extreme-point 와 동일 로직 */
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

/**
 * Row-lane 묶음 시도 — 같은 cargoId 의 동일 크기 단행 막대형 N개를 z=0 한 row 평면에
 * 폭 방향으로 나란히 anchor.
 *
 * 활성 조건:
 *   - units.length ≥ 2 AND 모든 unit 동일 (w, l, h, weight, remarks 일관)
 *   - noStacking=true 또는 가장 긴 변 ≥ innerLength × 0.25
 *   - 회전 face 중 짧은 변 × N ≤ innerWidth 인 face 존재
 *
 * 동작:
 *   - 가장 긴 변을 length 축 정렬, 짧은 변을 width 축 N개 나란히
 *   - 모든 unit z=0, y는 컨 안쪽 끝(useFarEnd) 기존 정책 그대로
 *   - 첫 box x=0, 두 번째 x=짧은변, ...  통째로 모두 들어가야 commit
 *
 * 반환:
 *   - 성공 시 newPlacements[] (호출자가 commit), 실패 시 null
 */
function tryRowLaneAnchor(
  units: UnitItem[],
  state: ContainerPackState,
  spec: ContainerSpec,
): Placement3D[] | null {
  if (units.length < 2) return null;
  // 모든 unit 동일 크기 검사
  const first = units[0];
  for (let i = 1; i < units.length; i++) {
    const u = units[i];
    if (
      u.width !== first.width ||
      u.length !== first.length ||
      u.height !== first.height
    ) {
      return null;
    }
    if (u.remarks.topOnly) return null;
  }
  if (first.remarks.topOnly) return null;
  // 활성 조건: noStacking=true 또는 가장 긴 변 ≥ 컨 길이 × 25%
  const longest = Math.max(first.width, first.length, first.height);
  const longRatioOk = longest >= spec.innerLength * 0.25;
  if (!first.remarks.noStacking && !longRatioOk) return null;
  // 무게 한도 사전 체크
  const totalAddWeight = units.reduce((s, u) => s + u.weight, 0);
  if (state.totalWeight + totalAddWeight >= spec.maxWeightKg) return null;

  // 회전 face 중 length 축에 가장 긴 변 정렬 + 짧은 변 × N ≤ innerWidth 인 face 우선
  const cargoLike = {
    width: first.width,
    length: first.length,
    height: first.height,
    remarks: first.remarks,
  };
  const faces = allowedFaces(cargoLike);
  let bestFace: { faceIdx: number; eff: ReturnType<typeof effectiveSizeFace> } | null = null;
  for (const faceIdx of faces) {
    const eff = effectiveSizeFace(cargoLike, faceIdx);
    // 가장 긴 변이 length 축 정렬
    if (Math.abs(eff.length - longest) > EPS) continue;
    // N개 나란히 폭 방향으로 들어가는지
    if (eff.width * units.length > spec.innerWidth + EPS) continue;
    if (eff.length > spec.innerLength + EPS) continue;
    if (eff.height > spec.innerHeight + EPS) continue;
    // 우선순위: 높이 작은 face 선호 (낮게 깔림)
    if (bestFace === null || eff.height < bestFace.eff.height) {
      bestFace = { faceIdx, eff };
    }
  }
  if (bestFace === null) return null;
  const eff = bestFace.eff;

  // 시작 y 위치 — 기존 정책과 동일 (안쪽 끝 우선)
  const useFarEnd = eff.length >= spec.innerLength * 0.5;
  const rowY = useFarEnd ? Math.max(0, spec.innerLength - eff.length) : 0;
  // x 시작 위치 — 기존 placements 중 같은 (rowY, z=0) 라인 차지한 것 다음
  let cursorX = 0;
  for (const p of state.placements) {
    if (
      Math.abs(p.position.z) < EPS &&
      Math.abs(p.position.y - rowY) < EPS
    ) {
      const xEnd = p.position.x + p.size.width;
      if (xEnd > cursorX) cursorX = xEnd;
    }
  }
  // 옆에 모두 들어가는지 재검사
  if (cursorX + eff.width * units.length > spec.innerWidth + EPS) return null;

  // 신규 placement 들 — z=0 한 row, x 가 짧은변 간격으로 나란히
  const newPlacements: Placement3D[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const x = cursorX + i * eff.width;
    const y = rowY;
    const z = 0;
    // 컨 boundary 재검사 (여유 EPS)
    if (x + eff.width > spec.innerWidth + EPS) return null;
    if (y + eff.length > spec.innerLength + EPS) return null;
    if (z + eff.height > spec.innerHeight + EPS) return null;
    // 기존 placements 충돌 검사
    for (const p of state.placements) {
      if (collides3D(x, y, z, eff.width, eff.length, eff.height, p)) return null;
    }
    // 새로 anchor 한 박스끼리 충돌 검사 (이론상 같은 z=0 평면 인접하므로 안 겹치지만 안전망)
    for (const p of newPlacements) {
      if (collides3D(x, y, z, eff.width, eff.length, eff.height, p)) return null;
    }
    newPlacements.push({
      unitId: u.unitId,
      cargoId: u.cargoId,
      shipper: u.shipper,
      bookingNo: u.bookingNo,
      name: u.name,
      cargoType: u.cargoType,
      cfsCbm: u.cfsCbm,
      position: { x, y, z },
      size: { width: eff.width, length: eff.length, height: eff.height },
      faceIdx: bestFace.faceIdx,
      rotated: eff.width !== u.width || eff.length !== u.length,
      weight: u.weight,
      remarks: u.remarks,
      layer: "bottom",
    });
  }
  return newPlacements;
}

/**
 * 한 cargoId 의 unit 들을 컨테이너 모서리 (x=0, y=0) 부터 X 축을 따라 차례 anchor.
 * 통째로 모두 들어가야 commit, 하나라도 실패 시 false (호출자가 스냅샷 복원).
 *
 * 사전 단계 (2026-05-12 추가):
 *   row-lane 모드 — 같은 cargoId 동일 크기 막대형 N개를 z=0 한 row 평면에 폭 방향으로
 *   나란히 묶어 배치 (예: FLOWBUS 326×116×110 ×2 → 116+116=232 ≤ 234 컨 폭).
 *   row-lane 성공 시 그 결과로 commit, 실패 시 기존 logic (한 줄 cursor anchor) 시도.
 */
function anchorOneCargoOnContainer(
  units: UnitItem[],
  state: ContainerPackState,
  spec: ContainerSpec,
): boolean {
  // 1) row-lane 묶음 시도 (같은 cargoId 동일 크기 막대형 ≥ 2개)
  const rowLane = tryRowLaneAnchor(units, state, spec);
  if (rowLane !== null) {
    for (const p of rowLane) {
      state.placements.push(p);
      state.totalWeight += p.weight;
      state.visualCbm += (p.size.width * p.size.length * p.size.height) / 1_000_000;
      state.candidates.push(
        { x: p.position.x + p.size.width, y: p.position.y, z: p.position.z },
        { x: p.position.x, y: p.position.y + p.size.length, z: p.position.z },
        { x: p.position.x, y: p.position.y, z: p.position.z + p.size.height },
      );
    }
    return true;
  }

  // 2) 기존 logic — 한 줄 cursor anchor (단행 막대형 또는 row-lane 실패 시)
  // 가장 긴 unit 부터 (longest-side desc) — 안정적 베이스
  const sorted = [...units].sort(
    (a, b) =>
      Math.max(b.width, b.length, b.height) - Math.max(a.width, a.length, a.height),
  );


  // 모든 unit 의 face 선택 — 하나라도 fit 안 되는 face 면 fail
  type Plan = { unit: UnitItem; faceIdx: number; eff: ReturnType<typeof effectiveSizeFace> };
  const plans: Plan[] = [];
  for (const u of sorted) {
    const pick = pickLongAlongLengthFace(u, spec);
    if (!pick) return false; // 컨에 안 들어감 → 다음 컨 후보
    plans.push({ unit: u, faceIdx: pick.faceIdx, eff: pick.eff });
  }

  // 사용한 X 슬라이스 추적 — y=0/z=0 모서리 라인 따라 차례 anchor
  // 첫 unit 은 (0,0,0). 후속은 직전 unit 의 x+w 부터. X 가득 차면 같은 길이방향 다음 행으로 줄바꿈.
  // 단, 일반 박스 자연 배치 (y=0 부터) 와의 충돌 최소화를 위해 가장 긴 변 ≥ 0.5×innerLength
  // 인 막대형은 컨테이너 안쪽 끝 (y = innerLength - eff.length) 에 anchor 한다.
  // (예: 1200cm 컨에 311cm 박스 → y=889 부터 시작 → 일반 박스의 y=0~889 영역 비워둠)
  const longestPlanLen = Math.max(...plans.map((p) => p.eff.length));
  const useFarEnd = longestPlanLen >= spec.innerLength * 0.5;
  let cursorX = 0;
  let rowY = useFarEnd ? Math.max(0, spec.innerLength - longestPlanLen) : 0;
  let rowMaxLength = 0; // 현재 행의 최대 length (줄바꿈 시 rowY += rowMaxLength)
  // 기존 placements 중 같은 모서리 라인 (rowY/z=0) 을 차지한 박스가 있으면
  // cursorX 를 그 박스들 다음으로 밀어 첫 행을 이어쓴다 (다른 cargoId 의 long-axis anchor 와 인접 배치).
  for (const p of state.placements) {
    if (
      Math.abs(p.position.z) < EPS &&
      Math.abs(p.position.y - rowY) < EPS
    ) {
      const xEnd = p.position.x + p.size.width;
      if (xEnd > cursorX) cursorX = xEnd;
      if (p.size.length > rowMaxLength) rowMaxLength = p.size.length;
    }
  }

  // 무게 한도 사전 체크 — 모두 합쳤을 때 한도 미만
  const totalAddWeight = plans.reduce((s, p) => s + p.unit.weight, 0);
  if (state.totalWeight + totalAddWeight >= spec.maxWeightKg) return false;

  // 신규 placement 들 (실패 시 push 안 함)
  const newPlacements: Placement3D[] = [];

  for (const plan of plans) {
    const { unit, faceIdx, eff } = plan;
    // topOnly 박스는 z=0 에 못 두므로 거부
    if (unit.remarks.topOnly) return false;

    // 현재 행에 들어가나? cursorX + eff.width <= innerWidth
    // 못 들어가면 줄바꿈: rowY += rowMaxLength, cursorX = 0, rowMaxLength = 0
    if (cursorX + eff.width > spec.innerWidth + EPS) {
      rowY += rowMaxLength;
      cursorX = 0;
      rowMaxLength = 0;
    }
    const x = cursorX;
    const y = rowY;
    const z = 0;
    // 컨 boundary 체크
    if (x + eff.width > spec.innerWidth + EPS) return false;
    if (y + eff.length > spec.innerLength + EPS) return false;
    if (z + eff.height > spec.innerHeight + EPS) return false;
    // 기존 placements 와 충돌 검사
    let hit = false;
    for (const p of state.placements) {
      if (collides3D(x, y, z, eff.width, eff.length, eff.height, p)) {
        hit = true;
        break;
      }
    }
    if (hit) return false;
    // 새로 anchor 한 박스끼리 충돌 검사
    for (const p of newPlacements) {
      if (collides3D(x, y, z, eff.width, eff.length, eff.height, p)) {
        return false;
      }
    }
    const placed: Placement3D = {
      unitId: unit.unitId,
      cargoId: unit.cargoId,
      shipper: unit.shipper,
      bookingNo: unit.bookingNo,
      name: unit.name,
      cargoType: unit.cargoType,
      cfsCbm: unit.cfsCbm,
      position: { x, y, z },
      size: { width: eff.width, length: eff.length, height: eff.height },
      faceIdx,
      rotated: eff.width !== unit.width || eff.length !== unit.length,
      weight: unit.weight,
      remarks: unit.remarks,
      layer: "bottom",
    };
    newPlacements.push(placed);
    cursorX = x + eff.width;
    if (eff.length > rowMaxLength) rowMaxLength = eff.length;
  }

  // 모두 commit
  for (const p of newPlacements) {
    state.placements.push(p);
    state.totalWeight += p.weight;
    state.visualCbm += (p.size.width * p.size.length * p.size.height) / 1_000_000;
    // 후보점 추가
    state.candidates.push(
      { x: p.position.x + p.size.width, y: p.position.y, z: p.position.z },
      { x: p.position.x, y: p.position.y + p.size.length, z: p.position.z },
      { x: p.position.x, y: p.position.y, z: p.position.z + p.size.height },
    );
  }
  return true;
}

/**
 * 메인 진입점 — 한 컨테이너에 후보 unit 풀을 받아 장축 anchor 시도.
 *
 * @param container 컨테이너 (state mutate 됨)
 * @param unitPool 후보 unit 풀 (이미 배치된 건 제외)
 * @param options { enabled, threshold }
 * @returns anchor 로 배치 성공한 unitId 들의 Set
 */
export function anchorLongAxisCargoes(
  container: ContainerLike,
  unitPool: UnitItem[],
  options?: LongAxisAnchorOptions,
): Set<string> {
  const placedIds = new Set<string>();
  if (options?.enabled === false) return placedIds;

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD_CM;
  // 활성 조건 강화: 컨 길이의 70% 이상 막대형만 선별 (회귀 방지)
  const longCargoes = findLongAxisCargoes(
    unitPool,
    threshold,
    container.spec.innerLength,
  );
  if (longCargoes.size === 0) return placedIds;

  for (const [cargoId, units] of longCargoes) {
    // 이미 다른 cargo 처리에서 unitId 가 처리됐으면 skip (보통은 안 겹침)
    const fresh = units.filter((u) => !placedIds.has(u.unitId));
    if (fresh.length === 0) continue;

    // structuredClone 으로 스냅샷 (실패 시 복원)
    const snap = structuredClone(container.packState);
    const ok = anchorOneCargoOnContainer(fresh, container.packState, container.spec);
    if (ok) {
      for (const u of fresh) placedIds.add(u.unitId);
    } else {
      // 복원
      container.packState.placements = snap.placements;
      container.packState.candidates = snap.candidates;
      container.packState.totalWeight = snap.totalWeight;
      container.packState.visualCbm = snap.visualCbm;
    }
  }

  return placedIds;
}

/** 테스트용 노출 */
export const __testables = {
  maxSideOf,
  maxSlendernessRatioOf,
  pickLongAlongLengthFace,
  anchorOneCargoOnContainer,
  tryRowLaneAnchor,
  DEFAULT_THRESHOLD_CM,
  SLENDERNESS_THRESHOLD,
};
