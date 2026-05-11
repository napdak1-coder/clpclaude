/**
 * HiGHS-js 스모크 테스트 — Node 환경에서 LP 문제 풀이 확인.
 * 간단한 LP: maximize x + 2y subject to x + y ≤ 10, x ≥ 0, y ≥ 0.
 * 정답: x=0, y=10, obj=20.
 */
import highsLoader from "highs";

console.log("HiGHS 모듈 로딩 시작...");
const highs = await highsLoader();
console.log("HiGHS 로딩 완료.");

const PROBLEM = `Maximize
 obj:
    x + 2 y
Subject To
 c1: x + y <= 10
Bounds
 0 <= x
 0 <= y
End`;

const t0 = Date.now();
const sol = highs.solve(PROBLEM);
const ms = Date.now() - t0;

console.log(`풀이 시간: ${ms}ms`);
console.log("Status:", sol.Status);
console.log("ObjectiveValue:", sol.ObjectiveValue);
console.log("x =", sol.Columns.x?.Primal);
console.log("y =", sol.Columns.y?.Primal);

if (sol.Status === "Optimal" && Math.abs(sol.ObjectiveValue - 20) < 0.001) {
  console.log("\n✅ HiGHS-js 정상 작동 (Node 환경)");
} else {
  console.log("\n❌ 결과 예상치 다름");
}
