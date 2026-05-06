/**
 * 홈(부킹 목록) 페이지
 *
 * - 상단: 타이틀 + 새 부킹 작성 버튼
 * - 본문: ShipmentList 클라이언트 컴포넌트
 */

import Link from "next/link";
import { ShipmentList } from "@/components/list/ShipmentList";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            clp노블코코
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            수출 콘솔 화물 합적 — 부킹 단위로 화물을 입력하고 자동으로 적재 계획을 만듭니다.
          </p>
        </div>
        <Link
          href="/shipments/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + NEW BOOK
        </Link>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          부킹 목록
        </h2>
        <ShipmentList />
      </section>
    </main>
  );
}
