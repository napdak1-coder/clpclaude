/**
 * clp_plans 저장소 — 계산된 적재 계획의 영속화
 *
 * - 결과(CLPResult)는 result_json TEXT 컬럼에 직렬화하여 저장
 * - 공유 링크용 short token 발급/조회를 같이 담당
 */

import crypto from "node:crypto";
import { db } from "../db.ts";
import type { CLPResult, ContainerMode } from "../../types/plan.ts";

export interface CLPPlanRecord {
  id: string;
  shipmentId: string;
  containerMode: ContainerMode;
  count20FT: number;
  count40FT: number;
  totalWeightKg: number | null;
  totalCbm: number | null;
  avgFillRate: number | null;
  unplacedCount: number;
  shareToken: string | null;
  createdAt: string;
  result: CLPResult;
}

/** 짧은 영문/숫자 토큰 — 추측 어렵게 22자 정도 */
function generateShareToken(): string {
  return crypto.randomBytes(16).toString("base64url");
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

function toString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toContainerMode(v: unknown): ContainerMode {
  const s = toString(v);
  if (s === "20ft_only" || s === "40ft_only" || s === "auto") return s;
  return "auto";
}

function rowToRecord(row: Record<string, unknown>): CLPPlanRecord {
  // result_json 은 TEXT 로 저장되어 있어 JSON.parse 필요
  const raw = toString(row.result_json);
  let result: CLPResult;
  try {
    result = JSON.parse(raw) as CLPResult;
  } catch {
    // 손상된 데이터에 대비한 안전 기본값
    result = {
      containers: [],
      unplaced: [],
      summary: {
        count20FT: 0,
        count40FT: 0,
        totalWeight: 0,
        totalCbm: 0,
        avgFillRate: 0,
      },
    };
  }
  return {
    id: toString(row.id),
    shipmentId: toString(row.shipment_id),
    containerMode: toContainerMode(row.container_mode),
    count20FT: toNumber(row.count_20ft),
    count40FT: toNumber(row.count_40ft),
    totalWeightKg: toNullableNumber(row.total_weight_kg),
    totalCbm: toNullableNumber(row.total_cbm),
    avgFillRate: toNullableNumber(row.avg_fill_rate),
    unplacedCount: toNumber(row.unplaced_count),
    shareToken: toStringOrNull(row.share_token),
    createdAt: toString(row.created_at),
    result,
  };
}

/** 1) 저장 — result 전체를 JSON 직렬화 */
export async function savePlan(
  shipmentId: string,
  mode: ContainerMode,
  result: CLPResult,
): Promise<CLPPlanRecord> {
  const id = crypto.randomUUID();

  await db.execute({
    sql: `
      INSERT INTO clp_plans (
        id, shipment_id, container_mode,
        count_20ft, count_40ft,
        total_weight_kg, total_cbm, avg_fill_rate,
        result_json, unplaced_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      shipmentId,
      mode,
      result.summary.count20FT,
      result.summary.count40FT,
      result.summary.totalWeight,
      result.summary.totalCbm,
      result.summary.avgFillRate,
      JSON.stringify(result),
      result.unplaced.length,
    ],
  });

  // shipment status를 calculated 로 갱신 — 재계산 흔적이 남도록
  await db.execute({
    sql:
      "UPDATE shipments SET status = 'calculated' WHERE id = ? AND status = 'draft'",
    args: [shipmentId],
  });

  const fetched = await db.execute({
    sql: "SELECT * FROM clp_plans WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (fetched.rows.length === 0) {
    throw new Error("clp_plan 저장 후 조회 실패");
  }
  return rowToRecord(fetched.rows[0] as Record<string, unknown>);
}

/** 2) 특정 shipment 의 계획 이력 */
export async function listPlans(shipmentId: string): Promise<CLPPlanRecord[]> {
  const result = await db.execute({
    sql:
      "SELECT * FROM clp_plans WHERE shipment_id = ? ORDER BY created_at DESC",
    args: [shipmentId],
  });
  return result.rows.map((r) => rowToRecord(r as Record<string, unknown>));
}

/** 3) 단건 조회 (관리/디버그용) */
export async function getPlan(planId: string): Promise<CLPPlanRecord | null> {
  const result = await db.execute({
    sql: "SELECT * FROM clp_plans WHERE id = ? LIMIT 1",
    args: [planId],
  });
  if (result.rows.length === 0) return null;
  return rowToRecord(result.rows[0] as Record<string, unknown>);
}

/** 4) 공유 토큰으로 plan 조회 */
export async function getPlanByShareToken(
  token: string,
): Promise<CLPPlanRecord | null> {
  const result = await db.execute({
    sql: "SELECT * FROM clp_plans WHERE share_token = ? LIMIT 1",
    args: [token],
  });
  if (result.rows.length === 0) return null;
  return rowToRecord(result.rows[0] as Record<string, unknown>);
}

/** 5) 공유 토큰 발급 — 이미 있으면 그대로 반환, 없으면 새로 생성 */
export async function createShareToken(planId: string): Promise<string | null> {
  const existing = await getPlan(planId);
  if (!existing) return null;
  if (existing.shareToken) return existing.shareToken;

  // share_token UNIQUE 제약이 있어 충돌 시 재시도
  // 충돌 가능성은 매우 낮지만(128bit 랜덤) 안전을 위해 3회까지 시도
  for (let i = 0; i < 3; i += 1) {
    const token = generateShareToken();
    try {
      await db.execute({
        sql: "UPDATE clp_plans SET share_token = ? WHERE id = ?",
        args: [token, planId],
      });
      return token;
    } catch {
      // UNIQUE 위반 추정 — 다음 토큰 시도
      continue;
    }
  }
  throw new Error("공유 토큰 발급에 실패했습니다");
}
