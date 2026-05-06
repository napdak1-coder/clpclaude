-- 0010: cargo_items 에 House B/L 와 DEST(목적지) 컬럼 per-cargo 추가
--
-- 기존: shipments.house_bl_no, shipments.destination 만 존재 (부킹 단위).
-- 사용자 양식의 콘솔(TOTAL) 케이스: 한 부킹 안에 여러 House B/L 화물이 섞여
-- 행마다 다른 HBL/DEST 가질 수 있음 → cargo 단위 보존.
--
-- shipment 마스터 house_bl_no/destination 은 그대로 유지. cargo.house_bl_no/destination
-- 가 없으면 shipment 마스터 fallback 사용 가능.

ALTER TABLE cargo_items ADD COLUMN house_bl_no TEXT;
ALTER TABLE cargo_items ADD COLUMN destination TEXT;

CREATE INDEX IF NOT EXISTS idx_cargo_items_hbl
  ON cargo_items (house_bl_no);
