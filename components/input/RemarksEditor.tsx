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

  const lbl = (full: string, short: string) => (compact ? short : full);
  const cbCls = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  const labelCls = compact ? "flex items-center gap-0.5" : "flex items-center gap-1";
  const selectCls = compact
    ? "rounded border border-neutral-300 bg-white px-0.5 py-0 text-[10px] leading-none"
    : "rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs";

  if (compact) {
    // 2단: 위 = 체크박스 3개, 아래 = 방향 드롭다운
    return (
      <div className="flex flex-col gap-y-0.5 text-[10px] leading-none">
        <div className="flex items-center gap-x-1.5">
          <label className={labelCls} title="이 화물 위에 다른 화물을 올릴 수 없습니다">
            <input
              type="checkbox"
              checked={value.noStacking}
              onChange={(e) => update({ noStacking: e.target.checked })}
              className={cbCls}
            />
            <span>{lbl("다단금지", "다금")}</span>
          </label>
          <label className={labelCls} title="반드시 다른 화물 위쪽(상단)에 적재해야 합니다">
            <input
              type="checkbox"
              checked={value.topOnly}
              onChange={(e) => update({ topOnly: e.target.checked })}
              className={cbCls}
            />
            <span>{lbl("상단적재", "상적")}</span>
          </label>
          <label className={labelCls} title="아래 화물이 위 화물보다 무거워야 합니다">
            <input
              type="checkbox"
              checked={value.heavierBelow}
              onChange={(e) => update({ heavierBelow: e.target.checked })}
              className={cbCls}
            />
            <span>{lbl("중량조건", "중조")}</span>
          </label>
          <label className={labelCls} title="자체다단 — 같은 부킹 안에서만 적층 허용. 다른 부킹과 적층 금지">
            <input
              type="checkbox"
              checked={value.selfStackOnly ?? false}
              onChange={(e) => update({ selfStackOnly: e.target.checked })}
              className={cbCls}
            />
            <span>{lbl("자체다단", "자다")}</span>
          </label>
        </div>
        <div>
          <select
            value={value.orientation}
            onChange={(e) => update({ orientation: e.target.value as Orientation })}
            className={`w-full ${selectCls}`}
            title="화물의 회전/방향 제한"
          >
            {(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((o) => (
              <option key={o} value={o}>
                {ORIENTATION_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <label className={labelCls} title="이 화물 위에 다른 화물을 올릴 수 없습니다">
        <input
          type="checkbox"
          checked={value.noStacking}
          onChange={(e) => update({ noStacking: e.target.checked })}
          className={cbCls}
        />
        <span>{lbl("다단금지", "다금")}</span>
      </label>
      <label className={labelCls} title="반드시 다른 화물 위쪽(상단)에 적재해야 합니다">
        <input
          type="checkbox"
          checked={value.topOnly}
          onChange={(e) => update({ topOnly: e.target.checked })}
          className={cbCls}
        />
        <span>{lbl("상단적재", "상적")}</span>
      </label>
      <label className={labelCls} title="아래 화물이 위 화물보다 무거워야 합니다">
        <input
          type="checkbox"
          checked={value.heavierBelow}
          onChange={(e) => update({ heavierBelow: e.target.checked })}
          className={cbCls}
        />
        <span>{lbl("중량조건", "중조")}</span>
      </label>
      <label className={labelCls} title="화물의 회전/방향 제한">
        <span>방향</span>
        <select
          value={value.orientation}
          onChange={(e) => update({ orientation: e.target.value as Orientation })}
          className={selectCls}
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
