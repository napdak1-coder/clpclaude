/**
 * 컨테이너 2D 평면도(SVG) — 세로 레이아웃
 *
 * - 컨테이너 길이방향(innerLength)을 화면 세로축, 폭(innerWidth)을 가로축으로
 * - 위쪽이 컨테이너 안쪽, 아래쪽이 입구 (굵은 파란선 + "입구" 라벨)
 * - 행은 위에서 아래로 누적 (인덱스 0 행이 가장 위 = 가장 안쪽 적재)
 * - 행 좌측: 행 번호(빨간 라벨) + 행 길이(cm)
 * - 행 우측: 폭 여유(cm) + 천장 여유(cm, doorPassable 따라 색 강조)
 * - 행 영역 안: 하단 박스(파란 실선 채움) + 상단 박스(주황 점선) + 상단 빈 슬롯(회색 점선)
 * - 폭 여유 영역(행 우측 비어있는 가로) 도 회색 점선 사각형으로 시각화
 *
 * 빈 컨테이너 (rows=0) 는 입고완료/CT 만 적재된 경우 placeholder 안내,
 * 그 외엔 "비어 있음" 표시.
 */

import type { ContainerPlan, PlacedCargo } from "@/types/plan";

interface ContainerView2DProps {
  plan: ContainerPlan;
  /** 1cm 당 px 비율 (기본 0.5) — 길이/폭 모두에 적용 */
  scale?: number;
}

const PADDING = 16;
const ROW_NUM_WIDTH = 56;     // 좌측 행 번호 라벨 영역 폭
const RIGHT_INFO_WIDTH = 110; // 우측 여유 정보 라벨 영역 폭
const TOP_LABEL_HEIGHT = 24;  // 위쪽 "안쪽" 라벨 영역
const BOTTOM_LABEL_HEIGHT = 32; // 아래쪽 "입구" 라벨 영역

export function ContainerView2D({ plan, scale = 0.5 }: ContainerView2DProps) {
  const { spec, rows } = plan;
  const innerWcm = spec.innerWidth;
  const innerLcm = spec.innerLength;
  const containerWidthPx = innerWcm * scale;
  const containerHeightPx = innerLcm * scale;

  const containerX = PADDING + ROW_NUM_WIDTH;
  const containerY = PADDING + TOP_LABEL_HEIGHT;
  const containerBottom = containerY + containerHeightPx;
  const containerRight = containerX + containerWidthPx;

  const totalWidthPx = containerRight + RIGHT_INFO_WIDTH + PADDING;
  const totalHeightPx = containerBottom + BOTTOM_LABEL_HEIGHT + PADDING;

  // cm → SVG 좌표 (입구가 아래)
  const toSvgX = (cmX: number) => containerX + cmX * scale;
  const toSvgY = (cmY: number) => containerBottom - cmY * scale;

  const hasDoorIssue = rows.some((r) => !r.doorPassable);
  const noVisual = rows.length === 0;
  const onlyBulk = noVisual && (plan.ctCbm > 0 || plan.completedCbm > 0);
  const totalBulk = plan.ctCbm + plan.completedCbm;

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <Legend color="#bfdbfe" stroke="#3b82f6" label="하단 적재" />
        <Legend color="#fed7aa" stroke="#f97316" label="상단 적재" dashed />
        <Legend color="#fafafa" stroke="#a3a3a3" label="가로 여유 / 빈 슬롯" dashed muted />
        <span className="text-neutral-400">|</span>
        <span className="text-neutral-600">
          내부 {innerWcm}(W) × {innerLcm}(L) × {spec.innerHeight}(H) cm · 입구 {spec.doorHeight} cm
        </span>
        {hasDoorIssue && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">
            ⚠ 일부 행이 입구 높이를 초과합니다
          </span>
        )}
      </div>
      <svg
        width={totalWidthPx}
        height={totalHeightPx}
        viewBox={`0 0 ${totalWidthPx} ${totalHeightPx}`}
        className="rounded border border-neutral-200 bg-neutral-50"
      >
        {/* 위쪽 "안쪽" 라벨 */}
        <text
          x={containerX + containerWidthPx / 2}
          y={containerY - 8}
          textAnchor="middle"
          fontSize={11}
          fill="#737373"
        >
          ↑ 안쪽
        </text>

        {/* 컨테이너 외곽 */}
        <rect
          x={containerX}
          y={containerY}
          width={containerWidthPx}
          height={containerHeightPx}
          fill="white"
          stroke="#374151"
          strokeWidth={2}
        />

        {/* 입구 표시 — 아래쪽 변 굵은 파란선 + 라벨 */}
        <line
          x1={containerX - 4}
          y1={containerBottom}
          x2={containerRight + 4}
          y2={containerBottom}
          stroke="#1d4ed8"
          strokeWidth={4}
        />
        <text
          x={containerX + containerWidthPx / 2}
          y={containerBottom + 18}
          textAnchor="middle"
          fontSize={12}
          fontWeight={600}
          fill="#1d4ed8"
        >
          ↓ 입구 (door)
        </text>

        {/* 행 단위 렌더링 — 안쪽(yEnd 큰 행)을 1행으로 매기고,
            그 행부터 차례로 누적 세로길이를 합산해 RowView 에 넘긴다.
            row.index 자체는 알고리즘이 부여한 0-based 입구 기준이지만
            화면에서는 안쪽이 위라서 사용자 친화적으로 displayNum 을 따로 계산. */}
        {(() => {
          const sortedFromInside = [...rows].sort((a, b) => b.yStart - a.yStart);
          let cum = 0;
          const meta = new Map<number, { displayNum: number; rowLengthCm: number; cumLengthCm: number }>();
          sortedFromInside.forEach((r, i) => {
            const itemsLen = [...r.bottomItems, ...r.topItems].reduce(
              (m, it) => Math.max(m, it.size.length),
              0,
            );
            const rowLenCm = Math.round(
              Math.max(itemsLen, r.yEnd - r.yStart),
            );
            cum += rowLenCm;
            meta.set(r.index, { displayNum: i + 1, rowLengthCm: rowLenCm, cumLengthCm: cum });
          });
          return rows.map((row) => {
            const m = meta.get(row.index)!;
            return (
              <RowView
                key={row.index}
                row={row}
                displayNum={m.displayNum}
                rowLengthCm={m.rowLengthCm}
                cumLengthCm={m.cumLengthCm}
                innerWcm={innerWcm}
                innerHeightCm={spec.innerHeight}
                scale={scale}
                containerX={containerX}
                containerWidthPx={containerWidthPx}
                containerRight={containerRight}
                toSvgX={toSvgX}
                toSvgY={toSvgY}
              />
            );
          });
        })()}

        {/* 빈 컨테이너 placeholder */}
        {noVisual && (
          <g>
            <rect
              x={containerX + 6}
              y={containerY + 6}
              width={containerWidthPx - 12}
              height={containerHeightPx - 12}
              fill={onlyBulk ? "#eff6ff" : "#fafafa"}
              stroke={onlyBulk ? "#bfdbfe" : "#e5e5e5"}
              strokeDasharray="6 4"
              strokeWidth={1}
            />
            <text
              x={containerX + containerWidthPx / 2}
              y={containerY + containerHeightPx / 2 - 8}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={600}
              fill={onlyBulk ? "#1d4ed8" : "#737373"}
            >
              {onlyBulk
                ? "이 컨테이너는 입고완료/CT 화물만 적재"
                : "비어 있음"}
            </text>
            {onlyBulk && (
              <text
                x={containerX + containerWidthPx / 2}
                y={containerY + containerHeightPx / 2 + 12}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fill="#1d4ed8"
              >
                시각 좌표 없음 · 총 {totalBulk.toFixed(2)} m³ 채움 (아래 화물 목록 참고)
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

interface RowViewProps {
  row: ContainerPlan["rows"][number];
  /** 안쪽=1 부터 시작하는 표시용 행 번호 */
  displayNum: number;
  /** 이 행의 가장 긴 화물 세로길이 (cm). 행 안 max(size.length) — 사실상 yEnd-yStart 와 같음 */
  rowLengthCm: number;
  /** 안쪽 1행부터 이 행까지 누적 세로길이 (cm) */
  cumLengthCm: number;
  innerWcm: number;
  innerHeightCm: number;
  scale: number;
  containerX: number;
  containerWidthPx: number;
  containerRight: number;
  toSvgX: (cmX: number) => number;
  toSvgY: (cmY: number) => number;
}

function RowView({
  row,
  displayNum,
  rowLengthCm,
  cumLengthCm,
  innerWcm,
  scale,
  containerX,
  containerWidthPx,
  containerRight,
  toSvgX,
  toSvgY,
}: RowViewProps) {
  const rowTopY = toSvgY(row.yEnd);     // 안쪽 끝 (위)
  const rowBottomY = toSvgY(row.yStart); // 입구쪽 끝 (아래)
  const rowHeightPx = rowBottomY - rowTopY;

  // 행 가로 여유 = innerWidth - 사용된 가로폭 (bottomItems 기준 — 좌측부터 채워지므로 max(x+width))
  const usedWidthCm = row.bottomItems.reduce(
    (m, b) => Math.max(m, b.position.x + b.size.width),
    0,
  );
  const widthClearanceCm = Math.max(0, innerWcm - usedWidthCm);
  const widthClearancePx = widthClearanceCm * scale;

  // 상단 빈 슬롯 식별 — bottomItems 중 같은 (x, y) 위치에 topItems 가 없는 박스
  const isTopOccupied = (b: PlacedCargo) =>
    row.topItems.some(
      (t) => t.position.x === b.position.x && t.position.y === b.position.y,
    );

  return (
    <g>
      {/* 행 구분선 (안쪽 끝 점선) — 첫 행 제외 시각 구분 */}
      {row.index > 0 && (
        <line
          x1={containerX}
          y1={rowBottomY}
          x2={containerRight}
          y2={rowBottomY}
          stroke="#d4d4d4"
          strokeDasharray="2 3"
          strokeWidth={0.5}
        />
      )}

      {/* 폭 여유 영역 — 행 우측 비어있는 가로 */}
      {widthClearanceCm > 0 && (
        <rect
          x={toSvgX(usedWidthCm)}
          y={rowTopY}
          width={widthClearancePx}
          height={rowHeightPx}
          fill="#fafafa"
          stroke="#d4d4d4"
          strokeDasharray="3 3"
          strokeWidth={0.5}
        >
          <title>이 행 폭 여유 {Math.round(widthClearanceCm)} cm</title>
        </rect>
      )}

      {/* 하단 화물 박스 */}
      {row.bottomItems.map((b, i) => (
        <PlacedRect
          key={`b-${i}`}
          item={b}
          layer="bottom"
          scale={scale}
          toSvgX={toSvgX}
          toSvgY={toSvgY}
        />
      ))}

      {/* 상단 빈 슬롯 (occupied 안 된 bottom 박스 위에 회색 점선) */}
      {row.bottomItems
        .filter((b) => !isTopOccupied(b))
        .map((b, i) => (
          <PlacedRect
            key={`empty-top-${i}`}
            item={b}
            layer="empty-top"
            scale={scale}
            toSvgX={toSvgX}
            toSvgY={toSvgY}
          />
        ))}

      {/* 상단 화물 박스 */}
      {row.topItems.map((t, i) => (
        <PlacedRect
          key={`t-${i}`}
          item={t}
          layer="top"
          scale={scale}
          toSvgX={toSvgX}
          toSvgY={toSvgY}
        />
      ))}

      {/* 좌측 행 번호 + 행 길이 + 누적 길이 라벨 */}
      <g>
        <rect
          x={containerX - ROW_NUM_WIDTH + 4}
          y={rowTopY + 2}
          width={ROW_NUM_WIDTH - 10}
          height={Math.min(rowHeightPx - 4, 50)}
          fill="#fef2f2"
          stroke="#fca5a5"
          strokeWidth={1}
          rx={3}
        />
        <text
          x={containerX - ROW_NUM_WIDTH / 2 + 2}
          y={rowTopY + 16}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill="#b91c1c"
        >
          {displayNum}
        </text>
        <text
          x={containerX - ROW_NUM_WIDTH / 2 + 2}
          y={rowTopY + 30}
          textAnchor="middle"
          fontSize={10}
          fill="#525252"
        >
          {rowLengthCm}
        </text>
        <text
          x={containerX - ROW_NUM_WIDTH / 2 + 2}
          y={rowTopY + 42}
          textAnchor="middle"
          fontSize={9}
          fill="#737373"
        >
          ({cumLengthCm})
        </text>
      </g>

      {/* 우측 여유 정보 라벨 */}
      <g>
        <text
          x={containerRight + 8}
          y={rowTopY + 14}
          fontSize={10}
          fill="#404040"
        >
          가로 여유 {Math.round(widthClearanceCm)} cm
        </text>
        <text
          x={containerRight + 8}
          y={rowTopY + 28}
          fontSize={10}
          fill={row.doorPassable ? "#047857" : "#dc2626"}
          fontWeight={row.doorPassable ? 400 : 600}
        >
          {row.doorPassable ? "" : "⚠ "}
          천장 여유 {Math.max(0, Math.round(row.topClearance))} cm
        </text>
        {!row.doorPassable && (
          <text
            x={containerRight + 8}
            y={rowTopY + 42}
            fontSize={9}
            fill="#dc2626"
            fontWeight={600}
          >
            입구 통과 불가
          </text>
        )}
      </g>
    </g>
  );
}

interface PlacedRectProps {
  item: PlacedCargo;
  layer: "bottom" | "top" | "empty-top";
  scale: number;
  toSvgX: (cmX: number) => number;
  toSvgY: (cmY: number) => number;
}

function PlacedRect({ item, layer, scale, toSvgX, toSvgY }: PlacedRectProps) {
  const x = toSvgX(item.position.x);
  const y = toSvgY(item.position.y + item.size.length);
  const w = item.size.width * scale;
  const h = item.size.length * scale;

  let fill = "#bfdbfe";
  let stroke = "#3b82f6";
  let dasharray: string | undefined;
  let opacity = 1;
  let label = item.shipper || item.name || "";
  let title = `${item.shipper ?? ""} ${item.cargoType ?? ""} ${item.size.width}×${item.size.length}×${item.size.height}cm`;

  if (layer === "top") {
    fill = "#fed7aa";
    stroke = "#f97316";
    dasharray = "4 3";
    opacity = 0.9;
    title = "[상단] " + title;
  } else if (layer === "empty-top") {
    fill = "rgba(240, 240, 240, 0.4)";
    stroke = "#a3a3a3";
    dasharray = "3 3";
    opacity = 1;
    label = "";
    title = "상단 빈 슬롯 — 이 위에 더 적재 가능";
  }

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={dasharray}
        opacity={opacity}
        rx={1}
      >
        <title>{title}</title>
      </rect>
      {layer !== "empty-top" && w > 32 && h > 24 && (
        <text
          x={x + w / 2}
          y={y + h / 2 - 3}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={9}
          fill="#262626"
        >
          {truncate(label, Math.max(6, Math.floor(w / 7)))}
        </text>
      )}
      {layer !== "empty-top" && w > 40 && h > 36 && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 9}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={8}
          fill="#525252"
        >
          {item.size.width}×{item.size.length}
          {item.cargoType ? ` · ${item.cargoType}` : ""}
        </text>
      )}
    </g>
  );
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}

interface LegendProps {
  color: string;
  stroke?: string;
  label: string;
  dashed?: boolean;
  muted?: boolean;
}

function Legend({ color, stroke, label, dashed, muted }: LegendProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{
          backgroundColor: color,
          border: `1px ${dashed ? "dashed" : "solid"} ${stroke ?? "#737373"}`,
          opacity: muted ? 0.8 : 1,
        }}
      />
      <span className="text-neutral-700">{label}</span>
    </span>
  );
}
