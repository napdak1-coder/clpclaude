import fs from "node:fs";
import highsLoader from "highs";

const highs = await highsLoader();
const lp = fs.readFileSync("/tmp/sub-milp.lp", "utf8");
console.log(`LP 길이: ${lp.length} 문자, ${lp.split("\n").length} 줄`);

try {
  const sol = highs.solve(lp);
  console.log("Status:", sol.Status);
} catch (e) {
  console.log("Error:", e.message);
  // 절반씩 줄이며 binary search 로 syntax 오류 위치 찾기
  const lines = lp.split("\n");
  // Find Subject To section
  const stIdx = lines.indexOf("Subject To");
  const bIdx = lines.indexOf("Bounds");
  console.log(`Subject To: ${stIdx}, Bounds: ${bIdx}`);
  // Try with fewer constraints (test minimal LP)
  const minimal = `Minimize\n obj: x\nSubject To\n c1: x >= 1\nBounds\n 0 <= x <= 100\nEnd`;
  console.log("\n최소 LP test...");
  const sol2 = highs.solve(minimal);
  console.log("최소 LP Status:", sol2.Status);
}
