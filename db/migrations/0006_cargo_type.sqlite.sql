-- 0006: 화물 종류 (cargo_type) 컬럼 추가
--
-- 사용자 양식의 Q'TY 옆 셀에 적힌 코드:
--   PL / WB / WC / WD / CR / CL — 정상 화물 (실측 W/L/H 있음, 시각 적재)
--   그 외(빈값, PK, 미상 등)    — CT (카톤). 일반 택배박스로 실측 X, CBM 만 사용,
--                                알고리즘에서는 컨테이너 여유 CBM 에 합산만 한다.

ALTER TABLE cargo_items ADD COLUMN cargo_type TEXT NOT NULL DEFAULT 'CT'
  CHECK (cargo_type IN ('PL','WB','WC','WD','CR','CL','CT'));
