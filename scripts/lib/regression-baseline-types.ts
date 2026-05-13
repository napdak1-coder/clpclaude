/**
 * 회귀 baseline 매트릭스 타입 정의.
 *
 * 사용 위치: regression script 전용. 알고리즘 런타임 import 금지.
 *
 * baseline 은 컨테이너 셋 결정 룰 변경 시 회귀 0건 확인용 기준 계약서.
 * 동결 필드(Hard 비교) vs 참고 필드(Warning/Allowed) 가 다름 — 비교 룰은
 * regression-baseline-schema.ts 의 refinement 와 회귀 스크립트의 diff 평가기에서 강제.
 */

import type { ContainerType } from "../../types/container.ts";
import type {
  CLPDebugInfo,
  ContainerCbmBasis,
  ContainerCandidateAttempt,
} from "../../types/clp-debug.ts";

export type ExpectedStatus = "PASS" | "KNOWN_MISMATCH" | "WIP";
export type PractitionerMismatchSource = "verify-script" | "none" | "manual";
export type PackMode = "auto" | "20ft_only" | "40ft_only";

/**
 * baseline 매트릭스 1 entry (1 샘플).
 *
 * Hard 동결 필드 (변하면 회귀 fail):
 *   containerSet, unplacedCount, unplacedCargoIds, cargoIdSplitCount,
 *   bookingSplitCount, hardViolationCount, cbmOverflowCount, weightOverflowCount,
 *   strictAuditPass, physicalTotalCbm
 *
 * 참고 필드 (Warning/Allowed):
 *   userDeclaredTotalCbm, legacyDecisionTotalCbm, candidatesEvaluated,
 *   practitionerMismatchCount, packTimeMs, packTimeMedianOf3, wallClockMs
 */
export interface BaselineSample {
  // ── 식별 ──
  sampleId: string;
  sampleName: string;
  sampleFile: string;
  /** 파일 내용 sha256 (16 자 prefix) — 입력 데이터 동결 보증 */
  inputFileHash: string;
  expectedStatus: ExpectedStatus;

  // ── 입력 메타 ──
  mode: PackMode;
  inputCargoRowCount: number;
  /** visual unit + CT cargo quantity 합 — placedCount + unplacedCount 검증용 */
  inputUnitTotalCount: number;
  inputTotalWeightKg: number;
  lightModeUsed: boolean;

  // ── 컨 결정 (Hard 동결) ──
  containerSet: ContainerType[];
  containerCount: number;
  containerCapacityCbmList: number[];
  totalCapacityCbm: number;
  cbmBasis: ContainerCbmBasis;
  userOverride: boolean;

  // ── 배치 결과 (Hard 동결) ──
  placedCount: number;
  unplacedCount: number;
  unplacedCargoIds: string[];
  cargoIdSplitCount: number;
  bookingSplitCount: number;
  hardViolationCount: number;
  cbmOverflowCount: number;
  weightOverflowCount: number;
  strictAuditPass: boolean;

  // ── 부피 진단 ──
  userDeclaredTotalCbm: number;
  physicalTotalCbm: number;
  legacyDecisionTotalCbm: number;
  /** 채택된 셋 vs 차순위 셋 capacity 차이. baseline 시점엔 0 (candidateUnion 후 의미). */
  decidedVsRunnerUpDeltaCbm: number;

  // ── 후보 시도 (참고, min 1) ──
  candidatesEvaluated: ContainerCandidateAttempt[];

  // ── 실무자 분배 (Warning 비교용, valid 기준 X) ──
  practitionerMismatchCount: number | null;
  practitionerMismatchSource: PractitionerMismatchSource;

  // ── 성능 (참고, 환경 의존) ──
  packTimeMs: number;
  packTimeMedianOf3: number;
  wallClockMs: number;

  // ── 메타 ──
  notes: string;
}

export interface BaselineSnapshot {
  schemaVersion: string;
  dataVersion: string;
  algorithmVersion: string;
  generatedAt: string;
  git: { commit: string; branch: string };
  host: { node: string; platform: string };
  ruleSetSnapshot: Record<string, string>;
  thresholds: {
    cbmDiffAbs: number;
    cbmDiffRel: number;
    packTimeWarnRatio: number;
    candidateMaxRunMs: number;
  };
  samples: BaselineSample[];
}

/** 회귀 비교 결과 1 샘플 */
export interface RegressionResult {
  sampleId: string;
  status: "PASS" | "WARNING" | "FAIL";
  expectedStatus: ExpectedStatus;
  diffs: RegressionDiff[];
  packTimeMs: number;
}

export interface RegressionDiff {
  field: string;
  baseline: unknown;
  actual: unknown;
  severity: "hard" | "warn" | "allowed";
  delta?: number;
}

export interface RegressionRun {
  schemaVersion: string;
  generatedAt: string;
  git: { commit: string; branch: string };
  baselineRef: string;
  results: RegressionResult[];
  summary: { pass: number; warning: number; fail: number };
}

/** CLPDebugInfo 재노출 — regression script 안 import 편의 */
export type { CLPDebugInfo };
