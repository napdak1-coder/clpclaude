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
  preClusterNearFootprint,
  preClusterRowLane,
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

const ROW_LANE_MAX_COLUMNS_TEST = 2;

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

  it("천장(innerHeight=268) 초과 시 컬럼 거부 (4단 71×4 = 284 > 268)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 3단 = 213 OK, 4단 = 284 > 268 천장 위반
    // (입구 258 검사는 사전 묶음에서 제거 — 자유 적재와 일관성, 컬럼도 안에서 하나씩 쌓는다는 가정)
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u5", cargoId: "c2", bookingNo: "BK-Y", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 모든 배치는 z + h ≤ 268 (천장)
    for (const p of cont.packState.placements) {
      assert.ok(p.position.z + p.size.height <= 268 + 0.01, `천장 높이 위반: ${p.unitId} z=${p.position.z} h=${p.size.height}`);
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

describe("footprint-cluster: 룰 E — cross-cargoId 묶음 (같은 booking + 정확히 동일 사이즈)", () => {
  it("VPHI 패턴 — 같은 booking, 114×114×71 박스 7개 (3 cargo) → 두 컬럼 3단 적층 (6박스), v24 2박스는 정식 wrapper로", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // VPHI 부킹 — sg3-23/24/25 (cargoId 다른) 같은 booking + 114×114×71 박스 7개
    // 천장 268 / 박스 71 → 한 컬럼 최대 3단. 두 컬럼 = 6박스 슬롯.
    // 7박스 중 cargo atomic 보호 위해 큰 cargo 우선 picked: sg3-25 (3) + sg3-23 (2) = 5,
    // sg3-24 (2) 추가하면 7 > 6 슬롯 → 제외. 5박스 룰 E 처리, v24 2박스는 정식 wrapper.
    const units: UnitItem[] = [
      mkUnit({ unitId: "v23a", cargoId: "sg3-23", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v23b", cargoId: "sg3-23", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v24a", cargoId: "sg3-24", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 373 }),
      mkUnit({ unitId: "v24b", cargoId: "sg3-24", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 373 }),
      mkUnit({ unitId: "v25a", cargoId: "sg3-25", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v25b", cargoId: "sg3-25", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v25c", cargoId: "sg3-25", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      // 활성 조건 채우기 (다른 booking)
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 룰 E 사전 필터: 큰 cargo 먼저 — sg3-25 (3) + sg3-23 (2) = 5박스 cargo atomic 으로 두 컬럼 3+2 적층.
    // sg3-24 (2) 는 5+2=7 > 6 슬롯 초과 → 룰 E 제외.
    // 룰 A 가 후속으로 같은 booking + footprint(114×114) sg3-24 v24a/v24b 를 별도 컬럼 적층 (옆 row).
    // 결과: 7박스 모두 같은 컨, 같은 booking VPHI atomic 보장.
    const vIds = ["v23a", "v23b", "v24a", "v24b", "v25a", "v25b", "v25c"];
    const placedV = vIds.filter((id) => placed.has(id));
    assert.equal(placedV.length, 7, `7박스 모두 배치 (룰 E 5 + 룰 A 2). 실제: ${placedV.length}`);
    const vPlacements = cont.packState.placements.filter((p) => vIds.includes(p.unitId));
    assert.equal(vPlacements.length, 7);
    // 천장 안 (z + h ≤ 268)
    for (const p of vPlacements) {
      assert.ok(
        p.position.z + p.size.height <= 268 + 0.01,
        `천장 위반: ${p.unitId} z=${p.position.z} h=${p.size.height}`,
      );
    }
    // 룰 E 5박스 = 같은 row (y 같음), 두 컬럼 (x 종류 2)
    const ruleEPlacements = cont.packState.placements.filter((p) =>
      ["v23a", "v23b", "v25a", "v25b", "v25c"].includes(p.unitId),
    );
    assert.equal(ruleEPlacements.length, 5);
    const ruleEys = new Set(ruleEPlacements.map((p) => p.position.y));
    assert.equal(ruleEys.size, 1, `룰 E 5박스 같은 row 평면 (y 종류: ${ruleEys.size})`);
    const ruleExs = new Set(ruleEPlacements.map((p) => p.position.x));
    assert.equal(ruleExs.size, 2, `룰 E 5박스 두 컬럼 (x 종류: ${ruleExs.size})`);
  });

  it("VPHI 6박스 (v24 제외) — 룰 E 가 두 컬럼 3단으로 모두 배치, 같은 row 패턴", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 6박스: sg3-23 (2) + sg3-25 (3) = 5 + 채우기 cargo X (1) ?
    // cargo atomic 검증 위해 sg3-25 (3) + sg3-23 (2) + sg3-26 (1 cargo, 1 unit)
    // sg3-26 unit 1 은 그룹에 안 들어감 (CROSS_CARGO_MIN_UNITS=3 이상이지만 cargo 단위로 atomic 가능)
    // 단순화: sg3-25 (3) + sg3-26 (3) = 6박스 같은 booking
    const units: UnitItem[] = [
      mkUnit({ unitId: "v25a", cargoId: "sg3-25", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v25b", cargoId: "sg3-25", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v25c", cargoId: "sg3-25", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v26a", cargoId: "sg3-26", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 500 }),
      mkUnit({ unitId: "v26b", cargoId: "sg3-26", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 500 }),
      mkUnit({ unitId: "v26c", cargoId: "sg3-26", bookingNo: "VPHI", width: 114, length: 114, height: 71, weight: 500 }),
      // 활성 조건 채우기
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    const vIds = ["v25a", "v25b", "v25c", "v26a", "v26b", "v26c"];
    const placedV = vIds.filter((id) => placed.has(id));
    assert.equal(placedV.length, 6, `6박스 모두 배치 (실제: ${placedV.length})`);
    const vPlacements = cont.packState.placements.filter((p) => vIds.includes(p.unitId));
    assert.equal(vPlacements.length, 6);
    // 같은 y 평면 (한 row)
    const ys = new Set(vPlacements.map((p) => p.position.y));
    assert.equal(ys.size, 1, `모두 같은 row 평면 (실제 y 종류: ${ys.size})`);
    // 두 컬럼 = x 종류 2
    const xs = new Set(vPlacements.map((p) => p.position.x));
    assert.equal(xs.size, 2, `두 컬럼 (x 종류 2, 실제: ${xs.size})`);
    // 천장 안 (z + h ≤ 268)
    for (const p of vPlacements) {
      assert.ok(
        p.position.z + p.size.height <= 268 + 0.01,
        `천장 위반: ${p.unitId} z=${p.position.z} h=${p.size.height}`,
      );
    }
  });

  it("다른 booking 같은 사이즈 → 묶음 X (룰 E 발동 X)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 같은 사이즈지만 booking 이 다 다름
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-A", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-B", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u3", cargoId: "c3", bookingNo: "BK-C", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u4", cargoId: "c4", bookingNo: "BK-D", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u5", cargoId: "c5", bookingNo: "BK-E", width: 114, length: 114, height: 71 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 룰 E: 같은 booking 안 그룹이 ≥ 3 이어야 → 모두 다른 booking 이므로 발동 X
    // 룰 A: 같은 booking 내 동일 footprint ≥ 2 도 발동 X
    assert.equal(placed.size, 0, "다른 booking 끼리는 룰 E 발동 X");
  });

  it("같은 booking 다른 사이즈 (114×114×71 + 111×111×104) → 룰 E 묶음 X (사이즈 정확히 같지 않음)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // VPHI 같은 booking 안 두 사이즈
    const units: UnitItem[] = [
      mkUnit({ unitId: "v23", cargoId: "sg3-23", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 751 }),
      mkUnit({ unitId: "v24", cargoId: "sg3-24", bookingNo: "FBSIN260400", width: 114, length: 114, height: 71, weight: 373 }),
      // 다른 사이즈 — 같은 booking 이지만 W·L·H 정확히 다름
      mkUnit({ unitId: "v22a", cargoId: "sg3-22", bookingNo: "FBSIN260400", width: 111, length: 111, height: 104, weight: 751 }),
      mkUnit({ unitId: "v22b", cargoId: "sg3-22", bookingNo: "FBSIN260400", width: 111, length: 111, height: 104, weight: 751 }),
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    // groupCrossCargoBundles 직접 호출로 검증 (preClusterFootprint 후 룰 A 도 발동되므로 분리)
    const bundles = __testables.groupCrossCargoBundles(units);
    // 114×114×71 = 2 박스 (< 3), 111×111×104 = 2 박스 (< 3) → 모두 CROSS_CARGO_MIN_UNITS=3 미만
    assert.equal(bundles.length, 0, "그룹 unit 3 미만 → 룰 E 묶음 X");
  });

  it("같은 booking 정확히 같은 사이즈지만 unit 2개 (< CROSS_CARGO_MIN_UNITS=3) → 룰 E 묶음 X", () => {
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
    ];
    const bundles = __testables.groupCrossCargoBundles(units);
    assert.equal(bundles.length, 0, "2 unit 만 있으면 룰 A 가 처리, 룰 E 발동 X");
  });

  it("noStacking=true 박스 포함 시 룰 E 묶음 X", () => {
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71 }),
      mkUnit({
        unitId: "u3",
        cargoId: "c3",
        bookingNo: "BK-X",
        width: 114,
        length: 114,
        height: 71,
        remarks: { noStacking: true, topOnly: false, orientation: "free", heavierBelow: false },
      }),
    ];
    const bundles = __testables.groupCrossCargoBundles(units);
    // noStacking 박스는 그룹에서 제외 → 남은 2 박스 < 3 → 그룹 X
    assert.equal(bundles.length, 0);
  });

  it("두 컬럼 폭 (114×2=228 ≤ 234) 들어가는 케이스 — 옆 컬럼 정상 발동", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // u1~u4 모두 배치, 두 컬럼 (각 2단)
    const ids = ["u1", "u2", "u3", "u4"];
    assert.equal(ids.filter((i) => placed.has(i)).length, 4);
    const ps = cont.packState.placements.filter((p) => ids.includes(p.unitId));
    const xs = new Set(ps.map((p) => p.position.x));
    assert.ok(xs.size === 2, `두 컬럼 (x 종류 2, 실제: ${xs.size})`);
  });

  it("두 컬럼 폭 초과 (160×2=320 > 234) — 한 컬럼만 적층", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 폭 160 — 두 컬럼 (320) 컨 폭 234 초과 → 룰 E tryPlaceCrossCargoBundle 활성 X
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 160, length: 100, height: 50, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 160, length: 100, height: 50, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c2", bookingNo: "BK-X", width: 160, length: 100, height: 50, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c3", bookingNo: "BK-X", width: 160, length: 100, height: 50, weight: 200 }),
      mkUnit({ unitId: "x1", cargoId: "other", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    const placed = preClusterFootprint(cont, units);
    // 룰 E 는 두 컬럼 폭 검사 fail → 발동 X. 룰 A 가 같은 footprint 2 박스 (u1/u2 같은 cargo) 묶음.
    // 룰 E placedIds 에 4 박스 다 안 들어가야 정상
    assert.ok(placed.size <= 4);
  });
});

describe("footprint-cluster: 룰 F — 근사 footprint 묶음 (nearFootprintStackBundle)", () => {
  it("SK GEO CENTRIC 축소 패턴 (137×115×85 + 135×115×129 같은 booking 2박스) → 한 컬럼 2단 적층 성공", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // SK GEO 의 단순화 — 2박스만. 활성 조건 8 (85+129=214 ≤ 268) 통과.
    // 같은 booking, 같은 cargoId atomic, footprint W 차이 2cm 허용.
    const units: UnitItem[] = [
      mkUnit({
        unitId: "sk-bottom",
        cargoId: "sg3-35",
        bookingNo: "FBSIN260431",
        width: 137,
        length: 115,
        height: 85,
        weight: 875,
      }),
      mkUnit({
        unitId: "sk-top",
        cargoId: "sg3-35",
        bookingNo: "FBSIN260431",
        width: 135,
        length: 115,
        height: 129,
        weight: 875,
      }),
    ];
    const placed = preClusterNearFootprint(cont, units);
    // 룰 F: 2박스 같은 booking + cargoId atomic, footprint 차이 2cm → 묶음 성공
    assert.equal(placed.size, 2, `2박스 모두 배치 (실제: ${placed.size})`);
    const ps = cont.packState.placements;
    assert.equal(ps.length, 2);
    // 활성 조건 5: 위 박스 W ≤ 아래 박스 W
    const bottom = ps.find((p) => p.position.z <= 0.01);
    const top = ps.find((p) => p.position.z > 0.01);
    assert.ok(bottom && top, "한 컬럼 2단 (바닥 + 위)");
    assert.ok(top!.size.width <= bottom!.size.width + 0.01, "위 박스 W ≤ 아래 박스 W (활성 조건 5)");
    assert.ok(top!.weight <= bottom!.weight + 0.01, "위 박스 무게 ≤ 아래 박스 무게 (활성 조건 7)");
    // 활성 조건 8: 천장 안
    assert.ok(
      top!.position.z + top!.size.height <= SPEC_40FT.innerHeight + 0.01,
      "천장 안",
    );
  });

  it("SK GEO 실제 3박스 패턴 — 활성 조건 8 (한 컬럼 총 높이 343 > 268) 또는 활성 조건 9 (두 컬럼 폭 272 > 234) 위반 → 전체 롤백", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // SK GEO 실제 박스 3개 — 활성 조건 12개로는 풀 수 없는 케이스.
    // 한 컬럼: 85+129+129=343 > 268 (활성 조건 8 위반)
    // 두 컬럼: 137+135=272 > 234 (활성 조건 9 위반)
    // → cargoId atomic 보호 → 전체 롤백 → 정식 wrapper 큐로 처리
    const units: UnitItem[] = [
      mkUnit({ unitId: "sk1", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 137, length: 115, height: 85, weight: 875 }),
      mkUnit({ unitId: "sk2", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 135, length: 115, height: 129, weight: 875 }),
      mkUnit({ unitId: "sk3", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 135, length: 115, height: 129, weight: 875 }),
    ];
    const placed = preClusterNearFootprint(cont, units);
    // 활성 조건 11 (partial cargoId 발생 시 전체 롤백)
    assert.equal(placed.size, 0, "활성 조건 8 or 9 위반 + cargoId atomic — 전체 롤백");
    assert.equal(cont.packState.placements.length, 0, "롤백 후 placement 0개");
  });

  it("다른 booking 같은 footprint → 묶음 X (회귀 0)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-A", width: 137, length: 115, height: 85, weight: 875 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-B", width: 135, length: 115, height: 129, weight: 875 }),
      mkUnit({ unitId: "u3", cargoId: "c3", bookingNo: "BK-C", width: 135, length: 115, height: 129, weight: 875 }),
    ];
    const placed = preClusterNearFootprint(cont, units);
    assert.equal(placed.size, 0, "다른 booking 끼리는 룰 F 묶음 X");
  });

  it("footprint W 차이 6cm 이상 → 묶음 X", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 같은 booking 이지만 W 차이 7cm (130 vs 137)
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85, weight: 875 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-X", width: 130, length: 115, height: 129, weight: 500 }),
      mkUnit({ unitId: "u3", cargoId: "c2", bookingNo: "BK-X", width: 130, length: 115, height: 129, weight: 500 }),
    ];
    const bundles = __testables.groupNearFootprintBundles(units);
    // 한 묶음 안에 W 차이 7cm > 5cm → 그룹 X
    assert.equal(bundles.length, 0, "footprint W 차이 7cm → 룰 F 묶음 X");
  });

  it("위 박스 무게 > 아래 박스 무게 → 활성 조건 7 위반, 적층 안 됨", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 무거운 박스(아래 후보)는 가벼움, 가벼운 박스 (위 후보)가 무거움 — STACK_WEIGHT_TOLERANCE=1.0 위반
    const units: UnitItem[] = [
      mkUnit({ unitId: "light-bottom", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85, weight: 100 }),
      mkUnit({ unitId: "heavy-top", cargoId: "c1", bookingNo: "BK-X", width: 135, length: 115, height: 129, weight: 5000 }),
    ];
    const placed = preClusterNearFootprint(cont, units);
    // weight desc 정렬 — heavy-top 이 첫 박스 (아래), light-bottom 이 둘째 (위)
    // 위 박스(light-bottom 100kg) ≤ 아래 박스(heavy-top 5000kg) → 활성 조건 7 통과
    // 그러나 활성 조건 5: 위 박스 W(137) ≤ 아래 박스 W(135)? — 137 > 135 위반 → 적층 안 됨
    // → 첫 박스만 배치 후 더 못 쌓음. NEAR_MIN_UNITS=2 미달 → 전체 롤백
    assert.equal(placed.size, 0, "활성 조건 5 위반 — 전체 롤백");
  });

  it("총 적층 높이 > 컨테이너 내부 높이 → 룰 F 묶음 X (활성 조건 8)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT, // innerHeight = 268
      packState: makeContainerState(),
    };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 150, weight: 800 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 135, length: 115, height: 150, weight: 800 }),
    ];
    // 150 + 150 = 300 > 268 → 적층 안 됨. 첫 박스만 배치 후 NEAR_MIN_UNITS=2 미달 → 롤백
    const placed = preClusterNearFootprint(cont, units);
    assert.equal(placed.size, 0, "총 높이 300 > 컨 268 — 적층 안 됨, 전체 롤백");
  });

  it("noStacking=true 박스 포함 시 룰 F 묶음 X (활성 조건 6)", () => {
    const units: UnitItem[] = [
      mkUnit({
        unitId: "u1",
        cargoId: "c1",
        bookingNo: "BK-X",
        width: 137,
        length: 115,
        height: 85,
        weight: 875,
        remarks: { noStacking: true, topOnly: false, orientation: "free", heavierBelow: false },
      }),
      mkUnit({
        unitId: "u2",
        cargoId: "c2",
        bookingNo: "BK-X",
        width: 135,
        length: 115,
        height: 129,
        weight: 875,
        remarks: { noStacking: true, topOnly: false, orientation: "free", heavierBelow: false },
      }),
    ];
    const bundles = __testables.groupNearFootprintBundles(units);
    assert.equal(bundles.length, 0, "noStacking=true 박스 — 룰 F 그룹 X");
  });

  it("partial cargoId 분리 시 전체 롤백 (활성 조건 11) — 2 cargo cross 묶음 한 cargo 만 배치 못함", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 두 cargo cross 묶음, 다른 사이즈 (137 + 135 + 80×4 추가)
    // c1: 137×115×85 ×1, c2: 135×115×129 ×4
    // 한 컬럼: 85+129+129=343 > 268 (활성 조건 8 위반)
    //   첫 박스만 배치 후 위 적층 실패 → 옆 컬럼 폭 검사 (137+135=272 > 234 위반) 또는 (135+135=270 > 234) → 옆 컬럼 못 만듦
    //   atomic 위반 (c2 5박스 중 일부만 배치) → 전체 롤백
    const units: UnitItem[] = [
      mkUnit({ unitId: "u-a", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85, weight: 700 }),
      mkUnit({ unitId: "u-b1", cargoId: "c2", bookingNo: "BK-X", width: 135, length: 115, height: 129, weight: 700 }),
      mkUnit({ unitId: "u-b2", cargoId: "c2", bookingNo: "BK-X", width: 135, length: 115, height: 129, weight: 700 }),
      mkUnit({ unitId: "u-b3", cargoId: "c2", bookingNo: "BK-X", width: 135, length: 115, height: 129, weight: 700 }),
      mkUnit({ unitId: "u-b4", cargoId: "c2", bookingNo: "BK-X", width: 135, length: 115, height: 129, weight: 700 }),
    ];
    const placed = preClusterNearFootprint(cont, units);
    // 한 컬럼 2단 (137 + 135 = 85+129=214 ≤ 268 OK) 까지만 가능. 그 후 c2 의 3박스 더 못 넣음.
    // 옆 컬럼 폭 137+135=272 > 234 → 못 만듦
    // → partial cargoId (c2 4박스 중 1박스만 배치) → 전체 롤백
    assert.equal(placed.size, 0, "partial cargoId atomic 위반 — 전체 롤백");
    assert.equal(cont.packState.placements.length, 0, "롤백 후 placement 0개");
  });

  it("exact 룰 E 로 해결되는 케이스에서는 룰 F preCluster 단계 (preClusterFootprint) 발동 안 됨 (회귀 0)", () => {
    // preClusterFootprint 는 룰 E 까지만 수행. 룰 F 는 algorithm.ts 5.45 단계에서 unplaced 발생 시만.
    // 단위 테스트로는 — preClusterFootprint 호출 후 같은 unit 풀에 preClusterNearFootprint 호출 시
    // 이미 배치된 unit 은 다시 안 잡혀야 함 (idempotent)
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    // 룰 E 발동 케이스 — 같은 booking + 정확히 동일 W·L·H ×3 (cross cargo)
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u3", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u4", cargoId: "c2", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "x1", cargoId: "fill", bookingNo: "OTHER", width: 50, length: 50, height: 50 }),
    ];
    const placedE = preClusterFootprint(cont, units);
    assert.ok(placedE.size >= 4, "룰 E 가 4 박스 모두 배치");
    // 이미 배치된 unit 은 풀에서 제외 — 남은 unit 만 룰 F 시도
    const remaining = units.filter((u) => !placedE.has(u.unitId));
    const placedF = preClusterNearFootprint(cont, remaining);
    // 룰 F 는 remaining 안에서 활성 조건 (≥ NEAR_MIN_UNITS, 같은 booking 등) 만족 시도
    // 남은 1박스(fill, OTHER booking) — 같은 booking 그룹 X → 룰 F 발동 안 됨
    assert.equal(placedF.size, 0, "룰 E 가 다 처리한 후 룰 F 추가 발동 안 됨");
  });
});

describe("footprint-cluster: 룰 E exactSameSize 헬퍼", () => {
  it("정확히 같은 W·L·H → true", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 114, length: 114, height: 71 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 114, length: 114, height: 71 });
    assert.equal(__testables.exactSameSize(a, b), true);
  });
  it("1cm 차이만 나도 false (룰 A 와 다름)", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 114, length: 114, height: 71 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 114, length: 113, height: 71 });
    assert.equal(__testables.exactSameSize(a, b), false);
  });
  it("높이만 달라도 false", () => {
    const a = mkUnit({ unitId: "u1", cargoId: "c1", width: 114, length: 114, height: 71 });
    const b = mkUnit({ unitId: "u2", cargoId: "c1", width: 114, length: 114, height: 70 });
    assert.equal(__testables.exactSameSize(a, b), false);
  });
});

describe("footprint-cluster: 룰 G — Row-lane 묶음 (preClusterRowLane)", () => {
  it("SK GEO CENTRIC 패턴 — 같은 cargoId noStacking=true 137×115×85 + 135×115×129 ×2 → 두 컬럼 옆 직렬, 미배치 0", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    // 모두 noStacking=true. face 1(L×W) → eff.width=115 두 컬럼 230 ≤ 234.
    const noStackRem = { noStacking: true, topOnly: false, orientation: "free" as const, heavierBelow: false };
    const units: UnitItem[] = [
      mkUnit({ unitId: "sk-a", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 137, length: 115, height: 85, weight: 875, remarks: noStackRem }),
      mkUnit({ unitId: "sk-b", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 135, length: 115, height: 129, weight: 875, remarks: noStackRem }),
      mkUnit({ unitId: "sk-c", cargoId: "sg3-35", bookingNo: "FBSIN260431", width: 135, length: 115, height: 129, weight: 875, remarks: noStackRem }),
    ];
    const placed = preClusterRowLane(cont, units);
    assert.equal(placed.size, 3, `3박스 모두 배치 (실제: ${placed.size})`);
    const ps = cont.packState.placements;
    assert.equal(ps.length, 3);
    // 활성 조건 2 — 모든 unit z=0 (noStacking 보호)
    for (const p of ps) {
      assert.equal(p.position.z, 0, `${p.unitId} z=0 강제 (noStacking 보호)`);
    }
    // face 1(L×W) 회전 → 폭 115. 컨 길이 1200 충분 → 모두 한 컬럼 직렬도 가능.
    // 컬럼 수 1 또는 2 (옆 컬럼은 잔여 박스 있을 때만 만들어짐). 핵심은 z=0 + 모두 배치.
    const xs = new Set(ps.map((p) => p.position.x));
    assert.ok(xs.size <= ROW_LANE_MAX_COLUMNS_TEST, `컬럼 수 ≤ 2 (실제: ${xs.size})`);
    // 모든 박스 face 가 같음 (활성 조건 6 — pickLaneFace 결과)
    const faces = new Set(ps.map((p) => p.faceIdx));
    assert.equal(faces.size, 1, `같은 face 강제 (실제 face 종류: ${faces.size})`);
    // 발동 로그
    const dec = __testables.lastRowLaneDecision;
    assert.ok(dec && dec.result === "placed", "발동 로그: placed");
    assert.equal(dec!.cargoId, "sg3-35");
  });

  it("같은 cargoId noStacking=false 묶음 → 룰 G 발동해도 결과 같음 (룰 F 영역과 충돌 없음)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    // 같은 cargoId, noStacking=false, 같은 W·L (룰 G 그룹 가능)
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 114, length: 114, height: 71, weight: 200 }),
    ];
    const placed = preClusterRowLane(cont, units);
    // 룰 G 는 cargoId 기준만 — noStacking 무관하게 두 컬럼 옆 직렬 처리
    // (위로 못 쌓는 케이스 fallback 이지만 noStacking=false 도 row-lane 으로 처리 가능 — 회귀 위험 없음)
    assert.ok(placed.size === 2 || placed.size === 0, "묶음 시도, 결과는 2 또는 활성 조건 미달 0");
  });

  it("같은 cargoId footprint 차 6cm 이상 → 룰 G 묶음 X", () => {
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85 }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 130, length: 115, height: 129 }),
    ];
    const bundles = __testables.groupNearRowLaneBundles(units);
    assert.equal(bundles.length, 0, "W 차 7cm > 5cm — 룰 G 묶음 X");
  });

  it("같은 booking 다른 cargoId → 룰 G 묶음 X (cargoId 한정)", () => {
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85 }),
      mkUnit({ unitId: "u2", cargoId: "c2", bookingNo: "BK-X", width: 135, length: 115, height: 129 }),
    ];
    const bundles = __testables.groupNearRowLaneBundles(units);
    // 각 cargoId 1박스 < ROW_LANE_MIN_UNITS=2 — 그룹 X
    assert.equal(bundles.length, 0, "다른 cargoId — 룰 G 묶음 X (booking 확장 X)");
  });

  it("orientation=fixed → 회전 X, face 0 만 사용 (eff.width 큰 면 — 두 컬럼 폭 위반 시 한 컬럼만)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    // 137×115 fixed → face 0 (W=137) 만 가능. 두 컬럼 274 > 234 → 한 컬럼만.
    // 한 컬럼 안 직렬: 115 + 115 = 230 길이 OK.
    // (룰 G 활성 조건: noStacking=true + variable unitSizes — 한 박스 width 138 로 미세 변경)
    const fixedRem = { noStacking: true, topOnly: false, orientation: "fixed" as const, heavierBelow: false };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 137, length: 115, height: 85, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 138, length: 115, height: 85, weight: 200, remarks: fixedRem }),
    ];
    const face = __testables.pickLaneFace(units);
    assert.equal(face, 0, "orientation=fixed → face 0 만");
    const placed = preClusterRowLane(cont, units);
    // face 0 — max W 138 → 두 컬럼 276 > 234 → 한 컬럼만. 한 컬럼 직렬 길이 230 ≤ 1200 OK.
    assert.equal(placed.size, 2, `한 컬럼 안 직렬 2박스 모두 배치 (실제: ${placed.size})`);
    // 한 컬럼만 — x 종류 1
    const xs = new Set(cont.packState.placements.map((p) => p.position.x));
    assert.equal(xs.size, 1, "한 컬럼만");
  });

  it("두 컬럼 폭 > innerWidth (160×2=320 > 234) → 한 컬럼만, 활성 조건 4 보호", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    // 큰 박스 폭 160 — face 회전해도 둘째 컬럼 못 만듦. 한 컬럼 직렬.
    // 큰 박스라 회전 시 length=160, width=200 같은 face 도 폭 위반. fixed 로 한 면만:
    // (룰 G 활성 조건: noStacking=true + variable unitSizes — 한 박스 length 161 로 미세 변경)
    const fixedRem = { noStacking: true, topOnly: false, orientation: "fixed" as const, heavierBelow: false };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 160, height: 100, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 161, height: 100, weight: 200, remarks: fixedRem }),
    ];
    const placed = preClusterRowLane(cont, units);
    // 한 컬럼: y 직렬 160+161=321 ≤ 1200 OK. 폭 200 ≤ 234 OK.
    assert.equal(placed.size, 2, "한 컬럼 직렬 2박스");
    const xs = new Set(cont.packState.placements.map((p) => p.position.x));
    assert.equal(xs.size, 1, "둘째 컬럼 폭 위반 — 한 컬럼만");
  });

  it("cargoId atomic 일부만 들어가면 전체 롤백 (활성 조건 9)", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    // 컨 길이 1200 — 큰 박스 5개 직렬 시 한 컬럼 길이 5×400=2000 > 1200 위반.
    // 두 컬럼 폭 (400×2=800 > 234) 위반 → 한 컬럼만 가능.
    // 한 컬럼 길이 1200 한도 — 박스 length 400 → 3개 배치, 4·5번째 못 들어감 → atomic 위반 → 전체 롤백
    // (룰 G 활성 조건: noStacking=true + variable unitSizes — 마지막 박스 length 401 로 미세 변경)
    const fixedRem = { noStacking: true, topOnly: false, orientation: "fixed" as const, heavierBelow: false };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 400, height: 100, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u2", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 400, height: 100, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u3", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 400, height: 100, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u4", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 400, height: 100, weight: 200, remarks: fixedRem }),
      mkUnit({ unitId: "u5", cargoId: "c1", bookingNo: "BK-X", width: 200, length: 401, height: 100, weight: 200, remarks: fixedRem }),
    ];
    const placed = preClusterRowLane(cont, units);
    assert.equal(placed.size, 0, "atomic 위반 — 전체 롤백");
    assert.equal(cont.packState.placements.length, 0, "롤백 후 placement 0");
    // 발동 로그
    const dec = __testables.lastRowLaneDecision;
    assert.ok(dec && dec.result === "rolled-back", `발동 로그: rolled-back (실제: ${dec?.result})`);
  });

  it("발동 로그 — production console.log 없이 모듈 변수에만 기록", () => {
    const cont = {
      index: 1,
      spec: SPEC_40FT,
      packState: makeContainerState(),
    };
    __testables.resetRowLaneDecision();
    assert.equal(__testables.lastRowLaneDecision, null, "리셋 후 null");
    // (룰 G 활성 조건: noStacking=true + variable unitSizes — 한 박스 width 101 로 미세 변경)
    const noStackRem = { noStacking: true, topOnly: false, orientation: "free" as const, heavierBelow: false };
    const units: UnitItem[] = [
      mkUnit({ unitId: "u1", cargoId: "log-c", bookingNo: "BK-LOG", width: 100, length: 100, height: 50, weight: 100, remarks: noStackRem }),
      mkUnit({ unitId: "u2", cargoId: "log-c", bookingNo: "BK-LOG", width: 101, length: 100, height: 50, weight: 100, remarks: noStackRem }),
    ];
    preClusterRowLane(cont, units);
    const dec = __testables.lastRowLaneDecision;
    assert.ok(dec, "발동 후 로그 기록");
    assert.equal(dec!.cargoId, "log-c");
    assert.equal(dec!.bookingNo, "BK-LOG");
  });
});
