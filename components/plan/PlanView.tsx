"use client";

/**
 * 적재 계획 상세 뷰 (클라이언트)
 *
 * - 컨테이너 탭 전환, PDF/공유 버튼
 * - 각 컨테이너에 "이 컨에 입고완료 전용 채우기" 미리보기 기능
 *   - 옵션 패널: 여유 CBM 에 미입고 시각/CT 허용 여부 토글
 *   - 미리보기: 화면 결과만 갱신 (DB 미수정)
 *   - 저장: 새 plan 으로 INSERT 후 그 페이지로 이동
 *
 * 행은 자동 계산된다 — 9번 자유 좌표 알고리즘은 컨테이너 전체를 한 덩어리로 packing 하고
 * 화면의 행 구분선은 보기 편의용 시각 그룹핑일 뿐 사용자 수동 조정 대상이 아니다.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlanSummary } from "./PlanSummary";
import { ContainerView2D } from "./ContainerView2D";
import { ContainerItemList } from "./ContainerItemList";
import { PdfExport } from "@/components/export/PdfExport";
import { ShareLink } from "@/components/export/ShareLink";
import type { CLPResult, ContainerMode } from "@/types/plan";

interface PlanViewProps {
  planId: string;
  shipmentId: string;
  containerMode: ContainerMode;
  result: CLPResult;
  shareToken: string | null;
  fileLabel?: string;
  /** 공유 페이지 등 읽기 전용 환경에서는 편집/공유 버튼 숨김 */
  readOnly?: boolean;
}

interface PreviewState {
  result: CLPResult;
  exclusiveIdx: number;
  allowVisual: boolean;
  allowCt: boolean;
}

export function PlanView({
  planId,
  shipmentId,
  containerMode,
  result: originalResult,
  shareToken,
  fileLabel,
  readOnly = false,
}: PlanViewProps) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const result = preview?.result ?? originalResult;

  const containerCount = result.containers.length;
  const [activeIdx, setActiveIdx] = useState(0);
  const [optionPanelIdx, setOptionPanelIdx] = useState<number | null>(null);
  const [optAllowVisual, setOptAllowVisual] = useState(false);
  const [optAllowCt, setOptAllowCt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const printAreaRef = useRef<HTMLDivElement | null>(null);

  const safeActiveIdx = Math.min(activeIdx, Math.max(0, containerCount - 1));
  const active = result.containers[safeActiveIdx];

  const requestPreview = async (containerIndex: number) => {
    setBusy(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          mode: containerMode,
          completedExclusiveContainerIndex: containerIndex,
          allowVisualInExclusive: optAllowVisual,
          allowCtInExclusive: optAllowCt,
          preview: true,
        }),
      });
      const json = await res.json();
      if (!json.success || !json.data?.result) {
        setSaveMsg(json.error ?? "미리보기 실패");
        return;
      }
      setPreview({
        result: json.data.result as CLPResult,
        exclusiveIdx: containerIndex,
        allowVisual: optAllowVisual,
        allowCt: optAllowCt,
      });
      setOptionPanelIdx(null);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "미리보기 실패");
    } finally {
      setBusy(false);
    }
  };

  const savePreview = async () => {
    if (!preview) return;
    setBusy(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          mode: containerMode,
          completedExclusiveContainerIndex: preview.exclusiveIdx,
          allowVisualInExclusive: preview.allowVisual,
          allowCtInExclusive: preview.allowCt,
          preview: false,
        }),
      });
      const json = await res.json();
      if (!json.success || !json.data?.planId) {
        setSaveMsg(json.error ?? "저장 실패");
        return;
      }
      router.push(`/shipments/${shipmentId}/plan/${json.data.planId}`);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setOptionPanelIdx(null);
    setSaveMsg(null);
  };

  const warnings = result.summary.warnings ?? [];

  return (
    <div className="space-y-4">
      {/* 미리보기 모드 배너 */}
      {preview && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2">
          <div className="text-sm text-amber-900">
            <b>미리보기 모드</b> — 컨테이너 {preview.exclusiveIdx} 입고완료 전용
            (시각{preview.allowVisual ? "허용" : "차단"} · CT{preview.allowCt ? "허용" : "차단"})
            <span className="ml-2 text-xs text-amber-700">DB 저장 전</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={cancelPreview}
              disabled={busy}
              className="rounded border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
            >
              원래대로
            </button>
            <button
              type="button"
              onClick={savePreview}
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "저장 중…" : "이 결과로 저장"}
            </button>
          </div>
        </div>
      )}

      {/* 경고 메시지 */}
      {warnings.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <b>⚠ 알림</b>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {saveMsg && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {saveMsg}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-500">
            ℹ 행은 자동 계산됩니다 — 화면 위 행 구분선은 보기 편의용일 뿐, 알고리즘은 컨테이너
            전체를 자유 좌표로 packing 합니다.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <PdfExport targetRef={printAreaRef} fileLabel={fileLabel} />
            <ShareLink planId={planId} initialToken={shareToken} />
          </div>
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
                      idx === safeActiveIdx
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
                <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs text-neutral-600">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                      #{active.index} · {active.spec.type}
                    </span>
                    <span>
                      중량 {active.totalWeight.toFixed(1)} /{" "}
                      {active.spec.maxWeightKg}kg (
                      {active.weightFillRate.toFixed(1)}%)
                    </span>
                    <span>
                      CBM {(active.totalCbm + active.ctCbm + active.completedCbm).toFixed(2)} (
                      {active.cbmFillRate.toFixed(1)}%)
                    </span>
                    {active.completedCbm > 0 && (
                      <span className="text-blue-700">
                        입고완료 {active.completedCbm.toFixed(2)} m³
                      </span>
                    )}
                    {active.ctCbm > 0 && (
                      <span className="text-amber-700">
                        CT {active.ctCbm.toFixed(2)} m³
                      </span>
                    )}
                  </div>
                  {!readOnly && !preview && (
                    <button
                      type="button"
                      onClick={() => {
                        if (optionPanelIdx === active.index) {
                          setOptionPanelIdx(null);
                        } else {
                          setOptionPanelIdx(active.index);
                          setOptAllowVisual(false);
                          setOptAllowCt(false);
                        }
                      }}
                      className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100"
                    >
                      {optionPanelIdx === active.index
                        ? "옵션 닫기"
                        : "이 컨에 입고완료 전용 채우기"}
                    </button>
                  )}
                </div>

                {/* 옵션 패널 */}
                {optionPanelIdx === active.index && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                    <div className="font-semibold text-blue-900">
                      컨테이너 {active.index} ({active.spec.type}, 한도{" "}
                      {active.spec.maxCbm} m³) 입고완료 전용 미리보기
                    </div>
                    <div className="mt-2 flex flex-col gap-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optAllowVisual}
                          onChange={(e) => setOptAllowVisual(e.target.checked)}
                        />
                        여유 CBM 에 미입고 시각 화물도 같이 채우기
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optAllowCt}
                          onChange={(e) => setOptAllowCt(e.target.checked)}
                        />
                        여유 CBM 에 CT 카톤도 같이 채우기
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOptionPanelIdx(null)}
                        disabled={busy}
                        className="rounded border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => requestPreview(active.index)}
                        disabled={busy}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busy ? "계산 중…" : "미리보기"}
                      </button>
                    </div>
                  </div>
                )}

                <ContainerView2D plan={active} scale={{ x: 1.79, y: 0.385 }} />
                <ContainerItemList plan={active} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
