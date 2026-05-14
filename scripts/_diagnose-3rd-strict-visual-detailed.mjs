/* 3차 진단 — strictVisualClassification=true 모드에서 미배치 cargoId 별 실패 원인 정밀 분석.
 *
 * 대상: 망작 SG / 1ST SG / 4ST SG / 5ST SG (사전 진단에서 미배치 발생 4 샘플)
 *
 * 각 unplaced cargo 마다:
 *   - cargoId, 사이즈, 수량, 총중량, noStacking, bottomOnly, booking
 *   - 컨테이너 잔여 공간 (CBM/weight)
 *   - 실패 원인 휴리스틱 추정:
 *     · bounds overflow      : cargo 박스가 어느 컨 안에도 회전 후 안 들어감
 *     · CBM overflow         : cargo CBM 합 > 모든 컨 잔여 CBM 합
 *     · weight rule          : cargo 총중량 > 모든 컨 잔여 weight 합
 *     · cargoId atomic       : 단일 컨 잔여 < cargo 전체 CBM 또는 weight (atomic 분리 금지)
 *     · noStacking violation : noStacking=true 인데 어느 컨도 z=0 자리 없음 (휴리스틱)
 *     · collision/no fit     : 위 조건 모두 통과인데 실제 못 들어감 (시각 배치 엔진 한계)
 *     · time budget          : pack 60s 초과
 *
 * 코드 수정 없음 — pack(strictVisualClassification=true) 호출 + 결과 분석만.
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack } = algo;

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
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

// 박스 한 면이 컨 안쪽에 들어가는지 (6 방향 회전 모두 검사)
function cargoFitsContainerBounds(c, containerSpec) {
  const dims = [c.width, c.length, c.height];
  const W = containerSpec.innerWidth ?? 234;
  const L = containerSpec.innerLength ?? (containerSpec.type === "40FT" ? 1200 : 590);
  const H = containerSpec.innerHeight ?? (containerSpec.type === "40FT" ? 268 : 238);
  // 6 회전 시도
  const perms = [
    [dims[0], dims[1], dims[2]],
    [dims[0], dims[2], dims[1]],
    [dims[1], dims[0], dims[2]],
    [dims[1], dims[2], dims[0]],
    [dims[2], dims[0], dims[1]],
    [dims[2], dims[1], dims[0]],
  ];
  return perms.some(([w, l, h]) => w <= W && l <= L && h <= H);
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
    return c.unitSizes.reduce(
      (s, u) => s + (u.weight ?? 0) * (u.quantity ?? 1),
      0,
    );
  }
  return (c.weightPerUnit ?? 0) * (c.quantity ?? 1);
}

function classifyFailure(cargo, result, packTimeSec) {
  if (packTimeSec > 60) return "time budget";
  // 컨 잔여 공간 합
  let totalRemCbm = 0;
  let totalRemWeight = 0;
  let maxRemCbm = 0;
  let maxRemWeight = 0;
  for (const c of result.containers) {
    const usedCbm = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const remCbm = Math.max(0, c.spec.maxCbm - usedCbm);
    const remW = Math.max(0, c.spec.maxWeightKg - (c.totalWeight ?? 0));
    totalRemCbm += remCbm;
    totalRemWeight += remW;
    maxRemCbm = Math.max(maxRemCbm, remCbm);
    maxRemWeight = Math.max(maxRemWeight, remW);
  }
  const cCbm = cargoCbm(cargo);
  const cWt = cargoWeight(cargo);
  // bounds 검사
  let anyContainerHoldsByBounds = false;
  for (const c of result.containers) {
    if (cargoFitsContainerBounds(cargo, c.spec)) {
      anyContainerHoldsByBounds = true;
      break;
    }
  }
  if (!anyContainerHoldsByBounds) return "bounds overflow";
  if (cCbm > totalRemCbm + 0.001) return "CBM overflow (전체)";
  if (cWt > totalRemWeight + 0.001) return "weight rule (전체)";
  // atomic: 단일 컨 잔여로 cargo 전체 못 받는지
  if (cCbm > maxRemCbm + 0.001) return "cargoId atomic (CBM)";
  if (cWt > maxRemWeight + 0.001) return "cargoId atomic (weight)";
  if (cargo.remarks?.noStacking) return "noStacking + 공간 fragmentation";
  return "collision / no fit (시각 배치 엔진 한계)";
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 3차 진단: strictVisualClassification=true 미배치 정밀 분석 ===");
log(`date: ${new Date().toISOString()}`);
log(`engine: pack() 직접 호출 (packBestWithCandidateUnion 미사용)`);
log("");

const summary = [];
for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    log(`[${s.id}] SKIP — 파일 없음`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  log(`## ${s.id} (${s.name}) — ${cargoes.length} 행`);

  const t0 = Date.now();
  const result = pack(cargoes, "auto", { strictVisualClassification: true });
  const dt = (Date.now() - t0) / 1000;
  log(`pack 시간: ${dt.toFixed(1)}s`);

  // 컨테이너 요약
  log(`컨테이너:`);
  for (let i = 0; i < result.containers.length; i++) {
    const c = result.containers[i];
    const used = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const remCbm = Math.max(0, c.spec.maxCbm - used);
    const remW = Math.max(0, c.spec.maxWeightKg - (c.totalWeight ?? 0));
    log(
      `  컨${i + 1} ${c.spec.type}: CBM ${used.toFixed(2)}/${c.spec.maxCbm} (남은 ${remCbm.toFixed(2)} m³) · 무게 ${((c.totalWeight ?? 0) / 1000).toFixed(1)}/${(c.spec.maxWeightKg / 1000).toFixed(1)} t (남은 ${(remW / 1000).toFixed(1)} t)`,
    );
  }

  // 미배치 분석
  const unplBy = new Map();
  for (const u of result.unplaced) {
    if (!u.cargoId) continue;
    if (!unplBy.has(u.cargoId)) {
      const cg = cargoes.find((c) => c.id === u.cargoId);
      unplBy.set(u.cargoId, { cargo: cg, count: 0 });
    }
    unplBy.get(u.cargoId).count += u.quantity ?? 1;
  }

  if (unplBy.size === 0) {
    log(`미배치: 0 (PASS)`);
    summary.push({ id: s.id, unplCount: 0, packSec: dt });
  } else {
    log(`미배치 ${unplBy.size} 개 cargo:`);
    for (const [cid, info] of unplBy.entries()) {
      const c = info.cargo;
      if (!c) {
        log(`  ${cid} (cargo 원본 못 찾음) ×${info.count}`);
        continue;
      }
      const cCbm = cargoCbm(c);
      const cWt = cargoWeight(c);
      const cause = classifyFailure(c, result, dt);
      const flags = [];
      if (c.remarks?.noStacking) flags.push("noStacking");
      if (c.remarks?.topOnly) flags.push("topOnly");
      if (c.remarks?.orientation === "fixed") flags.push("orientation=fixed");
      log(
        `  ${cid}: W${c.width} L${c.length} H${c.height} ×${c.quantity} (${cCbm.toFixed(3)} m³, ${cWt.toFixed(0)} kg) booking=${c.bookingNo ?? "—"}${flags.length ? " [" + flags.join(",") + "]" : ""}`,
      );
      log(`    → 실패 원인: ${cause}`);
    }
    summary.push({
      id: s.id,
      unplCount: result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0),
      packSec: dt,
      causes: [...unplBy.entries()].map(([cid, info]) => ({
        cargoId: cid,
        cause: classifyFailure(info.cargo, result, dt),
      })),
    });
  }

  log("");
}

log("=== 종합 ===");
for (const s of summary) {
  if (s.unplCount === 0) {
    log(`${s.id}: 미배치 0 (PASS) pack=${s.packSec.toFixed(1)}s`);
  } else {
    log(
      `${s.id}: 미배치 ${s.unplCount} unit pack=${s.packSec.toFixed(1)}s${s.packSec > 60 ? " ⚠ 60s 초과" : ""}`,
    );
    for (const c of s.causes) {
      log(`  - ${c.cargoId}: ${c.cause}`);
    }
  }
}

log("");
log("=== 실패 원인 분류 표 ===");
const causeBuckets = new Map();
for (const s of summary) {
  if (!s.causes) continue;
  for (const c of s.causes) {
    if (!causeBuckets.has(c.cause)) causeBuckets.set(c.cause, []);
    causeBuckets.get(c.cause).push(`${s.id}:${c.cargoId}`);
  }
}
for (const [cause, items] of causeBuckets.entries()) {
  log(`- ${cause}: ${items.length}건`);
  for (const it of items) log(`    · ${it}`);
}

const outPath = path.resolve("scripts/_diagnose-3rd-strict-visual-detailed-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
