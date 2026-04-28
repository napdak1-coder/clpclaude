/**
 * 천장까지 남은 여유 cm 라벨
 *
 * 입구 통과 가능 여부에 따라 색을 다르게 보여줘서 한눈에 위험을 식별
 */

interface ClearanceLabelProps {
  cm: number;
  doorPassable?: boolean;
  className?: string;
}

export function ClearanceLabel({
  cm,
  doorPassable = true,
  className = "",
}: ClearanceLabelProps) {
  const tone = doorPassable
    ? "text-emerald-700"
    : "text-red-600 font-semibold";
  const display = Number.isFinite(cm) ? Math.max(0, Math.round(cm)) : 0;
  return (
    <span className={`text-[10px] ${tone} ${className}`}>
      여유 {display}cm
    </span>
  );
}
