"use client";

/**
 * 부킹 상세 페이지
 *
 * - 상단: 수정 가능한 ShipmentForm
 * - 중단: 컨테이너 모드 선택 + 계산하기
 * - 하단: 이전 계산 이력
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShipmentForm,
  type ShipmentFormSubmit,
} from "@/components/input/ShipmentForm";
import type { ShipmentDetail } from "@/lib/repositories/shipments";
import type { ContainerMode } from "@/types/plan";

interface DetailResponse {
  success: boolean;
  data?: ShipmentDetail;
  error?: string;
}

interface PackResponse {
  success: boolean;
  data?: {
    planId: string;
    result: unknown;
    summary: unknown;
  };
  error?: string;
}

interface PlanHistoryItem {
  id: string;
  containerMode: ContainerMode;
  count20FT: number;
  count40FT: number;
  totalWeightKg: number | null;
  totalCbm: number | null;
  avgFillRate: number | null;
  unplacedCount: number;
  shareToken: string | null;
  createdAt: string;
}

interface PlansResponse {
  success: boolean;
  data?: PlanHistoryItem[];
  error?: string;
}

const MODE_LABELS: Record<ContainerMode, string> = {
  auto: "자동(혼합)",
  "20ft_only": "20FT만",
  "40ft_only": "40FT만",
};

export default function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [plans, setPlans] = useState<PlanHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ContainerMode>("auto");
  const [packing, setPacking] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const loadDetail = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${id}`, { cache: "no-store" });
      const json = (await res.json()) as DetailResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "부킹 조회 실패");
      }
      setDetail(json.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "부킹 조회 실패");
    }
  };

  const loadPlans = async () => {
    try {
      const res = await fetch(`/api/shipments/${id}/plans`, {
        cache: "no-store",
      });
      const json = (await res.json()) as PlansResponse;
      if (json.success && json.data) setPlans(json.data);
    } catch {
      // 이력은 부가 정보 — 실패해도 페이지 자체는 동작
    }
  };

  useEffect(() => {
    void loadDetail();
    void loadPlans();
  }, [id]);

  const handleUpdate = async (data: ShipmentFormSubmit) => {
    const res = await fetch(`/api/shipments/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as DetailResponse;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error || "수정 실패");
    }
    setDetail(json.data);
    setSavedToast("저장되었습니다");
    setTimeout(() => setSavedToast(null), 2500);
  };

  const handlePack = async () => {
    setPacking(true);
    setError(null);
    try {
      const res = await fetch("/api/pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shipmentId: id, mode }),
      });
      const json = (await res.json()) as PackResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "적재 계산 실패");
      }
      router.push(`/shipments/${id}/plan/${json.data.planId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "적재 계산 실패");
    } finally {
      setPacking(false);
    }
  };

  if (!detail) {
    return (
      <main className="mx-auto w-full p-3 sm:p-6">
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">불러오는 중…</div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full space-y-6 p-3 sm:p-6">
      <header className="flex justify-end gap-2">
        {savedToast && (
          <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
            {savedToast}
          </span>
        )}
        <Link
          href="/"
          className="text-sm text-neutral-500 underline hover:text-neutral-700"
        >
          ← 목록으로
        </Link>
      </header>

      <ShipmentForm
        initial={detail}
        onSubmit={handleUpdate}
        submitLabel="수정 저장"
      />

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-900">적재 계산</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="text-sm">
            컨테이너 모드:&nbsp;
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ContainerMode)}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            >
              {(Object.keys(MODE_LABELS) as ContainerMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handlePack}
            disabled={packing}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {packing ? "계산 중…" : "계산하기"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">
          이전 계산 이력 ({plans.length})
        </h2>
        {plans.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500">
            계산 이력이 없습니다. 위에서 &quot;계산하기&quot;를 눌러 첫 적재 계획을 생성하세요.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-700">
                <tr>
                  <th className="px-2 py-2 text-left">생성일시</th>
                  <th className="px-2 py-2 text-left">모드</th>
                  <th className="px-2 py-2 text-right">20FT</th>
                  <th className="px-2 py-2 text-right">40FT</th>
                  <th className="px-2 py-2 text-right">평균 적재율</th>
                  <th className="px-2 py-2 text-right">미배치</th>
                  <th className="px-2 py-2 text-center">열기</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-200">
                    <td className="px-2 py-1">
                      {new Date(p.createdAt).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-2 py-1">
                      {MODE_LABELS[p.containerMode]}
                    </td>
                    <td className="px-2 py-1 text-right">{p.count20FT}</td>
                    <td className="px-2 py-1 text-right">{p.count40FT}</td>
                    <td className="px-2 py-1 text-right">
                      {p.avgFillRate == null
                        ? "-"
                        : `${p.avgFillRate.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {p.unplacedCount > 0 ? (
                        <span className="font-semibold text-red-600">
                          {p.unplacedCount}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Link
                        href={`/shipments/${id}/plan/${p.id}`}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
                      >
                        보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
