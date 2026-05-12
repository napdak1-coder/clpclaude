/**
 * Long-Axis Anchor 단위 테스트
 *
 * 룰: 최대 변 ≥ 300 cm 화물을 컨테이너 length 축 모서리에 가장 먼저 강제 anchor.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  anchorLongAxisCargoes,
  findLongAxisCargoes,
  __testables,
} from "./long-axis-anchor.ts";
import { makeContainerState, type UnitItem } from "./extreme-point.ts";
import type { ContainerSpec } from "../../types/container.ts";

const SPEC_40FT: ContainerSpec = {
  type: "40FT",
  innerWidth: 234,
  innerLength: 1200,
  innerHeight: 268,
  doorHeight: 258,
  maxWeightKg: 25000,
  maxCbm: 60,
};

const SPEC_20FT: ContainerSpec = {
  type: "20FT",
  innerWidth: 234,
  innerLength: 590,
  innerHeight: 268,
  doorHeight: 258,
  maxWeightKg: 25000,
  maxCbm: 28,
};

function mkUnit(over: Partial<UnitItem> & { unitId: string; cargoId: string }): UnitItem {
  return {
    unitId: over.unitId,
    cargoId: over.cargoId,
    shipper: over.shipper ?? "TEST",
    bookingNo: over.bookingNo ?? "BK-1",
    name: over.name,
    cargoType: over.cargoType ?? "PL",
    cfsCbm: over.cfsCbm ?? null,
    width: over.width ?? 100,
    length: over.length ?? 100,
    height: over.height ?? 100,
    weight: over.weight ?? 100,
    remarks: over.remarks ?? {
      noStacking: false,
      topOnly: false,
      orientation: "free",
      heavierBelow: false,
    },
  };
}

describe("long-axis-anchor: findLongAxisCargoes", () => {
  it("311cm 막대 1개 → cargoId 골라냄", () => {
    const units = [
      mkUnit({ unitId: "u1", cargoId: "c1", width: 311, length: 15, height: 15 }),
      mkUnit({ unitId: "u2", cargoId: "c2", width: 100, length: 100, height: 100 }),
    ];
    const result = findLongAxisCargoes(units, 300);
    assert.equal(result.size, 1);
    assert.ok(result.has("c1"));
  });

  it("임계 미만 (250cm) → 비활성", () => {
    const units = [
      mkUnit({ unitId: "u1", cargoId: "c1", width: 250, length: 15, height: 15 }),
    ];
    const result = findLongAxisCargoes(units, 300);
    assert.equal(result.size, 0);
  });

  it("326 + 311 두 개 → longest-side desc 정렬", () => {
    const units = [
      mkUnit({ unitId: "u1", cargoId: "shorter", width: 311, length: 15, height: 15 }),
      mkUnit({ unitId: "u2", cargoId: "longer", width: 326, length: 20, height: 20 }),
    ];
    const result = findLongAxisCargoes(units, 300);
    const keys = [...result.keys()];
    assert.deepEqual(keys, ["longer", "shorter"]);
  });
});

describe("long-axis-anchor: anchorLongAxisCargoes — 단일 막대형", () => {
  it("311cm 막대 단행 anchor 성공 — x=0, z=0, length=311 (long-along-length)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "rod-0", cargoId: "rod", width: 311, length: 15, height: 15, weight: 50 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 1);
    assert.equal(cont.packState.placements.length, 1);
    const p = cont.packState.placements[0];
    assert.equal(p.position.x, 0);
    assert.equal(p.position.z, 0);
    // 가장 긴 변(311) 이 length 축에 정렬되어야
    assert.equal(p.size.length, 311);
    // y 위치는 모서리 (0 또는 innerLength-311)
    assert.ok(p.position.y === 0 || Math.abs(p.position.y - (SPEC_40FT.innerLength - 311)) < 0.01);
  });
});

describe("long-axis-anchor: 여러 화물 동시 anchor", () => {
  it("326cm + 311cm 두 막대 동시 anchor (FLOWBUS + 세아특수강 시나리오)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "flow-0", cargoId: "flowbus", width: 326, length: 30, height: 30, weight: 200 }),
      mkUnit({ unitId: "sea-0", cargoId: "seah", width: 311, length: 15, height: 15, weight: 60 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 2);
    assert.equal(cont.packState.placements.length, 2);
    // 모두 z=0, 같은 모서리 라인 (y 동일) — 한 줄로 anchor
    const ys = cont.packState.placements.map((p) => p.position.y);
    assert.ok(ys.every((y) => y === ys[0]));
    for (const p of cont.packState.placements) {
      assert.equal(p.position.z, 0);
    }
    // x 좌표 다름 (옆에 anchor)
    const xs = cont.packState.placements.map((p) => p.position.x).sort((a, b) => a - b);
    assert.equal(xs[0], 0);
    assert.ok(xs[1] > 0);
  });
});

describe("long-axis-anchor: 거부 케이스", () => {
  it("임계 미만 (250cm) 비활성 — placements 0", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "u1", cargoId: "c1", width: 250, length: 15, height: 15 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 0);
    assert.equal(cont.packState.placements.length, 0);
  });

  it("모든 회전 안 맞는 박스 (1300cm > 컨 length 1200) → 거부 + 다음 cargo 진행", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "huge-0", cargoId: "huge", width: 1300, length: 15, height: 15, weight: 50 }),
      mkUnit({ unitId: "fit-0", cargoId: "fit", width: 311, length: 15, height: 15, weight: 50 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    // huge 는 거부, fit 는 anchor
    assert.equal(placed.size, 1);
    assert.ok(placed.has("fit-0"));
    assert.ok(!placed.has("huge-0"));
  });

  it("enabled=false 면 동작 안 함", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "u1", cargoId: "c1", width: 311, length: 15, height: 15 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units, { enabled: false });
    assert.equal(placed.size, 0);
  });
});

describe("long-axis-anchor: row-lane bundle (2026-05-12 추가)", () => {
  it("FLOWBUS 326×116×110 ×2 → row-lane 묶음 성공 (z=0 한 row, 폭 116+116=232 ≤ 234)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({
        unitId: "flw-0",
        cargoId: "flowbus",
        width: 326,
        length: 116,
        height: 110,
        weight: 800,
      }),
      mkUnit({
        unitId: "flw-1",
        cargoId: "flowbus",
        width: 326,
        length: 116,
        height: 110,
        weight: 800,
      }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 2, "두 박스 모두 anchor 되어야 함");
    assert.equal(cont.packState.placements.length, 2);
    // 모두 z=0 (한 row, 적층 X)
    for (const p of cont.packState.placements) {
      assert.equal(p.position.z, 0, `z=0 평면이어야 (실제: ${p.position.z})`);
    }
    // 모두 동일 y (한 row 라인)
    const ys = cont.packState.placements.map((p) => p.position.y);
    assert.equal(ys[0], ys[1], "두 박스 y 좌표 동일해야 (한 row)");
    // length 축에 326 정렬
    for (const p of cont.packState.placements) {
      assert.equal(p.size.length, 326, "가장 긴 변 326 이 length 축에 정렬");
    }
    // x 좌표가 폭만큼 차이
    const xs = cont.packState.placements.map((p) => p.position.x).sort((a, b) => a - b);
    assert.equal(xs[0], 0, "첫 박스 x=0");
    assert.equal(xs[1], 116, "두 번째 박스 x=116 (폭 옆)");
  });

  it("큐브형 200×200×200 ×2 → row-lane 안 발동 (slenderness 1.0 > 0.40)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({
        unitId: "cube-0",
        cargoId: "cube",
        width: 200,
        length: 200,
        height: 200,
        weight: 500,
      }),
      mkUnit({
        unitId: "cube-1",
        cargoId: "cube",
        width: 200,
        length: 200,
        height: 200,
        weight: 500,
      }),
    ];
    // findLongAxisCargoes 단계에서 슬렌더니스 1.0 으로 거부 → anchor 0
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 0, "큐브형은 row-lane 안 발동");
    assert.equal(cont.packState.placements.length, 0);
  });

  it("단일 unit (qty=1) → row-lane 안 발동 (기존 단행 anchor 진입)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({
        unitId: "solo-0",
        cargoId: "solo",
        width: 326,
        length: 116,
        height: 110,
        weight: 800,
      }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    // 단행 = row-lane 거부 (≥2 조건), 기존 단행 anchor 로 처리
    assert.equal(placed.size, 1, "단일은 기존 단행 anchor 로 처리");
    assert.equal(cont.packState.placements.length, 1);
    const p = cont.packState.placements[0];
    assert.equal(p.size.length, 326);
    assert.equal(p.position.z, 0);
  });

  it("적층 가능 + 길이 짧음 (150cm 컨 길이 25% 미만 + noStacking=false) → row-lane 안 발동", () => {
    // 길이 150 < 1200 × 0.25 = 300 AND 적층 가능 → row-lane 거부
    // findLongAxisCargoes 도 절대 길이 임계(300) 못 넘어 통과 X
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({
        unitId: "short-0",
        cargoId: "short",
        width: 150,
        length: 50,
        height: 50,
        weight: 100,
      }),
      mkUnit({
        unitId: "short-1",
        cargoId: "short",
        width: 150,
        length: 50,
        height: 50,
        weight: 100,
      }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    assert.equal(placed.size, 0, "짧은 박스는 long-axis 자체 비활성");
  });

  it("FLOWBUS ×3 → 116×3=348 > 234 → row-lane 거부 → 단일 cursor anchor 로 폴백", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units = [
      mkUnit({ unitId: "f0", cargoId: "fl3", width: 326, length: 116, height: 110, weight: 800 }),
      mkUnit({ unitId: "f1", cargoId: "fl3", width: 326, length: 116, height: 110, weight: 800 }),
      mkUnit({ unitId: "f2", cargoId: "fl3", width: 326, length: 116, height: 110, weight: 800 }),
    ];
    const placed = anchorLongAxisCargoes(cont, units);
    // row-lane 은 거부 (3×116=348 > 234), 기존 cursor anchor 가 처리 (가능한 만큼 한 줄 + 줄바꿈)
    // 모두 들어가는 게 보장되진 않지만, 최소한 충돌·CBM 쪼개기 없이 통째로 배치 또는 0.
    // 통째 commit 룰이라 일부만 들어가지는 않음.
    assert.ok(
      placed.size === 0 || placed.size === 3,
      `통째로 0 또는 전부 (실제: ${placed.size})`,
    );
  });
});

describe("long-axis-anchor: SLENDERNESS_THRESHOLD 0.40", () => {
  it("FLOWBUS 비율 110/326 = 0.337 → 통과", () => {
    const u = mkUnit({ unitId: "u1", cargoId: "c1", width: 326, length: 116, height: 110 });
    const r = __testables.maxSlendernessRatioOf([u]);
    assert.ok(r <= __testables.SLENDERNESS_THRESHOLD, `${r} ≤ ${__testables.SLENDERNESS_THRESHOLD}`);
  });

  it("VPHI 비율 71/114 = 0.62 → 탈락 (큐브형 보호)", () => {
    const u = mkUnit({ unitId: "u1", cargoId: "c1", width: 114, length: 114, height: 71 });
    const r = __testables.maxSlendernessRatioOf([u]);
    assert.ok(r > __testables.SLENDERNESS_THRESHOLD, `${r} > ${__testables.SLENDERNESS_THRESHOLD}`);
  });

  it("311 막대 비율 15/311 = 0.048 → 통과 (기존 동작 유지)", () => {
    const u = mkUnit({ unitId: "u1", cargoId: "c1", width: 311, length: 15, height: 15 });
    const r = __testables.maxSlendernessRatioOf([u]);
    assert.ok(r <= __testables.SLENDERNESS_THRESHOLD);
  });
});

describe("long-axis-anchor: __testables.pickLongAlongLengthFace", () => {
  it("311×15×15 → length 축에 311 정렬되는 face 선택", () => {
    const u = mkUnit({ unitId: "u1", cargoId: "c1", width: 311, length: 15, height: 15 });
    const pick = __testables.pickLongAlongLengthFace(u, SPEC_40FT);
    assert.notEqual(pick, null);
    assert.equal(pick!.eff.length, 311);
  });

  it("1300×15×15 (컨 length 1200 초과) → null", () => {
    const u = mkUnit({ unitId: "u1", cargoId: "c1", width: 1300, length: 15, height: 15 });
    const pick = __testables.pickLongAlongLengthFace(u, SPEC_40FT);
    assert.equal(pick, null);
  });
});
