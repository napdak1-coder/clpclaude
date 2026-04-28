/**
 * /api/share — 공유 토큰 발급 (POST)
 *
 * planId 를 받아 share_token 을 생성하고 공유용 URL 을 함께 반환한다.
 * 이미 토큰이 있으면 동일 토큰을 재사용한다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createShareToken } from "@/lib/repositories/clpPlans";

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

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return fail("요청 본문이 비어있습니다", 400);
    }
    const obj = body as Record<string, unknown>;
    const planId = typeof obj.planId === "string" ? obj.planId : "";
    if (!planId) return fail("planId 가 필요합니다", 400);

    const token = await createShareToken(planId);
    if (!token) return fail("계획을 찾을 수 없습니다", 404);

    // 절대 URL 은 호출 측에서 host 정보를 모르므로 path 만 반환 — 클라이언트가 origin 을 붙임
    return ok({ token, path: `/share/${token}` });
  } catch (e: unknown) {
    if (e instanceof SyntaxError) return fail("JSON 파싱 실패", 400);
    const msg = e instanceof Error ? e.message : "공유 토큰 발급 실패";
    return fail(msg, 500);
  }
}
