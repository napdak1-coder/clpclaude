/**
 * shipments + cargo_items 저장소
 *
 * - 양식 컬럼(House B/L, DEST, Booking 등)을 1:1 매핑
 * - cargo_items 는 shipment 와 함께 트랜잭션으로 처리해야 부분 저장이 발생하지 않음
 * - SQLite 의 boolean 컬럼은 INTEGER(0/1) — 읽기/쓰기 시 변환 필수
 */

import { db } from "../db.ts";
import {
  normalizeCargoType,
  type CargoSpec,
  type CargoType,
  type Orientation,
  type UnitSize,
} from "../../types/cargo.ts";

/** unit_sizes_json TEXT → UnitSize[] (이상치는 조용히 폐기) */
function parseUnitSizes(raw: unknown): UnitSize[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const txt = typeof raw === "string" ? raw : String(raw);
  if (!txt) return undefined;
  try {
    const parsed: unknown = JSON.parse(txt);
    if (!Array.isArray(parsed)) return undefined;
    const cleaned: UnitSize[] = [];
    for (const v of parsed) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const w = Number(o.width);
      const l = Number(o.length);
      const h = Number(o.height);
      const q = Number(o.quantity);
      const wt = Number(o.weight);
      if (!Number.isFinite(w) || !Number.isFinite(l) || !Number.isFinite(h) || !Number.isFinite(q)) continue;
      if (w <= 0 || l <= 0 || h <= 0 || q <= 0) continue;
      cleaned.push({
        width: w,
        length: l,
        height: h,
        quantity: q,
        weight: Number.isFinite(wt) && wt >= 0 ? wt : 0,
      });
    }
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

function serializeUnitSizes(arr: UnitSize[] | undefined | null): string | null {
  if (!arr || arr.length === 0) return null;
  const cleaned = arr
    .filter((u) => u.width > 0 && u.length > 0 && u.height > 0 && u.quantity > 0)
    .map((u) => ({
      width: u.width,
      length: u.length,
      height: u.height,
      quantity: u.quantity,
      weight: typeof u.weight === "number" && u.weight >= 0 ? u.weight : 0,
    }));
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

/** shipments 테이블 + 합산값 (목록용) */
export interface ShipmentSummary {
  id: string;
  displayNo: number | null;
  houseBlNo: string | null;
  destination: string | null;
  bookingNo: string | null;
  shipmentRound: number | null;
  hb: string | null;
  ep: string | null;
  n: string | null;
  actualShipperName: string | null;
  shipperName: string | null;
  totalQuantity: number;
  totalWeightKg: number;
  totalCbm: number;
  about: string | null;
  generalRemark: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** 단일 shipment + 화물 상세 */
export interface ShipmentDetail extends ShipmentSummary {
  items: CargoSpec[];
}

/** 생성/수정 입력 */
export interface ShipmentInput {
  displayNo?: number | null;
  houseBlNo?: string | null;
  destination?: string | null;
  bookingNo?: string | null;
  shipmentRound?: number | null;
  hb?: string | null;
  ep?: string | null;
  n?: string | null;
  actualShipperName?: string | null;
  shipperName?: string | null;
  about?: string | null;
  generalRemark?: string | null;
  status?: "draft" | "calculated" | "shipped" | "archived";
  items: CargoItemInput[];
}

export interface CargoItemInput {
  id?: string;                 // 미지정 시 자동 발급
  cargoType?: CargoType | null;
  /** 부킹 번호 — 콘솔에서 한 shipment 안 여러 booking 가능 */
  bookingNo?: string | null;
  /** House B/L (포워더 발행) — cargo 단위 */
  houseBlNo?: string | null;
  /** DEST(목적지) — cargo 단위 */
  destination?: string | null;
  sortOrder?: number;
  itemName?: string | null;
  /** 화물 라인별 실화주 (콘솔 — 부킹 단위와 다른 화주 다중 보존) */
  actualShipperName?: string | null;
  /** 화물 라인별 화주(표시) */
  shipperName?: string | null;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  quantity: number;
  weightPerUnitKg: number;
  cbm?: number | null;
  /** 엑셀 ABOUT 셀 값 — CFS CBM 과 별도 보존 (about_cbm 컬럼) */
  aboutCbm?: number | null;
  /** 단위별 사이즈 그룹 — 있으면 unit_sizes_json TEXT 컬럼으로 직렬화 저장 */
  unitSizes?: UnitSize[] | null;
  noStacking?: boolean;
  topOnly?: boolean;
  orientation?: Orientation;
  heavierBelow?: boolean;
  itemRemark?: string | null;
}

/** SQLite row → 도메인 변환 헬퍼 */
function toBoolean(v: unknown): boolean {
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "boolean") return v;
  return false;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number(v);
  return 0;
}

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return toNumber(v);
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function rowToSummary(row: Record<string, unknown>): ShipmentSummary {
  return {
    id: toString(row.id),
    displayNo: toNullableNumber(row.display_no),
    houseBlNo: toStringOrNull(row.house_bl_no),
    destination: toStringOrNull(row.destination),
    bookingNo: toStringOrNull(row.booking_no),
    shipmentRound: toNullableNumber(row.shipment_round),
    hb: toStringOrNull(row.hb),
    ep: toStringOrNull(row.ep),
    n: toStringOrNull(row.n),
    actualShipperName: toStringOrNull(row.actual_shipper_name),
    shipperName: toStringOrNull(row.shipper_name),
    totalQuantity: toNumber(row.total_quantity),
    totalWeightKg: toNumber(row.total_weight_kg),
    totalCbm: toNumber(row.total_cbm),
    about: toStringOrNull(row.about),
    generalRemark: toStringOrNull(row.general_remark),
    status: toString(row.status),
    createdAt: toString(row.created_at),
    updatedAt: toString(row.updated_at),
  };
}

function rowToCargo(row: Record<string, unknown>): CargoSpec {
  const orientationRaw = toString(row.orientation);
  const orientation: Orientation =
    orientationRaw === "fixed" || orientationRaw === "long_along_length"
      ? orientationRaw
      : "free";
  return {
    id: toString(row.id),
    shipmentId: toString(row.shipment_id),
    sortOrder: toNumber(row.sort_order),
    cargoType: normalizeCargoType(row.cargo_type),
    bookingNo: toStringOrNull(row.booking_no) ?? undefined,
    houseBlNo: toStringOrNull(row.house_bl_no) ?? undefined,
    destination: toStringOrNull(row.destination) ?? undefined,
    itemName: toStringOrNull(row.item_name) ?? undefined,
    actualShipperName: toStringOrNull(row.actual_shipper_name) ?? undefined,
    shipperName: toStringOrNull(row.shipper_name) ?? undefined,
    width: toNumber(row.width_cm),
    length: toNumber(row.length_cm),
    height: toNumber(row.height_cm),
    quantity: toNumber(row.quantity),
    weightPerUnit: toNumber(row.weight_per_unit_kg),
    cbm: toNullableNumber(row.cbm) ?? undefined,
    aboutCbm: toNullableNumber(row.about_cbm) ?? undefined,
    unitSizes: parseUnitSizes(row.unit_sizes_json),
    remarks: {
      noStacking: toBoolean(row.no_stacking),
      topOnly: toBoolean(row.top_only),
      orientation,
      heavierBelow: toBoolean(row.heavier_below),
      notes: toStringOrNull(row.item_remark) ?? undefined,
    },
  };
}

/** 1) 목록 조회 — 합산이 포함된 view 사용 */
export async function listShipments(): Promise<ShipmentSummary[]> {
  const result = await db.execute(
    "SELECT * FROM shipment_summary_v ORDER BY created_at DESC",
  );
  return result.rows.map((r) => rowToSummary(r as Record<string, unknown>));
}

/** 2) 단건 조회 — shipments + cargo_items */
export async function getShipment(id: string): Promise<ShipmentDetail | null> {
  const summary = await db.execute({
    sql: "SELECT * FROM shipment_summary_v WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (summary.rows.length === 0) return null;
  const items = await db.execute({
    sql:
      "SELECT * FROM cargo_items WHERE shipment_id = ? ORDER BY sort_order ASC, id ASC",
    args: [id],
  });
  const summaryObj = rowToSummary(summary.rows[0] as Record<string, unknown>);
  return {
    ...summaryObj,
    items: items.rows.map((r) => rowToCargo(r as Record<string, unknown>)),
  };
}

/** 3) 생성 — shipment + 다건 cargo_items 트랜잭션 */
export async function createShipment(
  input: ShipmentInput,
): Promise<ShipmentDetail> {
  const id = crypto.randomUUID();
  const status = input.status ?? "draft";

  // 트랜잭션처럼 batch 사용 — 어느 한 statement 가 실패하면 모두 롤백
  const itemStatements = (input.items ?? []).map((item, idx) => {
    const itemId = item.id ?? crypto.randomUUID();
    return {
      sql: `
        INSERT INTO cargo_items (
          id, shipment_id, sort_order, item_name,
          actual_shipper_name, shipper_name,
          width_cm, length_cm, height_cm, quantity, weight_per_unit_kg, cbm,
          no_stacking, top_only, orientation, heavier_below, item_remark,
          unit_sizes_json, about_cbm, cargo_type, booking_no,
          house_bl_no, destination
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        itemId,
        id,
        item.sortOrder ?? idx,
        item.itemName ?? null,
        item.actualShipperName ?? null,
        item.shipperName ?? null,
        item.widthCm,
        item.lengthCm,
        item.heightCm,
        item.quantity,
        item.weightPerUnitKg,
        item.cbm ?? null,
        item.noStacking ? 1 : 0,
        item.topOnly ? 1 : 0,
        item.orientation ?? "free",
        item.heavierBelow ? 1 : 0,
        item.itemRemark ?? null,
        serializeUnitSizes(item.unitSizes ?? null),
        item.aboutCbm ?? null,
        normalizeCargoType(item.cargoType ?? null),
        item.bookingNo ?? null,
        item.houseBlNo ?? null,
        item.destination ?? null,
      ],
    };
  });

  await db.batch(
    [
      {
        sql: `
          INSERT INTO shipments (
            id, display_no, house_bl_no, destination, booking_no, shipment_round,
            hb, ep, n, actual_shipper_name, shipper_name, about, general_remark, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          input.displayNo ?? null,
          input.houseBlNo ?? null,
          input.destination ?? null,
          input.bookingNo ?? null,
          input.shipmentRound ?? null,
          input.hb ?? null,
          input.ep ?? null,
          input.n ?? null,
          input.actualShipperName ?? null,
          input.shipperName ?? null,
          input.about ?? null,
          input.generalRemark ?? null,
          status,
        ],
      },
      ...itemStatements,
    ],
    "write",
  );

  const created = await getShipment(id);
  if (!created) {
    throw new Error("shipment 생성 후 조회에 실패했습니다");
  }
  return created;
}

/** 4) 수정 — 기존 cargo_items 전체 삭제 후 재삽입 (단순화) */
export async function updateShipment(
  id: string,
  input: ShipmentInput,
): Promise<ShipmentDetail | null> {
  const existing = await getShipment(id);
  if (!existing) return null;

  const itemStatements = (input.items ?? []).map((item, idx) => {
    const itemId = item.id ?? crypto.randomUUID();
    return {
      sql: `
        INSERT INTO cargo_items (
          id, shipment_id, sort_order, item_name,
          actual_shipper_name, shipper_name,
          width_cm, length_cm, height_cm, quantity, weight_per_unit_kg, cbm,
          no_stacking, top_only, orientation, heavier_below, item_remark,
          unit_sizes_json, about_cbm, cargo_type, booking_no,
          house_bl_no, destination
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        itemId,
        id,
        item.sortOrder ?? idx,
        item.itemName ?? null,
        item.actualShipperName ?? null,
        item.shipperName ?? null,
        item.widthCm,
        item.lengthCm,
        item.heightCm,
        item.quantity,
        item.weightPerUnitKg,
        item.cbm ?? null,
        item.noStacking ? 1 : 0,
        item.topOnly ? 1 : 0,
        item.orientation ?? "free",
        item.heavierBelow ? 1 : 0,
        item.itemRemark ?? null,
        serializeUnitSizes(item.unitSizes ?? null),
        item.aboutCbm ?? null,
        normalizeCargoType(item.cargoType ?? null),
        item.bookingNo ?? null,
        item.houseBlNo ?? null,
        item.destination ?? null,
      ],
    };
  });

  await db.batch(
    [
      {
        sql: `
          UPDATE shipments SET
            display_no = ?, house_bl_no = ?, destination = ?, booking_no = ?,
            shipment_round = ?, hb = ?, ep = ?, n = ?,
            actual_shipper_name = ?, shipper_name = ?, about = ?, general_remark = ?,
            status = COALESCE(?, status)
          WHERE id = ?
        `,
        args: [
          input.displayNo ?? null,
          input.houseBlNo ?? null,
          input.destination ?? null,
          input.bookingNo ?? null,
          input.shipmentRound ?? null,
          input.hb ?? null,
          input.ep ?? null,
          input.n ?? null,
          input.actualShipperName ?? null,
          input.shipperName ?? null,
          input.about ?? null,
          input.generalRemark ?? null,
          input.status ?? null,
          id,
        ],
      },
      { sql: "DELETE FROM cargo_items WHERE shipment_id = ?", args: [id] },
      ...itemStatements,
    ],
    "write",
  );

  return getShipment(id);
}

/** 5) 삭제 — FK ON DELETE CASCADE 로 cargo_items 자동 삭제 */
export async function deleteShipment(id: string): Promise<boolean> {
  const result = await db.execute({
    sql: "DELETE FROM shipments WHERE id = ?",
    args: [id],
  });
  return (result.rowsAffected ?? 0) > 0;
}
