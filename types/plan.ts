/**
 * 적재 계획 결과 타입
 */

import type { ContainerSpec } from "./container";
import type { CargoType, Remark } from "./cargo";

export interface PlacedCargo {
  cargoId: string;               // CargoSpec.id
  shipper: string;               // 화주명 (스냅샷)
  name?: string;                 // 품목명
  /** 사용자 입력 화물 종류 (PL/WB/WC/WD/CR/CL — 시각 적재 화물은 항상 정상 6종 중 하나) */
  cargoType: CargoType;
  /**
   * 사용자가 입력한 CFS CBM (= cargo.cbm). 입고완료 화물에서만 채워짐.
   * 시각 적재되더라도 화면에 "엑셀 CBM" 칼럼으로 별도 표시한다 (시스템 CBM 과 비교용).
   * 미입고 (cbm 미입력) 은 null.
   */
  cfsCbm: number | null;
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

/**
 * CT 카톤·입고완료처럼 시각 좌표가 없는 화물의 컨테이너별 분배 항목.
 * 한 cargoId 가 여러 컨테이너로 분산될 수 있어 cbm 은 "이 컨테이너에 들어간 분량".
 *
 * UI 표시를 위해 원본 cargo 의 사이즈·수량·중량을 같이 보존한다.
 * 분할되어도 width/length/height/quantity/weightPerUnit 은 원본 그대로 유지하고,
 * cbm 만 부분값을 가진다 (totalCbm 과 비교해 분할 여부 판단).
 */
export interface BulkItem {
  cargoId: string;
  shipper: string;
  name?: string;
  cargoType: CargoType;
  /** 이 컨테이너에 할당된 CBM 분량 (m³). 분산 시 cargo 총 CBM 의 일부일 수 있음 */
  cbm: number;
  /** 원본 cargo 의 총 CBM (분배 기준) — 분할 표시·검증용 */
  totalCbm: number;
  /** 대표 사이즈 (cm) — 시각 좌표는 없지만 식별·검토용 */
  width: number;
  length: number;
  height: number;
  /** 원본 cargo 의 총 수량 (분할되어도 원본 그대로) */
  quantity: number;
  /** 단위당 중량 (kg) — 화면 표시 시 quantity * weightPerUnit 으로 총 중량 산출 */
  weightPerUnit: number;
  /**
   * 사용자가 입력한 CFS CBM (= cargo.cbm 필드). 입고완료 화물에서만 채워짐.
   * 입력 폼의 "엑셀 CBM" 컬럼에 해당하며 화면에서 시스템 CBM 과 별도로 표시한다.
   * CT 등 입력 안 된 경우 null.
   */
  cfsCbm: number | null;
  group: "ct" | "completed";
}

export interface ContainerPlan {
  index: number;                 // 1, 2, 3...
  spec: ContainerSpec;
  rows: Row[];
  totalWeight: number;           // kg
  totalCbm: number;              // 시각 unit 만 합산
  /** 카톤(CT) 화물 CBM — 시각화 X, 컨테이너 여유 CBM 에 합산만 */
  ctCbm: number;
  /** 입고완료(CFS CBM 입력) 화물 CBM — 시각화 X, 별도 합산 */
  completedCbm: number;
  /**
   * CT/입고완료 화물의 cargoId 단위 분배 목록.
   * 시각 화물(rows[].bottomItems/topItems) 과 합치면 이 컨테이너에 실제로 들어간
   * 모든 화물이 빠짐없이 표시된다.
   */
  bulkItems: BulkItem[];
  cbmFillRate: number;           // % — (시각 + ct + completed) / maxCbm × 100
  weightFillRate: number;        // %
}

export type ContainerMode = "auto" | "20ft_only" | "40ft_only";

/**
 * 미배치 화물 항목.
 * 표시 칼럼은 컨테이너 화물 목록과 동일 순서:
 * 분류 / 구분 / 화주 / 품목 / 사이즈 / 수량 / 시스템 CBM / 엑셀 CBM / 분량(미배치 m³) / 중량.
 *
 * 시각 unit 이 못 들어간 경우는 같은 cargoId 끼리 1행으로 묶어 표시한다 (수량 = 못 들어간 unit 수).
 * CT bulk 가 못 들어간 경우는 cargo 1행 = 못 들어간 m³ 표시.
 *
 * 구버전 결과는 cargoId/reason 만 있고 나머지 필드는 undefined — UI 에서 폴백 처리.
 */
export interface UnplacedItem {
  cargoId: string;
  reason: string;
  shipper?: string;
  name?: string;
  cargoType?: CargoType;
  width?: number;
  length?: number;
  height?: number;
  quantity?: number;
  systemCbm?: number;
  cfsCbm?: number | null;
  /** 못 들어간 분량 (m³). visual=unit cube 합, ct=allocate 실패 m³ */
  unfitCbm?: number;
  weight?: number;
  group?: "visual" | "ct" | "completed";
}

export interface CLPResult {
  containers: ContainerPlan[];
  unplaced: UnplacedItem[];
  summary: {
    count20FT: number;
    count40FT: number;
    totalWeight: number;
    totalCbm: number;
    /** 카톤(CT) 화물 총 CBM (시각화 X, 합산용) */
    ctTotalCbm: number;
    /** 입고완료(CFS CBM) 화물 총 CBM (시각화 X) */
    completedTotalCbm: number;
    avgFillRate: number;
    /** 사용자에게 표시할 경고/안내 메시지 (한도 초과 분산 등) */
    warnings: string[];
  };
}
