/**
 * shipments + cargo_items 저장소
 *
 * - 양식 컬럼(House B/L, DEST, Booking 등)을 1:1 매핑
 * - cargo_items 는 shipment 와 함께 트랜잭션으로 처리해야 부분 저장이 발생하지 않음
 * - SQLite 의 boolean 컬럼은 INTEGER(0/1) — 읽기/쓰기 시 변환 필수
 */

import { db } from "../db.ts";
import type { CargoSpec, Orientation } from "../../types/cargo.ts";

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
    itemName: toStringOrNull(row.item_name) ?? undefined,
    actualShipperName: toStringOrNull(row.actual_shipper_name) ?? undefined,
    shipperName: toStringOrNull(row.shipper_name) ?? undefined,
    width: toNumber(row.width_cm),
    length: toNumber(row.length_cm),
    height: toNumber(row.height_cm),
    quantity: toNumber(row.quantity),
    weightPerUnit: toNumber(row.weight_per_unit_kg),
    cbm: toNullableNumber(row.cbm) ?? undefined,
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
          no_stacking, top_only, orientation, heavier_below, item_remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          no_stacking, top_only, orientation, heavier_below, item_remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
