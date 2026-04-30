-- 0004: cargo_items 에 단위 사이즈 묶음(JSON) 보존
--
-- 한 행의 quantity 가 여러 개일 때, 사용자가 "사이즈" 버튼으로 단위별 사이즈를
-- 따로 입력하면 (가로,세로,높이,수량) 그룹들의 배열을 unit_sizes_json TEXT 로 저장한다.
-- 시스템 CBM 계산은 이 배열이 있으면 그룹별 합산, 없으면 행 단위 W*L*H*Q.

ALTER TABLE cargo_items ADD COLUMN unit_sizes_json TEXT;
