/**
 * 적재 계획 결과 타입
 */

import type { ContainerSpec } from "./container";
import type { Remark } from "./cargo";

export interface PlacedCargo {
  cargoId: string;               // CargoSpec.id
  shipper: string;               // 화주명 (스냅샷)
  name?: string;                 // 품목명
  layer: "bottom" | "top";
  /** 컨테이너 입구 기준 cm — x=폭방향, y=길이방향 */
  position: { x: number; y: number };
  /** 실제 배치된 사이즈 (회전 반영) */
  size: { width: number; length: number; height: number };
  rotated: boolean;
  weight: number;                // 단위 중량 (kg)
  remarks: Remark;
}

export interface Row {
  index: number;
  yStart: number;                // 입구 기준 cm
  yEnd: number;
  bottomItems: PlacedCargo[];
  topItems: PlacedCargo[];
  bottomMaxHeight: number;       // 하단 최대 높이 (cm)
  topMaxHeight: number;          // 상단 최대 높이 (cm)
  topClearance: number;          // 천장까지 여유 높이 (cm)
  doorPassable: boolean;         // 입구 통과 가능?
}

export interface ContainerPlan {
  index: number;                 // 1, 2, 3...
  spec: ContainerSpec;
  rows: Row[];
  totalWeight: number;           // kg
  totalCbm: number;
  cbmFillRate: number;           // %
  weightFillRate: number;        // %
}

export type ContainerMode = "auto" | "20ft_only" | "40ft_only";

export interface CLPResult {
  containers: ContainerPlan[];
  unplaced: { cargoId: string; reason: string }[];
  summary: {
    count20FT: number;
    count40FT: number;
    totalWeight: number;
    totalCbm: number;
    avgFillRate: number;
  };
}
