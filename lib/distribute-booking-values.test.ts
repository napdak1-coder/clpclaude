/**
 * distributeBookingValues 단위 테스트
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { distributeBookingValues } from "./distribute-booking-values.ts";
import { DEFAULT_REMARK, type CargoSpec } from "../types/cargo.ts";

function mkCargo(over: Partial<CargoSpec> & { id: string }): CargoSpec {
  return {
    id: over.id,
    shipmentId: "ship-1",
    sortOrder: 0,
    cargoType: over.cargoType ?? "CT",
    bookingNo: over.bookingNo,
    actualShipperName: over.actualShipperName,
    width: 0,
    length: 0,
    height: 0,
    quantity: over.quantity ?? 1,
    weightPerUnit: over.weightPerUnit ?? 0,
    cbm: over.cbm,
    aboutCbm: over.aboutCbm,
    remarks: DEFAULT_REMARK,
  };
}

describe("distributeBookingValues", () => {
  it("같은 부킹 + 한 행만 ABOUT 값 → 비율 분배", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "FTN", quantity: 21, aboutCbm: 7.396 }),
      mkCargo({ id: "c2", bookingNo: "BK1", actualShipperName: "FTN", quantity: 12 }),
      mkCargo({ id: "c3", bookingNo: "BK1", actualShipperName: "FTN", quantity: 32 }),
    ];
    const r = distributeBookingValues(cargoes);
    const total = 21 + 12 + 32;
    assert.ok(Math.abs((r.cargoes[0].aboutCbm ?? 0) - (7.396 * 21) / total) < 0.001);
    assert.ok(Math.abs((r.cargoes[1].aboutCbm ?? 0) - (7.396 * 12) / total) < 0.001);
    assert.ok(Math.abs((r.cargoes[2].aboutCbm ?? 0) - (7.396 * 32) / total) < 0.001);
    // 모든 cargo 가 분배 표시 받아야
    assert.ok(r.distributedFields.get("c1")?.has("aboutCbm"));
    assert.ok(r.distributedFields.get("c2")?.has("aboutCbm"));
    assert.ok(r.distributedFields.get("c3")?.has("aboutCbm"));
  });

  it("같은 부킹 + 두 행에 CBM 입력 → 분배 X", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "FTN", quantity: 21, cbm: 1.777 }),
      mkCargo({ id: "c2", bookingNo: "BK1", actualShipperName: "FTN", quantity: 12, cbm: 1 }),
      mkCargo({ id: "c3", bookingNo: "BK1", actualShipperName: "FTN", quantity: 32 }),
    ];
    const r = distributeBookingValues(cargoes);
    // cbm 분배 X (둘 이상 입력)
    assert.equal(r.cargoes[0].cbm, 1.777);
    assert.equal(r.cargoes[1].cbm, 1);
    assert.equal(r.cargoes[2].cbm, undefined);
    assert.equal(r.distributedFields.get("c1")?.has("cbm"), undefined);
  });

  it("같은 부킹 + 한 행만 무게 → 비율 분배", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "FTN", quantity: 21, weightPerUnit: 1972 }),
      mkCargo({ id: "c2", bookingNo: "BK1", actualShipperName: "FTN", quantity: 12 }),
      mkCargo({ id: "c3", bookingNo: "BK1", actualShipperName: "FTN", quantity: 32 }),
    ];
    const r = distributeBookingValues(cargoes);
    const total = 21 + 12 + 32;
    assert.ok(Math.abs(r.cargoes[0].weightPerUnit - (1972 * 21) / total) < 0.001);
    assert.ok(Math.abs(r.cargoes[1].weightPerUnit - (1972 * 12) / total) < 0.001);
    assert.ok(Math.abs(r.cargoes[2].weightPerUnit - (1972 * 32) / total) < 0.001);
  });

  it("다른 부킹은 별도 그룹", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "A", quantity: 10, aboutCbm: 5 }),
      mkCargo({ id: "c2", bookingNo: "BK2", actualShipperName: "A", quantity: 10 }),
    ];
    const r = distributeBookingValues(cargoes);
    // BK1 만 1개 cargo, BK2 도 1개 → 둘 다 분배 X (그룹 1개씩)
    assert.equal(r.cargoes[0].aboutCbm, 5);
    assert.equal(r.cargoes[1].aboutCbm, undefined);
  });

  it("같은 부킹 + 다른 화주는 별도 그룹", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "A", quantity: 10, aboutCbm: 5 }),
      mkCargo({ id: "c2", bookingNo: "BK1", actualShipperName: "B", quantity: 10 }),
    ];
    const r = distributeBookingValues(cargoes);
    // 화주 다르면 분배 X
    assert.equal(r.cargoes[0].aboutCbm, 5);
    assert.equal(r.cargoes[1].aboutCbm, undefined);
  });

  it("부킹 번호 없으면 그대로 (분배 X)", () => {
    const cargoes = [
      mkCargo({ id: "c1", actualShipperName: "FTN", quantity: 10, aboutCbm: 5 }),
      mkCargo({ id: "c2", actualShipperName: "FTN", quantity: 10 }),
    ];
    const r = distributeBookingValues(cargoes);
    assert.equal(r.cargoes[0].aboutCbm, 5);
    assert.equal(r.cargoes[1].aboutCbm, undefined);
  });

  it("한 행만 있으면 분배 X (그룹 1개)", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "A", quantity: 10, aboutCbm: 5 }),
    ];
    const r = distributeBookingValues(cargoes);
    assert.equal(r.cargoes[0].aboutCbm, 5);
    assert.equal(r.distributedFields.size, 0);
  });

  it("입력 순서 보존", () => {
    const cargoes = [
      mkCargo({ id: "c1", bookingNo: "BK1", actualShipperName: "FTN", quantity: 21, aboutCbm: 7.396 }),
      mkCargo({ id: "x", bookingNo: "BK2", actualShipperName: "Z", quantity: 5 }),
      mkCargo({ id: "c2", bookingNo: "BK1", actualShipperName: "FTN", quantity: 12 }),
      mkCargo({ id: "c3", bookingNo: "BK1", actualShipperName: "FTN", quantity: 32 }),
    ];
    const r = distributeBookingValues(cargoes);
    assert.deepEqual(r.cargoes.map((c) => c.id), ["c1", "x", "c2", "c3"]);
  });
});
