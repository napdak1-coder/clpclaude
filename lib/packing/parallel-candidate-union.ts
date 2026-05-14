import { availableParallelism, cpus, freemem } from "node:os";
import { Worker } from "node:worker_threads";

import {
  __testables,
  CONTAINER_SOFT_OVERFLOW_RATIO,
  packBest,
  type PackBestOptions,
  type PackOptions,
} from "./algorithm.ts";
import { strictStackAudit } from "./audit.ts";
import { getContainerCbm, getContainerSpec } from "./containers.ts";
import type { CargoSpec } from "../../types/cargo.ts";
import type { ContainerType } from "../../types/container.ts";
import type { CLPResult, ContainerMode } from "../../types/plan.ts";

type SortStrategy = NonNullable<PackOptions["sortStrategy"]>;
type ContainerOrder = NonNullable<PackOptions["containerOrder"]>;
type PlacementMode = NonNullable<PackOptions["placementMode"]>;

interface ParallelAttempt {
  id: number;
  candidateSet: ContainerType[];
  candidateRank: number;
  sortStrategy: SortStrategy;
  containerOrder: ContainerOrder;
  placementMode: PlacementMode;
  autoConsolidateCompleted: boolean;
  longAxisAnchorEnabled: boolean;
}

interface WorkerAttemptResult {
  attempt: ParallelAttempt;
  result?: CLPResult;
  error?: string;
  timedOut?: boolean;
}

export interface AdaptiveParallelCandidateUnionOptions {
  /** 직접 지정한 동시 실행 수. 없으면 컴퓨터 상태와 샘플 크기로 자동 산정. */
  parallelism?: number;
  /** 전체 병렬 탐색 시간. 0 이하이면 전체 제한을 두지 않는다. */
  timeBudgetMs?: number;
  /** 한 worker 시도 최대 시간. 0 이하이면 worker별 제한을 두지 않는다. */
  perAttemptTimeoutMs?: number;
  /** 자동 산정 시 허용할 최대 동시 실행 수. */
  maxParallelism?: number;
  /** 사전 단일 배치를 생략하고 후보를 부피에서 바로 만든다. 검증용 병렬 실행에서 사용. */
  skipInitialProbe?: boolean;
}

const DEFAULT_STRATEGIES: SortStrategy[] = [
  "ldf",
  "longest-side",
  "long-cargo-first",
  "largest-footprint-first",
  "no-stacking-first",
  "tallest",
  "widest",
  "input",
  "shortest",
  "shortest-height",
  "heaviest",
  "biggest-cargo-first",
  "booking-cluster-first",
];

const DEFAULT_CONTAINER_ORDERS: ContainerOrder[] = [
  "biggest-first",
  "smallest-first",
];

const DEFAULT_PLACEMENT_MODES: PlacementMode[] = ["wrapper", "pure"];

function resolveCpuCount(): number {
  try {
    return availableParallelism();
  } catch {
    return cpus().length || 2;
  }
}

export function resolveAdaptiveParallelism(
  cargoCount: number,
  attemptCount: number,
  opts: AdaptiveParallelCandidateUnionOptions = {},
): number {
  if (attemptCount <= 1) return 1;
  if (typeof opts.parallelism === "number" && Number.isFinite(opts.parallelism)) {
    return Math.max(1, Math.min(attemptCount, Math.floor(opts.parallelism)));
  }

  const cpuCount = resolveCpuCount();
  const reserveOneCore = Math.max(1, cpuCount - 1);
  const hardMax = Math.max(1, Math.min(opts.maxParallelism ?? 8, reserveOneCore));

  const memoryBudget = Math.max(1, Math.floor(freemem() / (700 * 1024 * 1024)));
  const sampleBudget = cargoCount >= 45 ? 4 : cargoCount >= 25 ? 6 : 3;
  return Math.max(1, Math.min(attemptCount, hardMax, memoryBudget, sampleBudget));
}

function candidateKey(c: ContainerType[]): string {
  return c.slice().sort().join("|");
}

function candidateCapacity(c: ContainerType[]): number {
  return c.reduce((sum, type) => sum + getContainerCbm(getContainerSpec(type)), 0);
}

function hasLongCargo(cargoes: CargoSpec[]): boolean {
  return cargoes.some((c) => {
    const baseMax = Math.max(c.width ?? 0, c.length ?? 0, c.height ?? 0);
    const unitMax = (c.unitSizes ?? []).some(
      (u) => Math.max(u.width ?? 0, u.length ?? 0, u.height ?? 0) >= 300,
    );
    return baseMax >= 300 || unitMax;
  });
}

function buildCandidateSets(
  initial: CLPResult,
  mode: ContainerMode,
): ContainerType[][] {
  const debug = initial.debug;
  if (!debug) return [initial.containers.map((c) => c.spec.type)];

  const uniqueByKey = new Map<string, ContainerType[]>();
  const add = (candidate: ContainerType[]): void => {
    if (candidate.length === 0) return;
    const key = candidateKey(candidate);
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, candidate);
  };

  const declared = debug.userDeclaredTotalCbm;
  const physical = debug.physicalTotalCbm;
  if (declared > 0) {
    for (const c of __testables.generateCandidateContainerSets(declared, mode)) add(c);
  }
  if (physical > 0) {
    for (const c of __testables.generateCandidateContainerSets(physical, mode)) add(c);
  }
  add(initial.containers.map((c) => c.spec.type));
  if (initial.alternative?.containers?.length) {
    add(initial.alternative.containers.map((c) => c.spec.type));
  }

  return Array.from(uniqueByKey.values()).sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return candidateCapacity(a) - candidateCapacity(b);
  });
}

function buildCandidateSetsFromCargoes(
  cargoes: CargoSpec[],
  mode: ContainerMode,
): ContainerType[][] {
  const uniqueByKey = new Map<string, ContainerType[]>();
  const add = (candidate: ContainerType[]): void => {
    if (candidate.length === 0) return;
    const key = candidateKey(candidate);
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, candidate);
  };

  const declared = cargoes.reduce(
    (sum, cargo) =>
      sum + __testables.getDeclaredCbmForContainerDecision(cargo),
    0,
  );
  const physical = cargoes.reduce(
    (sum, cargo) => sum + __testables.cargoCbm(cargo),
    0,
  );
  if (declared > 0) {
    for (const c of __testables.generateCandidateContainerSets(declared, mode)) add(c);
  }
  if (physical > 0) {
    for (const c of __testables.generateCandidateContainerSets(physical, mode)) add(c);
  }

  return Array.from(uniqueByKey.values()).sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return candidateCapacity(a) - candidateCapacity(b);
  });
}

function buildAttempts(
  cargoes: CargoSpec[],
  candidates: ContainerType[][],
  options?: PackBestOptions,
): ParallelAttempt[] {
  const userPinned =
    options?.fixedAssignment != null ||
    typeof options?.completedExclusiveContainerIndex === "number" ||
    options?.autoConsolidateCompleted === false;
  const consolidateModes = userPinned ? [false] : [true, false];
  const longAxisModes = hasLongCargo(cargoes) &&
    options?.longAxisAnchor?.enabled === undefined
    ? [false, true]
    : [options?.longAxisAnchor?.enabled === true];

  const attempts: ParallelAttempt[] = [];
  let id = 1;
  candidates.forEach((candidateSet, candidateRank) => {
    for (const sortStrategy of DEFAULT_STRATEGIES) {
      for (const containerOrder of DEFAULT_CONTAINER_ORDERS) {
        for (const placementMode of DEFAULT_PLACEMENT_MODES) {
          for (const autoConsolidateCompleted of consolidateModes) {
            for (const longAxisAnchorEnabled of longAxisModes) {
              attempts.push({
                id: id++,
                candidateSet,
                candidateRank,
                sortStrategy,
                containerOrder,
                placementMode,
                autoConsolidateCompleted,
                longAxisAnchorEnabled,
              });
            }
          }
        }
      }
    }
  });
  return attempts;
}

function countSplits(r: CLPResult): {
  cargoSplit: number;
  bookingSplit: number;
} {
  const cargoCi = new Map<string, Set<number>>();
  const bookingCi = new Map<string, Set<number>>();
  r.containers.forEach((container, index) => {
    for (const row of container.rows ?? []) {
      for (const item of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (item.cargoId) {
          const set = cargoCi.get(item.cargoId) ?? new Set<number>();
          set.add(index);
          cargoCi.set(item.cargoId, set);
        }
        const bookingNo = (item as { bookingNo?: string }).bookingNo;
        if (bookingNo) {
          const set = bookingCi.get(bookingNo) ?? new Set<number>();
          set.add(index);
          bookingCi.set(bookingNo, set);
        }
      }
    }
    for (const item of container.bulkItems ?? []) {
      if (item.cargoId) {
        const set = cargoCi.get(item.cargoId) ?? new Set<number>();
        set.add(index);
        cargoCi.set(item.cargoId, set);
      }
      const bookingNo = (item as { bookingNo?: string }).bookingNo;
      if (bookingNo) {
        const set = bookingCi.get(bookingNo) ?? new Set<number>();
        set.add(index);
        bookingCi.set(bookingNo, set);
      }
    }
  });
  return {
    cargoSplit: [...cargoCi.values()].filter((set) => set.size > 1).length,
    bookingSplit: [...bookingCi.values()].filter((set) => set.size > 1).length,
  };
}

function isValidResult(r: CLPResult): boolean {
  const unplaced = r.unplaced.reduce((sum, u) => sum + (u.quantity ?? 1), 0);
  if (unplaced > 0) return false;
  const audit = strictStackAudit(r);
  if (!audit.pass || audit.violations.length > 0) return false;
  for (const c of r.containers) {
    const softCap = c.spec.maxCbm * CONTAINER_SOFT_OVERFLOW_RATIO;
    if (c.totalCbm + c.ctCbm > softCap + 0.001) return false;
    if (c.totalWeight > c.spec.maxWeightKg + 0.001) return false;
  }
  const { cargoSplit, bookingSplit } = countSplits(r);
  return cargoSplit === 0 && bookingSplit === 0;
}

function compareResults(a: CLPResult, b: CLPResult): number {
  const keyOf = (r: CLPResult): number[] => {
    const unplaced = r.unplaced.reduce((sum, u) => sum + (u.quantity ?? 1), 0);
    const audit = strictStackAudit(r);
    let hardCbmOverflow = 0;
    let weightOverflow = 0;
    let totalCap = 0;
    for (const c of r.containers) {
      const softCap = c.spec.maxCbm * CONTAINER_SOFT_OVERFLOW_RATIO;
      if (c.totalCbm + c.ctCbm > softCap + 0.001) hardCbmOverflow++;
      if (c.totalWeight > c.spec.maxWeightKg + 0.001) weightOverflow++;
      totalCap += c.spec.maxCbm;
    }
    const { cargoSplit, bookingSplit } = countSplits(r);
    return [
      unplaced,
      audit.pass ? 0 : 1,
      audit.violations.length,
      hardCbmOverflow,
      weightOverflow,
      cargoSplit,
      bookingSplit,
      r.containers.length,
      totalCap,
    ];
  };
  const ak = keyOf(a);
  const bk = keyOf(b);
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return ak[i] - bk[i];
  }
  return 0;
}

function workerExecArgv(): string[] {
  const args = [...process.execArgv];
  if (!args.includes("--experimental-strip-types")) {
    args.push("--experimental-strip-types");
  }
  if (!args.includes("--no-warnings")) {
    args.push("--no-warnings");
  }
  return args;
}

function runAttemptInWorker(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options: PackBestOptions | undefined,
  attempt: ParallelAttempt,
  timeoutMs?: number,
): Promise<WorkerAttemptResult> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./parallel-candidate-union-worker.mjs", import.meta.url),
      { execArgv: workerExecArgv() },
    );
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: WorkerAttemptResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    if (
      typeof timeoutMs === "number" &&
      Number.isFinite(timeoutMs) &&
      timeoutMs > 0
    ) {
      timer = setTimeout(() => {
        finish({ attempt, timedOut: true, error: "parallel attempt timed out" });
      }, Math.max(1_000, timeoutMs));
    }

    worker.once("message", (message) => {
      if (message?.ok) {
        finish({ attempt, result: message.result as CLPResult });
      } else {
        finish({ attempt, error: message?.error ?? "parallel worker failed" });
      }
    });
    worker.once("error", (error) => {
      finish({ attempt, error: error.message });
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        finish({ attempt, error: `parallel worker exited: ${code}` });
      }
    });
    worker.postMessage({
      id: attempt.id,
      cargoes,
      mode,
      options,
      candidateSet: attempt.candidateSet,
      sortStrategy: attempt.sortStrategy,
      containerOrder: attempt.containerOrder,
      placementMode: attempt.placementMode,
      autoConsolidateCompleted: attempt.autoConsolidateCompleted,
      longAxisAnchorEnabled: attempt.longAxisAnchorEnabled,
    });
  });
}

async function runAttempts(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options: PackBestOptions | undefined,
  attempts: ParallelAttempt[],
  parallelism: number,
  timeBudgetMs?: number,
  perAttemptTimeoutMs?: number,
): Promise<WorkerAttemptResult[]> {
  const results: WorkerAttemptResult[] = [];
  const startedAt = Date.now();
  const hasOverallBudget =
    typeof timeBudgetMs === "number" &&
    Number.isFinite(timeBudgetMs) &&
    timeBudgetMs > 0;
  const hasAttemptBudget =
    typeof perAttemptTimeoutMs === "number" &&
    Number.isFinite(perAttemptTimeoutMs) &&
    perAttemptTimeoutMs > 0;
  let nextIndex = 0;
  let bestValidRank = Number.POSITIVE_INFINITY;

  const next = async (): Promise<void> => {
    while (nextIndex < attempts.length) {
      if (hasOverallBudget && Date.now() - startedAt > timeBudgetMs) return;
      const attempt = attempts[nextIndex++];
      if (attempt.candidateRank >= bestValidRank) continue;
      const remaining = hasOverallBudget
        ? timeBudgetMs - (Date.now() - startedAt)
        : undefined;
      const timeout =
        remaining !== undefined && hasAttemptBudget
          ? Math.min(perAttemptTimeoutMs, remaining)
          : remaining ?? (hasAttemptBudget ? perAttemptTimeoutMs : undefined);
      const result = await runAttemptInWorker(
        cargoes,
        mode,
        options,
        attempt,
        timeout,
      );
      results.push(result);
      if (result.result && isValidResult(result.result)) {
        bestValidRank = Math.min(bestValidRank, attempt.candidateRank);
      }
    }
  };

  const workers = Array.from(
    { length: Math.max(1, parallelism) },
    () => next(),
  );
  await Promise.all(workers);
  return results;
}

export async function packBestWithAdaptiveParallelCandidateUnion(
  cargoes: CargoSpec[],
  mode: ContainerMode,
  options?: PackBestOptions,
  parallelOptions: AdaptiveParallelCandidateUnionOptions = {},
): Promise<CLPResult> {
  if (options?.fixedContainers && options.fixedContainers.length > 0) {
    return packBest(cargoes, mode, options);
  }

  const initial = parallelOptions.skipInitialProbe
    ? undefined
    : packBest(cargoes, mode, { ...options, attachDebug: true });
  const candidates = initial
    ? buildCandidateSets(initial, mode)
    : buildCandidateSetsFromCargoes(cargoes, mode);
  const attempts = buildAttempts(cargoes, candidates, options);
  if (attempts.length === 0) {
    return initial ?? packBest(cargoes, mode, options);
  }
  if (initial && isValidResult(initial)) return initial;

  const parallelism = resolveAdaptiveParallelism(
    cargoes.length,
    attempts.length,
    parallelOptions,
  );
  const timeBudgetMs =
    parallelOptions.timeBudgetMs === undefined
      ? 180_000
      : parallelOptions.timeBudgetMs;

  let best = initial;
  try {
    const results = await runAttempts(
      cargoes,
      mode,
      options,
      attempts,
      parallelism,
      timeBudgetMs,
      parallelOptions.perAttemptTimeoutMs,
    );
    for (const item of results) {
      if (!item.result) continue;
      if (!best || compareResults(item.result, best) < 0) best = item.result;
    }
  } catch (error) {
    const fallback = best ?? packBest(cargoes, mode, options);
    fallback.summary.warnings.push(
      `병렬 탐색 실패로 기본 결과를 사용했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }

  if (!best) {
    const fallback = packBest(cargoes, mode, options);
    fallback.summary.warnings.push(
      "병렬 탐색 결과가 없어 기본 결과를 사용했습니다",
    );
    return fallback;
  }

  return best;
}

export const __parallelTestables = {
  buildAttempts,
  buildCandidateSets,
  buildCandidateSetsFromCargoes,
  compareResults,
  isValidResult,
};
