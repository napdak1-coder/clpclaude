/**
 * 화물 도메인 타입
 * - DB 스키마 cargo_items 테이블과 1:1 매핑
 * - 사용자 양식의 사이즈/리마크 컬럼이 여기 들어감
 */

export type Orientation = "free" | "long_along_length" | "fixed";

/**
 * 화물 종류:
 *  - PL/WB/WC/WD/CR/CL : 정상 화물 (실측 W/L/H 가짐, 컨테이너에 시각적으로 배치)
 *  - CT                : 카톤 (일반 택배박스). 실측 없고 CBM 만 사용 → 알고리즘은
 *                        컨테이너 여유 CBM 에 합산만, 시각화 안 함.
 */
export type CargoType = "PL" | "WB" | "WC" | "WD" | "CR" | "CL" | "CT";

export const CARGO_TYPES: CargoType[] = ["PL", "WB", "WC", "WD", "CR", "CL", "CT"];

/** 입력값 정규화 — 화이트리스트 외엔 모두 CT */
export function normalizeCargoType(v: unknown): CargoType {
  if (typeof v !== "string") return "CT";
  const upper = v.trim().toUpperCase();
  if ((CARGO_TYPES as string[]).includes(upper)) return upper as CargoType;
  return "CT";
}

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

/**
 * 단위 사이즈 그룹 — 한 행의 quantity 안에서 사이즈가 다른 화물이 섞여 있을 때
 * (예: 6개 중 4개는 162x107x66, 나머지 2개는 100x80x50) 그룹별로 표현.
 * 시스템 CBM = Σ (width * length * height * quantity) / 1_000_000
 */
export interface UnitSize {
  width: number;                 // 가로 cm
  length: number;                // 세로 cm
  height: number;                // 높이 cm
  quantity: number;              // 이 사이즈에 해당하는 단위 개수
  /** 그룹의 단위당 중량 (kg). 미입력이면 0 — 알고리즘에는 행 단위 weightPerUnit 가 우선 사용 */
  weight?: number;
}

export interface CargoSpec {
  id: string;
  shipmentId: string;            // 부킹 FK
  sortOrder: number;
  /** 화물 종류 (PL/WB/WC/WD/CR/CL = 정상화물, CT = 카톤) */
  cargoType: CargoType;
  itemName?: string;             // 품목명 (선택)
  /** 화물 라인별 실화주 (콘솔 케이스에서 booking 단위와 다를 수 있음) */
  actualShipperName?: string;
  /** 화물 라인별 화주(표시) */
  shipperName?: string;
  width: number;                 // 대표 사이즈 — 알고리즘 입력용 (단일 사이즈)
  length: number;
  height: number;
  quantity: number;
  weightPerUnit: number;         // 개당 중량 kg
  /** 엑셀 "CFS CBM" 셀에서 파싱했거나 사용자가 직접 입력한 CBM. 미입력은 undefined */
  cbm?: number;
  /** 엑셀 ABOUT 셀에서 파싱한 값. CFS CBM 과 별도로 보존하며 시스템 CBM 비교의 폴백 소스로 사용. */
  aboutCbm?: number;
  /** 단위별 사이즈 묶음 — 있으면 시스템 CBM 계산에 사용 (없으면 대표 사이즈 + quantity) */
  unitSizes?: UnitSize[];
  remarks: Remark;
}

export const DEFAULT_REMARK: Remark = {
  noStacking: false,
  topOnly: false,
  orientation: "free",
  heavierBelow: false,
};

/** 대표 사이즈 × 수량 기준 CBM (m³) — 호환용 */
export function calcCbm(c: Pick<CargoSpec, "width" | "length" | "height" | "quantity">): number {
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}

/**
 * 시스템 CBM 계산 — 단위 사이즈 묶음이 있으면 그룹별 합산, 없으면 대표 사이즈 사용.
 * 사용자 공식: 가로×세로×높이(cm) ÷ 1_000_000 × 수량
 *   예) 162×107×66 cm × 4개 = 1.144 × 4 = 4.576 m³
 */
export function calcSystemCbm(c: {
  width: number;
  length: number;
  height: number;
  quantity: number;
  unitSizes?: UnitSize[];
}): number {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce(
      (sum, u) => sum + (u.width * u.length * u.height * u.quantity) / 1_000_000,
      0,
    );
  }
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}
