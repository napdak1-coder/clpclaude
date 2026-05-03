-- 0008: cargo_items.cargo_type CHECK 제약에 'PK' 추가
--
-- 사용자 양식 추가 분류:
--   PK = 묶음 화물 (화주가 단위 미고지, 사이즈만 옴 / WC + 카톤 섞임 표기)
--        실측 사이즈 있으면 정상 화물처럼 시각 적재.
--
-- SQLite 는 ALTER TABLE 로 CHECK 제약 변경 불가 → 0007 패턴 (drop view → recreate
-- table → swap → reindex → recreate view) 사용. 멱등 보장.

PRAGMA foreign_keys = OFF;

-- 1) 의존 view 정리 + leftover 임시 테이블 정리
DROP VIEW IF EXISTS shipment_summary_v;
DROP TABLE IF EXISTS cargo_items_v2;

-- 2) 새 스키마 — cargo_type CHECK 에 PK 추가, 그 외 모든 컬럼은 0001+0002+0004+0005+0006 누적과 동일
CREATE TABLE cargo_items_v2 (
  id                  TEXT PRIMARY KEY,
  shipment_id         TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  item_name           TEXT,
  actual_shipper_name TEXT,
  shipper_name        TEXT,
  width_cm            REAL    NOT NULL CHECK (width_cm  > 0),
  length_cm           REAL    NOT NULL CHECK (length_cm > 0),
  height_cm           REAL    NOT NULL CHECK (height_cm > 0),
  quantity            INTEGER NOT NULL CHECK (quantity  > 0),
  weight_per_unit_kg  REAL    NOT NULL CHECK (weight_per_unit_kg >= 0),
  cbm                 REAL,
  no_stacking         INTEGER NOT NULL DEFAULT 0,
  top_only            INTEGER NOT NULL DEFAULT 0,
  orientation         TEXT NOT NULL DEFAULT 'free'
                      CHECK (orientation IN ('free','long_along_length','fixed')),
  heavier_below       INTEGER NOT NULL DEFAULT 0,
  item_remark         TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unit_sizes_json     TEXT,
  about_cbm           REAL,
  cargo_type          TEXT NOT NULL DEFAULT 'CT'
                      CHECK (cargo_type IN ('PL','WB','WC','WD','CR','CL','PK','CT'))
);

-- 3) 데이터 이전 — 컬럼 명시 (SELECT * 는 컬럼 순서 의존이라 위험)
INSERT INTO cargo_items_v2 (
  id, shipment_id, sort_order, item_name,
  actual_shipper_name, shipper_name,
  width_cm, length_cm, height_cm,
  quantity, weight_per_unit_kg, cbm,
  no_stacking, top_only, orientation, heavier_below,
  item_remark, created_at,
  unit_sizes_json, about_cbm, cargo_type
)
SELECT
  id, shipment_id, sort_order, item_name,
  actual_shipper_name, shipper_name,
  width_cm, length_cm, height_cm,
  quantity, weight_per_unit_kg, cbm,
  no_stacking, top_only, orientation, heavier_below,
  item_remark, created_at,
  unit_sizes_json, about_cbm, cargo_type
FROM cargo_items;

-- 4) 원본 폐기, v2 → 본명
DROP TABLE cargo_items;
ALTER TABLE cargo_items_v2 RENAME TO cargo_items;

-- 5) 인덱스 복원
CREATE INDEX IF NOT EXISTS idx_cargo_items_shipment_order
  ON cargo_items (shipment_id, sort_order);

-- 6) view 복원 (0001 정의 그대로)
CREATE VIEW shipment_summary_v AS
SELECT
  s.id, s.display_no, s.house_bl_no, s.destination, s.booking_no,
  s.shipment_round, s.hb, s.ep, s.n,
  s.actual_shipper_name, s.shipper_name,
  COALESCE(SUM(ci.quantity), 0)                                AS total_quantity,
  COALESCE(SUM(ci.quantity * ci.weight_per_unit_kg), 0)        AS total_weight_kg,
  COALESCE(SUM(
    CASE
      WHEN ci.cbm IS NOT NULL THEN ci.cbm
      ELSE (ci.width_cm * ci.length_cm * ci.height_cm * ci.quantity) / 1000000.0
    END
  ), 0)                                                        AS total_cbm,
  s.about, s.general_remark, s.status,
  s.created_at, s.updated_at
FROM shipments s
LEFT JOIN cargo_items ci ON ci.shipment_id = s.id
GROUP BY s.id;

PRAGMA foreign_keys = ON;
