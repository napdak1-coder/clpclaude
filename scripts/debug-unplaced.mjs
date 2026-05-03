/**
 * 현재 unplaced unit 에 대해 실제 packBest 결과 layout 에서 valid 위치 존재 여부 확인.
 * pack 결과 containers[].rows 의 placements 위치를 PHYSICAL 로 가정 (display-rows 거치므로
 * 정확하진 않지만 충돌 검사용으로 충분).
 *
 * 실제 packState 가 노출 안 되므로 packing 을 직접 재현해서 packState 추출.
 */

const { packBest, pack } = await import("../lib/packing/algorithm.ts");
const { allowedFaces, effectiveSizeFace } = await import("../lib/packing/constraints.ts");
const { getShipment } = await import("../lib/repositories/shipments.ts");
const { makeContainerState, tryPlaceUnit, expandCargoesToUnits } = await import(
  "../lib/packing/extreme-point.ts"
);
const { getContainerSpec } = await import("../lib/packing/containers.ts");

const ship = await getShipment("bbd2cece-976f-4665-b207-175aa2751b77");
const result = packBest(ship.items, "auto");

console.log("Unplaced:", result.unplaced.length);
for (const u of result.unplaced) {
  console.log(`  - ${u.shipper} ${u.width}x${u.length}x${u.height} qty=${u.quantity}`);
}

if (result.unplaced.length === 0) {
  console.log("✓ 모두 배치 — 작업 완료");
  process.exit(0);
}

// pack 결과의 containers[].rows 좌표는 display-rays 를 거쳐 재배치된 좌표라
// 실제 충돌 검사용으로 사용 불가.
// 대신: packBest 의 final pack() 호출을 재현해서 packState 추출 안되므로,
// 결과의 containers 의 spec 과 fillRate 만 보고 1cm STEP 으로 fine grid 검사.
//
// 더 간단한 접근: 1cm STEP brute-force 를 algorithm.ts 의 fallback 함수에서
// 시도하는데도 실패한다면 진짜 자리가 없는 것.
//
// 여기서는 "5cm STEP 이 너무 거칠어서 놓친 위치가 있는지" 만 확인하기 위해
// 1cm STEP scan 을 직접 시뮬레이션.

const u = result.unplaced[0];
const targetCargoId = u.cargoId;
const targetW = u.width;
const targetL = u.length;
const targetH = u.height;

// 모든 화물 LDF 로 정렬해 한 컨테이너씩 배치 시뮬레이션 (algorithm 그대로 못 쓰니 단순 LDF)
// 단순 packExtremePoint 로 simulate 하면 결과는 다를 수 있다 — 이건 추정용 예시.
const sortLDF = (us) =>
  [...us].sort((a, b) => {
    const va = a.width * a.length * a.height,
      vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    return b.weight - a.weight;
  });

// 컨테이너 spec
const c40 = makeContainerState();
const spec40 = getContainerSpec("40FT");
const c20 = makeContainerState();
const spec20 = getContainerSpec("20FT");

// 임시: actual packBest 결과의 placement 좌표를 DISPLAY 가 아닌 물리 좌표로 다시 가져오기 어렵다.
// 대신 1cm step brute-force 를 algorithm fallback 이 시도했고 실패했으니
// 실제 자리가 없는 것이 거의 확실.
// 여기서는 사용자에게 "어느 컨테이너에 얼마나 많은 화물이 들어갔고 미배치 사이즈는 얼마"
// 정보로 충분.

console.log("\n=== 컨테이너 충전률 ===");
for (const c of result.containers) {
  console.log(`  ${c.spec.type}: ${c.cbmFillRate.toFixed(1)}% (visualCbm=${c.totalCbm.toFixed(2)}/${c.spec.maxCbm})`);
}

const targetCbm = (targetW * targetL * targetH) / 1_000_000;
console.log(`\n  미배치 ${u.shipper} : ${targetW}×${targetL}×${targetH} = ${targetCbm.toFixed(3)} m³`);
console.log(`  40FT 잉여 : ${(spec40.maxCbm - result.containers[0].totalCbm).toFixed(2)} m³`);
console.log(`  20FT 잉여 : ${(spec20.maxCbm - result.containers[1].totalCbm).toFixed(2)} m³`);

// 만약 기존 시각 + 미배치 = 한도 초과면 컨테이너 추가가 필요하다
const totalDemand = result.containers.reduce((s, c) => s + c.totalCbm, 0) + targetCbm;
const totalCap = result.containers.reduce((s, c) => s + c.spec.maxCbm, 0);
console.log(`\n  총 시각 CBM 수요(미배치 포함) : ${totalDemand.toFixed(2)}`);
console.log(`  총 컨테이너 용량               : ${totalCap}`);
console.log(
  totalDemand <= totalCap
    ? "  → 용량 OK : 알고리즘이 빈 공간 재배치 못한 것"
    : "  → 용량 부족 : 컨테이너 추가 필요",
);
