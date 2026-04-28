"use client";

/**
 * 부킹 목록 클라이언트 — fetch + 삭제 기능
 *
 * - 서버 컴포넌트에서 직접 DB 호출도 가능하지만, 빠른 갱신/삭제 UX 를 위해 클라이언트 페치
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface ShipmentSummary {
  id: string;
  displayNo: number | null;
  houseBlNo: string | null;
  destination: string | null;
  bookingNo: string | null;
  shipmentRound: number | null;
  actualShipperName: string | null;
  shipperName: string | null;
  totalQuantity: number;
  totalWeightKg: number;
  totalCbm: number;
  status: string;
  createdAt: string;
}

interface ListResponse {
  success: boolean;
  data?: ShipmentSummary[];
  error?: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "작성중",
  calculated: "계산됨",
  shipped: "선적완료",
  archived: "보관",
};

function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function ShipmentList() {
  const [items, setItems] = useState<ShipmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/shipments", { cache: "no-store" });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "목록 조회 실패");
      }
      setItems(json.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "목록 조회 실패");
      setItems([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("이 부킹을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/shipments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "삭제 실패");
      }
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  if (items === null) {
    return <div className="p-4 text-sm text-neutral-500">불러오는 중…</div>;
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
        <p className="text-sm text-neutral-600">등록된 부킹이 아직 없습니다.</p>
        <Link
          href="/shipments/new"
          className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          + 새 부킹 작성
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-700">
          <tr>
            <th className="px-2 py-2 text-right">No</th>
            <th className="px-2 py-2 text-left">House B/L</th>
            <th className="px-2 py-2 text-left">DEST</th>
            <th className="px-2 py-2 text-left">Booking No</th>
            <th className="px-2 py-2 text-right">차수</th>
            <th className="px-2 py-2 text-left">실화주</th>
            <th className="px-2 py-2 text-left">화주</th>
            <th className="px-2 py-2 text-right">총수량</th>
            <th className="px-2 py-2 text-right">총중량</th>
            <th className="px-2 py-2 text-right">총CBM</th>
            <th className="px-2 py-2 text-center">상태</th>
            <th className="px-2 py-2 text-center">작업</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-neutral-200">
              <td className="px-2 py-1 text-right">{s.displayNo ?? "-"}</td>
              <td className="px-2 py-1">{s.houseBlNo ?? "-"}</td>
              <td className="px-2 py-1">{s.destination ?? "-"}</td>
              <td className="px-2 py-1">{s.bookingNo ?? "-"}</td>
              <td className="px-2 py-1 text-right">
                {s.shipmentRound ?? "-"}
              </td>
              <td className="px-2 py-1">{s.actualShipperName ?? "-"}</td>
              <td className="px-2 py-1">{s.shipperName ?? "-"}</td>
              <td className="px-2 py-1 text-right">
                {fmtNum(s.totalQuantity, 0)}
              </td>
              <td className="px-2 py-1 text-right">
                {fmtNum(s.totalWeightKg, 1)}
              </td>
              <td className="px-2 py-1 text-right">
                {fmtNum(s.totalCbm, 3)}
              </td>
              <td className="px-2 py-1 text-center">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
                  {STATUS_LABELS[s.status] ?? s.status}
                </span>
              </td>
              <td className="space-x-1 px-2 py-1 text-center">
                <Link
                  href={`/shipments/${s.id}`}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
                >
                  상세
                </Link>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
