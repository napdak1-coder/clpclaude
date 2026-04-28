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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card label="20FT" value={`${summary.count20FT}대`} />
        <Card label="40FT" value={`${summary.count40FT}대`} />
        <Card label="총 중량" value={`${fmtNumber(summary.totalWeight, 1)} kg`} />
        <Card label="총 CBM" value={`${fmtNumber(summary.totalCbm, 3)} CBM`} />
        <Card
          label="평균 적재율"
          value={`${fmtNumber(summary.avgFillRate, 1)} %`}
        />
      </div>

      {unplaced.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">
            ⚠ 미배치 화물 {unplaced.length}건이 있습니다
          </div>
          <ul className="mt-1 list-inside list-disc text-xs">
            {unplaced.slice(0, 5).map((u, idx) => (
              <li key={`${u.cargoId}-${idx}`}>
                {u.cargoId}: {u.reason}
              </li>
            ))}
            {unplaced.length > 5 && <li>외 {unplaced.length - 5}건…</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  label: string;
  value: string;
}

function Card({ label, value }: CardProps) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-neutral-800">{value}</div>
    </div>
  );
}
