#!/usr/bin/env node
/**
 * 샘플 JSON 의 unitSizes[].weight 가 "박스 1개 무게" 가 아니라
 * "행 전체 무게" 로 잘못 채워진 케이스를 보정.
 *
 * 알고리즘은 unitSize.weight 를 박스 1개 무게로 사용한다 (algorithm.ts:131,
 * extreme-point.ts:850). 잘못된 값이 들어가면 각 박스가 부풀려진 무게로
 * 처리돼 다단·중량 룰이 깨진다.
 *
 * 보정 룰 (사용자 사양 — 매우 보수적):
 *  1) 동일값 케이스 — 모든 unitSize.weight ≈ cargo.weightPerUnitKg (오차 1% 이내)
 *     이고 cargo.quantity > 1 → 박스1개 무게 = cargo.weightPerUnitKg / Σunit.quantity
 *
 * 룰2 (비율 폭주, unitW합 > wpu×1.5) 는 사용자가 "정상 cargo 는 절대 건드리지
 * 말 것" 을 명시했으므로 false positive 위험을 피해 보정하지 않고 보고만 한다.
 * (예: FISGN260332 — wpu=609, sumW=3045 인데 sumW/qty = 609 = wpu 라 정상.
 * 룰2 임계로 잡히지만 박스 1개 무게는 정확. 이런 케이스가 다수.)
 *
 * 정상 케이스는 절대 건드리지 않는다.
 *
 * 사용법:
 *   node scripts/fix-unit-weights.mjs           # 실제 수정 + 보고서
 *   node scripts/fix-unit-weights.mjs --dry-run # 변경 미적용, 보고만
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const samplesDir = path.join(projectRoot, "data", "samples");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

const TOLERANCE = 0.01; // 1% 이내면 동일값으로 간주
const RATIO_TRIGGER = 1.5; // 비율 폭주 감지 임계

function approxEqual(a, b, tol = TOLERANCE) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

function sumQuantity(unitSizes) {
  return unitSizes.reduce((acc, u) => acc + (Number(u.quantity) || 0), 0);
}

function sumWeight(unitSizes) {
  return unitSizes.reduce(
    (acc, u) =>
      acc + (Number(u.weight) || 0) * (Number(u.quantity) || 0),
    0,
  );
}

function detectFix(cargo) {
  const ws = Array.isArray(cargo.unitSizes) ? cargo.unitSizes : null;
  if (!ws || ws.length === 0) return null;
  const wpu = Number(cargo.weightPerUnitKg) || 0;
  const qty = Number(cargo.quantity) || 0;
  if (wpu <= 0 || qty <= 1) return null; // qty=1 이면 박스1개 = 행1개라 동일해도 정상

  const totalUnitQty = sumQuantity(ws);
  if (totalUnitQty <= 0) return null;

  // 룰 1: 모든 unitSize.weight 가 wpu 와 같음 (오차 1% 이내)
  const allEqualWpu = ws.every((u) => approxEqual(Number(u.weight) || 0, wpu));
  if (allEqualWpu) {
    const fixed = wpu / totalUnitQty;
    return {
      reason: "동일값(unit=행총중량)",
      before: ws.map((u) => Number(u.weight) || 0),
      after: ws.map(() => Number(fixed.toFixed(3))),
      fixed: Number(fixed.toFixed(3)),
      totalUnitQty,
    };
  }

  return null;
}

/**
 * 비율 폭주 케이스 — 보고만 (자동 보정 X). 사용자가 직접 검토해 결정.
 * 임계: Σ(unitSize.weight × unitSize.quantity) > cargo.weightPerUnit × 1.5
 *
 * 단, sumW / Σunit.qty ≈ wpu 이면 정상 (박스 1개 무게가 정확) → 보고에서 제외.
 */
function detectAnomaly(cargo) {
  const ws = Array.isArray(cargo.unitSizes) ? cargo.unitSizes : null;
  if (!ws || ws.length === 0) return null;
  const wpu = Number(cargo.weightPerUnitKg) || 0;
  if (wpu <= 0) return null;
  const totalUnitQty = sumQuantity(ws);
  const totalUnitWeight = sumWeight(ws);
  if (totalUnitQty <= 0 || totalUnitWeight <= 0) return null;
  if (totalUnitWeight <= wpu * RATIO_TRIGGER) return null;
  // 박스 1개 평균 무게가 wpu 와 일치하면 정상
  const avgPerUnit = totalUnitWeight / totalUnitQty;
  if (approxEqual(avgPerUnit, wpu, 0.05)) return null;
  return {
    sumW: totalUnitWeight,
    avgPerUnit,
    ratio: totalUnitWeight / wpu,
  };
}

function applyFix(cargo, plan) {
  const fixedUnitSizes = cargo.unitSizes.map((u, i) => ({
    ...u,
    weight: plan.after[i],
  }));
  return { ...cargo, unitSizes: fixedUnitSizes };
}

async function main() {
  const entries = await fs.readdir(samplesDir);
  const jsonFiles = entries.filter((n) => n.endsWith(".json")).sort();

  const reportRows = [];
  const anomalyRows = [];
  let totalChanged = 0;

  for (const fileName of jsonFiles) {
    const fullPath = path.join(samplesDir, fileName);
    const raw = await fs.readFile(fullPath, "utf8");
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error(`[skip] ${fileName} — JSON parse 실패: ${e.message}`);
      continue;
    }
    const rows = Array.isArray(json.rows) ? json.rows : [];
    let touched = 0;
    const newRows = rows.map((row) => {
      const anomaly = detectAnomaly(row);
      if (anomaly) {
        anomalyRows.push({
          파일: fileName,
          부킹: row.bookingNo || row.houseBlNo || "",
          화주: row.actualShipperName || row.shipperName || "",
          수량: row.quantity,
          행wpu: Number(row.weightPerUnitKg) || 0,
          단위무게합: Number(anomaly.sumW.toFixed(1)),
          박스평균: Number(anomaly.avgPerUnit.toFixed(1)),
          비율: Number(anomaly.ratio.toFixed(2)),
        });
      }
      const plan = detectFix(row);
      if (!plan) return row;
      touched++;
      reportRows.push({
        파일: fileName,
        부킹: row.bookingNo || row.houseBlNo || "",
        화주: row.actualShipperName || row.shipperName || "",
        수량: row.quantity,
        행총중량: Number(row.weightPerUnitKg) || 0,
        단위qty합: plan.totalUnitQty,
        보정사유: plan.reason,
        변경전: plan.before.join("/"),
        변경후: plan.after[0],
      });
      return applyFix(row, plan);
    });

    if (touched > 0 && !DRY_RUN) {
      const next = { ...json, rows: newRows };
      await fs.writeFile(fullPath, JSON.stringify(next, null, 2) + "\n", "utf8");
    }
    totalChanged += touched;
    if (touched > 0) {
      console.log(
        `${DRY_RUN ? "[dry] " : ""}${fileName}: ${touched}건 보정`,
      );
    }
  }

  if (reportRows.length === 0) {
    console.log("보정 대상 없음. 모든 unitSize.weight 가 정상값.");
    return;
  }

  // 보고표 — 콘솔 출력
  console.log("");
  console.log("=== 보정 표 ===");
  const headers = [
    "파일",
    "부킹",
    "화주",
    "수량",
    "행총중량",
    "단위qty합",
    "보정사유",
    "변경전",
    "변경후",
  ];
  const widths = headers.map((h) => h.length);
  for (const r of reportRows) {
    headers.forEach((h, i) => {
      const v = String(r[h] ?? "");
      if (v.length > widths[i]) widths[i] = v.length;
    });
  }
  const fmt = (cells) =>
    cells
      .map((c, i) => String(c ?? "").padEnd(widths[i]))
      .join(" | ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of reportRows) {
    console.log(fmt(headers.map((h) => r[h])));
  }

  console.log("");
  console.log(`총 ${totalChanged}건 보정${DRY_RUN ? " (dry-run, 미적용)" : ""}.`);

  if (anomalyRows.length > 0) {
    console.log("");
    console.log("=== 주의 (자동 보정 X, 수동 검토 권장) ===");
    console.log(
      `unit무게합 > wpu × 1.5 인데 박스평균이 wpu 와 다른 케이스 ${anomalyRows.length}건`,
    );
    const aHeaders = ["파일", "부킹", "화주", "수량", "행wpu", "단위무게합", "박스평균", "비율"];
    const aw = aHeaders.map((h) => h.length);
    for (const r of anomalyRows) {
      aHeaders.forEach((h, i) => {
        const v = String(r[h] ?? "");
        if (v.length > aw[i]) aw[i] = v.length;
      });
    }
    const fmtA = (cells) =>
      cells.map((c, i) => String(c ?? "").padEnd(aw[i])).join(" | ");
    console.log(fmtA(aHeaders));
    console.log(aw.map((w) => "-".repeat(w)).join("-+-"));
    for (const r of anomalyRows) console.log(fmtA(aHeaders.map((h) => r[h])));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
