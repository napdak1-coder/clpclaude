/**
 * 회귀 baseline 매트릭스 zod 검증 schema.
 *
 * regression script 전용 — 알고리즘 런타임 import 금지.
 * baseline.json 을 신뢰할 수 있는 입력으로 강제하기 위한 런타임 가드.
 */

import { z } from "zod";

const ContainerTypeSchema = z.enum(["20FT", "40FT"]);

export const ContainerCbmBasisSchema = z.enum([
  "declared",
  "physical",
  "fallback",
  "mixed",
]);

const ContainerCandidateAttemptValidSchema = z
  .object({
    status: z.literal("valid"),
    types: z.array(ContainerTypeSchema),
    capacity: z.number().nonnegative(),
    basis: z.enum(["declared", "physical"]),
    stage: z.enum(["lightMode", "fullMode"]),
    packTimeMs: z.number().nonnegative(),
  })
  .strict();

const ContainerCandidateAttemptInvalidSchema = z
  .object({
    status: z.enum(["invalid", "skipped"]),
    types: z.array(ContainerTypeSchema),
    capacity: z.number().nonnegative(),
    basis: z.enum(["declared", "physical"]),
    stage: z.enum(["lightMode", "fullMode"]),
    packTimeMs: z.number().nonnegative(),
    failReasons: z.array(z.string()).min(1),
  })
  .strict();

export const ContainerCandidateAttemptSchema = z.discriminatedUnion("status", [
  ContainerCandidateAttemptValidSchema,
  ContainerCandidateAttemptInvalidSchema,
]);

export const BaselineSampleSchema = z
  .object({
    sampleId: z.string().min(1),
    sampleName: z.string().min(1),
    sampleFile: z.string(),
    inputFileHash: z.string().regex(/^sha256:/),
    expectedStatus: z.enum(["PASS", "KNOWN_MISMATCH", "WIP"]),
    mode: z.enum(["auto", "20ft_only", "40ft_only"]),
    inputCargoRowCount: z.number().int().nonnegative(),
    inputUnitTotalCount: z.number().int().nonnegative(),
    inputTotalWeightKg: z.number().nonnegative(),
    lightModeUsed: z.boolean(),
    containerSet: z.array(ContainerTypeSchema),
    containerCount: z.number().int().nonnegative(),
    containerCapacityCbmList: z.array(z.number().positive()),
    totalCapacityCbm: z.number().nonnegative(),
    cbmBasis: ContainerCbmBasisSchema,
    userOverride: z.boolean(),
    placedCount: z.number().int().nonnegative(),
    unplacedCount: z.number().int().nonnegative(),
    unplacedCargoIds: z.array(z.string()),
    cargoIdSplitCount: z.number().int().nonnegative(),
    bookingSplitCount: z.number().int().nonnegative(),
    hardViolationCount: z.number().int().nonnegative(),
    cbmOverflowCount: z.number().int().nonnegative(),
    weightOverflowCount: z.number().int().nonnegative(),
    strictAuditPass: z.boolean(),
    userDeclaredTotalCbm: z.number().nonnegative(),
    physicalTotalCbm: z.number().nonnegative(),
    legacyDecisionTotalCbm: z.number().nonnegative(),
    decidedVsRunnerUpDeltaCbm: z.number(),
    candidatesEvaluated: z.array(ContainerCandidateAttemptSchema).min(1),
    practitionerMismatchCount: z.number().int().nonnegative().nullable(),
    practitionerMismatchSource: z.enum(["verify-script", "none", "manual"]),
    packTimeMs: z.number().nonnegative(),
    packTimeMedianOf3: z.number().nonnegative(),
    wallClockMs: z.number().nonnegative(),
    notes: z.string(),
  })
  .strict()
  .refine(
    (s) => s.placedCount + s.unplacedCount === s.inputUnitTotalCount,
    {
      message:
        "placedCount + unplacedCount 는 inputUnitTotalCount 와 같아야 함 (행 손실 감지)",
    },
  );

export const BaselineSnapshotSchema = z
  .object({
    schemaVersion: z.string(),
    dataVersion: z.string(),
    algorithmVersion: z.string(),
    generatedAt: z.string(),
    git: z.object({ commit: z.string(), branch: z.string() }).strict(),
    host: z.object({ node: z.string(), platform: z.string() }).strict(),
    ruleSetSnapshot: z.record(z.string(), z.string()),
    thresholds: z
      .object({
        cbmDiffAbs: z.number(),
        cbmDiffRel: z.number(),
        packTimeWarnRatio: z.number(),
        candidateMaxRunMs: z.number(),
      })
      .strict(),
    samples: z.array(BaselineSampleSchema),
  })
  .strict();

export type BaselineSnapshotInferred = z.infer<typeof BaselineSnapshotSchema>;
export type BaselineSampleInferred = z.infer<typeof BaselineSampleSchema>;
