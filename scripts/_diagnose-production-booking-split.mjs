/* 3차 단계 1 — 현재 production packBest booking split 실측 (10 샘플).
 *
 * 목표:
 *   같은 bookingNo가 ≥ 2 컨테이너에 분산되는지 production 기본 경로에서 확인.
 *   bookingSplit > 0 이 있으면 절대 룰 위반 후보로 별도 보고.
 *
 * read-only — production 알고리즘 호출만, 코드 수정 없음.
 *
 * 출력 (각 샘플 별):
 *   - sampleName / containerSet / unplacedCount
 *   - cargoIdSplitCount / bookingSplitCount
 *   - split 된 bookingNo + 그 booking 의 cargoId + 분산된 컨 인덱스
 *   - summary.b2Violations
 *   - strictAuditPass / cbmOverflow / weightOverflow
 *   - packTime
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { packBest } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

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

function countSplits(result) {
  const cargoCi = new Map();
  const bkCi = new Map();
  result.containers.forEach((c, ci) => {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          const s = cargoCi.get(it.cargoId) ?? new Set();
          s.add(ci);
          cargoCi.set(it.cargoId, s);
        }
        const bk = it.bookingNo;
        if (bk) {
          const s = bkCi.get(bk) ?? new Set();
          s.add(ci);
          bkCi.set(bk, s);
        }
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId) {
        const s = cargoCi.get(b.cargoId) ?? new Set();
        s.add(ci);
        cargoCi.set(b.cargoId, s);
      }
      const bk = b.bookingNo;
      if (bk) {
        const s = bkCi.get(bk) ?? new Set();
        s.add(ci);
        bkCi.set(bk, s);
      }
    }
  });
  const cargoSplit = [...cargoCi.values()].filter((s) => s.size > 1).length;
  const bookingSplit = [...bkCi.values()].filter((s) => s.size > 1).length;
  return { cargoSplit, bookingSplit, cargoCi, bkCi };
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 3차 단계 1 — production packBest booking split 실측 ===");
log(`date: ${new Date().toISOString()}`);
log(`engine: packBest 단독 (production 기본 경로)`);
log("");
log("| sample | rows | 컨 셋 | unpl | cargoSplit | **bookingSplit** | audit | cbmOver | wtOver | pack(s) |");
log("|---|---:|---|---:|---:|---:|---|---:|---:|---:|");

const summary = [];

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    log(`| ${s.id} | — | SKIP | | | | | | | |`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);

  const t0 = Date.now();
  const result = packBest(cargoes, "auto");
  const dt = (Date.now() - t0) / 1000;

  const splits = countSplits(result);
  const audit = strictStackAudit(result);

  let cbmOver = 0;
  let wtOver = 0;
  for (const c of result.containers) {
    if ((c.totalCbm ?? 0) + (c.ctCbm ?? 0) > c.spec.maxCbm + 0.001) cbmOver++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) wtOver++;
  }

  const set = result.containers.map((c) => c.spec.type).join("+");
  const unpl = result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  const b2 = result.summary?.b2Violations ?? "—";

  log(
    `| ${s.id} | ${cargoes.length} | ${set} | ${unpl} | ${splits.cargoSplit} | **${splits.bookingSplit}** | ${audit.pass ? "PASS" : `FAIL(${audit.violations.length})`} | ${cbmOver} | ${wtOver} | ${dt.toFixed(1)} |`,
  );

  // booking split 발생 시 상세
  if (splits.bookingSplit > 0) {
    log("");
    log(`  ### ${s.id} booking split 상세:`);
    for (const [bk, ciSet] of splits.bkCi.entries()) {
      if (ciSet.size <= 1) continue;
      // 이 booking 의 cargoId 들 + 각 cargoId 가 어느 컨에 갔는지
      const cargoesInBooking = cargoes.filter((c) => c.bookingNo === bk);
      const cargoMap = cargoesInBooking.map((c) => {
        const ci = splits.cargoCi.get(c.id);
        const arr = ci ? [...ci] : ["미"];
        return `${c.id}(${c.actualShipperName || "?"})→${arr.map((x) => x === "미" ? "미" : `컨${x + 1}`).join(",")}`;
      });
      log(`    booking=${bk} 분산 컨=[${[...ciSet].map((c) => `컨${c + 1}`).join(",")}], cargo: ${cargoMap.join(" / ")}`);
    }
    log("");
  }

  summary.push({
    id: s.id,
    set,
    unpl,
    cargoSplit: splits.cargoSplit,
    bookingSplit: splits.bookingSplit,
    auditPass: audit.pass,
    cbmOver,
    wtOver,
    packSec: dt,
    b2: b2,
  });
}

log("");
log("=== 종합 ===");
const anyBookingSplit = summary.some((s) => s.bookingSplit > 0);
const anyCargoSplit = summary.some((s) => s.cargoSplit > 0);
const anyAuditFail = summary.some((s) => !s.auditPass);
const anyCbmOver = summary.some((s) => s.cbmOver > 0);
const anyWtOver = summary.some((s) => s.wtOver > 0);

log(`- booking split 있음: ${anyBookingSplit ? `❌ YES (절대 룰 위반 후보!)` : "✅ NO"}`);
log(`- cargo split 있음:   ${anyCargoSplit ? "❌ YES" : "✅ NO"}`);
log(`- audit fail 있음:    ${anyAuditFail ? "❌ YES" : "✅ NO"}`);
log(`- CBM overflow 있음:  ${anyCbmOver ? "❌ YES" : "✅ NO"}`);
log(`- weight overflow:    ${anyWtOver ? "❌ YES" : "✅ NO"}`);

log("");
log("=== 판정 ===");
if (!anyBookingSplit && !anyCargoSplit && !anyAuditFail && !anyCbmOver && !anyWtOver) {
  log("✅ production packBest 기본 경로에서 절대 룰 모두 통과 — E0/E1/E2 실험 진행 가능");
} else {
  log("❌ 절대 룰 위반 발견 — E0/E1/E2 실험 전 별도 보고 필요");
}

const outPath = path.resolve("scripts/_diagnose-production-booking-split-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
