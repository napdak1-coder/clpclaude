/**
 * splitCargoesByUnitCargoType 단위 테스트
 *
 * 박스별 cargoType 이 cargo.cargoType 과 다르면 cargo 분리. 그 외엔 입력 = 출력.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { splitCargoesByUnitCargoType } from "./algorithm.ts";
import { DEFAULT_REMARK, type CargoSpec, type UnitSize } from "../../types/cargo.ts";

function mkCargo(over: Partial<CargoSpec> & { id: string }): CargoSpec {
  return {
    id: over.id,
    shipmentId: over.shipmentId ?? "ship-1",
    sortOrder: over.sortOrder ?? 0,
    cargoType: over.cargoType ?? "PL",
    width: over.width ?? 100,
    length: over.length ?? 100,
    height: over.height ?? 100,
    quantity: over.quantity ?? 1,
    weightPerUnit: over.weightPerUnit ?? 100,
    cbm: over.cbm,
    aboutCbm: over.aboutCbm,
    unitSizes: over.unitSizes,
    remarks: over.remarks ?? DEFAULT_REMARK,
  };
}

function mkUnit(over: Partial<UnitSize> & { width: number; length: number; height: number; quantity: number }): UnitSize {
  return {
    width: over.width,
    length: over.length,
    height: over.height,
    quantity: over.quantity,
    weight: over.weight,
    cargoType: over.cargoType,
  };
}

describe("splitCargoesByUnitCargoType", () => {
  it("unitSizes 없는 cargo → 그대로 (분리 X)", () => {
    const c = mkCargo({ id: "c1", cargoType: "PL", unitSizes: undefined });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "c1");
    assert.equal(out[0].cargoType, "PL");
  });

  it("unitSizes 모두 cargoType 미지정 → 그대로 (cargo.cargoType 폴백)", () => {
    const c = mkCargo({
      id: "c1",
      cargoType: "PL",
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 2 }),
        mkUnit({ width: 80, length: 80, height: 80, quantity: 1 }),
      ],
    });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "c1");
  });

  it("unitSizes 모두 cargoType 동일 (PL) → 그대로", () => {
    const c = mkCargo({
      id: "c1",
      cargoType: "PL",
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 80, length: 80, height: 80, quantity: 1, cargoType: "PL" }),
      ],
    });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "c1");
  });

  it("PL 2개 + CT 1개 섞임 → 2 cargo 로 분리", () => {
    const c = mkCargo({
      id: "c1",
      cargoType: "PL",
      quantity: 3,
      cbm: 6,
      aboutCbm: 6,
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 50, length: 50, height: 50, quantity: 1, cargoType: "CT" }),
      ],
    });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 2, "PL 1개 + CT 1개로 분리되어야");

    const pl = out.find((x) => x.cargoType === "PL");
    const ct = out.find((x) => x.cargoType === "CT");
    assert.ok(pl, "PL cargo 존재");
    assert.ok(ct, "CT cargo 존재");

    // id suffix
    assert.equal(pl.id, "c1-pl");
    assert.equal(ct.id, "c1-ct");

    // 분리된 unitSizes 갯수
    assert.equal(pl.unitSizes?.length, 2);
    assert.equal(ct.unitSizes?.length, 1);

    // quantity = 박스 수 합
    assert.equal(pl.quantity, 2);
    assert.equal(ct.quantity, 1);

    // cbm 비율 분배 (PL 2/3, CT 1/3)
    assert.ok(Math.abs((pl.cbm ?? 0) - 4) < 0.01, "PL cbm = 6 × 2/3 = 4");
    assert.ok(Math.abs((ct.cbm ?? 0) - 2) < 0.01, "CT cbm = 6 × 1/3 = 2");

    // 분리된 unit.cargoType 은 비움 (이미 cargo 로 표현됨)
    for (const u of pl.unitSizes ?? []) assert.equal(u.cargoType, undefined);
    for (const u of ct.unitSizes ?? []) assert.equal(u.cargoType, undefined);
  });

  it("PL + 미지정 (cargo.cargoType 폴백 PL) → 같은 그룹, 분리 X", () => {
    const c = mkCargo({
      id: "c1",
      cargoType: "PL",
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 80, length: 80, height: 80, quantity: 1 }), // cargoType 미지정 → PL 폴백
      ],
    });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 1, "둘 다 PL 이므로 분리 X");
  });

  it("3종 cargoType (PL/CT/PK) 섞임 → 3 cargo 로 분리", () => {
    const c = mkCargo({
      id: "c1",
      cargoType: "PL",
      quantity: 3,
      cbm: 9,
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 50, length: 50, height: 50, quantity: 1, cargoType: "CT" }),
        mkUnit({ width: 60, length: 60, height: 60, quantity: 1, cargoType: "PK" }),
      ],
    });
    const out = splitCargoesByUnitCargoType([c]);
    assert.equal(out.length, 3);
    const types = out.map((x) => x.cargoType).sort();
    assert.deepEqual(types, ["CT", "PK", "PL"]);
  });

  it("여러 cargo 입력 — 일부만 분리", () => {
    const c1 = mkCargo({ id: "a", cargoType: "PL" }); // unitSizes 없음
    const c2 = mkCargo({
      id: "b",
      cargoType: "PL",
      cbm: 4,
      unitSizes: [
        mkUnit({ width: 100, length: 100, height: 100, quantity: 1, cargoType: "PL" }),
        mkUnit({ width: 50, length: 50, height: 50, quantity: 1, cargoType: "CT" }),
      ],
    });
    const c3 = mkCargo({ id: "c", cargoType: "WB" }); // 단일
    const out = splitCargoesByUnitCargoType([c1, c2, c3]);
    assert.equal(out.length, 4, "a 1 + b 2 (분리) + c 1 = 4");
    const ids = out.map((x) => x.id);
    assert.ok(ids.includes("a"));
    assert.ok(ids.includes("b-pl"));
    assert.ok(ids.includes("b-ct"));
    assert.ok(ids.includes("c"));
  });
});
