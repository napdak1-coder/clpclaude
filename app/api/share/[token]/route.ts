/**
 * /api/share/[token] — 공유 토큰으로 적재 계획 조회 (읽기 전용 공개 링크)
 */

import { NextResponse, type NextRequest } from "next/server";
import { getPlanByShareToken } from "@/lib/repositories/clpPlans";

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
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { token } = await ctx.params;
    if (!token) return fail("토큰이 누락되었습니다", 400);

    const plan = await getPlanByShareToken(token);
    if (!plan) return fail("공유된 계획을 찾을 수 없습니다", 404);

    // 공개 응답 — shipmentId 등 식별 정보는 그대로 노출되지 않도록 필요한 필드만 추림
    return ok({
      id: plan.id,
      containerMode: plan.containerMode,
      count20FT: plan.count20FT,
      count40FT: plan.count40FT,
      totalWeightKg: plan.totalWeightKg,
      totalCbm: plan.totalCbm,
      avgFillRate: plan.avgFillRate,
      unplacedCount: plan.unplacedCount,
      createdAt: plan.createdAt,
      result: plan.result,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "조회 실패";
    return fail(msg, 500);
  }
}
