/* 3차 — 잔여 미배치 cargo 정밀 진단 (read-only).
 *
 * 대상:
 *   1. sg-4-4 (4ST SG, E3 잔여)
 *   2. sg-5 잔여 (E3 base 에서 미배치 3 cargo)
 *   3. sg-1 E8 성공 케이스 (비교용)
 *
 * 산출:
 *   - cargo 속성 (W/L/H, qty, weight, booking, noStacking 등)
 *   - bookingAnchor 추정 (같은 booking 다른 cargo 가 들어간 컨)
 *   - 각 컨테이너 잔여 공간 + cargo 가 그 컨 잔여 공간 안 들어가는지 dim 검사
 *   - cargo 가 어느 컨에서도 회전 후 들어가는 모서리 있는지
 *
 * read-only — production 코드 / algorithm 수정 없음.
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, packBestWithCandidateUnion, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;

const SAMPLES = [
  { id: "sg-1", file: "data/samples/singapore-total.json", focus: "success" },
  { id: "sg-4", file: "data/samples/singapore-total-4.json", focus: "residual" },
  { id: "sg-5", file: "data/samples/singapore-total-5.json", focus: "residual" },
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

function cargoCbm(c) {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce(
      (s, u) =>
        s +
        (typeof u.cbm === "number" && u.cbm > 0
          ? u.cbm
          : (u.width * u.length * u.height * u.quantity) / 1_000_000),
      0,
    );
  }
  return (c.width * c.length * c.height * c.quantity) / 1_000_000;
}

function cargoWeight(c) {
  if (c.unitSizes && c.unitSizes.length > 0) {
    return c.unitSizes.reduce((s, u) => s + (u.weight ?? 0) * (u.quantity ?? 1), 0);
  }
  return (c.weightPerUnit ?? 0) * (c.quantity ?? 1);
}

function fitsContainer(c, containerSpec) {
  const W = containerSpec.innerWidth ?? 234;
  const L = containerSpec.innerLength ?? 1200;
  const H = containerSpec.innerHeight ?? 268;
  const perms = [
    [c.width, c.length, c.height],
    [c.width, c.height, c.length],
    [c.length, c.width, c.height],
    [c.length, c.height, c.width],
    [c.height, c.width, c.length],
    [c.height, c.length, c.width],
  ];
  return perms.some(([w, l, h]) => w <= W && l <= L && h <= H);
}

function containerOf(result) {
  const map = new Map();
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) map.set(it.cargoId, ci);
      }
    }
    for (const bi of c.bulkItems ?? []) {
      if (bi.cargoId && !map.has(bi.cargoId)) map.set(bi.cargoId, ci);
    }
  }
  return map;
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("# 3차 — 잔여 미배치 cargo 정밀 진단");
log(`date: ${new Date().toISOString()}`);
log(`engine: pack() with sortStrategy='booking-cluster-first', strictVisualClassification=true (read-only)`);
log("");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const byId = new Map(cargoes.map((c) => [c.id, c]));

  log(`## ${s.id}`);

  // sg-1 은 E8 (candidateUnion + bookingCluster) 성공 케이스로 시도
  let result;
  let label;
  if (s.id === "sg-1") {
    log(`scenario: E8 candidateUnion + booking-cluster-first (성공 케이스)`);
    result = packBestWithCandidateUnion(cargoes, "auto", {
      strictVisualClassification: true,
      sortStrategy: "booking-cluster-first",
    });
    label = "E8";
  } else {
    log(`scenario: E3 base booking-cluster-first (잔여 미배치 진단)`);
    result = pack(cargoes, "auto", {
      strictVisualClassification: true,
      sortStrategy: "booking-cluster-first",
    });
    label = "E3";
  }

  const placement = containerOf(result);
  const set = result.containers.map((c) => c.spec.type).join("+");
  log(`컨 셋: ${set}`);

  // 컨테이너 잔여 공간
  const containerRem = result.containers.map((c, ci) => {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const remCbm = Math.max(0, c.spec.maxCbm - total);
    const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
    const remSoftCbm = Math.max(0, softCap - total);
    const remW = Math.max(0, c.spec.maxWeightKg - (c.totalWeight ?? 0));
    return { ci, type: c.spec.type, used: total, maxCbm: c.spec.maxCbm, softCap, remCbm, remSoftCbm, remW, spec: c.spec };
  });
  for (const r of containerRem) {
    log(`  컨${r.ci + 1} ${r.type}: 사용 ${r.used.toFixed(2)}/${r.maxCbm} (남은 ${r.remCbm.toFixed(2)} m³, soft 추가 ${(r.remSoftCbm - r.remCbm).toFixed(2)}) · 무게 남은 ${(r.remW / 1000).toFixed(1)} t`);
  }

  // 미배치 분석
  const unplIds = [...new Set(result.unplaced.filter((u) => u.cargoId).map((u) => u.cargoId))];
  log(`unplaced: ${unplIds.length === 0 ? "0 ✅" : unplIds.join(", ")}`);

  if (unplIds.length === 0) {
    log("");
    continue;
  }

  for (const cid of unplIds) {
    const c = byId.get(cid);
    if (!c) continue;
    log("");
    log(`### ${cid}`);
    log(`  - W${c.width} L${c.length} H${c.height} ×${c.quantity}`);
    log(`  - weightPerUnit ${c.weightPerUnit}kg / 총중량 ${cargoWeight(c).toFixed(0)}kg`);
    log(`  - CBM ${cargoCbm(c).toFixed(3)} m³ (단일 unit ${((c.width * c.length * c.height) / 1_000_000).toFixed(3)} m³ × ${c.quantity})`);
    log(`  - bookingNo: ${c.bookingNo ?? "—"}, 화주: ${c.actualShipperName || "?"}`);
    const flags = [];
    if (c.remarks?.noStacking) flags.push("noStacking");
    if (c.remarks?.topOnly) flags.push("topOnly");
    if (c.remarks?.orientation === "fixed") flags.push("orientation=fixed");
    if (flags.length > 0) log(`  - 플래그: ${flags.join(", ")}`);

    // 같은 booking 의 다른 cargo 가 어느 컨 에 갔는지 (bookingAnchor 추정)
    if (c.bookingNo) {
      const sameBkCargos = cargoes.filter((other) => other.id !== cid && other.bookingNo === c.bookingNo);
      const anchorCtns = new Set();
      for (const o of sameBkCargos) {
        const ci = placement.get(o.id);
        if (ci != null) anchorCtns.add(ci);
      }
      if (anchorCtns.size > 0) {
        log(`  - bookingAnchor 추정: 같은 booking 다른 cargo 가 컨${[...anchorCtns].map((x) => x + 1).join(",")} 에 있음`);
      } else if (sameBkCargos.length === 0) {
        log(`  - bookingAnchor: 단독 cargo (같은 booking 없음)`);
      } else {
        log(`  - bookingAnchor: 같은 booking 다른 cargo 도 미배치`);
      }
    }

    // 각 컨테이너 dim 검사 + CBM/무게 가능성
    log(`  - 컨별 fit 가능성:`);
    const totalCbm = cargoCbm(c);
    const totalWt = cargoWeight(c);
    for (const r of containerRem) {
      const fits = fitsContainer(c, r.spec);
      const cbmOk = totalCbm <= r.remSoftCbm + 0.001;
      const wtOk = totalWt <= r.remW + 0.001;
      const reasons = [];
      if (!fits) reasons.push("bounds: cargo 가 어느 회전으로도 컨 내부 dim 초과");
      if (!cbmOk) reasons.push(`CBM 부족 (${totalCbm.toFixed(2)} > soft ${r.remSoftCbm.toFixed(2)})`);
      if (!wtOk) reasons.push(`weight 부족 (${(totalWt / 1000).toFixed(1)}t > 남은 ${(r.remW / 1000).toFixed(1)}t)`);
      log(`    컨${r.ci + 1} ${r.type}: ${reasons.length === 0 ? "✅ 물리적 가능 (자리/배치 엔진 한계)" : reasons.join(", ")}`);
    }
  }

  log("");
}

const outPath = path.resolve("scripts/_diagnose-3rd-residual-cargo-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
