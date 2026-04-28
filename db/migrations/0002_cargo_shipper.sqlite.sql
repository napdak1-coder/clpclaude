-- 0002: cargo_items 에 화주/실화주 컬럼 추가
-- 사용자 양식의 콘솔(TOTAL) 케이스에서 한 부킹 안의 화물마다 화주가 다르므로 line-level 보존
--
-- SQLite 의 ALTER TABLE ADD COLUMN 은 IF NOT EXISTS 를 지원하지 않으므로
-- db-init.mjs 가 catch 후 "duplicate column" 오류는 무시(idempotent) 처리한다.

ALTER TABLE cargo_items ADD COLUMN actual_shipper_name TEXT;
ALTER TABLE cargo_items ADD COLUMN shipper_name TEXT;
