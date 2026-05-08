/**
 * BEFORE 상태 캡처 — 3ST SG TOTAL 컨2 (보강 전)
 * packBest('auto') 호출 → 컨2의 배치 좌표를 위에서 본 ASCII 도면으로 출력.
 * 1 char ≈ 12cm.
 */
import fs from "node:fs";
import path from "node:path";

const { packBest } = await import("../lib/packing/algorithm.ts");

const JSON_PATH = path.resolve("data/samples/singapore-total-3.json");
const OUT_PATH = path.resolve("logs/before-3st-sg-c2-ascii.txt");

const sample = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const rows = sample.rows;

const cargoes = rows.map((r, idx) => ({
  id: `sg3-${idx + 1}`,
  itemName: r.itemName || null,
  actualShipperName: r.actualShipperName ?? "",
  shipperName: r.shipperName ?? "",
  width: r.widthCm ?? 0, length: r.lengthCm ?? 0, height: r.heightCm ?? 0,
  quantity: Math.max(1, r.quantity ?? 1),
  weightPerUnit: r.weightPerUnitKg ?? 0,
  cbm: r.cbm ?? null, aboutCbm: r.aboutCbm ?? null,
  cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
  bookingNo: r.bookingNo || undefined,
  unitSizes: r.unitSizes,
  remarks: { noStacking: r.noStacking ?? false, topOnly: r.topOnly ?? false, orientation: r.orientation ?? "free", heavierBelow: r.heavierBelow ?? false },
  itemRemark: r.itemRemark ?? "",
}));

const result = packBest(cargoes, "auto");

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

log("=".repeat(80));
log("BEFORE 상태 — 3ST SG TOTAL (알고리즘 보강 전)");
log(`캡처 일시: ${new Date().toISOString()}`);
log("=".repeat(80));
log(`전체 컨테이너: ${result.containers.length}대 (${result.containers.map((c) => c.spec.type).join(", ")})`);
log(`전체 unplaced(시스템 외부): ${result.unplaced.length}`);
log("");

// 컨2 (index 1) 추출
const c2 = result.containers[1];
if (!c2) {
  log("컨2 없음 — 비정상");
} else {
  const spec = c2.spec; // {type, innerWidth, innerLength, innerHeight, ...}
  log(`[컨2] ${spec.type}  내경: ${spec.innerWidth}×${spec.innerLength}×${spec.innerHeight} cm`);

  // 모든 placement 수집 (placements: 자유 좌표 배열)
  const placements = c2.placements ?? [];
  // 일부 컨테이너는 rows[].bottomItems / topItems 구조 — placements 없으면 그쪽서 모음
  const fromRows = [];
  for (const row of (c2.rows ?? [])) {
    for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
      fromRows.push({
        unitId: it.unitId ?? it.cargoId,
        cargoId: it.cargoId,
        shipper: it.shipper ?? "",
        position: it.position ?? { x: it.x ?? 0, y: it.y ?? 0, z: it.z ?? 0 },
        size: it.size ?? { width: it.width, length: it.length, height: it.height },
      });
    }
  }
  const items = placements.length > 0 ? placements : fromRows;
  log(`컨2 배치된 unit 수: ${items.length}`);

  // C2 의 미배치 추출: result.unplaced 중 c2 후보였던 화물
  // packBest 는 컨테이너별 미배치 직접 노출하지 않음 → unplacedByContainer 시도
  const c2Unplaced = c2.unplaced ?? [];
  log(`컨2 미배치 unit 수: ${c2Unplaced.length}`);
  if (c2Unplaced.length > 0) {
    log("--- 컨2 미배치 박스 ---");
    for (const u of c2Unplaced) {
      log(`  ${u.shipper ?? ""} cargoId=${u.cargoId ?? "?"} unitId=${u.unitId ?? "?"} ${u.width ?? u.size?.width}×${u.length ?? u.size?.length}×${u.height ?? u.size?.height} cm  (${u.weight ?? "?"}kg)`);
    }
  }

  // 부피·무게
  let totalCbm = 0;
  let totalKg = 0;
  for (const it of items) {
    const sz = it.size;
    totalCbm += (sz.width * sz.length * sz.height) / 1e6;
    totalKg += it.weight ?? 0;
  }
  log(`적재 부피: ${totalCbm.toFixed(2)} m³ / ${spec.maxCbm ?? 60} m³  (${(totalCbm / (spec.maxCbm ?? 60) * 100).toFixed(1)}%)`);
  log(`적재 무게: ${totalKg.toFixed(0)} kg / ${spec.maxWeightKg ?? 25000} kg  (${(totalKg / (spec.maxWeightKg ?? 25000) * 100).toFixed(1)}%)`);

  // 위에서 본 ASCII 도면 (1 char = 12 cm, x = 폭, y = 길이)
  const SCALE = 12;
  const cols = Math.ceil(spec.innerWidth / SCALE); // 가로 (폭)
  const lengthRows = Math.ceil(spec.innerLength / SCALE); // 세로 (길이)
  log("");
  log(`--- 위에서 본 평면도 (1칸 ≈ ${SCALE}cm,  좌=문쪽 y=0, 우=벽쪽 y=${spec.innerLength}) ---`);
  log(`     화물명 색인은 cargoId 마지막 두 자리(rowIndex). ★=상단(z>0), 글자=하단(z=0)`);

  // 그리드: cols × lengthRows
  const grid = Array.from({ length: lengthRows }, () => Array.from({ length: cols }, () => "."));
  // 라벨: 박스마다 단일 글자 매핑
  const symbolMap = new Map(); // cargoId → char
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=?!";
  let symIdx = 0;
  function symFor(cargoId) {
    if (!symbolMap.has(cargoId)) {
      symbolMap.set(cargoId, ALPHABET[symIdx % ALPHABET.length]);
      symIdx++;
    }
    return symbolMap.get(cargoId);
  }

  // bottom 먼저 그리고 top 으로 덮어 쓰기 (★ 또는 소문자)
  const sorted = [...items].sort((a, b) => (a.position?.z ?? 0) - (b.position?.z ?? 0));
  for (const it of sorted) {
    const px = it.position?.x ?? 0;
    const py = it.position?.y ?? 0;
    const pz = it.position?.z ?? 0;
    const w = it.size?.width ?? 0;
    const l = it.size?.length ?? 0;
    const sym = symFor(it.cargoId);
    const isTop = pz > 0;
    const drawCh = isTop ? "*" : sym;
    const x0 = Math.max(0, Math.floor(px / SCALE));
    const x1 = Math.min(cols, Math.ceil((px + w) / SCALE));
    const y0 = Math.max(0, Math.floor(py / SCALE));
    const y1 = Math.min(lengthRows, Math.ceil((py + l) / SCALE));
    for (let yi = y0; yi < y1; yi++) {
      for (let xi = x0; xi < x1; xi++) {
        // 가장자리는 라벨, 안쪽은 점선 채움 (덮어쓰기 우선순위: 마지막에 그린 것)
        if (xi === x0 || yi === y0) grid[yi][xi] = drawCh;
        else grid[yi][xi] = isTop ? "*" : sym.toLowerCase();
      }
    }
  }

  // 출력 — y(길이) 방향이 위→아래, 문쪽(y=0)이 맨 위
  // 폭 방향 좌표 표시
  const ruler = "    " + Array.from({ length: cols }, (_, i) => (i % 10).toString()).join("");
  log(ruler);
  log("    " + "─".repeat(cols));
  for (let yi = 0; yi < lengthRows; yi++) {
    log(`${(yi * SCALE).toString().padStart(4, " ")}|${grid[yi].join("")}`);
  }
  log("    " + "─".repeat(cols));

  // 글자 → cargoId 색인
  log("");
  log("--- 글자 색인 (글자 → cargoId, 화주, 사이즈) ---");
  for (const [cid, sym] of symbolMap) {
    const it = items.find((x) => x.cargoId === cid);
    if (!it) continue;
    const sz = it.size;
    log(`  '${sym}' → ${cid} ${it.shipper ?? ""} ${sz.width}×${sz.length}×${sz.height}cm`);
  }
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
console.log(`\n저장: ${OUT_PATH}`);
