/**
 * 싱가폴 TOTAL 샘플로 pack 플로우 재현 — 20FT 에서 YKMC 1 unit 미배치 원인 추적.
 *
 * 1) pack() 와 동일한 분류·정렬·placement 흐름 직접 실행
 * 2) 컨테이너 상태 (placements, candidates) 노출
 * 3) 미배치 YKMC unit 의 grid scan — 어느 (x,y,z,faceIdx) 가 valid 한지 검사
 * 4) 그 valid 위치를 candidate set 이 보유하는지 비교
 */

const {
  packExtremePoint,
  expandCargoesToUnits,
  makeContainerState,
  tryPlaceUnit,
} = await import("../lib/packing/extreme-point.ts");
const { effectiveSizeFace, allowedFaces } = await import(
  "../lib/packing/constraints.ts"
);
const { getContainerSpec } = await import("../lib/packing/containers.ts");
const { getShipment } = await import("../lib/repositories/shipments.ts");

const ship = await getShipment("bbd2cece-976f-4665-b207-175aa2751b77");
const cargoes = ship.items;

// 새 classify 룰: 사이즈 있으면 visual
const visual = cargoes.filter(
  (c) => c.width > 0 && c.length > 0 && c.height > 0,
);

// LDF 정렬 (algorithm.ts sortBig 동일)
const sortLDF = (us) =>
  [...us].sort((a, b) => {
    const va = a.width * a.length * a.height,
      vb = b.width * b.length * b.height;
    if (vb !== va) return vb - va;
    const longA = Math.max(a.width, a.length, a.height);
    const longB = Math.max(b.width, b.length, b.height);
    if (longB !== longA) return longB - longA;
    return b.weight - a.weight;
  });

// sortClustered (algorithm.ts 동일 로직)
const sortClustered = (units) => {
  const ldf = sortLDF(units);
  const shipperFirst = new Map();
  const cargoFirst = new Map();
  const ldfRank = new Map();
  ldf.forEach((u, idx) => {
    if (!shipperFirst.has(u.shipper)) shipperFirst.set(u.shipper, idx);
    if (!cargoFirst.has(u.cargoId)) cargoFirst.set(u.cargoId, idx);
    ldfRank.set(u.unitId, idx);
  });
  return [...ldf].sort((a, b) => {
    const sa = shipperFirst.get(a.shipper) ?? 0;
    const sb = shipperFirst.get(b.shipper) ?? 0;
    if (sa !== sb) return sa - sb;
    const ca = cargoFirst.get(a.cargoId) ?? 0;
    const cb = cargoFirst.get(b.cargoId) ?? 0;
    if (ca !== cb) return ca - cb;
    return (ldfRank.get(a.unitId) ?? 0) - (ldfRank.get(b.unitId) ?? 0);
  });
};

const allUnits = expandCargoesToUnits(visual);
const generalUnits = sortClustered(allUnits.filter((u) => !u.remarks.topOnly));

const spec40 = getContainerSpec("40FT");
const spec20 = getContainerSpec("20FT");
const cont40 = { spec: spec40, packState: makeContainerState() };
const cont20 = { spec: spec20, packState: makeContainerState() };
const containers = [cont40, cont20];

// Replicate pack flow: groupByCargoId + tryBundleStack + fallback
const STACK_EPS = 0.01;
const groupByCargoId = (units) => {
  const map = new Map();
  for (const u of units) {
    let g = map.get(u.cargoId);
    if (!g) {
      g = [];
      map.set(u.cargoId, g);
    }
    g.push(u);
  }
  return Array.from(map.values());
};
const allUnitsSameSize = (group) => {
  const f = group[0];
  return group.every((u) => u.width === f.width && u.length === f.length && u.height === f.height);
};
const pickBundleFace = (unit, spec, groupSize) => {
  const faces = allowedFaces({ width: unit.width, length: unit.length, height: unit.height, remarks: unit.remarks });
  let best = null;
  for (const faceIdx of faces) {
    const eff = effectiveSizeFace(unit, faceIdx);
    if (eff.height <= 0) continue;
    if (eff.width > spec.innerWidth + STACK_EPS) continue;
    if (eff.length > spec.innerLength + STACK_EPS) continue;
    const physMax = Math.floor((spec.innerHeight + STACK_EPS) / eff.height);
    const ms = Math.min(groupSize, physMax);
    if (ms < 2) continue;
    if (!best || ms > best.maxStack || (ms === best.maxStack && eff.height < best.h)) {
      best = { faceIdx, h: eff.height, maxStack: ms };
    }
  }
  return best;
};
const tryBundleStack = (group, candidates) => {
  if (group.length < 2 || group[0].remarks.noStacking || !allUnitsSameSize(group)) {
    return { placed: [], remaining: group };
  }
  const first = group[0];
  let host = null;
  let chosenFace = null;
  let plannedStack = 0;
  for (const c of candidates) {
    const best = pickBundleFace(first, c.spec, group.length);
    if (best) {
      if (tryPlaceUnit(first, c.packState, c.spec, { forceFaceIdx: best.faceIdx })) {
        host = c;
        chosenFace = best.faceIdx;
        plannedStack = best.maxStack;
        break;
      }
    }
    if (tryPlaceUnit(first, c.packState, c.spec)) {
      host = c;
      chosenFace = null;
      plannedStack = 1;
      break;
    }
  }
  if (!host) return { placed: [], remaining: group };
  let anchor = host.packState.placements[host.packState.placements.length - 1];
  const placed = [first];
  if (chosenFace === null || plannedStack <= 1) {
    return { placed, remaining: group.slice(1) };
  }
  for (let i = 1; i < plannedStack; i++) {
    const u = group[i];
    const tx = anchor.position.x, ty = anchor.position.y, tz = anchor.position.z + anchor.size.height;
    const scoreFn = (cand) =>
      (Math.abs(cand.x - tx) < STACK_EPS && Math.abs(cand.y - ty) < STACK_EPS && Math.abs(cand.z - tz) < STACK_EPS) ? 0 : Number.POSITIVE_INFINITY;
    if (tryPlaceUnit(u, host.packState, host.spec, { scoreFn, forceFaceIdx: chosenFace })) {
      anchor = host.packState.placements[host.packState.placements.length - 1];
      placed.push(u);
    } else break;
  }
  const ids = new Set(placed.map(p => p.unitId));
  return { placed, remaining: group.filter(u => !ids.has(u.unitId)) };
};

const unplaced = [];
for (const group of groupByCargoId(generalUnits)) {
  let remaining = group;
  if (group.length >= 2 && !group[0].remarks.noStacking) {
    const r = tryBundleStack(group, containers);
    remaining = r.remaining;
  }
  for (const u of remaining) {
    let placed = false;
    for (const c of containers) {
      if (tryPlaceUnit(u, c.packState, c.spec)) { placed = true; break; }
    }
    if (!placed) unplaced.push(u);
  }
}

console.log(`\n=== Pack 결과 ===`);
console.log(`40FT: ${cont40.packState.placements.length} placements, ${cont40.packState.candidates.length} candidates`);
console.log(`20FT: ${cont20.packState.placements.length} placements, ${cont20.packState.candidates.length} candidates`);
console.log(`Unplaced: ${unplaced.length}`);
for (const u of unplaced) {
  console.log(`  - ${u.shipper} ${u.width}×${u.length}×${u.height} weight=${u.weight} remarks=${JSON.stringify(u.remarks)}`);
}

// === 미배치 unit 분석 ===
if (unplaced.length === 0) {
  console.log("\n✓ 미배치 0 — 6 corner 확장으로 해결!");
  process.exit(0);
}

const u = unplaced[0];
console.log(`\n=== ${u.shipper} ${u.width}×${u.length}×${u.height} 분석 ===`);

// 20FT 후보점 출력
console.log(`\n20FT candidates (${cont20.packState.candidates.length}):`);
for (const c of cont20.packState.candidates) {
  console.log(`  (${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)})`);
}

// Grid scan in 20FT
console.log(`\n=== 20FT grid scan: 모든 회전 × 모든 후보점 시도 ===`);
const faces = allowedFaces({ width: u.width, length: u.length, height: u.height, remarks: u.remarks });
const placements = cont20.packState.placements;
const EPS = 0.001;
const collides = (ax, ay, az, aw, al, ah, b) =>
  ax + aw > b.position.x + EPS && ax + EPS < b.position.x + b.size.width &&
  ay + al > b.position.y + EPS && ay + EPS < b.position.y + b.size.length &&
  az + ah > b.position.z + EPS && az + EPS < b.position.z + b.size.height;

for (const c of cont20.packState.candidates) {
  for (const f of faces) {
    const eff = effectiveSizeFace(u, f);
    if (c.x + eff.width > spec20.innerWidth + EPS) continue;
    if (c.y + eff.length > spec20.innerLength + EPS) continue;
    if (c.z + eff.height > spec20.innerHeight + EPS) continue;
    let hit = false;
    for (const p of placements) if (collides(c.x, c.y, c.z, eff.width, eff.length, eff.height, p)) { hit = true; break; }
    if (hit) continue;
    if (c.z > EPS) {
      // need support — check
      const supporters = placements.filter(p =>
        Math.abs(p.position.z + p.size.height - c.z) < EPS &&
        c.x + eff.width > p.position.x + EPS && c.x + EPS < p.position.x + p.size.width &&
        c.y + eff.length > p.position.y + EPS && c.y + EPS < p.position.y + p.size.length,
      );
      if (supporters.length === 0) continue;
    }
    console.log(`  ✓ candidate (${c.x},${c.y},${c.z}) face=${f} eff=${eff.width}×${eff.length}×${eff.height} OK`);
  }
}

// Grid scan: 5cm steps z=0
console.log(`\n=== 20FT 5cm grid scan (z=0 전체 위치 검사) ===`);
let foundZ0 = 0;
for (const f of faces) {
  const eff = effectiveSizeFace(u, f);
  for (let x = 0; x + eff.width <= spec20.innerWidth; x += 5) {
    for (let y = 0; y + eff.length <= spec20.innerLength; y += 5) {
      let hit = false;
      for (const p of placements) if (collides(x, y, 0, eff.width, eff.length, eff.height, p)) { hit = true; break; }
      if (!hit) {
        if (foundZ0 < 3) console.log(`  ✓ (${x},${y},0) face=${f} eff=${eff.width}×${eff.length}×${eff.height}`);
        foundZ0++;
      }
    }
  }
}
console.log(`  z=0 빈자리 총 ${foundZ0}개`);

// z>0: 모든 placement top 위 + 모든 (x,y) 5cm grid + isFullySupported 체크
console.log(`\n=== 20FT 5cm grid scan (z>0, isFullySupported 포함) ===`);
const isFully = (px, py, w, l, sups) => {
  const pts = [
    {x: px+0.001, y: py+0.001},
    {x: px+w-0.001, y: py+0.001},
    {x: px+0.001, y: py+l-0.001},
    {x: px+w-0.001, y: py+l-0.001},
    {x: px+w/2, y: py+l/2},
  ];
  return pts.every(pt => sups.some(s =>
    pt.x >= s.position.x - 0.001 && pt.x <= s.position.x + s.size.width + 0.001 &&
    pt.y >= s.position.y - 0.001 && pt.y <= s.position.y + s.size.length + 0.001,
  ));
};
const zLevels = new Set([0]);
for (const p of placements) zLevels.add(p.position.z + p.size.height);
let foundZup = 0;
for (const f of faces) {
  const eff = effectiveSizeFace(u, f);
  for (const z of zLevels) {
    if (z + eff.height > spec20.innerHeight + 0.001) continue;
    if (z <= 0.001) continue;
    for (let x = 0; x + eff.width <= spec20.innerWidth; x += 5) {
      for (let y = 0; y + eff.length <= spec20.innerLength; y += 5) {
        let hit = false;
        for (const p of placements) if (collides(x, y, z, eff.width, eff.length, eff.height, p)) { hit = true; break; }
        if (hit) continue;
        // Supporters at z
        const sups = placements.filter(p =>
          Math.abs(p.position.z + p.size.height - z) < 0.5 &&
          x + eff.width > p.position.x + 0.001 && x + 0.001 < p.position.x + p.size.width &&
          y + eff.length > p.position.y + 0.001 && y + 0.001 < p.position.y + p.size.length,
        );
        if (sups.length === 0) continue;
        if (!isFully(x, y, eff.width, eff.length, sups)) continue;
        if (foundZup < 3) console.log(`  ✓ (${x},${y},${z}) face=${f} eff=${eff.width}×${eff.length}×${eff.height} sups=${sups.length}`);
        foundZup++;
      }
    }
  }
}
console.log(`  z>0 fully-supported 빈자리 총 ${foundZup}개`);

// 40FT 도 시도
console.log(`\n=== 40FT 도 시도 ===`);
const placements40 = cont40.packState.placements;
let found40 = 0;
const zLevels40 = new Set([0]);
for (const p of placements40) zLevels40.add(p.position.z + p.size.height);
for (const f of faces) {
  const eff = effectiveSizeFace(u, f);
  for (const z of zLevels40) {
    if (z + eff.height > spec40.innerHeight + 0.001) continue;
    for (let x = 0; x + eff.width <= spec40.innerWidth; x += 5) {
      for (let y = 0; y + eff.length <= spec40.innerLength; y += 5) {
        let hit = false;
        for (const p of placements40) if (collides(x, y, z, eff.width, eff.length, eff.height, p)) { hit = true; break; }
        if (hit) continue;
        if (z <= 0.001) {
          if (found40 < 3) console.log(`  ✓ 40FT z=0 (${x},${y},0) face=${f}`);
          found40++;
          continue;
        }
        const sups = placements40.filter(p =>
          Math.abs(p.position.z + p.size.height - z) < 0.5 &&
          x + eff.width > p.position.x + 0.001 && x + 0.001 < p.position.x + p.size.width &&
          y + eff.length > p.position.y + 0.001 && y + 0.001 < p.position.y + p.size.length,
        );
        if (sups.length === 0) continue;
        if (!isFully(x, y, eff.width, eff.length, sups)) continue;
        if (found40 < 3) console.log(`  ✓ 40FT z=${z} (${x},${y},${z}) face=${f}`);
        found40++;
      }
    }
  }
}
console.log(`  40FT 빈자리 총 ${found40}개`);
