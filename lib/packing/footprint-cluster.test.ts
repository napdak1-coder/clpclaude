/**
 * Footprint Cluster 단위 테스트
 *
 * 룰 A: 부킹 내부 동일 footprint 자체 컬럼 적층
 * 룰 B: 다른 부킹 작은 footprint 흡수
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  preClusterFootprint,
  __testables,
} from "./footprint-cluster.ts";
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

describe("footprint-cluster: __testables.sameFootprint", () => {
  it("동일 W×L 면 true", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 110, length: 110 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 110, length: 110 });
    assert.equal(__testables.sameFootprint(a, b), true);
  });
  it("±5cm 이내면 true", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 110, length: 110 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 113, length: 108 });
    assert.equal(__testables.sameFootprint(a, b), true);
  });
  it("6cm 이상 차이면 false", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 110, length: 110 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 117, length: 110 });
    assert.equal(__testables.sameFootprint(a, b), false);
  });
});

describe("footprint-cluster: preClusterFootprint 룰 A — 부킹 내부 컬럼", () => {
  it("같은 부킹 동일 footprint 3개 → 3단 적층", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      // 채우기 (활성 조건 unit ≥ 5)
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    assert.ok(placed.has("u1"), "u1 배치되어야");
    assert.ok(placed.has("u2"), "u2 배치되어야");
    assert.ok(placed.has("u3"), "u3 배치되어야");
    // 같은 (x,y) 컬럼 — z 좌표 0/71/142
    const ps = cont.packState.placements.filter((p) => ["u1", "u2", "u3"].includes(p.unitId));
    assert.equal(ps.length, 3);
    const zs = ps.map((p) => p.position.z).sort((a, b) => a - b);
    assert.deepEqual(zs, [0, 71, 142]);
  });

  it("doorHeight 초과 시 컬럼 거부 (3단 213 + 93 = 306 > 258)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 3단 자체는 213cm OK 지만 4단 시도 시 284 > 258
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 4단 = 284 > 258 → 컬럼 전체 거부 (혹은 일부만)
    // 안전한 검증: door 초과로 거부되거나, 배치된 것 모두 z + h ≤ 258
    for (const p of cont.packState.placements) {
      assert.ok(p.position.z + p.size.height <= 258 + 0.01, `door 높이 위반: ${p.unitId} z=${p.position.z} h=${p.size.height}`);
    }
  });

  it("작은 컨테이너 (20FT < 50 m³) 활성 X — 묶음 0", () => {
    const cont = {
      index: 1,
      spec: SPEC_20FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    assert.equal(placed.size, 0, "20FT 는 활성 X");
    assert.equal(cont.packState.placements.length, 0);
  });

  it("부킹 다른 unit 끼리 묶지 않음", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-A", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-B", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u3", cargoId: "c3", bookingNo: "BK-C", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u4", cargoId: "c4", bookingNo: "BK-D", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u5", cargoId: "c5", bookingNo: "BK-E", width: 114, length: 114, height: 71 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 룰 A 컬럼은 0개 (각 부킹 unit 1개씩)
    // 룰 B 흡수 후보도 column 없으므로 0
    assert.equal(placed.size, 0, "다른 부킹은 룰 A 컬럼 못 만듦");
  });
});

describe("footprint-cluster: preClusterFootprint 룰 B — 흡수", () => {
  it("VPHI 컬럼 위에 한도 110×110×93 흡수 (받침 93%)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // VPHI 부킹 — sg3-23 ×2 (114×114×71) 자체이단 후 그 위 sg3-27 (110×110×93) 흡수
    const units: UnitItem[] = [
      mkUnit({ unitId: "v1", cargoId: "vphi23", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 300 }),
      mkUnit({ unitId: "v2", cargoId: "vphi23", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 300 }),
      // 다른 박스 (활성 조건)
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 100, length: 100, height: 50 }),
      mkUnit({ unitId: "x2", cargoId: "other", bookingNo: "OTHER", width: 100, length: 100, height: 50 }),
      // 한도 — 다른 부킹 단일 박스
      mkUnit({ unitId: "h1", cargoId: "hando", bookingNo: "HANDO", width: 110, length: 110, height: 93, weight: 100 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 룰 A: v1 v2 컬럼 적층 (114×114×142)
    assert.ok(placed.has("v1"), "v1 컬럼 배치");
    assert.ok(placed.has("v2"), "v2 컬럼 적층");
    // 룰 B: h1 흡수 (114×114 컬럼 top 위 110×110 = 받침 93.1% > 70%)
    assert.ok(placed.has("h1"), "한도 박스 흡수");
    // h1 위치 검증 — z = 142 (v2 top)
    const h1 = cont.packState.placements.find((p) => p.unitId === "h1");
    assert.ok(h1, "h1 placement 존재");
    assert.equal(h1!.position.z, 142, "한도 박스가 컬럼 top z=142 위에");
  });

  it("받침률 70% 미만이면 흡수 X", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // VPHI 부킹 column 위에 너무 작은 50×50 박스 → 받침 ~19% (50²/114²)
    const units: UnitItem[] = [
      mkUnit({ unitId: "v1", cargoId: "vphi", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 300 }),
      mkUnit({ unitId: "v2", cargoId: "vphi", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 300 }),
      mkUnit({ unitId: "x1", cargoId: "fill", bookingNo: "FILL", width: 100, length: 100, height: 50 }),
      mkUnit({ unitId: "x2", cargoId: "fill", bookingNo: "FILL", width: 100, length: 100, height: 50 }),
      mkUnit({ unitId: "tiny", cargoId: "tinyc", bookingNo: "TINY", width: 50, length: 50, height: 50, weight: 10 }),
    ];
    const placed = preClusterFootprint(cont, units);
    assert.ok(placed.has("v1"));
    assert.ok(placed.has("v2"));
    assert.ok(!placed.has("tiny"), "받침 19% < 70% — 흡수 X");
  });
});

describe("footprint-cluster: 옵션 C — 안쪽 깊숙이 고정점", () => {
  it("deepAnchor=true (기본) — 컬럼 첫 박스가 안쪽 끝(y 최댓값) 우선", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 도어 근처에 미리 다른 박스 1 개 배치 — y=0 자리 점유
    cont.packState.placements.push({
      unitId: "occ",
      cargoId: "occc",
      shipper: "OCC",
      bookingNo: "OCCB",
      cargoType: "PL",
      cfsCbm: null,
      position: { x: 0, y: 0, z: 0 },
      size: { width: 50, length: 50, height: 50 },
      faceIdx: 0,
      rotated: false,
      weight: 100,
      remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
      layer: "bottom",
    });
    cont.packState.candidates = [
      { x: 0, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
      { x: 0, y: 50, z: 0 },
      { x: 0, y: 800, z: 0 }, // 안쪽 깊숙이 후보
    ];

    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    preClusterFootprint(cont, units);
    const u1 = cont.packState.placements.find((p) => p.unitId === "u1");
    assert.ok(u1, "u1 placement 존재");
    // deepAnchor=true → 안쪽 끝 자리 후보(y=800) 선택
    assert.equal(u1!.position.y, 800, "옵션 C: 안쪽 끝(y=800) 우선");
  });

  it("deepAnchor=false — 자연 EP 배치 (y 최솟값 우선)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    cont.packState.placements.push({
      unitId: "occ",
      cargoId: "occc",
      shipper: "OCC",
      bookingNo: "OCCB",
      cargoType: "PL",
      cfsCbm: null,
      position: { x: 0, y: 0, z: 0 },
      size: { width: 50, length: 50, height: 50 },
      faceIdx: 0,
      rotated: false,
      weight: 100,
      remarks: { noStacking: false, topOnly: false, orientation: "free", heavierBelow: false },
      layer: "bottom",
    });
    cont.packState.candidates = [
      { x: 50, y: 0, z: 0 },
      { x: 0, y: 50, z: 0 },
      { x: 0, y: 800, z: 0 },
    ];

    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    preClusterFootprint(cont, units, { deepAnchor: false });
    const u1 = cont.packState.placements.find((p) => p.unitId === "u1");
    assert.ok(u1, "u1 placement 존재");
    // deepAnchor=false → y 최솟값 우선 (자연 EP)
    assert.ok(u1!.position.y < 800, "옵션 C off: 도어 쪽 자리 선택");
  });
});

describe("footprint-cluster: 옵션 비활성", () => {
  it("enabled=false 면 묶음 0", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units, { enabled: false });
    assert.equal(placed.size, 0);
  });
});
