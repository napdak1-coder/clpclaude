/**
 * CargoTable onChange 핸들러의 unitSizes 동기화 로직 단위 테스트.
 *
 * 검증: 사용자가 메인 컬럼(W·L·H·weight·cargoType) 수정 시
 * unitSizes 가 있는 행이면 unitSizes 의 모든 unit 도 같이 갱신되는지.
 */

import assert from "node:assert/strict";

// CargoTable.tsx 의 사이즈 onChange 핸들러 동작 추출 (논리만)
function applySizePatch(row, field, value) {
  const patch = { [field]: value };
  if (row.unitSizes && row.unitSizes.length > 0) {
    const usField =
      field === "widthCm"
        ? "width"
        : field === "lengthCm"
          ? "length"
          : field === "heightCm"
            ? "height"
            : field === "weightPerUnitKg"
              ? "weight"
              : null;
    if (usField) {
      patch.unitSizes = row.unitSizes.map((u) => ({ ...u, [usField]: value }));
    }
  }
  return { ...row, ...patch };
}

// cargoType onChange 핸들러 동작 추출
function applyCargoTypePatch(row, next) {
  const patch = { cargoType: next };
  if (row.unitSizes && row.unitSizes.length > 0) {
    patch.unitSizes = row.unitSizes.map((u) => ({ ...u, cargoType: next }));
  }
  return { ...row, ...patch };
}

// TMS KOREA 시나리오 — unitSizes 3개
const tms = {
  rowKey: "tms",
  widthCm: 110,
  lengthCm: 110,
  heightCm: 40,
  quantity: 44,
  weightPerUnitKg: 0,
  cargoType: "CT",
  unitSizes: [
    { width: 110, length: 110, height: 40, quantity: 1, weight: 0 },
    { width: 110, length: 110, height: 40, quantity: 1, weight: 0 },
    { width: 110, length: 55, height: 50, quantity: 42, weight: 0 },
  ],
};

// unitSizes 없는 일반 화물
const plain = {
  rowKey: "plain",
  widthCm: 100,
  lengthCm: 100,
  heightCm: 100,
  quantity: 1,
  weightPerUnitKg: 0,
  cargoType: "PL",
};

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✅", name);
  } catch (e) {
    fail++;
    console.log("  ❌", name, "—", e.message);
  }
}

console.log("\n=== TMS KOREA (unitSizes 있음) 시나리오 ===");

check("widthCm 110 → 120 변경 시 모든 unitSizes.width 도 120", () => {
  const r = applySizePatch(tms, "widthCm", 120);
  assert.equal(r.widthCm, 120);
  assert.equal(r.unitSizes.length, 3);
  for (const u of r.unitSizes) assert.equal(u.width, 120);
});

check("lengthCm 변경 시 unitSizes.length 동기화", () => {
  const r = applySizePatch(tms, "lengthCm", 130);
  assert.equal(r.lengthCm, 130);
  for (const u of r.unitSizes) assert.equal(u.length, 130);
});

check("heightCm 변경 시 unitSizes.height 동기화", () => {
  const r = applySizePatch(tms, "heightCm", 50);
  assert.equal(r.heightCm, 50);
  for (const u of r.unitSizes) assert.equal(u.height, 50);
});

check("weightPerUnitKg 변경 시 unitSizes.weight 동기화", () => {
  const r = applySizePatch(tms, "weightPerUnitKg", 100);
  assert.equal(r.weightPerUnitKg, 100);
  for (const u of r.unitSizes) assert.equal(u.weight, 100);
});

check("cargoType CT → PL 변경 시 unitSizes.cargoType 동기화", () => {
  const r = applyCargoTypePatch(tms, "PL");
  assert.equal(r.cargoType, "PL");
  for (const u of r.unitSizes) assert.equal(u.cargoType, "PL");
});

check("quantity 는 unitSizes 분포 보호 — 동기화 X", () => {
  const r = applySizePatch(tms, "quantity", 50);
  assert.equal(r.quantity, 50);
  // unitSizes quantity 그대로 (1+1+42)
  assert.equal(r.unitSizes[0].quantity, 1);
  assert.equal(r.unitSizes[1].quantity, 1);
  assert.equal(r.unitSizes[2].quantity, 42);
});

console.log("\n=== 일반 화물 (unitSizes 없음) 시나리오 ===");

check("widthCm 변경 시 unitSizes 추가되지 않음", () => {
  const r = applySizePatch(plain, "widthCm", 120);
  assert.equal(r.widthCm, 120);
  assert.equal(r.unitSizes, undefined);
});

check("cargoType 변경 시 unitSizes 추가되지 않음", () => {
  const r = applyCargoTypePatch(plain, "CT");
  assert.equal(r.cargoType, "CT");
  assert.equal(r.unitSizes, undefined);
});

console.log("\n=== 결과 ===");
console.log(`통과 ${pass} / 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
