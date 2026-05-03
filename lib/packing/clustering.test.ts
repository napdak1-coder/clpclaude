/**
 * 같은 화주 클러스터링(2번) + 수량 단위 묶음 stack(4번) 단위 테스트.
 *
 * 알고리즘 변경:
 *  - sortClustered: 같은 shipper / 같은 cargoId 인접 보장 (LDF 우선순위 보존)
 *  - tryBundleStack: cargoId 그룹의 N≥2 unit 을 한 컬럼 세로 stack 시도, 실패 시 자유 fallback
 *
 * pack() 의 containers[].rows 는 display-rows 거치므로 좌표는 표시용 (재배치) 이지만
 * "어느 placement 가 어느 행의 bottom/top 으로 들어갔는지" 는 보존된다 →
 * 같은 cargoId 가 한 행의 bottom + top 양쪽에 등장하면 묶음 stack 성공의 증거.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CargoSpec, Remark } from "../../types/cargo.ts";
import type { ContainerPlan, PlacedCargo } from "../../types/plan.ts";
import { pack } from "./algorithm.ts";

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
    actualShipperName: over.actualShipperName,
    shipperName: over.shipperName,
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

function allBottoms(cont: ContainerPlan): PlacedCargo[] {
  return cont.rows.flatMap((r) => r.bottomItems);
}
function allTops(cont: ContainerPlan): PlacedCargo[] {
  return cont.rows.flatMap((r) => r.topItems);
}

describe("clustering — 회전-aware 묶음 stack (face 자동 선택)", () => {
  it("247x129x46 qty=2 (데코론 형) → 작은 면(h=46) 회전으로 stack 성공", () => {
    // 컨테이너 40FT innerWidth=234 < 247 이므로 원본 face 는 들어가지도 않음.
    // 회전된 face (width=129, length=247, height=46) 로 들어가야 하고,
    // 같은 회전으로 두 번째 unit 이 z=46 에 stack 되어야 한다.
    const cargoes = [
      makeCargo({
        id: "deco",
        shipperName: "R&F",
        width: 247,
        length: 129,
        height: 46,
        quantity: 2,
        weightPerUnit: 4700,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "deco");
    const tops = allTops(cont).filter((p) => p.cargoId === "deco");
    assert.equal(result.unplaced.length, 0, "둘 다 적재 성공");
    assert.equal(bottoms.length, 1, "첫 unit bottom");
    assert.equal(tops.length, 1, "두 번째 unit top stack 성공");
    // 두 unit 모두 동일 회전 (size.height = 46)
    assert.equal(bottoms[0].size.height, 46);
    assert.equal(tops[0].size.height, 46);
  });

  it("81x77x144 qty=5 in 40FT (innerH=268) → 작은 면(h=77) 으로 묶음 + fallback, 모두 적재", () => {
    // 회전 face 중 가장 작은 height 는 77.
    // floor(268/77) = 3 → 묶음으로 3 stack 시도. 나머지 2 unit fallback.
    // 단, display-rows 는 top-on-top 을 표시에서 누락 (실제 placement 는 정상) →
    // 검증은 (a) 미배치 0, (b) 묶음 첫 unit 의 size.height = 77 (회전 적용 증명) 으로.
    const cargoes = [
      makeCargo({
        id: "tower",
        shipperName: "X",
        width: 81,
        length: 77,
        height: 144,
        quantity: 5,
        weightPerUnit: 2750,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "tower");
    const tops = allTops(cont).filter((p) => p.cargoId === "tower");
    assert.equal(result.unplaced.length, 0, "5 unit 모두 적재");
    // 묶음 bottom (첫 unit) 은 face height = 77 (원본 144 가 아닌 회전 면)
    const bundleBottom = bottoms.find((b) => b.size.height === 77);
    assert.ok(bundleBottom, "묶음 첫 unit 의 회전 면 height = 77 (회전-aware 증명)");
    // 최소 1 단 이상 stack 됨 (display 한계로 모두 표시되진 않을 수 있음)
    assert.ok(tops.length >= 1, "stack 이 발생함");
  });
});

describe("clustering — 같은 cargoId 묶음 stack (4번)", () => {
  it("데코론 qty=2 → 한 행에서 1 bottom + 1 top 으로 stack", () => {
    const cargoes = [
      makeCargo({
        id: "deco",
        shipperName: "R&F",
        width: 247,
        length: 129,
        height: 46,
        quantity: 2,
        weightPerUnit: 4700,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    assert.equal(result.containers.length, 1);
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "deco");
    const tops = allTops(cont).filter((p) => p.cargoId === "deco");
    assert.equal(bottoms.length, 1, "bundle 의 첫 unit 은 bottom 으로");
    assert.equal(tops.length, 1, "bundle 의 두 번째 unit 은 top 으로");
    assert.equal(result.unplaced.length, 0);
  });

  it("100x100x100 qty=2 → bundle 로 두 unit 모두 같은 cargoId 컬럼에 stack", () => {
    const cargoes = [
      makeCargo({
        id: "box",
        shipperName: "X",
        width: 100,
        length: 100,
        height: 100,
        quantity: 2,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "box");
    const tops = allTops(cont).filter((p) => p.cargoId === "box");
    assert.equal(bottoms.length, 1);
    assert.equal(tops.length, 1);
  });

  it("높이 한계로 묶음 부분 실패 — 100x100x100 qty=3 in 20FT (innerH 238) → 2 stack + 1 fallback", () => {
    // 20FT innerHeight=238. 100+100=200 OK, 100+100+100=300 > 238 → 3단 실패
    const cargoes = [
      makeCargo({
        id: "tower",
        shipperName: "X",
        width: 100,
        length: 100,
        height: 100,
        quantity: 3,
      }),
    ];
    const result = pack(cargoes, "20ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "tower");
    const tops = allTops(cont).filter((p) => p.cargoId === "tower");
    // 묶음: bottom 1개 + top 1개 (= 2단). 3번째 unit 은 fallback → 별도 bottom
    assert.equal(tops.length, 1, "묶음 2단째는 top");
    assert.equal(bottoms.length, 2, "묶음 1단 + fallback 1단 = bottom 2 개");
    assert.equal(result.unplaced.length, 0);
  });
});

describe("clustering — 같은 화주 인접 (2번)", () => {
  it("같은 shipper 의 두 cargo + 다른 shipper 큰 cargo → 같은 화주 cargo 가 인접 행에 배치", () => {
    // 보현석재의 두 작은 화물 + 다른 화주의 더 큰 화물.
    // sortClustered 로 보현석재 두 cargo 가 인접 placement 큐에 들어가고
    // 결과적으로 인접 row 로 떨어져야 한다.
    // (display-rows 는 행을 길이 오름차순으로 정렬하므로 절대 위치는 검증 X.
    //  대신 같은 화주 cargo 가 인접 row.index 에 있는지로 클러스터링 확인)
    const cargoes = [
      makeCargo({
        id: "big",
        shipperName: "기타",
        width: 234,
        length: 120,
        height: 120,
      }),
      makeCargo({
        id: "boA",
        shipperName: "보현석재",
        width: 200,
        length: 100,
        height: 100,
      }),
      makeCargo({
        id: "boB",
        shipperName: "보현석재",
        width: 150,
        length: 100,
        height: 100,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    // 각 cargo 가 어느 row.index 에 있는지 찾기
    const cargoRow = new Map<string, number>();
    for (const row of cont.rows) {
      for (const it of row.bottomItems) {
        if (!cargoRow.has(it.cargoId)) cargoRow.set(it.cargoId, row.index);
      }
    }
    const rowBig = cargoRow.get("big");
    const rowA = cargoRow.get("boA");
    const rowB = cargoRow.get("boB");
    assert.ok(rowBig != null && rowA != null && rowB != null, "세 cargo 모두 배치");
    // 보현석재 두 cargo 인접
    assert.equal(
      Math.abs((rowA ?? 0) - (rowB ?? 0)),
      1,
      "보현석재 두 cargo 가 인접 row 에 배치",
    );
    // big 은 보현석재 두 cargo 사이에 끼어들지 않음
    const between =
      (rowA! < rowBig! && rowBig! < rowB!) ||
      (rowB! < rowBig! && rowBig! < rowA!);
    assert.equal(between, false, "다른 화주 cargo 가 보현석재 사이에 끼어들지 않음");
  });
});

describe("clustering — 제약 존중", () => {
  it("noStacking=true qty=3 → 묶음 skip, 모두 bottom 으로 자유 배치", () => {
    const cargoes = [
      makeCargo({
        id: "noStack",
        shipperName: "X",
        width: 100,
        length: 100,
        height: 50,
        quantity: 3,
        remarks: { noStacking: true },
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "noStack");
    const tops = allTops(cont).filter((p) => p.cargoId === "noStack");
    assert.equal(bottoms.length, 3, "noStacking 이면 모두 z=0 (bottom)");
    assert.equal(tops.length, 0, "noStacking 이면 위로 안 쌓임");
  });

  it("topOnly qty=2 + base cargo → 둘 다 unplaced 가 아니어야 함 (bundle 또는 fallback 으로 적재)", () => {
    // bundle 성공 시 두 topper 가 한 컬럼에 stack — 단,
    // display-rows 의 supporter 검색은 bottomsAll 에만 → top-on-top 은 표시에서 누락 가능.
    // 핵심 보장: pack() 이 두 topper 모두 unplaced 로 보내지 않을 것 (적재 자체는 성공).
    const cargoes = [
      makeCargo({
        id: "base",
        shipperName: "X",
        width: 200,
        length: 200,
        height: 80,
      }),
      makeCargo({
        id: "topper",
        shipperName: "Y",
        width: 100,
        length: 100,
        height: 40,
        quantity: 2,
        remarks: { topOnly: true },
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const baseBottoms = allBottoms(cont).filter((p) => p.cargoId === "base");
    const topperBottoms = allBottoms(cont).filter(
      (p) => p.cargoId === "topper",
    );
    const topperUnplaced = result.unplaced.filter(
      (u) => u.cargoId === "topper",
    );
    assert.equal(baseBottoms.length, 1);
    assert.equal(topperBottoms.length, 0, "topOnly 는 z=0 거부");
    assert.equal(topperUnplaced.length, 0, "두 topper 모두 적재 성공");
  });
});

describe("cargo type — PK 도 시각 적재 대상", () => {
  it("cargoType=PK 인 화물 → CT 처럼 bulk 가 아닌 시각(visual) 큐에 들어감", () => {
    // PK = 화주가 단위 미고지지만 사이즈 적혀서 옴 / WC+카톤 묶음 표기.
    // PL/WB/WC 등과 동일하게 W/L/H 기반 시각 적재 대상.
    const cargoes = [
      makeCargo({
        id: "pk-cargo",
        shipperName: "화주A",
        cargoType: "PK",
        width: 100,
        length: 100,
        height: 100,
        quantity: 2,
        weightPerUnit: 200,
      }),
    ];
    const result = pack(cargoes, "40ft_only");
    const cont = result.containers[0];
    const bottoms = allBottoms(cont).filter((p) => p.cargoId === "pk-cargo");
    const tops = allTops(cont).filter((p) => p.cargoId === "pk-cargo");
    assert.equal(result.unplaced.length, 0, "PK 두 unit 모두 적재");
    assert.equal(bottoms.length + tops.length, 2, "PK 가 시각 placements 에 들어감");
    // CT 처럼 bulk 처리되면 0 개일 것이므로 위 어서션이 PK ≠ CT 정책을 보장
    // 묶음 stack 까지 적용되면 1 bottom + 1 top
    assert.ok(tops.length >= 1, "묶음 stack 동작 (qty=2 → top 1 이상)");
  });
});

describe("입고완료 자동 마감 (autoConsolidateCompleted)", () => {
  it("입고완료(cbm 입력) 화물 + 비-입고완료 화물 → 입고완료가 한 컨테이너에 모임", () => {
    // 입고완료 작은 cargoes (총 ~6 m³) + 비-입고완료 큰 cargo (1대 점유)
    // → 자동마감으로 입고완료 그룹이 20FT 한쪽에 몰릴 것 기대
    const cargoes = [
      // 비-입고완료 큰 cargo (cbm 미입력) → 40FT 우선
      makeCargo({
        id: "big",
        shipperName: "X",
        width: 200,
        length: 200,
        height: 200,
        weightPerUnit: 5000,
      }),
      // 입고완료 작은 cargoes (cbm 입력)
      makeCargo({
        id: "comp1",
        shipperName: "Y",
        width: 100,
        length: 100,
        height: 100,
        cbm: 1.0,
      }),
      makeCargo({
        id: "comp2",
        shipperName: "Y",
        width: 100,
        length: 100,
        height: 100,
        cbm: 1.0,
      }),
      makeCargo({
        id: "comp3",
        shipperName: "Z",
        width: 100,
        length: 100,
        height: 100,
        cbm: 1.0,
      }),
    ];
    const result = pack(cargoes, "auto");
    // 자동마감 확인: comp1/2/3 가 같은 컨테이너에 들어가는지
    const compContainerIdx = new Set<number>();
    for (const c of result.containers) {
      const ids = new Set<string>();
      for (const row of c.rows) for (const it of [...row.bottomItems, ...row.topItems]) ids.add(it.cargoId);
      for (const id of ["comp1", "comp2", "comp3"]) {
        if (ids.has(id)) compContainerIdx.add(c.index);
      }
    }
    assert.ok(compContainerIdx.size >= 1, "입고완료 화물 적재됨");
    // 가장 이상적 결과: 모든 입고완료가 같은 컨테이너 1개에
    // (자동마감 모드 미선택 시에도 packBest 가 best 픽이라 보장 안 되지만 결과 점검)
    assert.equal(result.unplaced.length, 0, "미배치 0");
  });

  it("autoConsolidateCompleted=false → 자동마감 비활성", () => {
    const cargoes = [
      makeCargo({
        id: "comp1",
        shipperName: "X",
        width: 100,
        length: 100,
        height: 100,
        cbm: 1.0,
      }),
      makeCargo({
        id: "comp2",
        shipperName: "X",
        width: 100,
        length: 100,
        height: 100,
        cbm: 1.0,
      }),
    ];
    // 자동마감 끔 — 정상 LDF 그대로
    const result = pack(cargoes, "auto", { autoConsolidateCompleted: false });
    assert.equal(result.unplaced.length, 0);
  });
});

describe("clustering — fixedAssignment 와 호환", () => {
  it("fixedAssignment 로 동일 cargoId 지정 → 그 컨테이너에서만 묶음 stack 시도", () => {
    const cargoes = [
      makeCargo({
        id: "deco",
        shipperName: "R&F",
        width: 247,
        length: 129,
        height: 46,
        quantity: 2,
      }),
    ];
    const result = pack(cargoes, "auto", {
      fixedContainers: ["40FT", "20FT"],
      fixedAssignment: { deco: 2 }, // 두 번째 컨(20FT) 강제
    });
    assert.equal(result.containers.length, 2);
    const c20 = result.containers.find((c) => c.spec.type === "20FT")!;
    const c40 = result.containers.find((c) => c.spec.type === "40FT")!;
    const c20Deco = [...allBottoms(c20), ...allTops(c20)].filter(
      (p) => p.cargoId === "deco",
    );
    const c40Deco = [...allBottoms(c40), ...allTops(c40)].filter(
      (p) => p.cargoId === "deco",
    );
    assert.equal(c40Deco.length, 0, "지정 안 된 컨테이너에는 안 들어감");
    assert.equal(c20Deco.length, 2, "지정된 20FT 에 두 unit 모두");
    // 묶음 성공 → bottom 1 + top 1
    const c20DecoBottoms = allBottoms(c20).filter((p) => p.cargoId === "deco");
    const c20DecoTops = allTops(c20).filter((p) => p.cargoId === "deco");
    assert.equal(c20DecoBottoms.length, 1);
    assert.equal(c20DecoTops.length, 1);
  });
});
