/**
 * 컨테이너 셋 결정 + pack 결과의 디버그 envelope.
 * regression baseline 측정 + 회귀 진단 전용. production UI 노출 X.
 *
 * leaf 모듈 — 다른 내부 모듈 import 금지 (순환 의존 방지).
 * packBest 의 `options.attachDebug === true` 일 때만 결과에 부착.
 */

import type { ContainerType } from "./container.ts";

/**
 * CBM 출처 4단계.
 * - declared: 사용자/CFS/about 기준 후보로 결정
 * - physical: 박스 W/L/H 계산 기준 후보로 결정
 * - fallback: declared 값 없어서 physical 로 대체된 후보
 * - mixed: declared 후보와 physical 후보가 union 된 결과 (candidateUnion 적용 시)
 */
export type ContainerCbmBasis = "declared" | "physical" | "fallback" | "mixed";

/**
 * 후보 시도 결과 — discriminated union.
 * valid 면 failReasons 필드 없음 (타입 강제).
 * invalid 또는 skipped 면 failReasons 최소 1개 보장.
 */
export type ContainerCandidateAttempt =
  | {
      status: "valid";
      types: ContainerType[];
      capacity: number;
      basis: "declared" | "physical";
      stage: "lightMode" | "fullMode";
      packTimeMs: number;
    }
  | {
      status: "invalid" | "skipped";
      types: ContainerType[];
      capacity: number;
      basis: "declared" | "physical";
      stage: "lightMode" | "fullMode";
      packTimeMs: number;
      failReasons: [string, ...string[]];
    };

/** packBest `attachDebug=true` 시 결과에 부착되는 디버그 envelope */
export interface CLPDebugInfo {
  /** ∀cargo: c.cbm ?? c.aboutCbm ?? cargoCbm(c) — 사용자 신고 기준 */
  userDeclaredTotalCbm: number;
  /** ∀cargo: cargoCbm(c) — 박스 W/L/H 계산 합 */
  physicalTotalCbm: number;
  /** 기존 알고리즘 visualCbm + ctCbm + completedCbm — 회귀 추적용 */
  legacyDecisionTotalCbm: number;
  /** visual unit + CT cargo quantity 합 — placedCount + unplacedCount 검증용 */
  inputUnitTotalCount: number;
  /** 컨 셋 결정 근거. candidateUnion 미적용 단계에서는 "physical" 고정. */
  cbmBasis: ContainerCbmBasis;
  /** fixedContainers 옵션 사용 여부 */
  userOverride: boolean;
  /** 후보 시도 기록. 단일 후보 단계도 1건 기록 (min 1). */
  candidatesEvaluated: ContainerCandidateAttempt[];
  /** packBest 호출 시 mode */
  mode: "auto" | "20ft_only" | "40ft_only";
  /** lightMode 사용 여부 */
  lightModeUsed: boolean;
}
