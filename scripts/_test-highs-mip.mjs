import highsLoader from "highs";

const highs = await highsLoader();

const PROBLEM = `Minimize
 obj: x

Subject To
 c1: x + 100 b <= 50
 c2: x >= 1

Bounds
 0 <= x <= 100

Binary
 b

End`;

const sol = highs.solve(PROBLEM);
console.log(JSON.stringify(sol, null, 2));
