/**
 * 화물 도메인 타입
 * - DB 스키마 cargo_items 테이블과 1:1 매핑
 * - 사용자 양식의 사이즈/리마크 컬럼이 여기 들어감
 */

export type Orientation = "free" | "long_along_length" | "fixed";

export interface Remark {
  /** 다단금지: 위에 다른 화물을 올리면 안 됨 */
  noStacking: boolean;
  /** 상단적재: 반드시 위쪽에 적재해야 함 */
  topOnly: boolean;
  /** 방향 제한: free=자유, long_along_length=장축을 컨테이너 길이방향으로, fixed=회전 금지 */
  orientation: Orientation;
  /** 중량 조건: 아래 화물이 위 화물보다 무거워야 함 */
  heavierBelow: boolean;
  /** 자유 메모 */
  notes?: string;
}

export interface CargoSpec {
  id: string;
  shipmentId: string;            // 부킹 FK
  sortOrder: number;
  itemName?: string;             // 품목명 (선택)
  /** 화물 라인별 실화주 (콘솔 케이스에서 booking 단위와 다를 수 있음) */
  actualShipperName?: string;
  /** 화물 라인별 화주(표시) */
  shipperName?: string;
  width: number;                 // 가로 cm
  length: number;                // 세로 cm
  height: number;                // 높이 cm
  quantity: number;
  weightPerUnit: number;         // 개당 중량 kg
  cbm?: number;                  // 미입력시 (w*l*h*qty)/1_000_000
  remarks: Remark;
}

export const DEFAULT_REMARK: Remark = {
  noStacking: false,
  topOnly: false,
  orientation: "free",
  heavierBelow: false,
};

export function calcCbm(c: Pick<CargoSpec, "width" | "length" | "height" | "quantity">): number {
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}
