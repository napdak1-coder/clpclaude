-- 0005: cargo_items 에 ABOUT 셀 별도 보존
-- 사용자 양식의 "CFS CBM"(사용자 입력)과 "ABOUT"(자동 계산값)을 별도로 저장.
-- 시스템 CBM 비교 시 폴백 소스로 사용 (CFS CBM 없으면 ABOUT 으로 비교).

ALTER TABLE cargo_items ADD COLUMN about_cbm REAL;
