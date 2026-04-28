# CLPNICE — DB 스키마 설계서

## 개요

수출 콘솔 부킹과 적재 계획(CLP)을 관리하는 데이터베이스. 한 건의 부킹(House B/L) 아래 여러 사이즈의 화물이 들어가고, 각 화물에는 다단금지/상단적재/방향제한/중량조건 같은 리마크가 붙는다. 계산된 적재 계획은 별도 이력으로 보관한다.

**DB:** PostgreSQL (Supabase 권장 — 무료 시작, 인증/스토리지/Realtime 내장, Vercel 친화)

---

## 입력 양식 매핑

사용자 기존 양식 → 스키마 컬럼

| 양식 컬럼 | 매핑 위치 | 비고 |
|---|---|---|
| No. | `shipments.display_no` | 표시 순번 |
| House B/L | `shipments.house_bl_no` | |
| DEST | `shipments.destination` | |
| Booking No | `shipments.booking_no` | |
| 차수 | `shipments.shipment_round` | |
| H/B | `shipments.hb` | |
| E/P | `shipments.ep` | |
| N | `shipments.n` | |
| 실화주 | `shipments.actual_shipper_name` (+ FK) | |
| 화주 | `shipments.shipper_name` (+ FK) | |
| Q'TY | `cargo_items.quantity` (합계는 view) | 사이즈별 분리 |
| G. W/T | `cargo_items.weight_per_unit_kg` (합계는 view) | 사이즈별 분리 |
| CFS CBM | `cargo_items.cbm` (합계는 view) | 자동 계산 가능 |
| ABOUT | `shipments.about` | |
| REMARK | `shipments.general_remark` | 부킹 전체 메모 |
| 가로/세로/높이 | `cargo_items.width_cm/length_cm/height_cm` | 사이즈별 |
| 다단금지 | `cargo_items.no_stacking` | bool |
| 상단적재 | `cargo_items.top_only` | bool |
| 방향제한 | `cargo_items.orientation` | enum |
| 중량조건 | `cargo_items.heavier_below` | bool |

---

## 엔티티 관계 (ERD 요약)

```
shippers (화주 마스터)
   │
   │ 1:N (actual_shipper_id, shipper_id)
   ▼
shipments (부킹 = 한 건의 House B/L)
   │
   │ 1:N
   ▼
cargo_items (화물 개별 사이즈/리마크)

shipments
   │
   │ 1:N (이력)
   ▼
clp_plans (계산된 적재 계획 결과)

cargo_templates (선택 — 자주 쓰는 화물 규격 단골 등록)
```

---

## 1. `shippers` — 화주 마스터

자주 쓰는 화주명/연락처를 등록해두고 부킹 입력 시 빠르게 선택.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `name` | text NOT NULL | 화주명 |
| `kind` | text NOT NULL | `actual` / `forwarder` / `both` |
| `contact` | text | 연락처/메모 |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**인덱스:** `(name)` 검색용

---

## 2. `shipments` — 부킹/출항 단위

엑셀 한 행에 해당. 하나의 House B/L = 하나의 shipment.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `display_no` | int | "No." 표시 순서 |
| `house_bl_no` | text | House B/L 번호 |
| `destination` | text | DEST |
| `booking_no` | text | Booking No |
| `shipment_round` | int | 차수 |
| `hb` | text | H/B 컬럼값 |
| `ep` | text | E/P 컬럼값 |
| `n` | text | N 컬럼값 |
| `actual_shipper_id` | uuid FK → shippers(id) NULL | 실화주 마스터 연결 |
| `actual_shipper_name` | text | 실화주명 스냅샷 (freeform 가능) |
| `shipper_id` | uuid FK → shippers(id) NULL | 화주 마스터 연결 |
| `shipper_name` | text | 화주명 스냅샷 |
| `about` | text | ABOUT |
| `general_remark` | text | REMARK (부킹 전체 메모) |
| `status` | text DEFAULT 'draft' | `draft` / `calculated` / `shipped` / `archived` |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**스냅샷 컬럼 이유:** 마스터 화주명이 바뀌어도 과거 부킹은 당시 이름 유지.

**인덱스:** `(house_bl_no)`, `(booking_no)`, `(created_at DESC)`, `(status)`

---

## 3. `cargo_items` — 화물 개별 사이즈/리마크

한 부킹 안에 여러 사이즈가 있을 수 있어 자식 테이블로 분리.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `shipment_id` | uuid FK → shipments(id) ON DELETE CASCADE | |
| `sort_order` | int DEFAULT 0 | 표시 순서 |
| `item_name` | text | 품목명 (선택) |
| `width_cm` | numeric(8,2) NOT NULL | 가로 cm |
| `length_cm` | numeric(8,2) NOT NULL | 세로 cm |
| `height_cm` | numeric(8,2) NOT NULL | 높이 cm |
| `quantity` | int NOT NULL CHECK (quantity > 0) | 수량 |
| `weight_per_unit_kg` | numeric(10,2) NOT NULL | 개당 중량 (kg) |
| `cbm` | numeric(10,4) | 부피 (NULL이면 앱 레벨에서 자동 계산) |
| `no_stacking` | bool DEFAULT false | 다단금지 |
| `top_only` | bool DEFAULT false | 상단적재 |
| `orientation` | text DEFAULT 'free' CHECK (orientation IN ('free','long_along_length','fixed')) | 방향제한 |
| `heavier_below` | bool DEFAULT false | 중량조건 (아래가 위보다 무거워야) |
| `item_remark` | text | 화물별 자유 메모 |
| `created_at` | timestamptz DEFAULT now() | |

**파생 CBM:** `(width × length × height × quantity) / 1_000_000`

**인덱스:** `(shipment_id, sort_order)`

---

## 4. `clp_plans` — 계산된 적재 계획 이력

알고리즘이 산출한 결과. 동일 shipment에 여러 번 계산 가능 (1:N).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `shipment_id` | uuid FK → shipments(id) ON DELETE CASCADE | |
| `container_mode` | text NOT NULL CHECK (container_mode IN ('auto','20ft_only','40ft_only')) | |
| `count_20ft` | int DEFAULT 0 | |
| `count_40ft` | int DEFAULT 0 | |
| `total_weight_kg` | numeric(12,2) | |
| `total_cbm` | numeric(10,4) | |
| `avg_fill_rate` | numeric(5,2) | 평균 적재율(%) |
| `result_json` | jsonb NOT NULL | 전체 ContainerPlan[] |
| `unplaced_count` | int DEFAULT 0 | 배치 못 한 화물 수 |
| `share_token` | text UNIQUE | 공유 링크 토큰 (NULL이면 비공개) |
| `created_at` | timestamptz DEFAULT now() | |

**인덱스:** `(shipment_id, created_at DESC)`, `(share_token)` UNIQUE

**`result_json` 예시:**
```json
{
  "containers": [
    {
      "index": 1,
      "spec": { "type": "40FT", "innerLength": 1200, "innerWidth": 234, "innerHeight": 268, "doorHeight": 258, "maxWeightKg": 25000 },
      "rows": [
        {
          "index": 0, "yStart": 0, "yEnd": 230,
          "bottomItems": [
            { "cargoItemId": "<uuid>", "shipper": "<화주명>", "name": "<품목명>",
              "layer": "bottom", "position": { "x": 0, "y": 0 },
              "size": { "width": 110, "length": 220, "height": 95 },
              "rotated": false, "weight": 320, "remarks": { ... } }
          ],
          "topItems": [...],
          "topClearance": 35,
          "doorPassable": true
        }
      ],
      "totalWeight": 18500,
      "totalCbm": 58.4,
      "cbmFillRate": 87.3,
      "weightFillRate": 74.0
    }
  ],
  "unplaced": [],
  "summary": { "count20FT": 0, "count40FT": 1, "totalWeight": 18500, "totalCbm": 58.4, "avgFillRate": 87.3 }
}
```

---

## 5. `cargo_templates` — 자주 쓰는 화물 규격 (선택)

같은 화주의 같은 품목을 매번 재입력하지 않도록 템플릿화.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `name` | text NOT NULL | 템플릿명 |
| `default_shipper_id` | uuid FK → shippers(id) NULL | |
| `width_cm` | numeric(8,2) | |
| `length_cm` | numeric(8,2) | |
| `height_cm` | numeric(8,2) | |
| `weight_per_unit_kg` | numeric(10,2) | |
| `default_no_stacking` | bool DEFAULT false | |
| `default_top_only` | bool DEFAULT false | |
| `default_orientation` | text DEFAULT 'free' | |
| `default_heavier_below` | bool DEFAULT false | |
| `default_remark` | text | |
| `created_at` | timestamptz DEFAULT now() | |

---

## 6. 편의 뷰 (선택) — `shipment_summary_v`

기존 양식처럼 한 행에 합계 Q'TY/G.W/T/CBM을 보여주는 뷰.

```sql
CREATE VIEW shipment_summary_v AS
SELECT
  s.id, s.display_no, s.house_bl_no, s.destination, s.booking_no,
  s.shipment_round, s.hb, s.ep, s.n,
  s.actual_shipper_name, s.shipper_name,
  COALESCE(SUM(ci.quantity), 0)                               AS total_quantity,
  COALESCE(SUM(ci.quantity * ci.weight_per_unit_kg), 0)       AS total_weight_kg,
  COALESCE(SUM(
    CASE
      WHEN ci.cbm IS NOT NULL THEN ci.cbm
      ELSE (ci.width_cm * ci.length_cm * ci.height_cm * ci.quantity) / 1000000.0
    END
  ), 0)                                                       AS total_cbm,
  s.about, s.general_remark, s.status,
  s.created_at, s.updated_at
FROM shipments s
LEFT JOIN cargo_items ci ON ci.shipment_id = s.id
GROUP BY s.id;
```

---

## 인증/권한 (Supabase RLS)

추후 결정. 일단 **단일 사용자**로 가정 — RLS 비활성화 또는 service role 단일 키 사용.
다중 사용자/팀 도입 시 `owner_id`(또는 `team_id`) 컬럼 추가 + RLS 정책으로 행 단위 접근제어.

---

## 마이그레이션 파일

`db/migrations/0001_init.sql` — 위 스키마의 SQL 정의.

---

## 향후 확장 (현재 범위 밖)

- `users` / `teams` — 다중 사용자 도입 시
- `clp_plans.parent_plan_id` — 행 수동 조정 후 재계산한 결과의 분기 추적
- `audit_log` — 누가 언제 수정했는지 기록
- `shippers.address` / `tax_id` — 인보이스/송장 자동 생성 시
