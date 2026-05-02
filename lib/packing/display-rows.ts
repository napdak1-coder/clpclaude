/**
 * 자유 좌표 적재 결과(Placement3D[]) → 화면용 Row[] 변환 (column-based stack display)
 *
 * 핵심:
 *  - 각 행 안에서 화물을 좌→우로 컬럼 단위로 배치
 *  - 한 컬럼 = 한 bottom + 그 위에 stack 된 top 들 (top 은 자기 supporter 바로 위에 붙음, 갭 0)
 *  - 행 전체 높이 = max(컬럼별 stack 길이) + 천장 여유 라벨 영역
 *  - 행끼리는 ROW_GAP_CM 균일 갭
 *
 * 배치 (cm 기준, 입구=y=0, 안쪽=y큰):
 *
 *   [yStart]
 *   ─── bottom ─── (각 컬럼의 bottom 화물)
 *   ─── top 1 ─── (그 컬럼에 stack 된 첫 번째 top)
 *   ─── top 2 ─── (그 다음 top)
 *   ...
 *   ─── 천장 여유 라벨 영역 (LABEL_AREA_CM) ───
 *   [yEnd]
 *
 * 컬럼마다 stack 길이가 다를 수 있으나 행 yEnd 는 최대 stack 기준으로 결정.
 */

import type { ContainerSpec } from "../../types/container.ts";
import type { PlacedCargo, Row } from "../../types/plan.ts";
import type { Placement3D } from "./extreme-point.ts";

const ROW_GAP_CM = 18;
const LABEL_AREA_CM = 24;
const SIMILAR_LENGTH_RATIO = 0.5;

function placedCargo(
  src: Placement3D,
  newX: number,
  newY: number,
  size?: { width: number; length: number; height: number },
): PlacedCargo {
  return {
    cargoId: src.cargoId,
    shipper: src.shipper,
    name: src.name,
    cargoType: src.cargoType,
    cfsCbm: src.cfsCbm,
    layer: src.layer,
    position: { x: newX, y: newY },
    size: size ?? src.size,
    rotated: src.rotated,
    weight: src.weight,
    remarks: src.remarks,
  };
}

export function computeDisplayRows(
  placements: Placement3D[],
  spec: ContainerSpec,
): Row[] {
  if (placements.length === 0) return [];

  const bottomsAll = placements.filter((p) => p.layer === "bottom");
  const topsAll = placements.filter((p) => p.layer === "top");

  // 1) bottom 정렬 — 길이 desc, 동률이면 폭 desc
  const sortedBottoms = [...bottomsAll].sort((a, b) => {
    if (b.size.length !== a.size.length) return b.size.length - a.size.length;
    return b.size.width - a.size.width;
  });

  // 2) bottom 행 배정 — 비슷한 길이 (≥50%) + 폭 합 ≤ innerWidth
  type RowGroup = { bottoms: Placement3D[]; widthSum: number; rowLength: number };
  const rowGroups: RowGroup[] = [];
  for (const p of sortedBottoms) {
    let placed = false;
    for (const g of rowGroups) {
      if (
        p.size.length >= g.rowLength * SIMILAR_LENGTH_RATIO &&
        g.widthSum + p.size.width <= spec.innerWidth + 0.5
      ) {
        g.bottoms.push(p);
        g.widthSum += p.size.width;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rowGroups.push({
        bottoms: [p],
        widthSum: p.size.width,
        rowLength: p.size.length,
      });
    }
  }

  // 3) 행 안 bottom 폭 큰 순으로 좌→우
  for (const g of rowGroups) {
    g.bottoms.sort((a, b) => b.size.width - a.size.width);
  }

  // 4) 행 순서 — 작은 길이 = 입구쪽, 큰 길이 = 안쪽
  rowGroups.sort((a, b) => a.rowLength - b.rowLength);

  // 5) 각 bottom 의 새 위치 + 매핑 — top 의 supporter 추적용
  interface BottomInfo {
    newX: number;
    newY: number;       // = rowYStart (계산은 8단계에서 채움)
    rowIdx: number;
    width: number;
    length: number;
    src: Placement3D;
  }
  const oldKeyToBottom = new Map<string, BottomInfo>();
  const rowBottomInfos: BottomInfo[][] = rowGroups.map(() => []);
  for (let i = 0; i < rowGroups.length; i++) {
    let xCursor = 0;
    for (const p of rowGroups[i].bottoms) {
      const oldKey = `${p.position.x},${p.position.y},${p.position.z}`;
      const info: BottomInfo = {
        newX: xCursor,
        newY: 0, // rowYStart 결정 후 채움
        rowIdx: i,
        width: p.size.width,
        length: p.size.length,
        src: p,
      };
      oldKeyToBottom.set(oldKey, info);
      rowBottomInfos[i].push(info);
      xCursor += p.size.width;
    }
  }

  // 6) top 화물의 supporter 찾기 + 컬럼 단위로 그룹핑 (한 supporter 에 여러 top 가능)
  interface TopAttach {
    supporterKey: string; // supporter 의 oldKey
    src: Placement3D;
    clippedWidth: number;
  }
  const topsByBottom = new Map<string, TopAttach[]>(); // oldKey → tops
  for (const t of topsAll) {
    const supporter = bottomsAll.find(
      (b) =>
        Math.abs(b.position.z + b.size.height - t.position.z) < 0.5 &&
        t.position.x < b.position.x + b.size.width &&
        t.position.x + t.size.width > b.position.x &&
        t.position.y < b.position.y + b.size.length &&
        t.position.y + t.size.length > b.position.y,
    );
    if (!supporter) continue;
    const oldKey = `${supporter.position.x},${supporter.position.y},${supporter.position.z}`;
    if (!topsByBottom.has(oldKey)) topsByBottom.set(oldKey, []);
    topsByBottom.get(oldKey)!.push({
      supporterKey: oldKey,
      src: t,
      clippedWidth: Math.min(t.size.width, supporter.size.width),
    });
  }

  // 7) 같은 supporter 의 top 들은 z 작은 순으로 정렬 (밑에서 위로 stack)
  for (const tops of topsByBottom.values()) {
    tops.sort((a, b) => a.src.position.z - b.src.position.z);
  }

  // 8) 각 행의 bottom newY 계산 + 컬럼 stack 길이 계산 + 행 yEnd 결정
  const rows: Row[] = [];
  let cumY = 0;

  for (let i = 0; i < rowGroups.length; i++) {
    const yStart = cumY;

    // 이 행의 모든 bottom 의 newY 를 yStart 로 설정
    for (const info of rowBottomInfos[i]) {
      info.newY = yStart;
    }

    // 행 안 컬럼별 stack 길이 = bottom.length + sum(그 컬럼 top 들 length)
    let rowMaxStackLen = 0;
    const bottomItems: PlacedCargo[] = [];
    const topItems: PlacedCargo[] = [];

    for (const info of rowBottomInfos[i]) {
      const oldKey = `${info.src.position.x},${info.src.position.y},${info.src.position.z}`;
      const tops = topsByBottom.get(oldKey) ?? [];

      // bottom 추가
      bottomItems.push(
        placedCargo(info.src, info.newX, info.newY, {
          width: info.width,
          length: info.length,
          height: info.src.size.height,
        }),
      );

      // 이 컬럼의 top 들 — bottom 바로 위부터 누적 stack
      let stackY = info.newY + info.length;
      let stackLen = info.length;
      for (const ta of tops) {
        topItems.push(
          placedCargo(ta.src, info.newX, stackY, {
            width: ta.clippedWidth,
            length: ta.src.size.length,
            height: ta.src.size.height,
          }),
        );
        stackY += ta.src.size.length;
        stackLen += ta.src.size.length;
      }

      if (stackLen > rowMaxStackLen) rowMaxStackLen = stackLen;
    }

    const yEnd = yStart + rowMaxStackLen + LABEL_AREA_CM;

    // 컬럼별 stack height (z 방향, 높이 단위) 로 천장 여유 계산 — 가장 높이 stack 된 컬럼 기준
    const bottomMaxHeight = Math.max(0, ...bottomItems.map((b) => b.size.height));
    let totalStackHeight = bottomMaxHeight;
    for (const info of rowBottomInfos[i]) {
      const oldKey = `${info.src.position.x},${info.src.position.y},${info.src.position.z}`;
      const tops = topsByBottom.get(oldKey) ?? [];
      const stackH =
        info.src.size.height + tops.reduce((s, t) => s + t.src.size.height, 0);
      if (stackH > totalStackHeight) totalStackHeight = stackH;
    }
    const topMaxHeight = Math.max(0, totalStackHeight - bottomMaxHeight);
    const topClearance = Math.max(0, spec.innerHeight - totalStackHeight);
    const doorPassable = totalStackHeight <= spec.doorHeight;

    rows.push({
      index: i,
      yStart,
      yEnd,
      bottomItems,
      topItems,
      bottomMaxHeight,
      topMaxHeight,
      topClearance,
      doorPassable,
    });

    cumY = yEnd + ROW_GAP_CM;
  }

  return rows;
}

export function totalDisplayLengthCm(rows: Row[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.yEnd));
}
