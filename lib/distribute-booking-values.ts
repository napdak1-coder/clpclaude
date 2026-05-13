/**
 * 부킹 단위 자동 값 분배 — 같은 booking + 같은 actualShipperName 인 cargo 들 중
 * 한 행에만 무게/CBM/ABOUT 값이 몰려있으면 수량 비율로 자동 분배.
 *
 * 분배 조건 (필드별 독립):
 *   - 같은 그룹 안에 정확히 1개 행만 값 있고 나머지는 0/null → 분배 발동
 *   - 2개 이상 행에 값 있으면 → 사용자 명시 입력으로 간주, 분배 X
 *
 * 분배 비율: cargo.quantity / Σ(cargo.quantity)
 *
 * 안전 원칙:
 *   - 원본 cargoes 변경 X (새 배열 반환)
 *   - 분배된 cargo 의 어떤 필드인지 distributedFields 맵으로 보고 → UI 가 빨간 글씨 표시 가능
 *   - 같은 booking 안에서도 actualShipperName 다르면 별도 그룹 (다른 화주는 합치지 않음)
 *   - bookingNo 가 비어 있으면 분배 대상 X (그룹 식별 불가)
 */

import type { CargoCbmSource, CargoSpec } from "../types/cargo.ts";

export type DistributedField = "cbm" | "aboutCbm" | "weightPerUnit";

export interface DistributeResult {
  cargoes: CargoSpec[];
  /** cargoId → 자동 분배된 필드 집합 (UI 빨간 글씨 표시용) */
  distributedFields: Map<string, Set<DistributedField>>;
}

function isEmpty(v: number | null | undefined): boolean {
  return v == null || v === 0;
}

function groupKey(c: CargoSpec): string | null {
  if (!c.bookingNo) return null;
  return `${c.bookingNo}|${c.actualShipperName ?? ""}`;
}

export function distributeBookingValues(
  cargoes: CargoSpec[],
): DistributeResult {
  // 1) 그룹화 (booking + actualShipperName)
  const groups = new Map<string, CargoSpec[]>();
  const ungrouped: CargoSpec[] = [];
  for (const c of cargoes) {
    const k = groupKey(c);
    if (k === null) {
      ungrouped.push(c);
      continue;
    }
    const list = groups.get(k) ?? [];
    list.push(c);
    groups.set(k, list);
  }

  const distributedFields = new Map<string, Set<DistributedField>>();
  const out: CargoSpec[] = [];

  // 그룹 안 cargo 들 처리
  for (const group of groups.values()) {
    if (group.length <= 1) {
      out.push(...group);
      continue;
    }

    const totalQty = group.reduce((s, c) => s + (c.quantity ?? 0), 0);
    if (totalQty <= 0) {
      out.push(...group);
      continue;
    }

    // 필드별 분배 검사
    const fields: DistributedField[] = ["cbm", "aboutCbm", "weightPerUnit"];

    // 각 cargo 사본 (원본 변경 X)
    const updated = group.map((c) => ({ ...c }));

    for (const field of fields) {
      const filled = updated.filter((c) => !isEmpty(c[field] as number | null | undefined));
      // 정확히 1개 행만 값 있음 → 분배
      if (filled.length === 1 && updated.length > 1) {
        const total = filled[0][field] as number;
        // cbm 필드 분배 시 원본 출처를 보존해 distributed-cfs/distributed-about 으로 마킹.
        // (사용자 결정 Q1 — 원본이 CFS 계열이면 distributed-cfs, ABOUT 계열이면 distributed-about)
        let distributedCbmSource: CargoCbmSource | null = null;
        if (field === "cbm") {
          const originSource = (filled[0] as CargoSpec).cbmSource;
          // CFS 계열 (excel-cfs / manual-cfs / distributed-cfs / legacy-cfs / undefined)
          // → distributed-cfs. 그 외 (calculated / distributed-about) 도 보수적으로 distributed-cfs
          // (원본이 c.cbm 에 있다는 것 자체가 사용자 신고 흐름의 일부).
          distributedCbmSource = "distributed-cfs";
          // forward compat: 명시 origin 이 distributed-about 또는 calculated 면 그 출처 보존
          if (originSource === "distributed-about") {
            distributedCbmSource = "distributed-about";
          }
        }
        for (const c of updated) {
          const ratio = (c.quantity ?? 0) / totalQty;
          (c as Record<string, unknown>)[field] = total * ratio;
          if (field === "cbm" && distributedCbmSource) {
            (c as Record<string, unknown>).cbmSource = distributedCbmSource;
          }
          // 분배 표시
          const set = distributedFields.get(c.id) ?? new Set<DistributedField>();
          set.add(field);
          distributedFields.set(c.id, set);
        }
      }
    }

    out.push(...updated);
  }

  // 그룹 안 못 들어간 cargo (bookingNo 없음) 그대로
  out.push(...ungrouped);

  // 입력 순서 보존 — id 기준 매핑
  const order = new Map(cargoes.map((c, i) => [c.id, i]));
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { cargoes: out, distributedFields };
}
