/**
 * DB cargo_items 의 W/L/H 가 mm 로 저장된 행을 cm 로 자동 정규화.
 *
 * 룰: max(W, L, H) > 300 + min(W, L, H) >= 10 이면 mm 로 간주 → ÷ 10
 * (placeholder 0.01 같이 작은 값은 건드리지 않음 — min < 10)
 */

const Database = (await import("libsql")).default;
const db = new Database("data/clpnice.db");

// max>300 AND min>=100 → mm 케이스 (보수적 — 실제 cm 큰 화물 보호)
const isMm = (w, l, h) => Math.max(w, l, h) > 300 && Math.min(w, l, h) >= 100;
const div10 = (x) => x / 10;

// 1) main W/L/H
const mainRows = db
  .prepare(
    "SELECT id, actual_shipper_name, width_cm, length_cm, height_cm FROM cargo_items WHERE width_cm > 300 OR length_cm > 300 OR height_cm > 300",
  )
  .all();
console.log(`[main W/L/H] 검사: ${mainRows.length} 행`);

const updMain = db.prepare(
  "UPDATE cargo_items SET width_cm = ?, length_cm = ?, height_cm = ? WHERE id = ?",
);
let mainFixed = 0;
for (const r of mainRows) {
  if (isMm(r.width_cm, r.length_cm, r.height_cm)) {
    updMain.run(div10(r.width_cm), div10(r.length_cm), div10(r.height_cm), r.id);
    console.log(
      `  ✓ ${r.actual_shipper_name}: ${r.width_cm}×${r.length_cm}×${r.height_cm} → ${div10(r.width_cm)}×${div10(r.length_cm)}×${div10(r.height_cm)}`,
    );
    mainFixed++;
  }
}
console.log(`[main W/L/H] ${mainFixed} 행 정규화됨\n`);

// 2) unit_sizes_json
const usRows = db
  .prepare(
    "SELECT id, actual_shipper_name, unit_sizes_json FROM cargo_items WHERE unit_sizes_json IS NOT NULL",
  )
  .all();
console.log(`[unit_sizes_json] 검사: ${usRows.length} 행`);

const updUS = db.prepare("UPDATE cargo_items SET unit_sizes_json = ? WHERE id = ?");
let usFixed = 0;
for (const r of usRows) {
  let arr;
  try {
    arr = JSON.parse(r.unit_sizes_json);
  } catch {
    continue;
  }
  let changed = false;
  const fixed = arr.map((u) => {
    if (isMm(u.width, u.length, u.height)) {
      changed = true;
      return {
        ...u,
        width: div10(u.width),
        length: div10(u.length),
        height: div10(u.height),
      };
    }
    return u;
  });
  if (changed) {
    updUS.run(JSON.stringify(fixed), r.id);
    console.log(`  ✓ ${r.actual_shipper_name}: ${arr.length} 사이즈 정규화`);
    usFixed++;
  }
}
console.log(`[unit_sizes_json] ${usFixed} 행 정규화됨`);

console.log(`\n완료: 총 ${mainFixed + usFixed} 행 (main ${mainFixed}, unitSizes ${usFixed})`);
