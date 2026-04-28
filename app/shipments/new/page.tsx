"use client";

/**
 * 새 부킹 작성 페이지
 *
 * - ShipmentForm 으로 부킹 + 화물을 입력
 * - 저장 성공 시 /shipments/[id] 로 이동
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShipmentForm,
  type ShipmentFormSubmit,
} from "@/components/input/ShipmentForm";

interface CreateResponse {
  success: boolean;
  data?: { id: string };
  error?: string;
}

export default function NewShipmentPage() {
  const router = useRouter();

  const handleSubmit = async (data: ShipmentFormSubmit) => {
    const res = await fetch("/api/shipments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as CreateResponse;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error || "부킹 생성 실패");
    }
    router.push(`/shipments/${json.data.id}`);
  };

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">새 부킹 작성</h1>
        <Link
          href="/"
          className="text-sm text-neutral-500 underline hover:text-neutral-700"
        >
          ← 목록으로
        </Link>
      </header>
      <ShipmentForm onSubmit={handleSubmit} submitLabel="부킹 저장" />
    </main>
  );
}
