/**
 * /api/pack — 부킹 ID + 모드를 받아 적재 계획을 계산하고 clp_plans 에 저장.
 *
 * 옵션:
 *   completedExclusiveContainerIndex (number) — 특정 컨테이너에 입고완료 우선 적재
 *   allowVisualInExclusive (bool)             — 위 컨테이너에 시각 화물 허용
 *   allowCtInExclusive (bool)                 — 위 컨테이너에 CT 카톤 허용
 *   preview (bool)                            — DB 저장 생략 (미리보기)
 *   useCandidateUnion (bool)                  — declared/physical 후보 union 시도 (2026-05-13 2차-A-2)
 *                                               기본 false → 기존 packBest 그대로
 *                                               true → packBestWithCandidateUnion 사용
 *   useParallelCandidateUnion (bool)          — 컴퓨터 상태 기반 병렬 후보 탐색 (기본 false)
 *   parallelism / maxParallelism              — 병렬 후보 탐색 동시 worker 수
 *   parallelTimeBudgetMs / perAttemptTimeoutMs — 0 이하이면 해당 제한 없음
 *   parallelSkipInitialProbe (bool)           — 사전 단일 배치 없이 병렬 후보부터 시작
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  packBest,
  packBestWithCandidateUnion,
  type PackOptions,
} from "@/lib/packing/algorithm";
import { packBestWithAdaptiveParallelCandidateUnion } from "@/lib/packing/parallel-candidate-union";
import { getShipment } from "@/lib/repositories/shipments";
import { savePlan } from "@/lib/repositories/clpPlans";
import type { ContainerMode } from "@/types/plan";

interface ApiOk<T> {
  success: true;
  data: T;
}
interface ApiErr {
  success: false;
  error: string;
}

function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiOk<T>>({ success: true, data }, { status });
}
function fail(error: string, status = 400) {
  return NextResponse.json<ApiErr>({ success: false, error }, { status });
}

function parseMode(v: unknown): ContainerMode {
  if (v === "20ft_only" || v === "40ft_only" || v === "auto") return v;
  return "auto";
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return fail("요청 본문이 비어있습니다", 400);
    }
    const obj = body as Record<string, unknown>;
    const shipmentId =
      typeof obj.shipmentId === "string" ? obj.shipmentId : "";
    if (!shipmentId) {
      return fail("shipmentId 가 필요합니다", 400);
    }
    const mode = parseMode(obj.mode);
    const preview = obj.preview === true;
    const useCandidateUnion = obj.useCandidateUnion === true;
    const useParallelCandidateUnion = obj.useParallelCandidateUnion === true;
    const parallelism =
      typeof obj.parallelism === "number" ? obj.parallelism : undefined;
    const maxParallelism =
      typeof obj.maxParallelism === "number" ? obj.maxParallelism : undefined;
    const parallelTimeBudgetMs =
      typeof obj.parallelTimeBudgetMs === "number"
        ? obj.parallelTimeBudgetMs
        : undefined;
    const perAttemptTimeoutMs =
      typeof obj.perAttemptTimeoutMs === "number"
        ? obj.perAttemptTimeoutMs
        : undefined;
    const parallelSkipInitialProbe = obj.parallelSkipInitialProbe === true;
    const opts: PackOptions = {
      completedExclusiveContainerIndex:
        typeof obj.completedExclusiveContainerIndex === "number"
          ? obj.completedExclusiveContainerIndex
          : undefined,
      allowVisualInExclusive: obj.allowVisualInExclusive === true,
      allowCtInExclusive: obj.allowCtInExclusive === true,
    };

    const shipment = await getShipment(shipmentId);
    if (!shipment) {
      return fail("부킹을 찾을 수 없습니다", 404);
    }
    if (shipment.items.length === 0) {
      return fail("계산할 화물이 없습니다", 400);
    }

    // useCandidateUnion=true 일 때만 declared/physical 후보 union 시도. 기본은 기존 packBest.
    const decisionMode:
      | "packBest"
      | "candidateUnion"
      | "parallelCandidateUnion" = useParallelCandidateUnion
      ? "parallelCandidateUnion"
      : useCandidateUnion
        ? "candidateUnion"
        : "packBest";
    const result = useParallelCandidateUnion
      ? await packBestWithAdaptiveParallelCandidateUnion(
          shipment.items,
          mode,
          opts,
          {
            parallelism,
            maxParallelism,
            timeBudgetMs: parallelTimeBudgetMs,
            perAttemptTimeoutMs,
            skipInitialProbe: parallelSkipInitialProbe,
          },
        )
      : useCandidateUnion
        ? packBestWithCandidateUnion(shipment.items, mode, opts)
        : packBest(shipment.items, mode, opts);

    // 미리보기면 DB 저장 안 함, planId 도 없음
    if (preview) {
      return ok({
        planId: null,
        result,
        summary: {
          count20FT: result.summary.count20FT,
          count40FT: result.summary.count40FT,
          totalWeightKg: result.summary.totalWeight,
          totalCbm: result.summary.totalCbm,
          avgFillRate: result.summary.avgFillRate,
          unplacedCount: result.unplaced.length,
          warnings: result.summary.warnings,
          decisionMode,
        },
      });
    }

    const saved = await savePlan(shipmentId, mode, result);
    return ok({
      planId: saved.id,
      result,
      summary: {
        count20FT: saved.count20FT,
        count40FT: saved.count40FT,
        totalWeightKg: saved.totalWeightKg,
        totalCbm: saved.totalCbm,
        avgFillRate: saved.avgFillRate,
        unplacedCount: saved.unplacedCount,
        warnings: result.summary.warnings,
        decisionMode,
      },
    });
  } catch (e: unknown) {
    if (e instanceof SyntaxError) return fail("JSON 파싱 실패", 400);
    const msg = e instanceof Error ? e.message : "적재 계산 실패";
    return fail(msg, 500);
  }
}
