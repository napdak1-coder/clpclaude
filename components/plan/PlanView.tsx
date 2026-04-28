"use client";

/**
 * 적재 계획 상세 뷰 (클라이언트)
 *
 * - 컨테이너 탭 전환, 행 미세조정 토글, PDF/공유 버튼을 한 화면에서 다룸
 * - 서버 페이지에서 plan 데이터를 받아 props 로 주입받는다
 */

import { useRef, useState } from "react";
import { PlanSummary } from "./PlanSummary";
import { ContainerView2D } from "./ContainerView2D";
import { RowEditor } from "./RowEditor";
import { PdfExport } from "@/components/export/PdfExport";
import { ShareLink } from "@/components/export/ShareLink";
import type { CLPResult } from "@/types/plan";

interface PlanViewProps {
  planId: string;
  result: CLPResult;
  shareToken: string | null;
  fileLabel?: string;
  /** 공유 페이지 등 읽기 전용 환경에서는 편집/공유 버튼 숨김 */
  readOnly?: boolean;
}

export function PlanView({
  planId,
  result,
  shareToken,
  fileLabel,
  readOnly = false,
}: PlanViewProps) {
  const containerCount = result.containers.length;
  const [activeIdx, setActiveIdx] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const printAreaRef = useRef<HTMLDivElement | null>(null);

  const active = result.containers[activeIdx];

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowEditor((v) => !v)}
            className={`rounded border px-3 py-1 text-sm ${
              showEditor
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-neutral-300 bg-white"
            }`}
          >
            {showEditor ? "행 수동 조정 닫기" : "행 수동 조정"}
          </button>
          <PdfExport targetRef={printAreaRef} fileLabel={fileLabel} />
          <ShareLink planId={planId} initialToken={shareToken} />
        </div>
      )}

      <div ref={printAreaRef} className="space-y-4 bg-white p-2">
        <PlanSummary result={result} />

        {containerCount === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
            배치된 컨테이너가 없습니다.
          </div>
        ) : (
          <>
            {containerCount > 1 && (
              <div className="flex flex-wrap gap-1 border-b border-neutral-200">
                {result.containers.map((c, idx) => (
                  <button
                    key={c.index}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className={`rounded-t px-3 py-1 text-sm ${
                      idx === activeIdx
                        ? "border border-b-0 border-neutral-300 bg-white font-semibold"
                        : "text-neutral-500 hover:text-neutral-800"
                    }`}
                  >
                    #{c.index} {c.spec.type}
                  </button>
                ))}
              </div>
            )}

            {active && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-3 text-xs text-neutral-600">
                  <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                    #{active.index} · {active.spec.type}
                  </span>
                  <span>
                    중량 {active.totalWeight.toFixed(1)} /{" "}
                    {active.spec.maxWeightKg}kg (
                    {active.weightFillRate.toFixed(1)}%)
                  </span>
                  <span>
                    CBM {active.totalCbm.toFixed(2)} (
                    {active.cbmFillRate.toFixed(1)}%)
                  </span>
                </div>
                <ContainerView2D plan={active} />
                {showEditor && !readOnly && (
                  <RowEditor
                    rows={active.rows}
                    containerLength={active.spec.innerLength}
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
