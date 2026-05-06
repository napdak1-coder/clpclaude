-- 0009: cargo_items 에 부킹 번호 (House B/L) 컬럼 추가
--
-- 콘솔(consolidation) 케이스에서 한 shipment 안에 여러 House B/L 의 화물이
-- 함께 적재됨. cargo 단위 booking_no 를 별도 보존해 같은 booking 화물끼리
-- 묶어 배치 (sortClustered 1순위) + 화면 시각화.
--
-- shipment 마스터 booking_no 는 그대로 유지. cargo.booking_no 가 없으면
-- shipment.booking_no fallback 사용 가능.

ALTER TABLE cargo_items ADD COLUMN booking_no TEXT;

CREATE INDEX IF NOT EXISTS idx_cargo_items_booking
  ON cargo_items (booking_no);
