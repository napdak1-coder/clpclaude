/**
 * 적재 계획 요약 카드
 *
 * - 컨테이너 수, 총 중량/CBM, 평균 적재율
 * - 미배치 화물이 있으면 붉은 배너로 경고
 */

import type { CLPResult } from "@/types/plan";

interface PlanSummaryProps {
  result: CLPResult;
}

function fmtNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function PlanSummary({ result }: PlanSummaryProps) {
  const { summary, unplaced } = result;
  const totalCbmAll =
    summary.totalCbm + summary.ctTotalCbm + summary.completedTotalCbm;
  // 입고완료가 있으면 단독 카드로 강조 (사용자 추적성)
  const showCompletedCard = summary.completedTotalCbm > 0;
  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 gap-3 ${showCompletedCard ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
        <Card label="20FT" value={`${summary.count20FT}대`} />
        <Card label="40FT" value={`${summary.count40FT}대`} />
        <Card label="총 중량" value={`${fmtNumber(summary.totalWeight, 1)} kg`} />
        <Card
          label="총 CBM (시각+CT+완료)"
          value={`${fmtNumber(totalCbmAll, 3)} CBM`}
          sub={
            summary.ctTotalCbm > 0 || summary.completedTotalCbm > 0
              ? `시각 ${fmtNumber(summary.totalCbm, 2)}${
                  summary.ctTotalCbm > 0
                    ? ` · CT ${fmtNumber(summary.ctTotalCbm, 2)}`
                    : ""
                }${
                  summary.completedTotalCbm > 0
                    ? ` · 입고완료 ${fmtNumber(summary.completedTotalCbm, 2)}`
                    : ""
                }`
              : undefined
          }
        />
        {showCompletedCard && (
          <Card
            label="입고완료 CBM"
            value={`${fmtNumber(summary.completedTotalCbm, 3)} CBM`}
            tone="completed"
          />
        )}
        <Card
          label="평균 적재율"
          value={`${fmtNumber(summary.avgFillRate, 1)} %`}
        />
      </div>

      {summary.warnings && summary.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">⚠ 알림</div>
          <ul className="mt-1 list-inside list-disc text-xs">
            {summary.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {unplaced.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          <div className="px-1 pb-2 font-semibold">
            ⚠ 미배치 화물 {unplaced.length}종 — 컨테이너에 못 들어간 화물
          </div>
          <div className="overflow-x-auto rounded border border-red-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-red-100 text-red-900">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">분류</th>
                  <th className="px-2 py-1 text-center font-medium">구분</th>
                  <th className="px-2 py-1 text-left font-medium">화주</th>
                  <th className="px-2 py-1 text-left font-medium">품목</th>
                  <th className="px-2 py-1 text-right font-medium">
                    사이즈 (W×L×H, cm)
                  </th>
                  <th className="px-2 py-1 text-right font-medium">수량</th>
                  <th className="px-2 py-1 text-right font-medium">시스템 CBM</th>
                  <th className="px-2 py-1 text-right font-medium">엑셀 CBM</th>
                  <th
                    className="px-2 py-1 text-right font-medium"
                    title="이 cargo 에서 컨테이너에 못 들어간 분량"
                  >
                    분량 (못 들어감)
                  </th>
                  <th className="px-2 py-1 text-right font-medium">중량 (kg)</th>
                </tr>
              </thead>
              <tbody>
                {unplaced.map((u, idx) => {
                  const groupKindLabel =
                    u.group === "ct"
                      ? { text: "CT 미배치", cls: "bg-amber-100 text-amber-800" }
                      : u.group === "completed"
                        ? { text: "입고완료 미배치", cls: "bg-blue-100 text-blue-800" }
                        : u.group === "visual"
                          ? { text: "시각 미배치", cls: "bg-emerald-100 text-emerald-800" }
                          : { text: "미배치", cls: "bg-red-100 text-red-800" };
                  const sizeText =
                    u.width != null && u.length != null && u.height != null
                      ? `${u.width}×${u.length}×${u.height}`
                      : "-";
                  const labelName =
                    u.name || u.shipper || u.cargoId.slice(0, 8);
                  return (
                    <tr
                      key={`${u.cargoId}-${idx}`}
                      className="border-t border-red-100"
                      title={u.reason}
                    >
                      <td className="px-2 py-1 align-top">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${groupKindLabel.cls}`}
                        >
                          {groupKindLabel.text}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-center align-top font-mono text-[11px] text-neutral-700">
                        {u.cargoType ?? "-"}
                      </td>
                      <td className="px-2 py-1 align-top text-neutral-800">
                        {u.shipper || "-"}
                      </td>
                      <td className="px-2 py-1 align-top text-neutral-800">
                        {labelName}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono text-neutral-700">
                        {sizeText}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono">
                        {u.quantity != null ? u.quantity : "-"}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono">
                        {u.systemCbm != null ? u.systemCbm.toFixed(3) : "-"}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono text-blue-700">
                        {u.cfsCbm != null ? u.cfsCbm.toFixed(3) : "-"}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono text-red-700">
                        {u.unfitCbm != null ? u.unfitCbm.toFixed(3) : "-"}
                      </td>
                      <td className="px-2 py-1 text-right align-top font-mono">
                        {u.weight != null ? u.weight.toFixed(1) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "completed";
}

function Card({ label, value, sub, tone = "default" }: CardProps) {
  const cls =
    tone === "completed"
      ? "rounded-lg border border-blue-300 bg-blue-50 p-3"
      : "rounded-lg border border-neutral-200 bg-white p-3";
  const labelCls =
    tone === "completed" ? "text-xs text-blue-700" : "text-xs text-neutral-500";
  const valueCls =
    tone === "completed"
      ? "mt-1 text-lg font-semibold text-blue-900"
      : "mt-1 text-lg font-semibold text-neutral-800";
  return (
    <div className={cls}>
      <div className={labelCls}>{label}</div>
      <div className={valueCls}>{value}</div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-neutral-500">{sub}</div>
      )}
    </div>
  );
}
