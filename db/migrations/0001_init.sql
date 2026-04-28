-- CLPNICE Initial Schema
-- PostgreSQL 14+ (Supabase compatible)
-- Run via: psql ... -f 0001_init.sql  OR  paste into Supabase SQL editor

-- =============================================================
-- Extensions
-- =============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- =============================================================
-- Helper: updated_at auto-touch
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 1) shippers (화주 마스터)
-- =============================================================
CREATE TABLE IF NOT EXISTS shippers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('actual','forwarder','both')),
  contact     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shippers_name ON shippers (name);

DROP TRIGGER IF EXISTS trg_shippers_updated_at ON shippers;
CREATE TRIGGER trg_shippers_updated_at
  BEFORE UPDATE ON shippers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shippers IS '화주 마스터 (단골 빠른 선택용)';
COMMENT ON COLUMN shippers.kind IS 'actual=실화주, forwarder=화주(표시), both=둘 다';

-- =============================================================
-- 2) shipments (부킹/출항 단위 = House B/L 한 건)
-- =============================================================
CREATE TABLE IF NOT EXISTS shipments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_no            int,
  house_bl_no           text,
  destination           text,
  booking_no            text,
  shipment_round        int,
  hb                    text,
  ep                    text,
  n                     text,
  actual_shipper_id     uuid REFERENCES shippers(id) ON DELETE SET NULL,
  actual_shipper_name   text,
  shipper_id            uuid REFERENCES shippers(id) ON DELETE SET NULL,
  shipper_name          text,
  about                 text,
  general_remark        text,
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','calculated','shipped','archived')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_house_bl     ON shipments (house_bl_no);
CREATE INDEX IF NOT EXISTS idx_shipments_booking_no   ON shipments (booking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at   ON shipments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_status       ON shipments (status);

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON shipments;
CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shipments IS '부킹/출항 단위 — 사용자 양식 한 행에 해당';
COMMENT ON COLUMN shipments.display_no IS '"No." 표시 순번';
COMMENT ON COLUMN shipments.actual_shipper_name IS '실화주명 스냅샷 (마스터 변경시에도 유지)';
COMMENT ON COLUMN shipments.shipper_name IS '화주명 스냅샷';

-- =============================================================
-- 3) cargo_items (화물 개별 사이즈/리마크)
-- =============================================================
CREATE TABLE IF NOT EXISTS cargo_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sort_order          int NOT NULL DEFAULT 0,
  item_name           text,
  width_cm            numeric(8,2)  NOT NULL CHECK (width_cm  > 0),
  length_cm           numeric(8,2)  NOT NULL CHECK (length_cm > 0),
  height_cm           numeric(8,2)  NOT NULL CHECK (height_cm > 0),
  quantity            int           NOT NULL CHECK (quantity  > 0),
  weight_per_unit_kg  numeric(10,2) NOT NULL CHECK (weight_per_unit_kg >= 0),
  cbm                 numeric(10,4),
  no_stacking         boolean NOT NULL DEFAULT false,  -- 다단금지
  top_only            boolean NOT NULL DEFAULT false,  -- 상단적재
  orientation         text NOT NULL DEFAULT 'free'
                      CHECK (orientation IN ('free','long_along_length','fixed')),
  heavier_below       boolean NOT NULL DEFAULT false,  -- 중량조건
  item_remark         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cargo_items_shipment_order
  ON cargo_items (shipment_id, sort_order);

COMMENT ON TABLE  cargo_items IS '한 부킹 안의 사이즈별 화물 항목';
COMMENT ON COLUMN cargo_items.no_stacking   IS '다단금지: 위에 다른 화물 못 올림';
COMMENT ON COLUMN cargo_items.top_only      IS '상단적재: 반드시 위쪽에 적재';
COMMENT ON COLUMN cargo_items.orientation   IS '방향제한: free/long_along_length/fixed';
COMMENT ON COLUMN cargo_items.heavier_below IS '중량조건: 아래가 위보다 무거워야';

-- =============================================================
-- 4) clp_plans (계산된 적재 계획 이력)
-- =============================================================
CREATE TABLE IF NOT EXISTS clp_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  container_mode  text NOT NULL CHECK (container_mode IN ('auto','20ft_only','40ft_only')),
  count_20ft      int NOT NULL DEFAULT 0,
  count_40ft      int NOT NULL DEFAULT 0,
  total_weight_kg numeric(12,2),
  total_cbm       numeric(10,4),
  avg_fill_rate   numeric(5,2),
  result_json     jsonb NOT NULL,
  unplaced_count  int NOT NULL DEFAULT 0,
  share_token     text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clp_plans_shipment_created
  ON clp_plans (shipment_id, created_at DESC);

COMMENT ON TABLE clp_plans IS '알고리즘이 산출한 적재 계획. 동일 부킹에 N개 가능';

-- =============================================================
-- 5) cargo_templates (자주 쓰는 화물 규격)
-- =============================================================
CREATE TABLE IF NOT EXISTS cargo_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  default_shipper_id      uuid REFERENCES shippers(id) ON DELETE SET NULL,
  width_cm                numeric(8,2),
  length_cm               numeric(8,2),
  height_cm               numeric(8,2),
  weight_per_unit_kg      numeric(10,2),
  default_no_stacking     boolean NOT NULL DEFAULT false,
  default_top_only        boolean NOT NULL DEFAULT false,
  default_orientation     text NOT NULL DEFAULT 'free'
                          CHECK (default_orientation IN ('free','long_along_length','fixed')),
  default_heavier_below   boolean NOT NULL DEFAULT false,
  default_remark          text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cargo_templates_name ON cargo_templates (name);

COMMENT ON TABLE cargo_templates IS '자주 쓰는 화물 규격 템플릿';

-- =============================================================
-- 6) shipment_summary_v (편의 뷰 — 기존 양식 한 행 합계)
-- =============================================================
CREATE OR REPLACE VIEW shipment_summary_v AS
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
  COALESCE(SUM(ci.quantity), 0)                                                       AS total_quantity,
  COALESCE(SUM(ci.quantity * ci.weight_per_unit_kg), 0)                               AS total_weight_kg,
  COALESCE(SUM(
    CASE
      WHEN ci.cbm IS NOT NULL THEN ci.cbm
      ELSE (ci.width_cm * ci.length_cm * ci.height_cm * ci.quantity) / 1000000.0
    END
  ), 0)                                                                                AS total_cbm,
  s.about,
  s.general_remark,
  s.status,
  s.created_at,
  s.updated_at
FROM shipments s
LEFT JOIN cargo_items ci ON ci.shipment_id = s.id
GROUP BY s.id;

COMMENT ON VIEW shipment_summary_v IS '기존 엑셀 양식 한 행에 해당하는 합계 Q''TY/G.W/T/CBM 뷰';

-- =============================================================
-- Done
-- =============================================================
