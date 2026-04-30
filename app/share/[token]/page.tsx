/**
 * 공유 토큰으로 접근하는 읽기 전용 적재 계획 페이지
 *
 * - 인증 없이 접근. 식별 정보(House B/L 등)는 노출하지 않고 결과만 표시
 */

import { notFound } from "next/navigation";
import { getPlanByShareToken } from "@/lib/repositories/clpPlans";
import { PlanView } from "@/components/plan/PlanView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SharedPlanPage({ params }: PageProps) {
  const { token } = await params;
  const plan = await getPlanByShareToken(token);
  if (!plan) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-8">
      <header>
        <h1 className="text-xl font-bold">clp노블코코 — 공유</h1>
        <p className="mt-1 text-xs text-neutral-500">
          이 화면은 읽기 전용입니다. 계산 시각:{" "}
          {new Date(plan.createdAt).toLocaleString("ko-KR")}
        </p>
      </header>
      <PlanView
        planId={plan.id}
        shipmentId={plan.shipmentId}
        containerMode={plan.containerMode}
        result={plan.result}
        shareToken={plan.shareToken}
        readOnly
      />
    </main>
  );
}
