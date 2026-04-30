-- 0003: 알고리즘 결과를 정규화 테이블로 저장
--
-- result_json TEXT 블롭 단독 보관에서 → SQL 분석/검색/부분수정 가능한 구조로.
-- clp_plans (헤더) 1 ─ N plan_containers 1 ─ N plan_rows 1 ─ N plan_placements
-- clp_plans 1 ─ N plan_unplaced
-- 기존 result_json 컬럼은 일단 유지 (스냅샷·롤백용). 정규화 테이블은 함께 채워진다.

PRAGMA foreign_keys = ON;

-- =============================================================
-- plan_containers — 계획 안의 컨테이너 1대 단위
-- =============================================================
CREATE TABLE IF NOT EXISTS plan_containers (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES clp_plans(id) ON DELETE CASCADE,
  container_index   INTEGER NOT NULL,                    -- 1, 2, 3...
  container_type    TEXT NOT NULL CHECK (container_type IN ('20FT','40FT')),
  inner_length_cm   REAL NOT NULL,
  inner_width_cm    REAL NOT NULL,
  inner_height_cm   REAL NOT NULL,
  door_height_cm    REAL NOT NULL,
  max_weight_kg     REAL NOT NULL,
  total_weight_kg   REAL NOT NULL DEFAULT 0,
  total_cbm         REAL NOT NULL DEFAULT 0,
  cbm_fill_rate     REAL NOT NULL DEFAULT 0,
  weight_fill_rate  REAL NOT NULL DEFAULT 0,
  UNIQUE (plan_id, container_index)
);

CREATE INDEX IF NOT EXISTS idx_plan_containers_plan ON plan_containers (plan_id);

-- =============================================================
-- plan_rows — 컨테이너 내부의 행 1개 (길이방향 슬라이스)
-- =============================================================
CREATE TABLE IF NOT EXISTS plan_rows (
  id                  TEXT PRIMARY KEY,
  plan_container_id   TEXT NOT NULL REFERENCES plan_containers(id) ON DELETE CASCADE,
  row_index           INTEGER NOT NULL,
  y_start_cm          REAL NOT NULL,
  y_end_cm            REAL NOT NULL,
  bottom_max_height   REAL NOT NULL DEFAULT 0,
  top_max_height      REAL NOT NULL DEFAULT 0,
  top_clearance       REAL NOT NULL DEFAULT 0,
  door_passable       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plan_container_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_plan_rows_container ON plan_rows (plan_container_id);

-- =============================================================
-- plan_placements — 개별 unit(단위 화물) 좌표·사이즈·리마크 스냅샷
-- cargo_id 는 cargo_items.id 를 가리키지만 FK 미설정 (화물 삭제 후에도 계획은 보존)
-- =============================================================
CREATE TABLE IF NOT EXISTS plan_placements (
  id            TEXT PRIMARY KEY,
  plan_row_id   TEXT NOT NULL REFERENCES plan_rows(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_plan_placements_row     ON plan_placements (plan_row_id);
CREATE INDEX IF NOT EXISTS idx_plan_placements_cargo   ON plan_placements (cargo_id);
CREATE INDEX IF NOT EXISTS idx_plan_placements_shipper ON plan_placements (shipper);
CREATE INDEX IF NOT EXISTS idx_plan_placements_layer   ON plan_placements (layer);

-- =============================================================
-- plan_unplaced — 미배치 unit + 사유
-- =============================================================
CREATE TABLE IF NOT EXISTS plan_unplaced (
  id        TEXT PRIMARY KEY,
  plan_id   TEXT NOT NULL REFERENCES clp_plans(id) ON DELETE CASCADE,
  cargo_id  TEXT NOT NULL,
  reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_unplaced_plan  ON plan_unplaced (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_unplaced_cargo ON plan_unplaced (cargo_id);

-- =============================================================
-- 분석 편의 뷰
-- =============================================================
DROP VIEW IF EXISTS plan_shipper_stats_v;
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
GROUP BY pl.id, pp.shipper;
