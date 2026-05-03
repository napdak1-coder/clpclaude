-- 0007: plan_placements.plan_row_id NULLABLE 정리
--
-- 9번 자유 좌표(extreme-point) 알고리즘 도입 후, plan_rows 는
-- 시각 그룹핑 용도로만 남는다. 미래 확장(행 없는 placement 직접 저장)을
-- 위해 plan_row_id 의 NOT NULL 제약을 제거하고 FK 동작을 SET NULL 로 약화한다.
--
-- SQLite 는 ALTER COLUMN 으로 NOT NULL 을 제거할 수 없으므로
-- "create new → copy → swap → reindex" 패턴을 사용한다.
--
-- 멱등 보장:
--   - 모든 destructive 단계는 명시적으로 IF EXISTS / IF NOT EXISTS 가드.
--   - VIEW 가 plan_placements 를 참조하므로 RENAME 충돌을 막기 위해
--     swap 전에 VIEW 를 먼저 DROP, swap 후에 다시 CREATE.
--   - 이미 적용된 DB 에 다시 실행해도 같은 최종 상태가 된다 (데이터 보존).

PRAGMA foreign_keys = OFF;

-- 1) VIEW 와 leftover 임시 테이블 정리 (RENAME 충돌 차단)
DROP VIEW IF EXISTS plan_shipper_stats_v;
DROP TABLE IF EXISTS plan_placements_v2;

-- 2) 새 스키마 — plan_row_id NULLABLE + ON DELETE SET NULL
CREATE TABLE plan_placements_v2 (
  id            TEXT PRIMARY KEY,
  plan_row_id   TEXT REFERENCES plan_rows(id) ON DELETE SET NULL,
  cargo_id      TEXT NOT NULL,
  shipper       TEXT,
  item_name     TEXT,
  layer         TEXT NOT NULL CHECK (layer IN ('bottom','top')),
  pos_x_cm      REAL NOT NULL,
  pos_y_cm      REAL NOT NULL,
  width_cm      REAL NOT NULL,
  length_cm     REAL NOT NULL,
  height_cm     REAL NOT NULL,
  rotated       INTEGER NOT NULL DEFAULT 0,
  weight_kg     REAL NOT NULL DEFAULT 0,
  no_stacking   INTEGER NOT NULL DEFAULT 0,
  top_only      INTEGER NOT NULL DEFAULT 0,
  orientation   TEXT NOT NULL DEFAULT 'free'
                CHECK (orientation IN ('free','long_along_length','fixed')),
  heavier_below INTEGER NOT NULL DEFAULT 0
);

-- 3) 데이터 이전 — 컬럼 명시 (SELECT * 는 컬럼 순서 의존이라 위험)
INSERT INTO plan_placements_v2 (
  id, plan_row_id, cargo_id, shipper, item_name, layer,
  pos_x_cm, pos_y_cm, width_cm, length_cm, height_cm,
  rotated, weight_kg, no_stacking, top_only, orientation, heavier_below
)
SELECT
  id, plan_row_id, cargo_id, shipper, item_name, layer,
  pos_x_cm, pos_y_cm, width_cm, length_cm, height_cm,
  rotated, weight_kg, no_stacking, top_only, orientation, heavier_below
FROM plan_placements;

-- 4) 원본 폐기, v2 → 본명
DROP TABLE plan_placements;
ALTER TABLE plan_placements_v2 RENAME TO plan_placements;

-- 5) 인덱스 복원
CREATE INDEX IF NOT EXISTS idx_plan_placements_row     ON plan_placements (plan_row_id);
CREATE INDEX IF NOT EXISTS idx_plan_placements_cargo   ON plan_placements (cargo_id);
CREATE INDEX IF NOT EXISTS idx_plan_placements_shipper ON plan_placements (shipper);
CREATE INDEX IF NOT EXISTS idx_plan_placements_layer   ON plan_placements (layer);

-- 6) 분석 뷰 재정의 — plan_row_id NULL 케이스를 명시적으로 제외
CREATE VIEW plan_shipper_stats_v AS
SELECT
  pl.id                  AS plan_id,
  pl.shipment_id         AS shipment_id,
  pp.shipper             AS shipper,
  COUNT(*)               AS placed_unit_count,
  SUM(pp.weight_kg)      AS placed_weight_kg,
  SUM(pp.width_cm * pp.length_cm * pp.height_cm) / 1000000.0 AS placed_cbm
FROM clp_plans pl
JOIN plan_containers pc ON pc.plan_id = pl.id
JOIN plan_rows pr       ON pr.plan_container_id = pc.id
JOIN plan_placements pp ON pp.plan_row_id = pr.id
WHERE pp.plan_row_id IS NOT NULL
GROUP BY pl.id, pp.shipper;

PRAGMA foreign_keys = ON;
