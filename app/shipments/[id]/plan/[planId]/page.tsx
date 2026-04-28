/**
 * 적재 계획 상세 페이지 (서버 컴포넌트)
 *
 * - DB 에서 직접 plan 을 읽어 PlanView 클라이언트 컴포넌트로 전달
 * - 다른 부킹/계획 ID 로 잘못 접근하면 404 안내
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlan } from "@/lib/repositories/clpPlans";
import { getShipment } from "@/lib/repositories/shipments";
import { PlanView } from "@/components/plan/PlanView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; planId: string }>;
}

export default async function PlanDetailPage({ params }: PageProps) {
  const { id, planId } = await params;
  const plan = await getPlan(planId);
  if (!plan || plan.shipmentId !== id) {
    notFound();
  }

  const shipment = await getShipment(id);
  const fileLabel = shipment?.houseBlNo || shipment?.bookingNo || "shipment";

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">적재 계획 상세</h1>
          <p className="text-xs text-neutral-500">
            계산 시각:{" "}
            {new Date(plan.createdAt).toLocaleString("ko-KR")} · 모드{" "}
            {plan.containerMode}
          </p>
        </div>
        <Link
          href={`/shipments/${id}`}
          className="text-sm text-neutral-500 underline hover:text-neutral-700"
        >
          ← 부킹으로
        </Link>
      </header>
      <PlanView
        planId={plan.id}
        result={plan.result}
        shareToken={plan.shareToken}
        fileLabel={fileLabel}
      />
    </main>
  );
}
