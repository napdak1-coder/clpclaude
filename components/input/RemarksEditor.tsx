"use client";

/**
 * 화물 리마크 편집기
 *
 * - 4 체크박스 + 방향제한 셀렉트
 * - CargoTable 셀 안에서 가로로 펼쳐짐. 좁은 화면에서는 줄바꿈.
 */

import type { Orientation, Remark } from "@/types/cargo";

interface RemarksEditorProps {
  value: Remark;
  onChange: (next: Remark) => void;
  /** 컴팩트 모드 — 표 셀 안에서 사용할 때 라벨을 짧게 */
  compact?: boolean;
}

const ORIENTATION_LABELS: Record<Orientation, string> = {
  free: "자유",
  long_along_length: "장축 길이방향",
  fixed: "회전 금지",
};

export function RemarksEditor({ value, onChange, compact }: RemarksEditorProps) {
  const update = (patch: Partial<Remark>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <label
        className="flex items-center gap-1"
        title="이 화물 위에 다른 화물을 올릴 수 없습니다"
      >
        <input
          type="checkbox"
          checked={value.noStacking}
          onChange={(e) => update({ noStacking: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        <span>다단금지</span>
      </label>
      <label
        className="flex items-center gap-1"
        title="반드시 다른 화물 위쪽(상단)에 적재해야 합니다"
      >
        <input
          type="checkbox"
          checked={value.topOnly}
          onChange={(e) => update({ topOnly: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        <span>상단적재</span>
      </label>
      <label
        className="flex items-center gap-1"
        title="아래 화물이 위 화물보다 무거워야 합니다"
      >
        <input
          type="checkbox"
          checked={value.heavierBelow}
          onChange={(e) => update({ heavierBelow: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        <span>중량조건</span>
      </label>
      <label
        className="flex items-center gap-1"
        title="화물의 회전/방향 제한"
      >
        <span className={compact ? "sr-only" : ""}>방향</span>
        <select
          value={value.orientation}
          onChange={(e) =>
            update({ orientation: e.target.value as Orientation })
          }
          className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs"
        >
          {(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((o) => (
            <option key={o} value={o}>
              {ORIENTATION_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
