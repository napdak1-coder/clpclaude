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
    cargoType: over.cargoType ?? "PL",
    itemName: over.itemName,
    width: over.width ?? 100,
    length: over.length ?? 100,
    height: over.height ?? 100,
    quantity: over.quantity ?? 1,
    weightPerUnit: over.weightPerUnit ?? 100,
    cbm: over.cbm,
    aboutCbm: over.aboutCbm,
    unitSizes: over.unitSizes,
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

describe("pack — 카톤(CT) 분리", () => {
  it("CT 화물(입고전, aboutCbm 만)은 시각 unit 으로 안 들어가고 ctCbm 에 합산된다", () => {
    const cargoes = [
      makeCargo({
        id: "regular",
        cargoType: "PL",
        width: 100,
        length: 100,
        height: 100,
      }),
      // CT 카톤 + 입고전 — c.cbm null, aboutCbm 5
      // (cbm 이 채워지면 입고완료로 우선 분류되므로 입고전 케이스 명시)
      makeCargo({
        id: "carton",
        cargoType: "CT",
        width: 50,
        length: 50,
        height: 50,
        cbm: undefined,
        aboutCbm: 5,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const visualUnits = result.containers.reduce(
      (s, c) =>
        s +
        c.rows.reduce((rs, r) => rs + r.bottomItems.length + r.topItems.length, 0),
      0,
    );
    assert.equal(visualUnits, 1, "CT 는 시각 unit 으로 들어가지 않아야 함");
    assert.ok(
      result.containers[0].ctCbm > 0,
      `CT 화물 CBM 은 ctCbm 에 합산 (실제 ${result.containers[0].ctCbm})`,
    );
    assert.equal(result.summary.ctTotalCbm, 5);
  });
});

describe("pack — 입고완료 시각 배치", () => {
  it("입고완료 화물(c.cbm 입력) 도 사이즈로 시각 배치되고, summary.completedTotalCbm 은 입력 CBM 합으로 정보 표시된다", () => {
    const cargoes = [
      makeCargo({
        id: "a",
        cargoType: "PL",
        width: 200,
        length: 200,
        height: 250,
        quantity: 5,
      }),
      // 입고완료 (c.cbm=25 입력) — 시각 배치 대상이며 사이즈는 100×100×100
      makeCargo({
        id: "completed",
        cargoType: "PL",
        width: 100,
        length: 100,
        height: 100,
        cbm: 25,
      }),
    ];
    const result = pack(cargoes, "auto");
    assert.ok(result.containers.length >= 1);
    // 입고완료 cargo 도 시각 unit 으로 들어가야 함 — 어딘가의 row 에 cargoId="completed" 가 존재
    const placedCompleted = result.containers.flatMap((c) =>
      c.rows.flatMap((r) => [...r.bottomItems, ...r.topItems]),
    ).some((p) => p.cargoId === "completed");
    assert.ok(placedCompleted, "입고완료 화물도 시각 unit 으로 배치되어야 함");
    // 더이상 컨테이너의 completedCbm 에는 합산되지 않음 (항상 0)
    assert.equal(
      result.containers.every((c) => c.completedCbm === 0),
      true,
      "completedCbm 은 시각 모델에서 0",
    );
    // summary.completedTotalCbm 은 사용자 입력 CBM(c.cbm) 합으로 정보 표시
    assert.equal(result.summary.completedTotalCbm, 25);
  });
});

describe("pack — 중량 한도", () => {
  it("총 화물 중량이 컨테이너 한도 미만이어야 한다 (40FT < 25000kg)", () => {
    // 새 시맨틱: weightPerUnit 은 행 총중량(엑셀 G.W/T) 으로 해석되어 quantity 로 나뉘어 단위중량이 됨.
    // 행 총중량 24000kg → 단위중량 800kg × 30 = 24000kg, 40FT 한도(25000) 미만
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 24000,
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
    // 행 총중량 40000kg (단위중량 2000kg × 20개) → 40FT 1대로는 부족
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 40000,
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
    // unplaced 는 cargoId 단위로 그룹핑되므로 각 entry 의 quantity 를 합산해 비교
    const unplacedUnitCount = result.unplaced.reduce(
      (s, u) => s + (u.quantity ?? 1),
      0,
    );
    assert.ok(placed + unplacedUnitCount === 20);
  });
});
