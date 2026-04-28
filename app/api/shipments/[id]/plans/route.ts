/**
 * /api/shipments/[id]/plans — 부킹별 계산 이력 조회
 */

import { NextResponse, type NextRequest } from "next/server";
import { listPlans } from "@/lib/repositories/clpPlans";

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

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    if (!id) return fail("부킹 ID 가 누락되었습니다", 400);
    const plans = await listPlans(id);
    return ok(
      plans.map((p) => ({
        id: p.id,
        shipmentId: p.shipmentId,
        containerMode: p.containerMode,
        count20FT: p.count20FT,
        count40FT: p.count40FT,
        totalWeightKg: p.totalWeightKg,
        totalCbm: p.totalCbm,
        avgFillRate: p.avgFillRate,
        unplacedCount: p.unplacedCount,
        shareToken: p.shareToken,
        createdAt: p.createdAt,
      })),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "이력 조회 실패";
    return fail(msg, 500);
  }
}
