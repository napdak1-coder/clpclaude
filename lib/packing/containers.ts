/**
 * 컨테이너 스펙 상수 및 조회 헬퍼
 *
 * 사용자 요구사항 기준치(20FT < 21000kg, 40FT < 25000kg, 입구/내부 사이즈)를
 * 한 곳에서만 정의해야 알고리즘과 UI가 어긋나지 않기 때문에 단일 소스로 관리한다.
 */

import type { ContainerSpec, ContainerType } from "../../types/container.ts";

export const CONTAINERS: Record<ContainerType, ContainerSpec> = {
  "20FT": {
    type: "20FT",
    maxWeightKg: 21000,
    maxCbm: 28,
    innerLength: 590,
    innerWidth: 234,
    doorHeight: 228,
    innerHeight: 238,
  },
  "40FT": {
    type: "40FT",
    maxWeightKg: 25000,
    maxCbm: 60,
    innerLength: 1200,
    innerWidth: 234,
    doorHeight: 258,
    innerHeight: 268,
  },
};

/**
 * 컨테이너 타입을 받아 스펙을 반환한다.
 * 알 수 없는 타입은 명시적으로 에러를 던져 호출자가 빨리 실패하도록 한다.
 */
export function getContainerSpec(type: ContainerType): ContainerSpec {
  const spec = CONTAINERS[type];
  if (!spec) {
    throw new Error(`알 수 없는 컨테이너 타입: ${type}`);
  }
  return spec;
}

/**
 * 컨테이너 운영상 최대 부피(m³) — 컨테이너 수 산정 / 충전률 기준값.
 * 이론적인 내부 치수 부피가 아닌 사용자가 정한 maxCbm 을 반환한다.
 */
export function getContainerCbm(spec: ContainerSpec): number {
  return spec.maxCbm;
}
