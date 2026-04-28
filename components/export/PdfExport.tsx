"use client";

/**
 * PDF 내보내기 버튼
 *
 * - targetRef 가 가리키는 DOM 을 html2canvas 로 캡처
 * - jsPDF 로 A4 가로에 맞춰 출력 (긴 도면은 페이지 분할)
 * - 동적 import 로 SSR 영향 없음
 */

import { useState, type RefObject } from "react";

interface PdfExportProps {
  targetRef: RefObject<HTMLElement | null>;
  /** 파일명 일부 — 보통 House B/L No */
  fileLabel?: string;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function PdfExport({ targetRef, fileLabel }: PdfExportProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportPdf = async () => {
    setError(null);
    if (!targetRef.current) {
      setError("출력할 화면을 찾을 수 없습니다");
      return;
    }
    setBusy(true);
    try {
      const html2canvasMod = await import("html2canvas");
      const jsPdfMod = await import("jspdf");
      const html2canvas = html2canvasMod.default;
      const JsPDF = jsPdfMod.default;

      const canvas = await html2canvas(targetRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new JsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      } else {
        let consumed = 0;
        while (consumed < imgHeight) {
          pdf.addImage(imgData, "PNG", 0, -consumed, imgWidth, imgHeight);
          consumed += pageHeight;
          if (consumed < imgHeight) pdf.addPage();
        }
      }

      const safeLabel = (fileLabel ?? "shipment").replace(/[^\w-]+/g, "_");
      pdf.save(`CLP_${safeLabel}_${todayStamp()}.pdf`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PDF 변환 실패";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={exportPdf}
        disabled={busy}
        className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "PDF 생성 중…" : "PDF 다운로드"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
