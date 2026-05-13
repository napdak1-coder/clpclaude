-- 0011: cargo_items.cbm_source 컬럼 추가 (2026-05-13)
--
-- 목적:
--   c.cbm 값의 출처 라벨을 DB 에 보존해 컨테이너 셋 결정·classify 분기에서
--   사용자 신고 (excel-cfs / manual-cfs / distributed-cfs / legacy-cfs) vs
--   자동값 (calculated / distributed-about) 을 구분.
--
-- 호환:
--   - 기존 행 cbm_source = NULL → 런타임 `rowToCargo` 에서 cbm 있을 때 'legacy-cfs' 폴백.
--   - 기존 알고리즘 동작 100% 보존 (legacy-cfs 는 excel-cfs 와 동등 취급).
--
-- 인덱스 없음 (조회 패턴 없음, 라벨 검사용).

ALTER TABLE cargo_items ADD COLUMN cbm_source TEXT;
