/**
 * 컨테이너 2D 평면도(SVG)
 *
 * - 위에서 내려다보는 시점: 길이방향(innerLength)을 가로축, 폭(innerWidth)을 세로축으로
 * - 입구는 컨테이너 왼쪽(짧은 변), 안쪽은 오른쪽
 * - 한 행(Row) 안에서는 하단/상단을 색으로 구분, 상단은 점선 테두리 + 그림자
 */

import type { ContainerPlan, PlacedCargo, Row } from "@/types/plan";
import { ClearanceLabel } from "./ClearanceLabel";

interface ContainerView2DProps {
  plan: ContainerPlan;
  /** 1cm 당 px 비율 (기본 0.5 → 40FT 1200cm = 600px) */
  scale?: number;
}

const PADDING = 24;
const ROW_LABEL_WIDTH = 40;

export function ContainerView2D({ plan, scale = 0.5 }: ContainerView2DProps) {
  const { spec, rows } = plan;
  const innerWcm = spec.innerWidth;
  const innerLcm = spec.innerLength;
  const widthPx = innerLcm * scale + PADDING * 2 + ROW_LABEL_WIDTH;
  const heightPx = innerWcm * scale + PADDING * 2 + 60;

  const containerX = PADDING + ROW_LABEL_WIDTH;
  const containerY = PADDING;

  // 입구 통과 불가 row 가 하나라도 있으면 컨테이너 외곽에 경고 배너
  const hasDoorIssue = rows.some((r) => !r.doorPassable);

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <Legend color="#bfdbfe" label="하단 적재" />
        <Legend color="#fed7aa" label="상단 적재" dashed />
        <span className="text-neutral-400">|</span>
        <span className="text-neutral-600">
          내부 {innerLcm}×{innerWcm}cm · 입구 {spec.doorHeight}cm · 천장{" "}
          {spec.innerHeight}cm
        </span>
        {hasDoorIssue && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">
            ⚠ 일부 행이 입구 높이를 초과합니다
          </span>
        )}
      </div>
      <svg
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
        className="rounded border border-neutral-200 bg-neutral-50"
      >
        <rect
          x={containerX}
          y={containerY}
          width={innerLcm * scale}
          height={innerWcm * scale}
          fill="white"
          stroke="#374151"
          strokeWidth={2}
        />
        {/* 입구 표시 — 왼쪽 변 */}
        <line
          x1={containerX}
          y1={containerY - 4}
          x2={containerX}
          y2={containerY + innerWcm * scale + 4}
          stroke="#1d4ed8"
          strokeWidth={3}
        />
        <text
          x={containerX - 6}
          y={containerY + (innerWcm * scale) / 2}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={10}
          fill="#1d4ed8"
        >
          입구
        </text>

        {rows.map((row) => (
          <RowView
            key={row.index}
            row={row}
            containerX={containerX}
            containerY={containerY}
            innerWcm={innerWcm}
            scale={scale}
          />
        ))}
      </svg>
    </div>
  );
}

interface RowViewProps {
  row: Row;
  containerX: number;
  containerY: number;
  innerWcm: number;
  scale: number;
}

function RowView({
  row,
  containerX,
  containerY,
  innerWcm,
  scale,
}: RowViewProps) {
  const x1 = containerX + row.yStart * scale;
  const x2 = containerX + row.yEnd * scale;
  const h = innerWcm * scale;

  return (
    <g>
      <line
        x1={x2}
        y1={containerY}
        x2={x2}
        y2={containerY + h}
        stroke="#9ca3af"
        strokeDasharray="3 3"
      />
      <text x={x1 + 4} y={containerY - 4} fill="#6b7280" fontSize={9}>
        행 {row.index + 1} ({Math.round(row.yEnd - row.yStart)}cm)
      </text>

      {row.bottomItems.map((p, idx) => (
        <PlacedRect
          key={`b-${idx}`}
          item={p}
          containerX={containerX}
          containerY={containerY}
          scale={scale}
          color="#bfdbfe"
          stroke="#2563eb"
        />
      ))}
      {row.topItems.map((p, idx) => (
        <PlacedRect
          key={`t-${idx}`}
          item={p}
          containerX={containerX}
          containerY={containerY}
          scale={scale}
          color="#fed7aa"
          stroke="#ea580c"
          dashed
          shadow
        />
      ))}

      <text
        x={(x1 + x2) / 2}
        y={containerY + h + 14}
        textAnchor="middle"
        fontSize={10}
        fill={row.doorPassable ? "#047857" : "#dc2626"}
        fontWeight={row.doorPassable ? "normal" : "bold"}
      >
        {row.doorPassable ? "" : "⚠ "}여유 {Math.round(row.topClearance)}cm
      </text>
    </g>
  );
}

interface PlacedRectProps {
  item: PlacedCargo;
  containerX: number;
  containerY: number;
  scale: number;
  color: string;
  stroke: string;
  dashed?: boolean;
  shadow?: boolean;
}

function PlacedRect({
  item,
  containerX,
  containerY,
  scale,
  color,
  stroke,
  dashed,
  shadow,
}: PlacedRectProps) {
  // PlacedCargo.position: x=폭방향, y=길이방향. 화면에서는 y(길이)를 가로로 그림
  const x = containerX + item.position.y * scale;
  const y = containerY + item.position.x * scale;
  const w = item.size.length * scale;
  const h = item.size.width * scale;
  return (
    <g>
      {shadow && (
        <rect
          x={x + 2}
          y={y + 2}
          width={w}
          height={h}
          fill="rgba(0,0,0,0.08)"
        />
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={color}
        fillOpacity={shadow ? 0.85 : 1}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      {w > 30 && h > 14 && (
        <text x={x + 4} y={y + 12} fontSize={9} fill="#1f2937">
          {item.shipper || item.name || item.cargoId.slice(0, 6)}
        </text>
      )}
      {w > 30 && h > 26 && (
        <text x={x + 4} y={y + 22} fontSize={8} fill="#4b5563">
          {Math.round(item.size.width)}×{Math.round(item.size.length)}×
          {Math.round(item.size.height)}
        </text>
      )}
    </g>
  );
}

interface LegendProps {
  color: string;
  label: string;
  dashed?: boolean;
}

function Legend({ color, label, dashed }: LegendProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-3 w-4"
        style={{
          backgroundColor: color,
          border: `1px ${dashed ? "dashed" : "solid"} #374151`,
        }}
      />
      <span className="text-neutral-700">{label}</span>
    </span>
  );
}

/** 외부에서 같이 import 하기 편하도록 재노출 */
export { ClearanceLabel };
