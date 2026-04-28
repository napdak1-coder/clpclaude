-- CLPNICE Initial Schema (SQLite)
-- Adapted from PostgreSQL version (0001_init.sql) for local PC use
-- Run via: npm run db:init  (executes scripts/db-init.mjs)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =============================================================
-- 1) shippers (화주 마스터)
-- =============================================================
CREATE TABLE IF NOT EXISTS shippers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('actual','forwarder','both')),
  contact     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_shippers_name ON shippers (name);

CREATE TRIGGER IF NOT EXISTS trg_shippers_updated_at
AFTER UPDATE ON shippers
FOR EACH ROW
BEGIN
  UPDATE shippers
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = OLD.id;
END;

-- =============================================================
-- 2) shipments (부킹/출항 단위 = House B/L 한 건)
-- =============================================================
CREATE TABLE IF NOT EXISTS shipments (
  id                    TEXT PRIMARY KEY,
  display_no            INTEGER,
  house_bl_no           TEXT,
  destination           TEXT,
  booking_no            TEXT,
  shipment_round        INTEGER,
  hb                    TEXT,
  ep                    TEXT,
  n                     TEXT,
  actual_shipper_id     TEXT REFERENCES shippers(id) ON DELETE SET NULL,
  actual_shipper_name   TEXT,
  shipper_id            TEXT REFERENCES shippers(id) ON DELETE SET NULL,
  shipper_name          TEXT,
  about                 TEXT,
  general_remark        TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','calculated','shipped','archived')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_house_bl   ON shipments (house_bl_no);
CREATE INDEX IF NOT EXISTS idx_shipments_booking_no ON shipments (booking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_status     ON shipments (status);

CREATE TRIGGER IF NOT EXISTS trg_shipments_updated_at
AFTER UPDATE ON shipments
FOR EACH ROW
BEGIN
  UPDATE shipments
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = OLD.id;
END;

-- =============================================================
-- 3) cargo_items (화물 개별 사이즈/리마크)
-- =============================================================
CREATE TABLE IF NOT EXISTS cargo_items (
  id                  TEXT PRIMARY KEY,
  shipment_id         TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  item_name           TEXT,
  -- 사용자 양식의 콘솔(TOTAL) 케이스: 한 부킹(컨테이너) 안의 화물마다 화주가 다를 수 있어
  -- shipments 의 booking-level 화주와 별개로 각 화물 라인의 실화주/화주도 보존
  actual_shipper_name TEXT,
  shipper_name        TEXT,
  width_cm            REAL    NOT NULL CHECK (width_cm  > 0),
  length_cm           REAL    NOT NULL CHECK (length_cm > 0),
  height_cm           REAL    NOT NULL CHECK (height_cm > 0),
  quantity            INTEGER NOT NULL CHECK (quantity  > 0),
  weight_per_unit_kg  REAL    NOT NULL CHECK (weight_per_unit_kg >= 0),
  cbm                 REAL,
  no_stacking         INTEGER NOT NULL DEFAULT 0,  -- 다단금지 (0/1)
  top_only            INTEGER NOT NULL DEFAULT 0,  -- 상단적재
  orientation         TEXT NOT NULL DEFAULT 'free'
                      CHECK (orientation IN ('free','long_along_length','fixed')),
  heavier_below       INTEGER NOT NULL DEFAULT 0,  -- 중량조건
  item_remark         TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_cargo_items_shipment_order
  ON cargo_items (shipment_id, sort_order);

-- =============================================================
-- 4) clp_plans (계산된 적재 계획 이력)
-- =============================================================
CREATE TABLE IF NOT EXISTS clp_plans (
  id              TEXT PRIMARY KEY,
  shipment_id     TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  container_mode  TEXT NOT NULL CHECK (container_mode IN ('auto','20ft_only','40ft_only')),
  count_20ft      INTEGER NOT NULL DEFAULT 0,
  count_40ft      INTEGER NOT NULL DEFAULT 0,
  total_weight_kg REAL,
  total_cbm       REAL,
  avg_fill_rate   REAL,
  result_json     TEXT NOT NULL,  -- JSON as TEXT (use json() functions when querying)
  unplaced_count  INTEGER NOT NULL DEFAULT 0,
  share_token     TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_clp_plans_shipment_created
  ON clp_plans (shipment_id, created_at DESC);

-- =============================================================
-- 5) cargo_templates (자주 쓰는 화물 규격)
-- =============================================================
CREATE TABLE IF NOT EXISTS cargo_templates (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  default_shipper_id      TEXT REFERENCES shippers(id) ON DELETE SET NULL,
  width_cm                REAL,
  length_cm               REAL,
  height_cm               REAL,
  weight_per_unit_kg      REAL,
  default_no_stacking     INTEGER NOT NULL DEFAULT 0,
  default_top_only        INTEGER NOT NULL DEFAULT 0,
  default_orientation     TEXT NOT NULL DEFAULT 'free'
                          CHECK (default_orientation IN ('free','long_along_length','fixed')),
  default_heavier_below   INTEGER NOT NULL DEFAULT 0,
  default_remark          TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_cargo_templates_name ON cargo_templates (name);

-- =============================================================
-- 6) shipment_summary_v (편의 뷰 — 양식 한 행 합계)
-- =============================================================
DROP VIEW IF EXISTS shipment_summary_v;
CREATE VIEW shipment_summary_v AS
SELECT
  s.id,
  s.display_no,
  s.house_bl_no,
  s.destination,
  s.booking_no,
  s.shipment_round,
  s.hb,
  s.ep,
  s.n,
  s.actual_shipper_name,
  s.shipper_name,
  COALESCE(SUM(ci.quantity), 0)                                                   AS total_quantity,
  COALESCE(SUM(ci.quantity * ci.weight_per_unit_kg), 0)                           AS total_weight_kg,
  COALESCE(SUM(
    CASE
      WHEN ci.cbm IS NOT NULL THEN ci.cbm
      ELSE (ci.width_cm * ci.length_cm * ci.height_cm * ci.quantity) / 1000000.0
    END
  ), 0)                                                                            AS total_cbm,
  s.about,
  s.general_remark,
  s.status,
  s.created_at,
  s.updated_at
FROM shipments s
LEFT JOIN cargo_items ci ON ci.shipment_id = s.id
GROUP BY s.id;

-- =============================================================
-- Done
-- =============================================================
