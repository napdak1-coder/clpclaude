/**
 * 적층 무게 룰 strict audit — 최종 결과의 모든 적층 페어가
 * "위 박스 무게 ≤ 아래 받침 무게(들 중 최소)" 조건을 만족하는지 검사.
 *
 * 흐름:
 *   1) ContainerPlan.placements 의 모든 placement 를 훑는다.
 *   2) 각 placement (top) 에 대해 직접 아래에 있는 받침 박스(들) 추출.
 *      받침 = z 좌표가 (top.position.z) 와 EPS 이내 일치 + x/y AABB 겹침.
 *   3) 받침이 1개 이상이면, top.weight > min(받침.weight) 면 위반.
 *      받침이 0개이면 (z=0 바닥) 위반 X.
 *   4) 위반 페어 모두 수집해서 반환. pass = (violations.length === 0).
 *
 * 사용:
 *   const audit = strictStackAudit(result);
 *   if (audit.pass) { ... 안전 ... } else { console.log(audit.violations); }
 *
 * 주의:
 *   - placements 가 없는 ContainerPlan (구버전 결과) 은 검사 대상 X (skip).
 *   - bulk (CT/완료) 화물은 placements 에 없으므로 검사 X (적층 자체 안 함).
 *   - 무게 정보 부재 (weight === 0) 박스가 받침이면 strict 검사에서 통과
 *     처리 (데이터 누락 보호 — canStackOn 폴백과 일관). 진짜 0kg 위 적층 차단을
 *     원하면 별도 룰 추가 필요.
 */

import type { CLPResult, PlanPlacement } from "../../types/plan.ts";

const EPS = 0.5; // 좌표 비교 허용 오차 (cm)

export interface StackViolation {
  containerIndex: number;
  bottom: PlacementInfo;
  top: PlacementInfo;
  ratio: number; // top.weight / bottom.weight
}

interface PlacementInfo {
  cargoId: string;
  shipper?: string;
  weight: number;
  zRange: string; // "z=0..71"
  position: { x: number; y: number; z: number };
}

export interface StackAuditResult {
  /** 모든 적층 페어가 strict 룰 통과하면 true */
  pass: boolean;
  /** 위반 페어 상세 목록 */
  violations: StackViolation[];
  /** 검사한 적층 페어 총 수 */
  totalPairs: number;
}

function placementInfo(p: PlanPlacement): PlacementInfo {
  return {
    cargoId: p.cargoId,
    shipper: p.shipper,
    weight: p.weight,
    zRange: `z=${p.position.z.toFixed(0)}..${(p.position.z + p.size.height).toFixed(0)}`,
    position: p.position,
  };
}

/**
 * top 박스의 직접 아래 받침 박스(들) 추출.
 * 받침 조건:
 *   - bottom.position.z + bottom.size.height ≈ top.position.z (EPS 이내)
 *   - x/y AABB 겹침 (양쪽 모두 EPS 초과 겹침)
 */
function findSupporters(
  top: PlanPlacement,
  all: PlanPlacement[],
): PlanPlacement[] {
  const result: PlanPlacement[] = [];
  for (const candidate of all) {
    if (candidate === top) continue;
    const cTopZ = candidate.position.z + candidate.size.height;
    if (Math.abs(cTopZ - top.position.z) > EPS) continue;
    const ox =
      Math.min(
        candidate.position.x + candidate.size.width,
        top.position.x + top.size.width,
      ) - Math.max(candidate.position.x, top.position.x);
    const oy =
      Math.min(
        candidate.position.y + candidate.size.length,
        top.position.y + top.size.length,
      ) - Math.max(candidate.position.y, top.position.y);
    if (ox <= EPS || oy <= EPS) continue;
    result.push(candidate);
  }
  return result;
}

export function strictStackAudit(result: CLPResult): StackAuditResult {
  const violations: StackViolation[] = [];
  let totalPairs = 0;

  for (const cont of result.containers) {
    const placements = cont.placements;
    if (!placements || placements.length === 0) continue;

    for (const top of placements) {
      // 바닥(z=0) 박스는 받침 없음 — 검사 대상 X
      if (top.position.z <= EPS) continue;

      const supporters = findSupporters(top, placements);
      if (supporters.length === 0) continue;

      totalPairs++;

      // strict 룰: 가장 가벼운 받침 ≥ top
      // = top > min(supporters.weight) 이면 위반
      // 무게 정보 부재 (받침 0kg) 는 검사 통과 (데이터 누락 보호)
      const knownSupporters = supporters.filter((s) => s.weight > 0);
      if (knownSupporters.length === 0) continue;

      const minSupporterWeight = Math.min(
        ...knownSupporters.map((s) => s.weight),
      );

      if (top.weight > minSupporterWeight + 0.01) {
        // 받침 중 가장 가벼운 박스 찾기 (위반 상세용)
        const lightest = knownSupporters.reduce((a, b) =>
          a.weight <= b.weight ? a : b,
        );
        violations.push({
          containerIndex: cont.index,
          bottom: placementInfo(lightest),
          top: placementInfo(top),
          ratio: top.weight / minSupporterWeight,
        });
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
    totalPairs,
  };
}

/**
 * 위반 상세를 사용자 보고용 한국어 텍스트로 포맷.
 */
export function formatViolations(audit: StackAuditResult): string {
  if (audit.pass) {
    return `적층 무게 룰 audit: ${audit.totalPairs}개 페어 모두 통과 ✓`;
  }
  const lines: string[] = [
    `적층 무게 룰 audit: ${audit.totalPairs}개 페어 중 ${audit.violations.length}건 위반 ✗`,
  ];
  for (const v of audit.violations) {
    lines.push(
      `  [컨${v.containerIndex}] 아래 ${v.bottom.cargoId} ${v.bottom.shipper ?? "?"} ${v.bottom.weight}kg ${v.bottom.zRange} → 위 ${v.top.cargoId} ${v.top.shipper ?? "?"} ${v.top.weight}kg ${v.top.zRange} (×${v.ratio.toFixed(2)})`,
    );
  }
  return lines.join("\n");
}
