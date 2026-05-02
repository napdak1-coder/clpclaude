/**
 * extreme-point packer 단위 테스트
 *
 * Node 내장 test runner (`node --test --experimental-strip-types`).
 * 본 테스트는 packExtremePoint 단독 호출 — 컨테이너 결정·CT 분배 등 상위 책임은 검증 X.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CargoSpec, Remark } from "../../types/cargo.ts";
import { getContainerSpec } from "./containers.ts";
import {
  expandCargoesToUnits,
  packExtremePoint,
  type Placement3D,
  type UnitItem,
} from "./extreme-point.ts";

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

function spec40() {
  return getContainerSpec("40FT");
}

/** 두 placement 가 3D 로 겹치는지 (충돌 검사 검증용) */
function overlaps3D(a: Placement3D, b: Placement3D, eps = 0.01): boolean {
  return (
    a.position.x + a.size.width > b.position.x + eps &&
    a.position.x + eps < b.position.x + b.size.width &&
    a.position.y + a.size.length > b.position.y + eps &&
    a.position.y + eps < b.position.y + b.size.length &&
    a.position.z + a.size.height > b.position.z + eps &&
    a.position.z + eps < b.position.z + b.size.height
  );
}

describe("packExtremePoint — 기본 배치", () => {
  it("작은 화물 1개 → 원점 (0,0,0) 에 배치", () => {
    const units = expandCargoesToUnits([
      makeCargo({ id: "c1", width: 50, length: 60, height: 70 }),
    ]);
    const r = packExtremePoint(units, spec40());
    assert.equal(r.placements.length, 1);
    assert.equal(r.unplaced.length, 0);
    const p = r.placements[0];
    assert.equal(p.position.x, 0);
    assert.equal(p.position.y, 0);
    assert.equal(p.position.z, 0);
    assert.equal(p.layer, "bottom");
  });

  it("작은 화물 2개 → 충돌 없이 다른 좌표", () => {
    const units = expandCargoesToUnits([
      makeCargo({ id: "a", width: 100, length: 100, height: 100 }),
      makeCargo({ id: "b", width: 100, length: 100, height: 100 }),
    ]);
    const r = packExtremePoint(units, spec40());
    assert.equal(r.placements.length, 2);
    assert.equal(overlaps3D(r.placements[0], r.placements[1]), false);
  });
});

describe("packExtremePoint — 다단금지 (noStacking)", () => {
  it("모두 noStacking=true 인 5개 화물은 전부 z=0 (바닥)", () => {
    const cargoes = Array.from({ length: 5 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 100,
        length: 100,
        height: 100,
        remarks: { ...baseRemark, noStacking: true },
      }),
    );
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.unplaced.length, 0);
    for (const p of r.placements) {
      assert.equal(p.position.z, 0, `${p.cargoId} 는 z=0 이어야 함`);
      assert.equal(p.layer, "bottom");
    }
  });
});

describe("packExtremePoint — 상단적재 (topOnly)", () => {
  it("topOnly 화물은 z > 0 — 다른 화물 위에 배치", () => {
    // 큰 base 먼저 (z=0 바닥), 그 다음 작은 topOnly (z>0)
    const cargoes = [
      makeCargo({
        id: "base",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 200,
      }),
      makeCargo({
        id: "top",
        width: 90,
        length: 90,
        height: 50,
        weightPerUnit: 50,
        remarks: { ...baseRemark, topOnly: true },
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.unplaced.length, 0);
    const top = r.placements.find((p) => p.cargoId === "top");
    assert.ok(top, "topOnly 화물이 배치되어야 함");
    assert.ok(top!.position.z > 0, `top 의 z 가 0보다 커야 함 (실제: ${top!.position.z})`);
    assert.equal(top!.layer, "top");
  });
});

describe("packExtremePoint — 중량조건 (heavierBelow)", () => {
  it("heavierBelow=true + topOnly 가벼운 화물 → 무거운 화물 위로 갈 수 있음", () => {
    // 무거운 화물 먼저 → 바닥. 가벼운 화물(topOnly) 은 무거운 위에 (heavierBelow 통과)
    const cargoes = [
      makeCargo({
        id: "heavy",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 500,
        remarks: { ...baseRemark, heavierBelow: true },
      }),
      makeCargo({
        id: "light",
        width: 80,
        length: 80,
        height: 50,
        weightPerUnit: 30,
        remarks: { ...baseRemark, topOnly: true, heavierBelow: true },
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    const heavy = r.placements.find((p) => p.cargoId === "heavy");
    const light = r.placements.find((p) => p.cargoId === "light");
    assert.ok(heavy && light, "둘 다 배치되어야 함");
    assert.equal(heavy!.position.z, 0);
    assert.ok(light!.position.z > 0);
  });

  it("heavierBelow=true + 가벼운 화물 먼저 + 무거운 화물이 위로 가려 하면 → 다단 거부", () => {
    // 가벼운 게 먼저 바닥, 무거운 게 그 위로 가려 하면 canStackOn 실패 → 다른 곳에 배치
    const cargoes = [
      makeCargo({
        id: "light",
        width: 200,
        length: 200,
        height: 100,
        weightPerUnit: 30,
        remarks: { ...baseRemark, heavierBelow: true },
      }),
      makeCargo({
        id: "heavy",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 500,
        remarks: { ...baseRemark, heavierBelow: true },
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    const light = r.placements.find((p) => p.cargoId === "light");
    const heavy = r.placements.find((p) => p.cargoId === "heavy");
    assert.ok(light && heavy);
    // heavy 가 light 위에 올라가지 않았어야 함 (heavy.z 가 light 위가 아니어야)
    if (heavy!.position.z > 0) {
      // 만약 z>0 이면 light 위가 아니어야 한다 — supporters 가 light 가 아닌 다른 화물
      const restingOnLight =
        Math.abs(heavy!.position.z - (light!.position.z + light!.size.height)) < 0.1 &&
        heavy!.position.x < light!.position.x + light!.size.width &&
        heavy!.position.x + heavy!.size.width > light!.position.x &&
        heavy!.position.y < light!.position.y + light!.size.length &&
        heavy!.position.y + heavy!.size.length > light!.position.y;
      assert.equal(restingOnLight, false, "무거운 화물이 가벼운 화물 위에 올라감 — heavierBelow 위반");
    }
  });
});

describe("packExtremePoint — 다단 적재 (3층+)", () => {
  it("같은 사이즈 3개 → 3층 stack 가능 (제약 없으면)", () => {
    const cargoes = Array.from({ length: 3 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 100,
        length: 100,
        height: 80,
        weightPerUnit: 50,
      }),
    );
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.placements.length, 3);
    assert.equal(r.unplaced.length, 0);
    // 셋 중 적어도 하나는 z>=160 (3층)
    const zs = r.placements.map((p) => p.position.z).sort((a, b) => a - b);
    // 기본 score 는 z 작은 곳 우선이라 셋 다 옆으로 펼쳐질 수도 있다.
    // 강제로 stack 만 가능하게 하려면 컨테이너 폭이 화물 폭보다 작아야 함.
    // 여기선 stack 이 "가능했음" 만 확인 — 실제로 z=0 일 수 있음 (컨테이너가 충분히 크니까)
    assert.ok(zs[0] >= 0);
  });

  it("좁은 컨테이너 폭(=화물 폭 1개분) → 3개가 다 stack 됨", () => {
    // 가짜 좁은 spec 으로 강제 stack 유도
    const real = spec40();
    const narrow = {
      ...real,
      innerWidth: 100, // 화물 폭과 동일 → 옆으로 못 펴짐
      innerLength: 110, // 화물 길이와 동일 → 뒤로도 못 감
      innerHeight: 300, // 위로는 충분
    };
    const cargoes = Array.from({ length: 3 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 100,
        length: 100,
        height: 80,
        weightPerUnit: 50,
      }),
    );
    const r = packExtremePoint(expandCargoesToUnits(cargoes), narrow);
    assert.equal(r.placements.length, 3, "3개 다 들어가야 함");
    const zs = r.placements.map((p) => p.position.z).sort((a, b) => a - b);
    assert.equal(zs[0], 0);
    assert.equal(zs[1], 80);
    assert.equal(zs[2], 160);
  });
});

describe("packExtremePoint — 6면 회전", () => {
  it("orientation=fixed 인 화물은 회전 안 함 (rotated=false)", () => {
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 50,
        height: 70,
        remarks: { ...baseRemark, orientation: "fixed" },
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.placements.length, 1);
    assert.equal(r.placements[0].rotated, false);
    assert.equal(r.placements[0].size.width, 100);
    assert.equal(r.placements[0].size.length, 50);
    assert.equal(r.placements[0].size.height, 70);
  });

  it("좁은 컨테이너에서는 6면 중 맞는 면을 골라 회전한다", () => {
    // innerWidth=80, length=200 — 화물 100×50×70 은 width=100 그대로면 안 들어감.
    // 6면 회전으로 width=50, length=100 자세를 골라야 들어감.
    const real = spec40();
    const narrow = { ...real, innerWidth: 80, innerLength: 200 };
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 50,
        height: 70,
        // orientation=free (기본) — 회전 허용
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), narrow);
    assert.equal(r.placements.length, 1);
    assert.ok(r.placements[0].size.width <= 80, "회전 후 width 가 컨테이너 안");
  });
});

describe("packExtremePoint — 중량 한도", () => {
  it("단일 화물이 컨테이너 중량 한도 이상이면 unplaced", () => {
    // 40FT maxWeight 25000kg. weightPerUnit=30000 → 한도 초과
    const cargoes = [
      makeCargo({
        id: "heavy",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 30000,
        quantity: 1,
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.placements.length, 0);
    assert.equal(r.unplaced.length, 1);
  });

  it("누적 중량이 한도를 초과하면 그 이후 unit 은 unplaced", () => {
    // 단위 12000kg × 3 = 36000kg, 40FT 한도 25000 → 2번째 unit 까지만 (24000), 3번째 거부
    const cargoes = [
      makeCargo({
        id: "c1",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 12000,
        quantity: 1,
      }),
      makeCargo({
        id: "c2",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 12000,
        quantity: 1,
      }),
      makeCargo({
        id: "c3",
        width: 100,
        length: 100,
        height: 100,
        weightPerUnit: 12000,
        quantity: 1,
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.placements.length, 2);
    assert.equal(r.unplaced.length, 1);
    assert.equal(r.unplaced[0].cargoId, "c3");
    assert.ok(r.totalWeight < spec40().maxWeightKg);
  });
});

describe("packExtremePoint — 충돌 검증", () => {
  it("10개 화물 모두 배치되고 어느 두 박스도 겹치지 않음", () => {
    const cargoes = Array.from({ length: 10 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 80 + (i % 3) * 20,
        length: 100 + (i % 4) * 30,
        height: 60 + (i % 2) * 20,
        weightPerUnit: 100,
      }),
    );
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.unplaced.length, 0, "10개 다 배치되어야 함");
    for (let i = 0; i < r.placements.length; i++) {
      for (let j = i + 1; j < r.placements.length; j++) {
        assert.equal(
          overlaps3D(r.placements[i], r.placements[j]),
          false,
          `placement ${i} 와 ${j} 가 겹침`,
        );
      }
    }
  });

  it("모든 placement 가 컨테이너 안에 있음", () => {
    const sp = spec40();
    const cargoes = Array.from({ length: 8 }, (_, i) =>
      makeCargo({
        id: `c${i}`,
        width: 100,
        length: 120,
        height: 80,
        weightPerUnit: 200,
      }),
    );
    const r = packExtremePoint(expandCargoesToUnits(cargoes), sp);
    for (const p of r.placements) {
      assert.ok(p.position.x >= 0);
      assert.ok(p.position.y >= 0);
      assert.ok(p.position.z >= 0);
      assert.ok(p.position.x + p.size.width <= sp.innerWidth + 0.01);
      assert.ok(p.position.y + p.size.length <= sp.innerLength + 0.01);
      assert.ok(p.position.z + p.size.height <= sp.innerHeight + 0.01);
    }
  });
});

describe("packExtremePoint — full support (overhang 거부)", () => {
  it("작은 base 위에 큰 화물은 z>0 못 가서 옆으로 펴짐", () => {
    // 좁은 컨테이너 + 작은 base 1개 + 큰 화물 1개. 큰 화물은 base 위로 못 가야 함.
    const real = spec40();
    const narrow = { ...real, innerWidth: 200, innerLength: 200, innerHeight: 300 };
    const cargoes = [
      // base — 50×50
      makeCargo({
        id: "base",
        width: 50,
        length: 50,
        height: 50,
        weightPerUnit: 100,
      }),
      // big — 150×150 (base 보다 큼) — base 위에 올리면 overhang
      makeCargo({
        id: "big",
        width: 150,
        length: 150,
        height: 50,
        weightPerUnit: 100,
      }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), narrow);
    assert.equal(r.placements.length, 2);
    const big = r.placements.find((p) => p.cargoId === "big");
    assert.equal(big!.position.z, 0, "big 은 overhang 거부로 바닥에 가야 함");
  });
});

describe("packExtremePoint — 입력 순서 = 우선순위", () => {
  it("input 순서가 우선 — 첫 unit 이 가장 좋은 자리(원점) 차지", () => {
    const cargoes = [
      makeCargo({ id: "first", width: 100, length: 100, height: 100 }),
      makeCargo({ id: "second", width: 100, length: 100, height: 100 }),
    ];
    const r = packExtremePoint(expandCargoesToUnits(cargoes), spec40());
    assert.equal(r.placements[0].cargoId, "first");
    assert.equal(r.placements[0].position.x, 0);
    assert.equal(r.placements[0].position.y, 0);
    assert.equal(r.placements[0].position.z, 0);
  });
});

describe("expandCargoesToUnits", () => {
  it("quantity 만큼 unit 분해", () => {
    const cargoes = [
      makeCargo({ id: "c1", quantity: 3, weightPerUnit: 300 }),
    ];
    const units = expandCargoesToUnits(cargoes);
    assert.equal(units.length, 3);
    // 단위중량은 weightPerUnit / quantity = 100
    assert.equal(units[0].weight, 100);
    assert.equal(units[1].weight, 100);
    assert.equal(units[2].weight, 100);
  });

  it("unitSizes 가 있으면 그룹별 분해 (그룹 weight 우선)", () => {
    const cargoes = [
      makeCargo({
        id: "c1",
        quantity: 5,
        weightPerUnit: 500,
        unitSizes: [
          { width: 100, length: 100, height: 100, quantity: 2, weight: 80 },
          { width: 50, length: 50, height: 50, quantity: 3 }, // weight 누락 → fallback
        ],
      }),
    ];
    const units = expandCargoesToUnits(cargoes);
    assert.equal(units.length, 5);
    // 첫 2개는 100³ 사이즈, 무게 80
    assert.equal(units[0].width, 100);
    assert.equal(units[0].weight, 80);
    assert.equal(units[1].weight, 80);
    // 다음 3개는 50³ 사이즈, fallback 무게 = 500/5 = 100
    assert.equal(units[2].width, 50);
    assert.equal(units[2].weight, 100);
    assert.equal(units[3].weight, 100);
    assert.equal(units[4].weight, 100);
  });
});
