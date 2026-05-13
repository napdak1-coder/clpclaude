/* cbmSource 저장/불러오기 검증 — 마이그레이션 0011 적용 후 round-trip 테스트.
 *
 * 1) 기존 DB 데이터 깨지지 않았는지 (cargo_items 행 개수 + 샘플 행 읽기)
 * 2) cbm 있는 기존 행이 'legacy-cfs' 로 폴백되는지
 * 3) 새 CargoItemInput.cbmSource 값들이 INSERT → SELECT 사이클에서 유지되는지
 * 4) UnitSize.cbmSource 가 JSON 직렬화 → 역직렬화에서 유지되는지
 *
 * read-only 일부만 — 검증 끝나면 임시 데이터 삭제 (rollback).
 */
import { createClient } from "@libsql/client";

const dbPath = process.cwd().replaceAll("\\", "/") + "/data/clpnice.db";
const client = createClient({ url: `file:${dbPath}` });

const errors = [];
const ok = (msg) => console.log(`✅ ${msg}`);
const fail = (msg) => {
  console.log(`❌ ${msg}`);
  errors.push(msg);
};

console.log("=== cbmSource 저장/불러오기 검증 ===");
console.log(`db: ${dbPath}`);
console.log("");

// 1) 기존 DB 데이터 무결성
console.log("--- 1) 기존 데이터 무결성 ---");
const totalCargos = await client.execute("SELECT COUNT(*) AS c FROM cargo_items");
const cargoCount = Number(totalCargos.rows[0].c);
console.log(`총 cargo_items 행: ${cargoCount}`);
ok(`기존 행 ${cargoCount}건 SELECT 성공`);

const sample = await client.execute(
  "SELECT id, cbm, cbm_source, about_cbm, unit_sizes_json FROM cargo_items WHERE cbm IS NOT NULL AND cbm > 0 LIMIT 5",
);
console.log(`cbm 있는 행 샘플 ${sample.rows.length}건:`);
for (const r of sample.rows) {
  console.log(
    `  id=${String(r.id).slice(0, 8)}... cbm=${r.cbm} cbm_source=${r.cbm_source ?? "(NULL)"}`,
  );
}

// 2) rowToCargo 폴백 — cbm > 0 인데 cbm_source NULL 이면 'legacy-cfs' 부여하는지
console.log("");
console.log("--- 2) legacy-cfs 폴백 확인 ---");
const { getShipment, listShipments } = await import(
  "../lib/repositories/shipments.ts"
);
const shipments = await listShipments();
console.log(`shipments: ${shipments.length}건`);
let legacyCount = 0;
let totalCbmRows = 0;
let firstLegacyExample = null;
for (const s of shipments.slice(0, 30)) {
  const detail = await getShipment(s.id);
  if (!detail) continue;
  for (const item of detail.items) {
    if (item.cbm != null && item.cbm > 0) {
      totalCbmRows++;
      if (item.cbmSource === "legacy-cfs") {
        legacyCount++;
        if (!firstLegacyExample) firstLegacyExample = item;
      }
    }
  }
}
console.log(`cbm > 0 인 cargo 중 cbmSource='legacy-cfs' : ${legacyCount} / ${totalCbmRows}`);
if (firstLegacyExample) {
  console.log(
    `  예: id=${firstLegacyExample.id.slice(0, 8)}... cbm=${firstLegacyExample.cbm} cbmSource='${firstLegacyExample.cbmSource}'`,
  );
}
if (legacyCount > 0) {
  ok("기존 cbm 행이 legacy-cfs 로 폴백 - 알고리즘 호환 보장");
} else if (totalCbmRows === 0) {
  console.log("(cbm 있는 행 없음 — 폴백 검증 불가)");
} else {
  fail("legacy-cfs 폴백 안 됨");
}

// 3) INSERT/SELECT 사이클 — 모든 cbmSource 값 round-trip
console.log("");
console.log("--- 3) cbmSource INSERT/SELECT round-trip ---");
const cargoSources = [
  "excel-cfs",
  "manual-cfs",
  "distributed-cfs",
  "distributed-about",
  "calculated",
  "legacy-cfs",
];
const testShipmentId = "test-cbm-source-" + crypto.randomUUID().slice(0, 8);
await client.execute({
  sql: `INSERT INTO shipments (id, status) VALUES (?, 'draft')`,
  args: [testShipmentId],
});
const inserted = [];
for (let i = 0; i < cargoSources.length; i++) {
  const src = cargoSources[i];
  const itemId = `test-${src}-${crypto.randomUUID().slice(0, 8)}`;
  await client.execute({
    sql: `INSERT INTO cargo_items (
      id, shipment_id, sort_order, width_cm, length_cm, height_cm,
      quantity, weight_per_unit_kg, cbm, cbm_source, cargo_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [itemId, testShipmentId, i, 100, 100, 100, 1, 500, 1.0, src, "PL"],
  });
  inserted.push({ itemId, src });
}

// 다시 읽어서 검증
const roundTrip = await getShipment(testShipmentId);
if (!roundTrip) {
  fail("test shipment SELECT 실패");
} else {
  for (const { itemId, src } of inserted) {
    const item = roundTrip.items.find((c) => c.id === itemId);
    if (!item) {
      fail(`item ${itemId} not found after SELECT`);
      continue;
    }
    if (item.cbmSource === src) {
      ok(`cbmSource='${src}' round-trip 유지`);
    } else {
      fail(
        `cbmSource='${src}' → 읽기 후 '${item.cbmSource}' (mismatch)`,
      );
    }
  }
}

// 4) UnitSize.cbmSource JSON 직렬화 round-trip
console.log("");
console.log("--- 4) UnitSize.cbmSource JSON round-trip ---");
const unitTestId = `test-unit-${crypto.randomUUID().slice(0, 8)}`;
const unitSizes = [
  { width: 80, length: 60, height: 40, quantity: 1, weight: 100, cbm: 0.192, cbmSource: "user" },
  { width: 80, length: 60, height: 40, quantity: 1, weight: 100, cbm: 0.192, cbmSource: "calculated" },
  { width: 80, length: 60, height: 40, quantity: 1, weight: 100, cbm: 0.192, cbmSource: "distributed-cfs" },
  { width: 80, length: 60, height: 40, quantity: 1, weight: 100, cbm: 0.192, cbmSource: "distributed-about" },
  { width: 80, length: 60, height: 40, quantity: 1, weight: 100, cbm: 0.192, cbmSource: "legacy-unit-cbm" },
];
await client.execute({
  sql: `INSERT INTO cargo_items (
    id, shipment_id, sort_order, width_cm, length_cm, height_cm,
    quantity, weight_per_unit_kg, cbm, cbm_source, cargo_type, unit_sizes_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    unitTestId,
    testShipmentId,
    99,
    80,
    60,
    40,
    5,
    100,
    1.0,
    "manual-cfs",
    "PL",
    JSON.stringify(unitSizes),
  ],
});
const reloaded = await getShipment(testShipmentId);
const unitItem = reloaded?.items.find((c) => c.id === unitTestId);
if (!unitItem || !unitItem.unitSizes) {
  fail("unit test item 또는 unitSizes 누락");
} else {
  for (let i = 0; i < unitSizes.length; i++) {
    const expected = unitSizes[i].cbmSource;
    const actual = unitItem.unitSizes[i]?.cbmSource;
    if (actual === expected) {
      ok(`unit[${i}] cbmSource='${expected}' round-trip 유지`);
    } else {
      fail(`unit[${i}] cbmSource='${expected}' → '${actual}' (mismatch)`);
    }
  }
}

// 5) cleanup — test shipment 삭제
console.log("");
console.log("--- 5) test 데이터 정리 ---");
await client.execute({
  sql: "DELETE FROM cargo_items WHERE shipment_id = ?",
  args: [testShipmentId],
});
await client.execute({
  sql: "DELETE FROM shipments WHERE id = ?",
  args: [testShipmentId],
});
ok("test shipment + items 삭제 완료");

// 6) 기존 데이터 무결성 재확인 (삭제 후)
const totalAfter = await client.execute("SELECT COUNT(*) AS c FROM cargo_items");
const afterCount = Number(totalAfter.rows[0].c);
console.log(`삭제 후 cargo_items: ${afterCount}건 (시작 ${cargoCount}건과 동일 기대)`);
if (afterCount === cargoCount) {
  ok("기존 데이터 무결성 보존");
} else {
  fail(`행 수 불일치: ${cargoCount} → ${afterCount}`);
}

console.log("");
console.log("=== 종합 ===");
if (errors.length === 0) {
  console.log("✅ 모든 검증 통과");
} else {
  console.log(`❌ 실패 ${errors.length} 건:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}

client.close();
