/* Residual Make-Room Repack — bounded local LNS 실험 (script-level, algorithm.ts 수정 없음).
 *
 * 동작:
 *   1) pack() 으로 baseline 실행, 미배치 cargo 식별
 *   2) 각 미배치 cargo 별:
 *      a) CBM/무게 여유 있는 컨 후보 선택
 *      b) 그 컨 안 placed cargo 들을 volume asc 정렬
 *      c) 1~3 cargoId 조합 (최대 12 unit) 을 conflict set 후보로 시도
 *      d) (전체 cargo - removed) + residual + removed 순서로 pack(fixedContainers=baseline 셋) 재실행
 *      e) 결과가 baseline 보다 좋아지면 (미배치 감소, 룰 위반 X) 성공
 *      f) timeBudget / maxTargets / maxCombo 가드
 *
 * 제한:
 *   - maxRemoveCargoIds: 3
 *   - maxRemoveUnits: 12
 *   - maxTargets per residual: 50
 *   - timeBudgetMs per sample: 90000 (1.5 min)
 *
 * read-only on production — pack() 인 자 / fixedContainers 만 사용. 특정 cargoId hardcoding X.
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack, CONTAINER_SOFT_OVERFLOW_RATIO } = algo;
const { strictStackAudit } = await import("../lib/packing/audit.ts");

const SOFT_OVERFLOW = CONTAINER_SOFT_OVERFLOW_RATIO ?? 1.05;
const TIME_BUDGET_MS = 90000;
const MAX_REMOVE_CARGOS = 3;
const MAX_REMOVE_UNITS = 12;
const MAX_TARGETS = 50;

const SAMPLES = [
  { id: "sg-1", file: "data/samples/singapore-total.json" },
  { id: "sg-4", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", file: "data/samples/singapore-total-5.json" },
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

function cargoUnitVol(c) {
  return (c.width * c.length * c.height) / 1_000_000;
}

function placementMap(result) {
  const map = new Map(); // cargoId → containerIdx
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) map.set(it.cargoId, ci);
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.cargoId && !map.has(b.cargoId)) map.set(b.cargoId, ci);
    }
  }
  return map;
}

function analyze(result) {
  const placedMap = placementMap(result);
  const cargoCi = new Map();
  const bkCi = new Map();
  for (const [cid, ci] of placedMap.entries()) {
    cargoCi.set(cid, new Set([ci]));
  }
  // booking split count
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.bookingNo) {
          const s = bkCi.get(it.bookingNo) ?? new Set();
          s.add(ci);
          bkCi.set(it.bookingNo, s);
        }
      }
    }
    for (const b of c.bulkItems ?? []) {
      if (b.bookingNo) {
        const s = bkCi.get(b.bookingNo) ?? new Set();
        s.add(ci);
        bkCi.set(b.bookingNo, s);
      }
    }
  }
  const cargoSplit = [...cargoCi.values()].filter((s) => s.size > 1).length;
  const bookingSplit = [...bkCi.values()].filter((s) => s.size > 1).length;
  const audit = strictStackAudit(result);
  let softCbm = 0, hardCbm = 0, weightOver = 0;
  for (const c of result.containers) {
    const total = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
    const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
    if (total > softCap + 0.001) hardCbm++;
    else if (total > c.spec.maxCbm + 0.001) softCbm++;
    if ((c.totalWeight ?? 0) > c.spec.maxWeightKg + 0.001) weightOver++;
  }
  const unplCargoIds = [...new Set(result.unplaced.filter((u) => u.cargoId).map((u) => u.cargoId))];
  const unplUnits = result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0);
  return { unplCargoIds, unplUnits, cargoSplit, bookingSplit, auditPass: audit.pass, softCbm, hardCbm, weightOver, placedMap };
}

const out = [];
const log = (s) => { console.log(s); out.push(s); };

log("# Residual Make-Room Repack — bounded local LNS 실험");
log(`date: ${new Date().toISOString()}`);
log(`bounds: maxRemoveCargos=${MAX_REMOVE_CARGOS}, maxRemoveUnits=${MAX_REMOVE_UNITS}, maxTargets=${MAX_TARGETS}, timeBudgetMs=${TIME_BUDGET_MS}`);
log("");
log("| sample | residualCargoId | targetContainer | triedTargets | conflictSet | residualPlaced | removedRepacked | finalUnpl | finalCargoSpl | finalBookSpl | audit | hardCbm | wtOver | packTime(s) | timeout | 결과 |");
log("|---|---|---|---:|---|---|---|---:|---:|---:|---|---:|---:|---:|:---:|---|");

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [head, ...rest] = arr;
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) continue;
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const cargoById = new Map(cargoes.map((c) => [c.id, c]));

  // baseline: E3 booking-cluster-first
  const baseline = pack(cargoes, "auto", { strictVisualClassification: true, sortStrategy: "booking-cluster-first" });
  const baselineAnalysis = analyze(baseline);
  const baselineSet = baseline.containers.map((c) => c.spec.type);
  const baselinePlacement = baselineAnalysis.placedMap;

  if (baselineAnalysis.unplCargoIds.length === 0) {
    log(`| ${s.id} | (baseline 미배치 0, skip) | — | — | — | — | — | 0 | 0 | 0 | P | 0 | 0 | — | — | baseline 성공 |`);
    continue;
  }

  const sampleStart = Date.now();

  for (const residualCid of baselineAnalysis.unplCargoIds) {
    if (Date.now() - sampleStart > TIME_BUDGET_MS) {
      log(`| ${s.id} | ${residualCid} | — | — | — | — | — | — | — | — | — | — | — | — | TIME | budget timeout |`);
      break;
    }

    const residualCargo = cargoById.get(residualCid);
    if (!residualCargo) continue;
    const residualCbm = cargoCbm(residualCargo);

    // candidate 컨: 잔여 CBM 여유 있는 컨 (큰 잔여 우선)
    const containerCandidates = baseline.containers
      .map((c, ci) => {
        const used = (c.totalCbm ?? 0) + (c.ctCbm ?? 0);
        const softCap = c.spec.maxCbm * SOFT_OVERFLOW;
        const remCbm = Math.max(0, softCap - used);
        const remW = Math.max(0, c.spec.maxWeightKg - (c.totalWeight ?? 0));
        return { ci, c, remCbm, remW };
      })
      .filter((x) => x.remCbm > 0)
      .sort((a, b) => b.remCbm - a.remCbm);

    let success = false;
    let bestResult = null;
    let bestAnalysis = null;
    let bestTargetCi = null;
    let bestRemoved = null;
    let triedTargets = 0;

    for (const { ci, c } of containerCandidates) {
      if (Date.now() - sampleStart > TIME_BUDGET_MS) break;
      if (success) break;

      // 컨테이너 안 placed cargoId (volume asc — 작은 거 먼저 제거 시도)
      const inCont = [...new Set(
        (c.rows ?? []).flatMap((row) => [...(row.bottomItems ?? []), ...(row.topItems ?? [])])
          .map((it) => it.cargoId)
          .filter(Boolean)
      )];
      const inContSorted = inCont
        .map((cid) => ({ cid, cargo: cargoById.get(cid) }))
        .filter((x) => x.cargo)
        .sort((a, b) => cargoUnitVol(a.cargo) * (a.cargo.quantity ?? 1) - cargoUnitVol(b.cargo) * (b.cargo.quantity ?? 1));

      // 후보 conflict combos: 1, 2, 3 개 (최대 unit 12, residual cbm 정도 빼는 CBM)
      const candPool = inContSorted.slice(0, 15); // 최대 15 cargo 중에서만 조합
      const combos = [];
      for (let k = 1; k <= MAX_REMOVE_CARGOS; k++) {
        for (const combo of combinations(candPool.map((x) => x.cid), k)) {
          const cargosCombo = combo.map((cid) => cargoById.get(cid));
          const totalUnits = cargosCombo.reduce((a, c) => a + (c.quantity ?? 1), 0);
          if (totalUnits > MAX_REMOVE_UNITS) continue;
          const totalRemovedCbm = cargosCombo.reduce((a, c) => a + cargoCbm(c), 0);
          // residual CBM 보다 1.2배 정도 까지만 (너무 많이 빼지 않게)
          if (totalRemovedCbm > residualCbm * 1.5 + 0.5) continue;
          combos.push({ combo, totalCbm: totalRemovedCbm, totalUnits });
        }
      }
      // CBM 작은 차이 우선 (residual 만큼만 비우는 거)
      combos.sort((a, b) => Math.abs(a.totalCbm - residualCbm) - Math.abs(b.totalCbm - residualCbm));
      const triedCombos = combos.slice(0, MAX_TARGETS);

      for (const { combo } of triedCombos) {
        if (Date.now() - sampleStart > TIME_BUDGET_MS) break;
        triedTargets++;

        const removedSet = new Set(combo);
        // 재배치 cargo 리스트 — residual 을 먼저 → 그다음 removed → 나머지
        const reorderedCargoes = [
          residualCargo,
          ...combo.map((cid) => cargoById.get(cid)),
          ...cargoes.filter((c) => c.id !== residualCid && !removedSet.has(c.id)),
        ];

        let testResult;
        try {
          testResult = pack(reorderedCargoes, "auto", {
            strictVisualClassification: true,
            sortStrategy: "input", // 우리가 정한 순서 따름
            fixedContainers: baselineSet,
          });
        } catch (e) {
          continue;
        }

        const aTest = analyze(testResult);
        // 성공 조건: 미배치 감소, audit pass, 절대 룰 통과
        if (
          aTest.unplUnits < baselineAnalysis.unplUnits &&
          aTest.cargoSplit === 0 &&
          aTest.bookingSplit === 0 &&
          aTest.auditPass === true &&
          aTest.hardCbm === 0 &&
          aTest.weightOver === 0
        ) {
          // 추가 검증: residual cargo 가 실제 배치됐는지
          const residualPlaced = aTest.placedMap.has(residualCid);
          // 제거했던 cargo 모두 재배치됐는지
          const allRemovedRepacked = combo.every((cid) => aTest.placedMap.has(cid));
          if (residualPlaced && allRemovedRepacked) {
            success = true;
            bestResult = testResult;
            bestAnalysis = aTest;
            bestTargetCi = ci;
            bestRemoved = combo;
            break;
          }
        }
      }
    }

    const packTime = (Date.now() - sampleStart) / 1000;
    if (success) {
      log(
        `| ${s.id} | ${residualCid} | 컨${bestTargetCi + 1} | ${triedTargets} | ${bestRemoved.join(",")} | ✅ | ✅ | ${bestAnalysis.unplUnits} | ${bestAnalysis.cargoSplit} | ${bestAnalysis.bookingSplit} | ${bestAnalysis.auditPass ? "P" : "F"} | ${bestAnalysis.hardCbm} | ${bestAnalysis.weightOver} | ${packTime.toFixed(1)} | | ✅ make-room 성공 |`,
      );
    } else {
      log(
        `| ${s.id} | ${residualCid} | (시도 ${containerCandidates.length}컨) | ${triedTargets} | — | ❌ | — | ${baselineAnalysis.unplUnits} | ${baselineAnalysis.cargoSplit} | ${baselineAnalysis.bookingSplit} | ${baselineAnalysis.auditPass ? "P" : "F"} | ${baselineAnalysis.hardCbm} | ${baselineAnalysis.weightOver} | ${packTime.toFixed(1)} | | ❌ make-room 실패 |`,
      );
    }
  }
  log("");
}

log("## 결론");
log("");
log("- residualMakeRoom 후보 conflict set (1~3 cargoIds, 최대 12 units, residual CBM 1.5배 안) 시도");
log("- 성공 조건: 미배치 감소 + cargoId/booking split 0 + audit pass + hard CBM/weight 0");
log("- 각 컨테이너에서 가장 작은 cargo 부터 조합 시도");

const outPath = path.resolve("scripts/_diagnose-residual-make-room-out.txt");
fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
