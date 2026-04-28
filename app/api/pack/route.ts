/**
 * /api/pack — 부킹 ID + 모드를 받아 적재 계획을 계산하고 clp_plans 에 저장
 */

import { NextResponse, type NextRequest } from "next/server";
import { pack } from "@/lib/packing/algorithm";
import { getShipment } from "@/lib/repositories/shipments";
import { savePlan } from "@/lib/repositories/clpPlans";
import type { ContainerMode } from "@/types/plan";

interface ApiOk<T> {
  success: true;
  data: T;
}
interface ApiErr {
  success: false;
  error: string;
}

function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiOk<T>>({ success: true, data }, { status });
}
function fail(error: string, status = 400) {
  return NextResponse.json<ApiErr>({ success: false, error }, { status });
}

function parseMode(v: unknown): ContainerMode {
  if (v === "20ft_only" || v === "40ft_only" || v === "auto") return v;
  return "auto";
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return fail("요청 본문이 비어있습니다", 400);
    }
    const obj = body as Record<string, unknown>;
    const shipmentId =
      typeof obj.shipmentId === "string" ? obj.shipmentId : "";
    if (!shipmentId) {
      return fail("shipmentId 가 필요합니다", 400);
    }
    const mode = parseMode(obj.mode);

    const shipment = await getShipment(shipmentId);
    if (!shipment) {
      return fail("부킹을 찾을 수 없습니다", 404);
    }
    if (shipment.items.length === 0) {
      return fail("계산할 화물이 없습니다", 400);
    }

    // 알고리즘 실행 — 동기 처리 (휴리스틱이라 빠름)
    const result = pack(shipment.items, mode);

    // DB 영속화 — 결과 자체와 요약 컬럼 모두 저장
    const saved = await savePlan(shipmentId, mode, result);

    return ok({
      planId: saved.id,
      result,
      summary: {
        count20FT: saved.count20FT,
        count40FT: saved.count40FT,
        totalWeightKg: saved.totalWeightKg,
        totalCbm: saved.totalCbm,
        avgFillRate: saved.avgFillRate,
        unplacedCount: saved.unplacedCount,
      },
    });
  } catch (e: unknown) {
    if (e instanceof SyntaxError) return fail("JSON 파싱 실패", 400);
    const msg = e instanceof Error ? e.message : "적재 계산 실패";
    return fail(msg, 500);
  }
}
