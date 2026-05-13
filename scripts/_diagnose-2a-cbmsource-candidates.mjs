/* 2차-A 진단 — cbmSource 가 declared 후보 생성에 미치는 효과 확인.
 *
 * 1) production 경로 (packBest 단독) — 10 샘플 회귀 확인 (변화 없어야 함)
 * 2) packBestWithCandidateUnion — 선별 샘플에서 declared/physical 후보 분포 확인
 *    - 망작 SG: 40FT 1대 후보가 살아나는지
 *    - 4ST HM: 40+40+20 후보가 살아나는지
 *    - 5ST SG: declared 후보 확인 (자동값 다수 행)
 *
 * 3ST SG candidateUnion 은 시간 폭증 위험 — pack() 단독만 확인.
 */
import fs from "node:fs";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, packBestWithCandidateUnion } = algo;

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-2", name: "2ST SG", file: "data/samples/singapore-total-2.json" },
  { id: "sg-3", name: "3ST SG", file: "data/samples/singapore-total-3.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
  { id: "hm-1", name: "1ST HM", file: "data/samples/hochiminh-total.json" },
  { id: "hm-2", name: "2ST HM", file: "data/samples/hochiminh-total-2.json" },
  { id: "hm-3", name: "3ST HM", file: "data/samples/hochiminh-total-3.json" },
  { id: "hm-4", name: "4ST HM", file: "data/samples/hochiminh-total-4.json" },
];

// candidateUnion 시도할 샘플 (시간 폭증 가능 샘플 제외)
const UNION_SAMPLES = new Set(["mangjak", "hm-4", "sg-5"]);

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
    itemName: r.itemName || null,
    actualShipperName: r.actualShipperName ?? "",
    shipperName: r.shipperName ?? "",
    width: r.widthCm ?? 0,
    length: r.lengthCm ?? 0,
    height: r.heightCm ?? 0,
    quantity: Math.max(1, r.quantity ?? 1),
    weightPerUnit: r.weightPerUnitKg ?? 0,
    cbm: r.cbm ?? null,
    aboutCbm: r.aboutCbm ?? null,
    cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
    bookingNo: r.bookingNo || undefined,
    unitSizes: r.unitSizes,
    remarks: {
      noStacking: r.noStacking ?? false,
      topOnly: r.topOnly ?? false,
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    },
    itemRemark: r.itemRemark ?? "",
  }));
}

console.log("=== 2차-A 진단: cbmSource → 컨 셋 후보 생성 효과 ===");
console.log(`date: ${new Date().toISOString()}`);
console.log("");

// 1) production 경로 (packBest 단독) — 회귀 확인
console.log("## 1) production 경로 pack() — 회귀 확인");
console.log("| sample | rows | 컨 셋 | bulk | unpl | pack(s) |");
console.log("|---|---:|---|---:|---:|---:|");
for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    console.log(`| ${s.id} | — | SKIP | — | — | — |`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const t0 = Date.now();
  const r = pack(cargoes, "auto");
  const dt = (Date.now() - t0) / 1000;
  const set = r.containers.map((c) => c.spec.type).join("+");
  const bulk = r.containers.reduce((a, c) => a + (c.bulkItems?.length ?? 0), 0);
  const unpl = r.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  console.log(
    `| ${s.id} | ${cargoes.length} | ${set} | ${bulk} | ${unpl} | ${dt.toFixed(1)} |`,
  );
}

// 2) packBestWithCandidateUnion (선별 샘플)
console.log("");
console.log("## 2) packBestWithCandidateUnion — declared/physical 후보 진단");
for (const s of SAMPLES) {
  if (!UNION_SAMPLES.has(s.id)) continue;
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  console.log("");
  console.log(`### ${s.id} (${s.name})`);
  const t0 = Date.now();
  const r = packBestWithCandidateUnion(cargoes, "auto", { attachDebug: true });
  const dt = (Date.now() - t0) / 1000;
  const set = r.containers.map((c) => c.spec.type).join("+");
  const bulk = r.containers.reduce((a, c) => a + (c.bulkItems?.length ?? 0), 0);
  const unpl = r.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  console.log(`- 최종: ${set} (bulk=${bulk}, unpl=${unpl}, pack=${dt.toFixed(1)}s)`);
  const debug = r.debug;
  if (debug) {
    console.log(
      `- userDeclaredTotalCbm: ${debug.userDeclaredTotalCbm.toFixed(3)} m³  (CFS→ABOUT→system)`,
    );
    console.log(
      `- physicalTotalCbm    : ${debug.physicalTotalCbm.toFixed(3)} m³  (W×L×H 만)`,
    );
    console.log(
      `- candidatesEvaluated : ${debug.candidatesEvaluated.length}건`,
    );
    for (const c of debug.candidatesEvaluated) {
      const reasons = "failReasons" in c ? ` (failReasons: ${c.failReasons.join(",")})` : "";
      console.log(
        `    - ${c.types.join("+")} (cap ${c.capacity}m³) basis=${c.basis} status=${c.status}${reasons}`,
      );
    }
  }
}

console.log("");
console.log("## 검증 포인트");
console.log("- 망작 SG: 40FT 1대 후보가 시도되는지? (declared 60 m³ → decideContainers 40FT 1대 가능)");
console.log("- 4ST HM: 40+40+20 후보가 시도되는지? (declared 더 작으면 작은 셋 valid 가능)");
console.log("- 5ST SG: declared 합이 calculated 행 때문에 system CBM 으로 폴백되는지");
console.log("- 3ST SG: 시간 폭증 위험으로 pack() 단독만 (회귀 0 유지)");
