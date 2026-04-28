/**
 * pack() 휴리스틱 단위 테스트
 *
 * Node 내장 test runner 사용 (`node --test --experimental-strip-types`).
 * 외부 의존성 없이 알고리즘이 핵심 도메인 룰을 준수하는지만 확인한다.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CargoSpec, Remark } from "../../types/cargo.ts";
import { pack } from "./algorithm.ts";

// 헬퍼: 기본 리마크 (테스트 가독성을 위한 로컬 사본)
const baseRemark: Remark = {
  noStacking: false,
  topOnly: false,
  orientation: "free",
  heavierBelow: false,
};

function makeCargo(over: Partial<CargoSpec> & { id: string }): CargoSpec {
  return {
    id: over.id,
    shipmentId: over.shipmentId ?? "ship-1",
    sortOrder: over.sortOrder ?? 0,
    itemName: over.itemName,
    width: over.width ?? 100,
    length: over.length ?? 100,
    height: over.height ?? 100,
    quantity: over.quantity ?? 1,
    weightPerUnit: over.weightPerUnit ?? 100,
    cbm: over.cbm,
    remarks: { ...baseRemark, ...(over.remarks ?? {}) },
  };
}

describe("pack — 기본 동작", () => {
  it("작은 화물 1개 → 컨테이너 1개에 배치된다 (40ft_only)", () => {
    const cargo = [makeCargo({ id: "c1", width: 50, length: 60, height: 70 })];
    const result = pack(cargo, "40ft_only");
    assert.equal(result.containers.length, 1);
    assert.equal(result.containers[0].spec.type, "40FT");
    assert.equal(result.unplaced.length, 0);
    // 단일 화물은 1개 row의 bottom에 들어가야 함
    assert.equal(result.containers[0].rows.length, 1);
    assert.equal(result.containers[0].rows[0].bottomItems.length, 1);
    assert.equal(result.containers[0].rows[0].topItems.length, 0);
  });

  it("작은 화물 1개 → 20ft_only도 동일하게 1개 컨테이너", () => {
    const cargo = [makeCargo({ id: "c1", width: 50, length: 60, height: 70 })];
    const result = pack(cargo, "20ft_only");
    assert.equal(result.containers.length, 1);
    assert.equal(result.containers[0].spec.type, "20FT");
    assert.equal(result.unplaced.length, 0);
  });
});

describe("pack — 다단금지 (noStacking)", () => {
  it("모두 noStacking=true 인 5개 화물은 전부 bottom 에만 들어간다", () => {
    const cargoes = Array.from({ length: 5 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 100,
        length: 100,
        height: 100,
        remarks: { ...baseRemark, noStacking: true },
      }),
    );
    const result = pack(cargoes, "40ft_only");
    let totalBottom = 0;
    let totalTop = 0;
    for (const c of result.containers) {
      for (const r of c.rows) {
        totalBottom += r.bottomItems.length;
        totalTop += r.topItems.length;
      }
    }
    assert.equal(totalBottom, 5);
    assert.equal(totalTop, 0);
  });
});

describe("pack — 상단적재 (topOnly)", () => {
  it("topOnly 1개 + 일반 1개 → topOnly가 top에 배치된다", () => {
    const cargoes = [
      // 일반 화물 (bottom 후보)
      makeCargo({
        id: "base",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 200,
      }),
      // 상단 전용 (작아야 위에 올라감)
      makeCargo({
        id: "top",
        width: 90,
        length: 90,
        height: 50,
        weightPerUnit: 50,
        remarks: { ...baseRemark, topOnly: true },
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    assert.equal(result.unplaced.length, 0);
    let foundTop = false;
    for (const c of result.containers) {
      for (const r of c.rows) {
        for (const t of r.topItems) {
          if (t.cargoId === "top") foundTop = true;
        }
      }
    }
    assert.ok(foundTop, "topOnly 화물은 반드시 top 레이어에 있어야 한다");
  });
});

describe("pack — 중량조건 (heavierBelow)", () => {
  it("무거운 화물이 가벼운 화물 아래로 가야 한다 (heavierBelow=true)", () => {
    const cargoes = [
      // 가벼운 화물이 topOnly 로 위쪽 후보
      makeCargo({
        id: "light",
        width: 80,
        length: 80,
        height: 50,
        weightPerUnit: 30,
        remarks: { ...baseRemark, topOnly: true, heavierBelow: true },
      }),
      // 무거운 화물 — bottom 후보
      makeCargo({
        id: "heavy",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 500,
        remarks: { ...baseRemark, heavierBelow: true },
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    let lightLayer: "bottom" | "top" | null = null;
    let heavyLayer: "bottom" | "top" | null = null;
    for (const c of result.containers) {
      for (const r of c.rows) {
        for (const item of r.bottomItems) {
          if (item.cargoId === "light") lightLayer = "bottom";
          if (item.cargoId === "heavy") heavyLayer = "bottom";
        }
        for (const item of r.topItems) {
          if (item.cargoId === "light") lightLayer = "top";
          if (item.cargoId === "heavy") heavyLayer = "top";
        }
      }
    }
    assert.equal(heavyLayer, "bottom", "무거운 화물은 bottom");
    assert.equal(lightLayer, "top", "가벼운 화물은 top");
  });
});

describe("pack — 중량 한도", () => {
  it("총 화물 중량이 컨테이너 한도 미만이어야 한다 (40FT < 25000kg)", () => {
    // 단일 화물 800kg × 30개 = 24000kg → 40FT 한도(25000) 미만
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 800,
        quantity: 30,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    for (const c of result.containers) {
      assert.ok(
        c.totalWeight < c.spec.maxWeightKg,
        `컨테이너 ${c.index} 누적 중량(${c.totalWeight})이 한도(${c.spec.maxWeightKg})를 초과`,
      );
    }
  });

  it("중량 한도를 넘는 화물은 다음 컨테이너로 분산되거나 unplaced 처리된다", () => {
    // 2000kg × 20개 = 40000kg → 40FT 1대로는 부족
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 2000,
        quantity: 20,
      }),
    ];
    const result = pack(cargoes, "auto");
    // 컨테이너가 2개 이상이거나 unplaced 가 있어야 한다
    const placed = result.containers.reduce(
      (s, c) =>
        s +
        c.rows.reduce(
          (rs, r) => rs + r.bottomItems.length + r.topItems.length,
          0,
        ),
      0,
    );
    assert.ok(
      result.containers.length >= 2 || result.unplaced.length > 0,
      "한 컨테이너에 다 들어가서는 안 된다",
    );
    // 모든 컨테이너가 한도를 지키는지
    for (const c of result.containers) {
      assert.ok(c.totalWeight < c.spec.maxWeightKg);
    }
    assert.ok(placed + result.unplaced.length === 20);
  });
});
