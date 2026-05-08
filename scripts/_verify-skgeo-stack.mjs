/**
 * 컨2 행 4의 SK GEO 위에 미배치 SK GEO 박스를 올릴 수 있는지 정확히 검증.
 * 각 룰별 통과/실패 사유 출력.
 */
import fs from "node:fs";
import path from "node:path";
const { pack } = await import("../lib/packing/algorithm.ts");
const { tryPlaceUnit } = await import("../lib/packing/extreme-point.ts");

const sample = JSON.parse(fs.readFileSync(path.resolve("data/samples/singapore-total-3.json"), "utf8"));

const cargoes = sample.rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

const fixedAssignment = {};
cargoes.forEach((c, i) => { fixedAssignment[c.id] = i < 19 ? 1 : 2; });

const result = pack(cargoes, "auto", { fixedContainers: ["40FT", "40FT"], fixedAssignment });

console.log("=== 컨2 SK GEO 박스 분석 ===");

const cont = result.containers[1]; // 컨2
const spec = cont.spec;
console.log(`컨2 spec: ${spec.innerWidth}×${spec.innerLength}×${spec.innerHeight}`);

// 컨2 안의 모든 placement (rows에서 재구성)
const placements = [];
for (const row of cont.rows) {
  for (const it of row.bottomItems) placements.push({ ...it });
  for (const it of row.topItems) placements.push({ ...it });
}
console.log(`\n총 placement: ${placements.length}`);

// SK GEO 박스 찾기
const skgeoPlacements = placements.filter(p => p.cargoId === "sg3-35");
console.log(`\n--- 컨2 SK GEO 배치된 박스 ${skgeoPlacements.length}개 ---`);
for (const p of skgeoPlacements) {
  console.log(`  cargoId=${p.cargoId} x=${p.position.x} y=${p.position.y} z=${p.position.z}`);
  console.log(`    크기: ${p.size.width}×${p.size.length}×${p.size.height}`);
  console.log(`    무게: ${p.weight}kg`);
  console.log(`    노스택: ${p.remarks?.noStacking ?? false}, 무겁기below: ${p.remarks?.heavierBelow ?? false}`);
}

console.log(`\n--- 미배치 박스 ---`);
for (const u of result.unplaced) {
  console.log(`  cargoId=${u.cargoId} unitId=${u.unitId} ${u.width}×${u.length}×${u.height} ${u.weight}kg`);
}

// 미배치 SK GEO 박스
const unplacedSkgeo = result.unplaced.find(u => u.cargoId === "sg3-35");
if (!unplacedSkgeo) {
  console.log("미배치 SK GEO 없음 — 0 미배치 달성");
  process.exit(0);
}

// 컨2 SK GEO 중 같은 사이즈 (135×115×129) 찾기
const sameSize = skgeoPlacements.find(p =>
  p.size.width === unplacedSkgeo.width &&
  p.size.length === unplacedSkgeo.length &&
  p.size.height === unplacedSkgeo.height
);

if (!sameSize) {
  console.log(`\n같은 사이즈 SK GEO 없음 — 회전 필요?`);
  // 회전된 면 매칭 시도
  for (const p of skgeoPlacements) {
    const dims = [p.size.width, p.size.length, p.size.height].sort();
    const udims = [unplacedSkgeo.width, unplacedSkgeo.length, unplacedSkgeo.height].sort();
    if (dims[0] === udims[0] && dims[1] === udims[1] && dims[2] === udims[2]) {
      console.log(`회전 가능: 배치된 (${p.size.width}×${p.size.length}×${p.size.height}) ↔ 미배치 (${unplacedSkgeo.width}×${unplacedSkgeo.length}×${unplacedSkgeo.height})`);
    }
  }
  process.exit(0);
}

console.log(`\n=== 같은 사이즈 SK GEO 발견 ===`);
console.log(`기존 박스: x=${sameSize.position.x} y=${sameSize.position.y} z=${sameSize.position.z}, ${sameSize.size.width}×${sameSize.size.length}×${sameSize.size.height}, ${sameSize.weight}kg`);

// 위에 올리는 후보 좌표
const stackX = sameSize.position.x;
const stackY = sameSize.position.y;
const stackZ = sameSize.position.z + sameSize.size.height;
const stackW = unplacedSkgeo.width;
const stackL = unplacedSkgeo.length;
const stackH = unplacedSkgeo.height;
console.log(`\n=== 후보 위치: x=${stackX} y=${stackY} z=${stackZ}, ${stackW}×${stackL}×${stackH} ===`);

// 각 룰 검증
const EPS = 0.5;

// 1. height
const topZ = stackZ + stackH;
console.log(`\n[1] 높이 룰 (top z ${topZ} ≤ 컨테이너 높이 ${spec.innerHeight}cm)`);
console.log(`    ${topZ <= spec.innerHeight ? "✅ 통과" : `❌ 실패 (${topZ - spec.innerHeight}cm 초과)`}`);

// 2. width / length 경계
console.log(`\n[2] 폭·길이 경계 (x+w ${stackX + stackW} ≤ ${spec.innerWidth}, y+l ${stackY + stackL} ≤ ${spec.innerLength})`);
const widthOK = stackX + stackW <= spec.innerWidth + EPS;
const lengthOK = stackY + stackL <= spec.innerLength + EPS;
console.log(`    폭: ${widthOK ? "✅" : "❌"}, 길이: ${lengthOK ? "✅" : "❌"}`);

// 3. 충돌 검사
console.log(`\n[3] 충돌 검사 (이 자리에 다른 박스 있나)`);
let collision = null;
for (const p of placements) {
  const overlap =
    stackX < p.position.x + p.size.width - EPS &&
    p.position.x < stackX + stackW - EPS &&
    stackY < p.position.y + p.size.length - EPS &&
    p.position.y < stackY + stackL - EPS &&
    stackZ < p.position.z + p.size.height - EPS &&
    p.position.z < stackZ + stackH - EPS;
  if (overlap) { collision = p; break; }
}
console.log(`    ${collision ? `❌ 실패 — 박스 ${collision.cargoId} 와 겹침 (x${collision.position.x}~${collision.position.x+collision.size.width}, y${collision.position.y}~${collision.position.y+collision.size.length}, z${collision.position.z}~${collision.position.z+collision.size.height})` : "✅ 통과"}`);

// 4. 받침면 (5점)
console.log(`\n[4] 받침면 검사 (5점 — 4모서리 + 중심)`);
const points = [
  { x: stackX + EPS, y: stackY + EPS, label: "좌하" },
  { x: stackX + stackW - EPS, y: stackY + EPS, label: "우하" },
  { x: stackX + EPS, y: stackY + stackL - EPS, label: "좌상" },
  { x: stackX + stackW - EPS, y: stackY + stackL - EPS, label: "우상" },
  { x: stackX + stackW / 2, y: stackY + stackL / 2, label: "중심" },
];
let supported = 0;
for (const pt of points) {
  const sup = placements.find(p =>
    Math.abs(p.position.z + p.size.height - stackZ) < EPS &&
    pt.x >= p.position.x - EPS && pt.x <= p.position.x + p.size.width + EPS &&
    pt.y >= p.position.y - EPS && pt.y <= p.position.y + p.size.length + EPS
  );
  console.log(`    ${pt.label} (${pt.x.toFixed(1)},${pt.y.toFixed(1)}): ${sup ? `✅ 받침 ${sup.cargoId}` : "❌ 안 받쳐짐"}`);
  if (sup) supported++;
}
console.log(`    합계: ${supported}/5 ${supported === 5 ? "✅ 통과 (100%)" : "❌ 실패"}`);

// 5. noStacking 룰
console.log(`\n[5] noStacking 룰 (받침 박스 위에 못 쌓음 표시?)`);
const supBox = placements.find(p =>
  Math.abs(p.position.z + p.size.height - stackZ) < EPS &&
  stackX + EPS >= p.position.x && stackX + stackW - EPS <= p.position.x + p.size.width &&
  stackY + EPS >= p.position.y && stackY + stackL - EPS <= p.position.y + p.size.length
);
const noStack = supBox?.remarks?.noStacking ?? false;
console.log(`    받침 박스 noStacking: ${noStack ? "❌ 실패 (위에 못 쌓음)" : "✅ 통과"}`);

// 6. heavierBelow 룰
console.log(`\n[6] 무거운 거 아래 룰 (위 박스 무게 ≤ 아래 박스 무게)`);
const upperWeight = unplacedSkgeo.weight;
const lowerWeight = sameSize.weight;
console.log(`    아래: ${lowerWeight}kg, 위: ${upperWeight}kg`);
console.log(`    ${upperWeight <= lowerWeight + EPS ? "✅ 통과" : "❌ 실패 (위가 더 무거움)"}`);

// 7. 종합 판정 — 모든 룰 통과 시 알고리즘이 왜 못 찾았는지 결론
console.log(`\n[7] 종합`);
const allChecks = [
  topZ <= spec.innerHeight,
  widthOK,
  lengthOK,
  !collision,
  supported >= 5,
  !noStack,
  upperWeight <= lowerWeight + EPS,
];
const failed = allChecks.filter(c => !c).length;
if (failed === 0) {
  console.log(`    ✅ 모든 룰 통과 — 이 자리는 물리적으로 가능`);
  console.log(`    → 알고리즘이 이 후보를 평가하지 못함 (extreme point 후보에서 누락 또는 행 fitting 미시도)`);
} else {
  console.log(`    ❌ ${failed}개 룰 실패 — 위 단계별 결과 참고`);
}
