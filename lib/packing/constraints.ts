/**
 * 적재 제약 조건 검사 — 순수 함수 모음
 *
 * 알고리즘 본체에서 분리한 이유:
 *  - 단위 테스트 용이성 (입력만 보고 판단 가능)
 *  - 비즈니스 룰(다단금지/상단적재/방향제한/중량조건)이 추후 변경될 때 한 곳에서 수정
 */

import type { CargoSpec } from "../../types/cargo.ts";
import type { ContainerSpec } from "../../types/container.ts";

/**
 * 회전 여부에 따른 실효 사이즈 (width, length 스왑) — 평면 90° 회전 (legacy).
 * 6면 회전을 쓰려면 effectiveSizeFace 사용.
 */
export function effectiveSize(
  item: Pick<CargoSpec, "width" | "length" | "height">,
  rotated: boolean,
): { width: number; length: number; height: number } {
  if (rotated) {
    return { width: item.length, length: item.width, height: item.height };
  }
  return { width: item.width, length: item.length, height: item.height };
}

/**
 * 화물의 6가지 자세(어느 면을 바닥으로 두는가) 별 실효 사이즈.
 * faceIdx 0=W×L (높이 H, 기본), 1=L×W (평면 90°), 2=W×H (옆 눕힘),
 *        3=H×W, 4=L×H, 5=H×L.
 */
export function effectiveSizeFace(
  item: Pick<CargoSpec, "width" | "length" | "height">,
  faceIdx: number,
): { width: number; length: number; height: number } {
  const w = item.width;
  const l = item.length;
  const h = item.height;
  switch (faceIdx) {
    case 0:
      return { width: w, length: l, height: h };
    case 1:
      return { width: l, length: w, height: h };
    case 2:
      return { width: w, length: h, height: l };
    case 3:
      return { width: h, length: w, height: l };
    case 4:
      return { width: l, length: h, height: w };
    case 5:
      return { width: h, length: l, height: w };
    default:
      return { width: w, length: l, height: h };
  }
}

/**
 * 화물의 orientation 제한에 따라 허용되는 면 인덱스 목록.
 * - free: 6면 모두
 * - long_along_length: 평면에서 length ≥ width 인 면들 (장축이 길이방향)
 * - fixed: 면 0 (원본 그대로)
 */
export function allowedFaces(
  item: Pick<CargoSpec, "width" | "length" | "height" | "remarks">,
): number[] {
  const orientation = item.remarks.orientation;
  if (orientation === "fixed") return [0];
  const all = [0, 1, 2, 3, 4, 5];
  if (orientation === "free") return all;
  if (orientation === "long_along_length") {
    return all.filter((idx) => {
      const eff = effectiveSizeFace(item, idx);
      return eff.length >= eff.width;
    });
  }
  return all;
}

/**
 * 화물이 회전 상태에서 컨테이너 내부 사이즈에 들어가는지 검사.
 * (단순 차원 체크, 다른 화물과의 충돌 검사는 알고리즘에서 별도 수행)
 */
export function canFitDimensions(
  item: Pick<CargoSpec, "width" | "length" | "height">,
  container: ContainerSpec,
  rotated: boolean,
): boolean {
  const size = effectiveSize(item, rotated);
  return (
    size.width <= container.innerWidth &&
    size.length <= container.innerLength &&
    size.height <= container.innerHeight
  );
}

/**
 * 회전이 리마크의 방향제한과 양립하는지 검사.
 * - free: 자유 회전 가능
 * - long_along_length: 장축이 컨테이너 길이방향 — 회전 후 length가 width보다 길거나 같아야 함
 * - fixed: 회전 금지
 */
export function respectsOrientation(
  item: Pick<CargoSpec, "width" | "length" | "remarks">,
  rotated: boolean,
): boolean {
  const orientation = item.remarks.orientation;
  if (orientation === "free") return true;
  if (orientation === "fixed") return rotated === false;
  if (orientation === "long_along_length") {
    const eff = effectiveSize(
      { width: item.width, length: item.length, height: 0 },
      rotated,
    );
    // 길이방향(length)이 폭(width)보다 짧으면 장축이 길이방향이 아니다
    return eff.length >= eff.width;
  }
  return true;
}

/** 글로벌 무게 룰 허용 비율 — 위 박스 무게 ≤ 아래 박스 무게 (엄격, 등가까지) */
export const STACK_WEIGHT_TOLERANCE = 1.0;

/**
 * top 화물을 bottom 화물 위에 쌓아도 되는지 검사.
 * - bottom이 다단금지(noStacking)면 불가
 * - **글로벌 무게 룰 (2026-05-11 엄격화)**: 위 박스 무게 ≤ 아래 박스 무게
 *   (등가 OK, 위가 아래보다 무거우면 불가 — 사용자 의도 "하단 ≥ 상단" 엄격 룰).
 *   heavierBelow 플래그 무관하게 모든 적층에 적용. 실무 안전 룰 (하단 박스 압축
 *   파손 방지). 단, 양 쪽 무게가 모두 0 이상이고 어느 쪽이든 0 이면 무게 정보
 *   누락으로 간주해 기존 heavierBelow 플래그 기반 체크만 적용 (데이터 누락 보호).
 */
export function canStackOn(
  top: Pick<CargoSpec, "weightPerUnit" | "remarks">,
  bottom: Pick<CargoSpec, "weightPerUnit" | "remarks">,
  options?: {
    /** 적층 booking 비교용. selfStackOnly 룰 검사 시 둘 다 전달 필수. */
    topBookingNo?: string;
    bottomBookingNo?: string;
  },
): boolean {
  if (bottom.remarks.noStacking) return false;

  // 자체다단 룰 — 위/아래 어느 쪽이라도 selfStackOnly + booking 다르면 거부.
  // booking 정보 없으면 (옵션 미전달) 안전 모드: selfStackOnly 활성 시 거부.
  const needsSelfStack =
    top.remarks.selfStackOnly === true ||
    bottom.remarks.selfStackOnly === true;
  if (needsSelfStack) {
    const tb = options?.topBookingNo;
    const bb = options?.bottomBookingNo;
    if (!tb || !bb || tb !== bb) return false;
  }

  const bothWeightsKnown = top.weightPerUnit > 0 && bottom.weightPerUnit > 0;
  if (bothWeightsKnown) {
    // 글로벌 룰 — 위 무게가 아래 무게 × 허용비율 보다 무거우면 불가
    if (top.weightPerUnit > bottom.weightPerUnit * STACK_WEIGHT_TOLERANCE) {
      return false;
    }
  } else {
    // 무게 정보 누락 케이스 — 기존 heavierBelow 플래그 기반 폴백
    const heavierBelowRequired =
      top.remarks.heavierBelow || bottom.remarks.heavierBelow;
    if (heavierBelowRequired && bottom.weightPerUnit < top.weightPerUnit) {
      return false;
    }
  }
  return true;
}

/**
 * 누적 중량 + 추가 중량이 컨테이너 최대 중량 미만인지 검사.
 * 사용자 기준이 "<"(미만)이므로 등호는 포함하지 않는다.
 */
export function withinWeightLimit(
  currentWeight: number,
  addWeight: number,
  container: ContainerSpec,
): boolean {
  return currentWeight + addWeight < container.maxWeightKg;
}
