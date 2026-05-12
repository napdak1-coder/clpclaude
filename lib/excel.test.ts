/**
 * lib/excel.ts 단위 테스트
 *
 * 실행:
 *   node --test --experimental-strip-types lib/excel.test.ts
 *
 * 첫 케이스: 부풀려진 unitSize.weight 자동 보정.
 *   엑셀에서 사용자가 G.W/T(=행 총중량) 와 같은 값을 모든 사이즈 그룹의 weight
 *   칸에 박아둔 양식이 들어오면, correctInflatedUnitWeights 가 박스 1개 무게로
 *   재계산해 돌려준다. 정상 케이스는 그대로 둔다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { correctInflatedUnitWeights } from "./excel.ts";

test("correctInflatedUnitWeights — 모든 unitSize.weight 가 행총중량과 같으면 박스1개 무게로 보정", () => {
  // FBSGN260919 케이스: qty=4, wpu=726, 사이즈 3그룹(quantity 합=4) 모두 weight=726
  const cargo = { quantity: 4, weightPerUnitKg: 726 };
  const unitSizes = [
    { width: 110, length: 110, height: 100, quantity: 1, weight: 726 },
    { width: 110, length: 110, height: 120, quantity: 1, weight: 726 },
    { width: 110, length: 110, height: 140, quantity: 2, weight: 726 },
  ];

  const fixed = correctInflatedUnitWeights(cargo, unitSizes);

  assert.ok(fixed, "보정이 적용돼야 함");
  // 박스 1개 무게 = 726 / 4 = 181.5
  for (const u of fixed!) {
    assert.equal(u.weight, 181.5, "각 그룹의 박스1개 무게가 181.5kg 으로 통일");
  }
  // 사이즈 정보는 보존
  assert.equal(fixed![0].width, 110);
  assert.equal(fixed![2].quantity, 2);
});

test("correctInflatedUnitWeights — 정상 데이터(박스1개 무게가 행총중량과 다름)는 건드리지 않음", () => {
  // FISGN260339 케이스: qty=2, wpu=476, 박스1개 무게=238 (정상)
  const cargo = { quantity: 2, weightPerUnitKg: 476 };
  const unitSizes = [
    { width: 110, length: 110, height: 180, quantity: 1, weight: 238 },
    { width: 110, length: 110, height: 180, quantity: 1, weight: 238 },
  ];

  const fixed = correctInflatedUnitWeights(cargo, unitSizes);

  assert.equal(fixed, null, "보정 대상 아니면 null 반환");
});

test("correctInflatedUnitWeights — quantity=1 이면 보정 안 함 (행=박스1개라 같아도 정상)", () => {
  const cargo = { quantity: 1, weightPerUnitKg: 500 };
  const unitSizes = [
    { width: 100, length: 100, height: 100, quantity: 1, weight: 500 },
  ];

  const fixed = correctInflatedUnitWeights(cargo, unitSizes);

  assert.equal(fixed, null);
});

test("correctInflatedUnitWeights — weight=0 은 그대로 (차선책 경로 유지)", () => {
  const cargo = { quantity: 3, weightPerUnitKg: 600 };
  const unitSizes = [
    { width: 100, length: 100, height: 100, quantity: 1, weight: 0 },
    { width: 100, length: 100, height: 120, quantity: 2, weight: 0 },
  ];

  const fixed = correctInflatedUnitWeights(cargo, unitSizes);

  assert.equal(fixed, null, "weight=0 은 보정 트리거 안 됨");
});

test("correctInflatedUnitWeights — 1% 오차 허용 (반올림된 값도 동일값으로 처리)", () => {
  const cargo = { quantity: 5, weightPerUnitKg: 1000 };
  const unitSizes = [
    { width: 100, length: 100, height: 100, quantity: 2, weight: 1005 },
    { width: 100, length: 100, height: 100, quantity: 3, weight: 995 },
  ];

  const fixed = correctInflatedUnitWeights(cargo, unitSizes);

  assert.ok(fixed, "1% 이내 오차도 동일값으로 보정");
  assert.equal(fixed![0].weight, 200, "1000 / 5 = 200kg");
});
