import assert from "node:assert/strict";
import test from "node:test";

import {
  __parallelTestables,
  packBestWithAdaptiveParallelCandidateUnion,
  resolveAdaptiveParallelism,
} from "./parallel-candidate-union.ts";
import type { CargoSpec } from "../../types/cargo.ts";

test("resolveAdaptiveParallelism — 사용자가 지정한 동시 실행 수를 안전 범위로 제한한다", () => {
  assert.equal(resolveAdaptiveParallelism(20, 10, { parallelism: 4 }), 4);
  assert.equal(resolveAdaptiveParallelism(20, 3, { parallelism: 10 }), 3);
  assert.equal(resolveAdaptiveParallelism(20, 10, { parallelism: 0 }), 1);
});

test("resolveAdaptiveParallelism — 시도 1개면 병렬도 1로 고정한다", () => {
  assert.equal(resolveAdaptiveParallelism(20, 1), 1);
});

test("buildCandidateSetsFromCargoes — 사전 단일 배치 없이 후보 셋을 만든다", () => {
  const cargoes: CargoSpec[] = [
    {
      id: "c1",
      shipmentId: "s1",
      sortOrder: 1,
      cargoType: "PL",
      width: 100,
      length: 100,
      height: 100,
      quantity: 1,
      weightPerUnit: 100,
      cbm: 60,
      cbmSource: "manual-cfs",
      remarks: {
        noStacking: false,
        topOnly: false,
        orientation: "free",
        heavierBelow: false,
      },
    },
  ];
  const sets = __parallelTestables.buildCandidateSetsFromCargoes(cargoes, "auto");
  assert.ok(sets.length > 0);
  assert.ok(sets.some((set) => set.includes("40FT")));
});

test("packBestWithAdaptiveParallelCandidateUnion — 사전 단일 배치 생략 모드 smoke", async () => {
  const cargoes: CargoSpec[] = [
    {
      id: "small",
      shipmentId: "s1",
      sortOrder: 1,
      cargoType: "PL",
      width: 100,
      length: 100,
      height: 100,
      quantity: 2,
      weightPerUnit: 100,
      remarks: {
        noStacking: false,
        topOnly: false,
        orientation: "free",
        heavierBelow: false,
      },
    },
  ];
  const result = await packBestWithAdaptiveParallelCandidateUnion(
    cargoes,
    "auto",
    {},
    {
      parallelism: 2,
      maxParallelism: 2,
      timeBudgetMs: 0,
      perAttemptTimeoutMs: 0,
      skipInitialProbe: true,
    },
  );
  assert.equal(result.unplaced.length, 0);
});
