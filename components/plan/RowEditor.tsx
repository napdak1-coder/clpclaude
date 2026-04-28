"use client";

/**
 * 행 수동 조정 (v1 단순 보기 + 안내)
 *
 * - 현재는 행별 yStart/yEnd 만 표시하고 사용자가 값을 바꾸면 onChange 로 전달
 * - 실제 재계산은 상위 페이지에서 결정 (TODO: 변경된 yEnd 를 알고리즘 hint 로 전달하는 기능)
 */

import { useState } from "react";
import type { Row } from "@/types/plan";

interface RowEditorProps {
  rows: Row[];
  containerLength: number;
  /** 사용자가 yEnd 를 조정한 결과 — 상위에서 어떻게 활용할지 결정 */
  onChange?: (rows: Row[]) => void;
}

export function RowEditor({ rows, containerLength, onChange }: RowEditorProps) {
  const [draft, setDraft] = useState<Row[]>(rows);

  const updateYEnd = (index: number, yEnd: number) => {
    const next = draft.map((r, i) => (i === index ? { ...r, yEnd } : r));
    // 다음 행의 yStart 도 따라가도록 보정 (단순화)
    for (let i = index + 1; i < next.length; i += 1) {
      next[i] = { ...next[i], yStart: next[i - 1].yEnd };
    }
    setDraft(next);
    onChange?.(next);
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-amber-800">행 미세조정</h4>
        <span className="text-[11px] text-amber-700">
          (베타) 변경값은 화면에만 반영됩니다 — 정식 재계산 기능은 추후 구현
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {draft.map((r, idx) => (
          <div
            key={r.index}
            className="rounded bg-white px-2 py-1 ring-1 ring-amber-200"
          >
            <div className="flex items-center justify-between">
              <span>행 {r.index + 1}</span>
              <span className="text-neutral-500">
                {Math.round(r.yStart)} → {Math.round(r.yEnd)}cm
              </span>
            </div>
            <label className="mt-1 flex items-center gap-2">
              <span className="w-12 text-neutral-600">yEnd</span>
              <input
                type="number"
                min={r.yStart + 1}
                max={containerLength}
                value={Math.round(r.yEnd)}
                onChange={(e) => updateYEnd(idx, Number(e.target.value) || 0)}
                className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-right"
              />
              <span className="text-neutral-400">cm</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
