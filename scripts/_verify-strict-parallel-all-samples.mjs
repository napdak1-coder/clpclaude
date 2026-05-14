/* strict visual + adaptive parallel candidate union 전체 JSON 샘플 검증.
 *
 * 환경 변수:
 * - SAMPLE_CONCURRENCY: 동시에 돌릴 샘플 수 (기본 2)
 * - ATTEMPT_PARALLELISM: 샘플 1개 안에서 동시에 돌릴 worker 수 (기본 6)
 * - MAX_PARALLELISM: 자동 산정 상한 (기본 ATTEMPT_PARALLELISM)
 * - TIME_BUDGET_MS: 샘플별 전체 제한. 0이면 제한 없음 (기본 0)
 * - PER_ATTEMPT_TIMEOUT_MS: worker별 제한. 0이면 제한 없음 (기본 0)
 * - OUT_FILE: 진행 로그 파일 (기본 scripts/_verify-strict-parallel-all-samples-out.txt)
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CONTAINER_SOFT_OVERFLOW_RATIO } from "../lib/packing/algorithm.ts";
import { strictStackAudit } from "../lib/packing/audit.ts";
import { packBestWithAdaptiveParallelCandidateUnion } from "../lib/packing/parallel-candidate-union.ts";

const OUT_FILE =
  process.env.OUT_FILE ?? "scripts/_verify-strict-parallel-all-samples-out.txt";

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

const SAMPLE_CONCURRENCY = Math.max(1, readInt("SAMPLE_CONCURRENCY", 2));
const ATTEMPT_PARALLELISM = Math.max(1, readInt("ATTEMPT_PARALLELISM", 6));
const MAX_PARALLELISM = Math.max(
  1,
  readInt("MAX_PARALLELISM", ATTEMPT_PARALLELISM),
);
const TIME_BUDGET_MS = readInt("TIME_BUDGET_MS", 0);
const PER_ATTEMPT_TIMEOUT_MS = readInt("PER_ATTEMPT_TIMEOUT_MS", 0);
const CHILD_SAMPLE_FILE = process.env.STRICT_PARALLEL_SAMPLE_FILE;
const SCRIPT_FILE = fileURLToPath(import.meta.url);

const files = fs
  .readdirSync("data/samples")
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => path.join("data/samples", f));

function append(line = "") {
  fs.appendFileSync(OUT_FILE, `${line}\n`, "utf8");
  console.log(line);
}

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

function countSplits(r) {
  const cargo = new Map();
  const booking = new Map();
  r.containers.forEach((c, idx) => {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) {
          const set = cargo.get(it.cargoId) ?? new Set();
          set.add(idx);
          cargo.set(it.cargoId, set);
        }
        if (it.bookingNo) {
          const set = booking.get(it.bookingNo) ?? new Set();
          set.add(idx);
          booking.set(it.bookingNo, set);
        }
      }
    }
    for (const it of c.bulkItems ?? []) {
      if (it.cargoId) {
        const set = cargo.get(it.cargoId) ?? new Set();
        set.add(idx);
        cargo.set(it.cargoId, set);
      }
      if (it.bookingNo) {
        const set = booking.get(it.bookingNo) ?? new Set();
        set.add(idx);
        booking.set(it.bookingNo, set);
      }
    }
  });
  return {
    cargoSplit: [...cargo.values()].filter((set) => set.size > 1).length,
    bookingSplit: [...booking.values()].filter((set) => set.size > 1).length,
  };
}

function hardCbm(r) {
  return r.containers.filter(
    (c) =>
      c.totalCbm + c.ctCbm >
      c.spec.maxCbm * CONTAINER_SOFT_OVERFLOW_RATIO + 0.001,
  ).length;
}

function weightOver(r) {
  return r.containers.filter(
    (c) => c.totalWeight > c.spec.maxWeightKg + 0.001,
  ).length;
}

function prefixFor(file) {
  return path
    .basename(file, ".json")
    .replace(/^singapore-/, "sg-")
    .replace(/^hochiminh-/, "hm-");
}

async function runOne(file) {
  const sample = JSON.parse(fs.readFileSync(file, "utf8"));
  const prefix = prefixFor(file);
  const cargoes = build(sample.rows ?? [], prefix);
  const startedAt = Date.now();
  const result = await packBestWithAdaptiveParallelCandidateUnion(
    cargoes,
    "auto",
    { strictVisualClassification: true },
    {
      parallelism: ATTEMPT_PARALLELISM,
      maxParallelism: MAX_PARALLELISM,
      timeBudgetMs: TIME_BUDGET_MS,
      perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS,
      skipInitialProbe: true,
    },
  );
  const seconds = (Date.now() - startedAt) / 1000;
  const audit = strictStackAudit(result);
  const split = countSplits(result);
  const unplaced = result.unplaced.map((u) => u.cargoId).join(",") || "-";
  const unplacedUnits = result.unplaced.reduce(
    (sum, u) => sum + (u.quantity ?? 1),
    0,
  );
  return {
    file,
    rows: sample.rows?.length ?? 0,
    seconds,
    containers: result.containers.map((c) => c.spec.type).join("+"),
    unplacedUnits,
    unplaced,
    cargoSplit: split.cargoSplit,
    bookingSplit: split.bookingSplit,
    auditPass: audit.pass,
    auditViolations: audit.violations.length,
    hardCbm: hardCbm(result),
    weightOver: weightOver(result),
  };
}

function nodeExecArgv() {
  const args = [...process.execArgv];
  if (!args.includes("--experimental-strip-types")) {
    args.push("--experimental-strip-types");
  }
  if (!args.includes("--no-warnings")) {
    args.push("--no-warnings");
  }
  return args;
}

function errorRow(file, error) {
  return {
    file,
    error: error instanceof Error ? error.message : String(error),
  };
}

function parseChildMessage(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Skip non-JSON diagnostic lines.
    }
  }
  return null;
}

async function runSampleChild(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeExecArgv(), SCRIPT_FILE], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STRICT_PARALLEL_SAMPLE_FILE: file,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      resolve(errorRow(file, error));
    });
    child.once("close", (code) => {
      const message = parseChildMessage(stdout);
      if (message?.ok && message.row) {
        resolve(message.row);
        return;
      }
      const detail =
        message?.error ??
        stderr.trim() ??
        stdout.trim() ??
        `sample worker exited: ${code}`;
      resolve(errorRow(file, detail));
    });
  });
}

async function childMain(file) {
  try {
    const row = await runOne(file);
    process.stdout.write(`${JSON.stringify({ ok: true, row })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: errorRow(file, error).error })}\n`,
    );
    process.exitCode = 1;
  }
}

async function main() {
  fs.writeFileSync(OUT_FILE, "", "utf8");
  append("# strict visual + 병렬 탐색 전체 샘플 검증");
  append(`date: ${new Date().toISOString()}`);
  append(
    `config: sampleConcurrency=${SAMPLE_CONCURRENCY}, attemptParallelism=${ATTEMPT_PARALLELISM}, maxParallelism=${MAX_PARALLELISM}, timeBudgetMs=${TIME_BUDGET_MS}, perAttemptTimeoutMs=${PER_ATTEMPT_TIMEOUT_MS}`,
  );
  append("");
  append(
    "| file | rows | seconds | containers | unpl | unplaced | cargoSplit | bookingSplit | audit | hardCbm | wtOver |",
  );
  append("|---|---:|---:|---|---:|---|---:|---:|---|---:|---:|");

  const results = [];
  let nextIndex = 0;
  const startedAt = Date.now();

  async function worker() {
    while (nextIndex < files.length) {
      const file = files[nextIndex++];
      append(`START ${file} ${new Date().toISOString()}`);
      const row = await runSampleChild(file);
      results.push(row);
      if (row.error) {
        append(`| ${file} | - | - | ERROR | - | ${row.error} | - | - | - | - | - |`);
      } else {
        append(
          `| ${row.file} | ${row.rows} | ${row.seconds.toFixed(1)} | ${row.containers} | ${row.unplacedUnits} | ${row.unplaced} | ${row.cargoSplit} | ${row.bookingSplit} | ${row.auditPass ? "PASS" : "FAIL"}(${row.auditViolations}) | ${row.hardCbm} | ${row.weightOver} |`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SAMPLE_CONCURRENCY, files.length) }, () =>
      worker(),
    ),
  );

  const failing = results.filter(
    (r) =>
      r.error ||
      r.unplacedUnits > 0 ||
      r.cargoSplit > 0 ||
      r.bookingSplit > 0 ||
      r.auditPass === false ||
      r.hardCbm > 0 ||
      r.weightOver > 0,
  );
  append("");
  append(`TOTAL_SECONDS=${((Date.now() - startedAt) / 1000).toFixed(1)}`);
  append(
    `PROBLEM_FILES=${
      failing.length
        ? failing
            .map((r) =>
              r.error
                ? `${r.file}:ERROR`
                : `${r.file}:unpl=${r.unplacedUnits},cargoSplit=${r.cargoSplit},bookingSplit=${r.bookingSplit}`,
            )
            .join(";")
        : "NONE"
    }`,
  );
}

if (CHILD_SAMPLE_FILE) {
  await childMain(CHILD_SAMPLE_FILE);
} else {
  await main();
}
