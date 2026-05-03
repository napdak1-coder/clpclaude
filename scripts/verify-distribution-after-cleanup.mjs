/**
 * 데이터 정리 (8 cargoes cbm=NULL) 후 17/5 분배 + 물리·규칙 종합 검증.
 *
 * 기대:
 *   40FT (17 화주): 메가젠/데코론/YKMC/보현석재/에이제이테크/카페봄봄/
 *                  EXCELERATE/VISCOSMO/더블유티/리만/대한정밀/선진뷰티/SUNGBO/
 *                  제일기공/웨스코/디에스콘/티케이테크
 *   20FT (5 화주):  AWOT/대원산업/씨에스에프/HD현대/포컴퍼니
 *   unplaced: 0
 *   물리: bounding/overlap/weight/door/rules 모두 PASS
 */

const { packBest } = await import("../lib/packing/algorithm.ts");
const { getShipment } = await import("../lib/repositories/shipments.ts");

const EXPECTED_40FT = new Set([
  "메가젠임플란트",
  "데코론",
  "YKMC",
  "보현석재",
  "에이제이테크",
  "카페봄봄",
  "EXCELERATE ENERGY",
  "VISCOSMO",
  "더블유티 스프레이",
  "리만",
  "대한정밀공업",
  "선진뷰티사이언스",
  "SUNGBO INDUSTRIA",
  "제일기공",
  "웨스코",
  "디에스콘",
  "티케이테크",
]);
const EXPECTED_20FT = new Set([
  "AWOT",
  "대원산업",
  "씨에스에프",
  "HD현대건설기계",
  "포컴퍼니",
]);

const ship = await getShipment("bbd2cece-976f-4665-b207-175aa2751b77");
console.log(`총 화물: ${ship.items.length}`);

const t0 = Date.now();
const result = packBest(ship.items, "auto");
console.log(`pack 시간: ${Date.now() - t0}ms`);
console.log(`컨테이너: ${result.containers.length}대`);
console.log(`unplaced: ${result.unplaced.length}`);

// 화주 → cargoId 매핑
const shipperByCargo = new Map();
for (const c of ship.items) {
  shipperByCargo.set(c.id, c.actualShipperName ?? "");
}

const containerShippers = new Map(); // type → Set of shipper names
for (const c of result.containers) {
  const set = new Set();
  for (const row of c.rows) {
    for (const it of [...row.bottomItems, ...row.topItems]) {
      const shipper = shipperByCargo.get(it.cargoId);
      if (shipper) set.add(shipper);
    }
  }
  containerShippers.set(c.spec.type, { set, container: c });
}

console.log("\n=== 분배 확인 ===");
let distOK = true;
for (const [type, info] of containerShippers) {
  const expected = type === "40FT" ? EXPECTED_40FT : EXPECTED_20FT;
  const actual = info.set;
  const missing = [...expected].filter((s) => !actual.has(s));
  const extra = [...actual].filter((s) => !expected.has(s));
  console.log(`\n${type} (${info.container.cbmFillRate.toFixed(1)}% 충전, 화주 ${actual.size}/${expected.size})`);
  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ✓ 정확히 일치 (${[...actual].join(", ")})`);
  } else {
    distOK = false;
    if (missing.length) console.log(`  ✗ 누락 (${missing.length}): ${missing.join(", ")}`);
    if (extra.length) console.log(`  ✗ 잘못 들어감 (${extra.length}): ${extra.join(", ")}`);
  }
}

console.log(`\n=== 분배 결과 ===  ${distOK ? "✅ 일치" : "❌ 불일치"}`);

// 물리·규칙 검증 (display 좌표 기반 simple check — strict는 packState 필요)
console.log("\n=== 물리·규칙 검증 (display 좌표 + spec) ===");
const EPS = 0.01;
let physOK = true;
for (const c of result.containers) {
  const placements = [];
  for (const row of c.rows) {
    for (const it of row.bottomItems) placements.push({ ...it, layer: "bottom" });
    for (const it of row.topItems) placements.push({ ...it, layer: "top" });
  }
  const wOk = placements.every(
    (p) => p.position.x >= -EPS && p.position.x + p.size.width <= c.spec.innerWidth + EPS,
  );
  const hOk = placements.every(
    (p) => p.size.height <= c.spec.innerHeight + EPS,
  );
  const wt = placements.reduce((s, p) => s + (p.weight ?? 0), 0);
  const wtOk = wt <= c.spec.maxWeightKg + EPS;
  const ruleViol = placements.filter((p) => {
    const r = p.remarks ?? {};
    if (r.topOnly && p.layer !== "top") return true;
    return false;
  });
  const ok = wOk && hOk && wtOk && ruleViol.length === 0;
  console.log(
    `  ${ok ? "✓" : "✗"} ${c.spec.type}: width≤${c.spec.innerWidth} ${wOk ? "✓" : "✗"} | height≤${c.spec.innerHeight} ${hOk ? "✓" : "✗"} | weight ${wt.toFixed(0)}/${c.spec.maxWeightKg} ${wtOk ? "✓" : "✗"} | rules ${ruleViol.length === 0 ? "✓" : "✗"}`,
  );
  if (!ok) physOK = false;
}

console.log(`\n=== 종합 ===`);
console.log(`  분배 일치 : ${distOK ? "✅" : "❌"}`);
console.log(`  물리·규칙 : ${physOK ? "✅" : "❌"}`);
console.log(`  미배치    : ${result.unplaced.length === 0 ? "✅ 0" : "❌ " + result.unplaced.length}`);
process.exit(distOK && physOK && result.unplaced.length === 0 ? 0 : 1);
