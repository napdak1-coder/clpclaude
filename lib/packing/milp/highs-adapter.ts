/**
 * HiGHS-js (WASM) adapter — LP/MILP solver loader + 헬퍼.
 *
 * 설치: `npm install highs`
 * Node + Vercel WASM 환경 호환.
 *
 * 절대 룰:
 *   - 점수화 X — solver 의 objective 는 lex hierarchical 만 사용 (외부 호출자가 lex round 별 호출).
 *   - 하드코딩 X — 호출자가 generic 모델 빌드 후 LP string 전달.
 *
 * 단일 인스턴스 caching — load 비용 한 번만.
 */

// dynamic import 로 ESM/CJS 호환
let highsInstance: { solve: (problem: string, options?: Record<string, unknown>) => HighsSolution } | null = null;

export interface HighsColumn {
  Index: number;
  Status: string;
  Lower: number;
  Upper: number;
  Type: string;
  Primal: number;
  Dual: number;
  Name: string;
}

export interface HighsRow {
  Index: number;
  Name: string;
  Status: string;
  Lower: number;
  Upper: number;
  Primal: number;
  Dual: number;
}

export interface HighsSolution {
  Status: string; // "Optimal" | "Infeasible" | ...
  ObjectiveValue: number;
  Columns: Record<string, HighsColumn>;
  Rows: HighsRow[];
}

/**
 * HiGHS 인스턴스 lazy load. Node 에서는 locateFile 불필요.
 */
async function loadHighs(): Promise<{ solve: (problem: string, options?: Record<string, unknown>) => HighsSolution }> {
  if (highsInstance) return highsInstance;
  const mod = await import("highs");
  const factory = (mod as unknown as { default: (settings?: Record<string, unknown>) => Promise<{ solve: (p: string, o?: Record<string, unknown>) => HighsSolution }> }).default;
  highsInstance = await factory();
  return highsInstance!;
}

/**
 * LP 문자열 (CPLEX .lp format) 으로 솔버 호출.
 *
 * @param lpString CPLEX .lp format LP/MILP 문제
 * @param timeLimitSec 시간 제한 (초). 기본 5초.
 * @returns HighsSolution. Status === "Optimal" 이면 변수 값 사용 가능.
 */
export async function solveLp(
  lpString: string,
  timeLimitSec = 5,
): Promise<HighsSolution> {
  const highs = await loadHighs();
  return highs.solve(lpString, {
    time_limit: timeLimitSec,
    presolve: "on",
  });
}

/**
 * 빠른 가용성 확인 — HiGHS 가 환경에서 작동하는지 smoke test.
 */
export async function isHighsAvailable(): Promise<boolean> {
  try {
    const sol = await solveLp(
      `Minimize\n obj: x\nSubject To\n c1: x >= 1\nBounds\n 0 <= x\nEnd`,
      1,
    );
    return sol.Status === "Optimal" && Math.abs(sol.ObjectiveValue - 1) < 0.001;
  } catch {
    return false;
  }
}
