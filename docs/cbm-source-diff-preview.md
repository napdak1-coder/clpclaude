# cbmSource 도입 — 최소 수정안 diff 미리보기 (코드 수정 전 검토용)

date: 2026-05-13
status: **미적용 (review only)**
관련 결정: 사용자 메시지 — Q1~Q5 답변 + 8 우선순위

---

## 변경 파일 목록 (8개)

| # | 파일 | 변경 성격 |
|---|---|---|
| 1 | `types/cargo.ts` | 타입 신규: `CargoCbmSource`, `UnitSizeCbmSource` + `cbmSource?` 필드 추가 |
| 2 | `db/migrations/0011_cbm_source.sqlite.sql` | **신규 파일** — `cargo_items.cbm_source` 컬럼 추가 |
| 3 | `lib/repositories/shipments.ts` | 직렬화/역직렬화에 cbmSource 보존 + DB INSERT/SELECT 컬럼 추가 |
| 4 | `components/input/ExcelImport.tsx` | `pickRowCbm` 결과에 `cbmSource: 'excel-cfs'` 마킹 |
| 5 | `components/input/CargoTable.tsx` | `CargoRow.cbmSource?` 추가 + CFS 칸 직접 입력 시 `cbmSource: 'manual-cfs'` + `baseCbmSource` prop 전달 |
| 6 | `components/input/UnitSizesModal.tsx` | `baseCbmSource` prop 받음 + `defaultDraft` 자동 분배 시 `cbmSource: 'distributed-cfs' \| 'distributed-about' \| 'calculated'` + 사용자 직접 입력 시 `cbmSource: 'user'` |
| 7 | `lib/distribute-booking-values.ts` | 분배 결과 cargoSpec 에 `cbmSource: 'distributed-cfs'` 부착 (원본 출처 보존) |
| 8 | `lib/packing/algorithm.ts` | 신규 헬퍼 `getDeclaredCbmForContainerDecision()` + `classify` 룰 1 → `allHaveUserCfs && !anyHasSize` 조건으로 변경 + `visualCbm/ctCbm` 합산을 신규 헬퍼로 일원화 |

---

## ① `types/cargo.ts` — 타입 추가

```diff
+ /**
+  * CargoSpec.cbm 의 출처 라벨.
+  *
+  * - excel-cfs       : 엑셀 "CFS CBM" 컬럼 셀에서 파싱 (사용자 신고)
+  * - manual-cfs      : 사용자가 메인 화물 표 "CFS CBM" 칸에 직접 입력 (사용자 신고)
+  * - distributed-cfs : distributeBookingValues 가 같은 부킹 안 다른 CFS 행에서 분배해 채움
+  * - distributed-about: distributeBookingValues 가 같은 부킹 ABOUT 에서 파생해 채움 (forward compat)
+  * - calculated      : UI 자동 계산 (W×L×H×Q) — CFS 와 별개
+  * - legacy-cfs      : 기존 DB 의 라벨 없는 c.cbm — excel-cfs 와 동등 취급 (마이그레이션 폴백)
+  */
+ export type CargoCbmSource =
+   | 'excel-cfs'
+   | 'manual-cfs'
+   | 'distributed-cfs'
+   | 'distributed-about'
+   | 'calculated'
+   | 'legacy-cfs';
+
+ /**
+  * UnitSize.cbm 의 출처 라벨.
+  *
+  * - user             : 사용자가 사이즈 모달 "그룹 총 CBM" 칸에 직접 입력
+  * - calculated       : 모달이 W×L×H×Q 박스 계산값으로 자동 채움
+  * - distributed-cfs  : 모달이 행 c.cbm 받아 그룹 수로 균등 분배 (사이즈 없는 행)
+  * - distributed-about: 모달이 행 aboutCbm 받아 그룹 수로 균등 분배
+  * - legacy-unit-cbm  : 기존 unit_sizes_json 의 라벨 없는 cbm — calculated 와 동등 취급
+  */
+ export type UnitSizeCbmSource =
+   | 'user'
+   | 'calculated'
+   | 'distributed-cfs'
+   | 'distributed-about'
+   | 'legacy-unit-cbm';
+
  export interface UnitSize {
    ...
    cbm?: number;
+   /** 이 cbm 값의 출처. 미설정 시 'legacy-unit-cbm' 으로 폴백 (calculated 와 동등). */
+   cbmSource?: UnitSizeCbmSource;
    ...
  }

  export interface CargoSpec {
    ...
    cbm?: number;
+   /** 이 cbm 값의 출처. 미설정 시 'legacy-cfs' 으로 폴백 (excel-cfs 와 동등). */
+   cbmSource?: CargoCbmSource;
    aboutCbm?: number;
    ...
  }
```

선언만 — runtime 동작 변화 0.

---

## ② `db/migrations/0011_cbm_source.sqlite.sql` — 신규 파일

```sql
-- 0011: c.cbm 출처 라벨 컬럼 추가
-- 기존 행은 NULL — 런타임에서 'legacy-cfs' 로 폴백 → 기존 동작 100% 보존

ALTER TABLE cargo_items ADD COLUMN cbm_source TEXT;
-- 인덱스 없음 (조회 패턴 없음, 라벨 검사용)
```

---

## ③ `lib/repositories/shipments.ts` — 직렬화/역직렬화

```diff
function parseUnitSizes(raw: unknown): UnitSize[] | undefined {
  ...
  for (const o of arr) {
    ...
+   const cbmSrcRaw =
+     typeof (o as Record<string, unknown>).cbmSource === 'string'
+       ? ((o as Record<string, unknown>).cbmSource as string)
+       : undefined;
+   const cbmSource: UnitSizeCbmSource | undefined =
+     cbmSrcRaw === 'user' || cbmSrcRaw === 'calculated' ||
+     cbmSrcRaw === 'distributed-cfs' || cbmSrcRaw === 'distributed-about' ||
+     cbmSrcRaw === 'legacy-unit-cbm'
+       ? (cbmSrcRaw as UnitSizeCbmSource)
+       : undefined;
    cleaned.push({
      width: w, length: l, height: h, quantity: q, weight: ...,
      ...(ct ? { cargoType: ct } : {}),
      ...(Number.isFinite(cbmVal) && cbmVal > 0 ? { cbm: cbmVal } : {}),
+     // legacy 폴백: cbm 있는데 source 없으면 legacy-unit-cbm 으로 마킹
+     ...(Number.isFinite(cbmVal) && cbmVal > 0
+         ? { cbmSource: cbmSource ?? 'legacy-unit-cbm' }
+         : {}),
    });
  }
}

function serializeUnitSizes(arr: UnitSize[] | undefined | null): string | null {
  ...
  return JSON.stringify(
    cleaned.map((u) => {
      ...
+     if (u.cbmSource) base.cbmSource = u.cbmSource;
      return base;
    }),
  );
}

// DB select (line ~242)
return {
  ...
  cbm: toNullableNumber(row.cbm) ?? undefined,
+ cbmSource: typeof row.cbm_source === 'string'
+   ? (row.cbm_source as CargoCbmSource)
+   : (toNullableNumber(row.cbm) ?? undefined) !== undefined ? 'legacy-cfs' : undefined,
  aboutCbm: toNullableNumber(row.about_cbm) ?? undefined,
  ...
};

// DB insert (line ~297, ~384) — INSERT 쿼리에 cbm_source 추가
INSERT INTO cargo_items (
  ..., cbm, cbm_source, about_cbm, ...
) VALUES (
  ..., ?, ?, ?, ...
);
// values: ..., item.cbm ?? null, item.cbmSource ?? null, item.aboutCbm ?? null, ...
```

---

## ④ `components/input/ExcelImport.tsx` — 엑셀 출처 마킹

기존 line 263~266:
```ts
case "cbm": {
  base.cbm = pickRowCbm(row, header);
  base.aboutCbm = pickRowAbout(row, header, headers);
  break;
}
```

변경:
```diff
  case "cbm": {
    base.cbm = pickRowCbm(row, header);
    base.aboutCbm = pickRowAbout(row, header, headers);
+   if (base.cbm != null && base.cbm > 0) {
+     base.cbmSource = 'excel-cfs';
+   }
    break;
  }
```

---

## ⑤ `components/input/CargoTable.tsx` — UI 입력 출처 마킹

### 5-A. `CargoRow` 인터페이스 확장

```diff
  export interface CargoRow {
    ...
    cbm: number | null;
+   /** cbm 값의 출처 — UI 표시 + 알고리즘 분기용 */
+   cbmSource?: CargoCbmSource;
    aboutCbm: number | null;
    ...
  }
```

### 5-B. CFS CBM 칸 onChange (기존 line 655~660)

```diff
  onChange={(e) => {
    const num = Number(e.target.value);
-   updateRow(r.rowKey, {
-     cbm: Number.isFinite(num) ? num : null,
-   });
+   const valid = Number.isFinite(num) && num > 0;
+   updateRow(r.rowKey, {
+     cbm: Number.isFinite(num) ? num : null,
+     cbmSource: valid ? 'manual-cfs' : undefined,
+   });
  }}
```

### 5-C. UnitSizesModal 에 출처 prop 전달 (기존 line 883~891)

```diff
  baseCbm={
    sizeModalRow
      ? (isDistributed(sizeModalRow.rowKey, "cbm")
          ? (distributedValue(sizeModalRow.rowKey, "cbm") ?? undefined)
          : isDistributed(sizeModalRow.rowKey, "aboutCbm")
            ? (distributedValue(sizeModalRow.rowKey, "aboutCbm") ?? undefined)
            : (sizeModalRow.cbm ?? sizeModalRow.aboutCbm ?? undefined))
      : undefined
  }
+ baseCbmOrigin={
+   sizeModalRow
+     ? (isDistributed(sizeModalRow.rowKey, "cbm")
+         ? 'cfs'
+         : isDistributed(sizeModalRow.rowKey, "aboutCbm")
+           ? 'about'
+           : sizeModalRow.cbm != null && sizeModalRow.cbm > 0
+             ? 'cfs'
+             : sizeModalRow.aboutCbm != null && sizeModalRow.aboutCbm > 0
+               ? 'about'
+               : undefined)
+     : undefined
+ }
```

---

## ⑥ `components/input/UnitSizesModal.tsx` — 모달 출처 마킹

### 6-A. props 인터페이스

```diff
  interface UnitSizesModalProps {
    ...
    baseCbm?: number;
+   /** baseCbm 값의 출처 — 'cfs' (행 c.cbm) / 'about' (행 aboutCbm) / undefined */
+   baseCbmOrigin?: 'cfs' | 'about';
    ...
  }
```

### 6-B. `defaultDraft` 자동 분배 출처 마킹 (기존 line 96~127)

```diff
  if (n > 50) {
    const grp: DraftRow = { ... };
-   if (baseCbm > 0) grp.cbm = Number(baseCbm.toFixed(4));
+   if (baseCbm > 0) {
+     grp.cbm = Number(baseCbm.toFixed(4));
+     grp.cbmSource =
+       base.baseCbmOrigin === 'about' ? 'distributed-about' : 'distributed-cfs';
+   }
    return [grp];
  }
  return Array.from({ length: n }, (_, idx) => {
    const grp: DraftRow = { ... };
    if (perGroupCbm > 0) {
      const v = idx === n - 1 ? baseCbm - perGroupCbm * (n - 1) : perGroupCbm;
      grp.cbm = Number(v.toFixed(4));
+     grp.cbmSource =
+       base.baseCbmOrigin === 'about' ? 'distributed-about' : 'distributed-cfs';
    }
    return grp;
  });
```

### 6-C. 사용자가 모달 cbm 칸 직접 입력 (기존 line 326~338)

```diff
  onChange={(e) => {
    const t = e.target.value;
    const num = Number(t);
+   const valid = t !== "" && Number.isFinite(num) && num > 0;
    updateRow(d.rowKey, {
      cbm:
-       t === "" || !Number.isFinite(num) || num <= 0
-         ? undefined
-         : num,
+       valid ? num : undefined,
+     cbmSource: valid ? 'user' : undefined,
    });
  }}
```

### 6-D. `handleSave` — UnitSize 직렬화 시 cbmSource 보존 (기존 line 218~221)

```diff
- if (typeof d.cbm === "number" && d.cbm > 0) u.cbm = d.cbm;
+ if (typeof d.cbm === "number" && d.cbm > 0) {
+   u.cbm = d.cbm;
+   u.cbmSource = d.cbmSource ?? 'calculated';
+ }
```

---

## ⑦ `lib/distribute-booking-values.ts` — 분배 출처 보존

기존 line 76~90:
```ts
for (const field of fields) {
  const filled = updated.filter((c) => !isEmpty(c[field] as number | null | undefined));
  if (filled.length === 1 && updated.length > 1) {
    const total = filled[0][field] as number;
    for (const c of updated) {
      const ratio = (c.quantity ?? 0) / totalQty;
      (c as Record<string, unknown>)[field] = total * ratio;
      const set = distributedFields.get(c.id) ?? new Set<DistributedField>();
      set.add(field);
      distributedFields.set(c.id, set);
    }
  }
}
```

변경:
```diff
  for (const field of fields) {
    const filled = updated.filter((c) => !isEmpty(c[field] as number | null | undefined));
    if (filled.length === 1 && updated.length > 1) {
      const total = filled[0][field] as number;
+     // 분배 결과의 cbmSource — 원본 행 출처가 cfs 계열이면 'distributed-cfs',
+     // about 계열이면 'distributed-about'. 다른 필드(weightPerUnit)는 cbmSource 영향 X.
+     const originalCbmSource = (filled[0] as CargoSpec).cbmSource;
+     const distributedSource: CargoCbmSource =
+       originalCbmSource === 'manual-cfs' ||
+       originalCbmSource === 'excel-cfs' ||
+       originalCbmSource === 'legacy-cfs' ||
+       originalCbmSource === 'distributed-cfs' ||
+       originalCbmSource === undefined
+         ? 'distributed-cfs'
+         : 'distributed-cfs';  // 보수적 폴백
      for (const c of updated) {
        const ratio = (c.quantity ?? 0) / totalQty;
        (c as Record<string, unknown>)[field] = total * ratio;
+       if (field === 'cbm') {
+         (c as Record<string, unknown>).cbmSource = distributedSource;
+       }
        const set = distributedFields.get(c.id) ?? new Set<DistributedField>();
        set.add(field);
        distributedFields.set(c.id, set);
      }
    }
  }
```

---

## ⑧ `lib/packing/algorithm.ts` — 헬퍼 + classify + 합산 변경

### 8-A. 신규 헬퍼 `getDeclaredCbmForContainerDecision` (cargoCbm 옆에 추가, line ~119)

```ts
/**
 * 컨테이너 셋 결정용 부피 추정 — 사용자 신고 우선 → ABOUT → 시스템 CBM 폴백.
 *
 * 우선순위:
 *   1. excel-cfs / manual-cfs / distributed-cfs / legacy-cfs (= 사용자 신고 CFS)
 *   2. aboutCbm > 0 (ABOUT 또는 distributed-about 가 c.cbm 에 있다면 그것도 1번 우선)
 *   3. cargoCbm(c) (시스템 CBM, W×L×H×Q 또는 unitSizes 합)
 *
 * calculated 출처는 사용자 신고 아님 → 1번 통과 X, 2번/3번 폴백.
 * 결과는 양수 보장.
 */
function getDeclaredCbmForContainerDecision(c: CargoSpec): number {
  const cfsLikeSources: CargoCbmSource[] = [
    'excel-cfs',
    'manual-cfs',
    'distributed-cfs',
    'legacy-cfs',
  ];
  const src = c.cbmSource ?? 'legacy-cfs';
  if (typeof c.cbm === 'number' && c.cbm > 0 && cfsLikeSources.includes(src)) {
    return c.cbm;
  }
  if (typeof c.aboutCbm === 'number' && c.aboutCbm > 0) {
    return c.aboutCbm;
  }
  return cargoCbm(c);
}
```

### 8-B. `classify` 룰 1 변경 (기존 line 217~225)

```diff
  const allHaveCbm =
    cargoes.length >= 2 && cargoes.every((c) => (c.cbm ?? 0) > 0);
- if (allHaveCbm) {
+ // 사용자 신고 CFS (excel-cfs / manual-cfs / distributed-cfs / legacy-cfs) 만 카운트.
+ // calculated 자동 계산값 때문에 allHaveCbm 이 트리거되면 안 됨 (사용자 절대 룰).
+ const allHaveUserCfs =
+   cargoes.length >= 2 &&
+   cargoes.every((c) => {
+     const src = c.cbmSource ?? 'legacy-cfs';
+     const isCfsLike =
+       src === 'excel-cfs' ||
+       src === 'manual-cfs' ||
+       src === 'distributed-cfs' ||
+       src === 'legacy-cfs';
+     return isCfsLike && (c.cbm ?? 0) > 0;
+   });
+ // anyHasSize: 사이즈 입력된 행이 한 건이라도 있으면 룰 1 우회.
+ const anyHasSize = cargoes.some(
+   (c) =>
+     (c.width >= SIZE_MIN_CM &&
+       c.length >= SIZE_MIN_CM &&
+       c.height >= SIZE_MIN_CM) ||
+     (c.unitSizes?.some(
+       (u) =>
+         u.width >= SIZE_MIN_CM &&
+         u.length >= SIZE_MIN_CM &&
+         u.height >= SIZE_MIN_CM,
+     ) ??
+       false),
+ );
+ if (allHaveUserCfs && !anyHasSize) {
    return { visualCargoes: [], ctCargoes: [...cargoes], completedCargoes: [] };
  }
```

(strictVisualClassification 옵션은 이미 적용된 상태 유지. 이번 변경은 production 기본값을 안전하게 강화.)

### 8-C. `visualCbm`, `ctCbm` 합산 일원화 (기존 line 1200~1206)

```diff
- const visualCbm = visualCargoes.reduce((s, c) => s + cargoCbm(c), 0);
- const ctCbm = ctCargoes.reduce(
-   (s, c) => s + (c.cbm ?? c.aboutCbm ?? cargoCbm(c)),
-   0,
- );
+ // 사용자 결정: 컨 셋 결정용 부피는 CFS → ABOUT → 시스템 우선순위로 visual·ct 모두 통일.
+ // 기존: visual=system 만 / ct=cfs 우선 → 같은 신고값이 트랙 따라 다르게 계산되던 결함 해소.
+ const visualCbm = visualCargoes.reduce(
+   (s, c) => s + getDeclaredCbmForContainerDecision(c),
+   0,
+ );
+ const ctCbm = ctCargoes.reduce(
+   (s, c) => s + getDeclaredCbmForContainerDecision(c),
+   0,
+ );
```

⚠ **주의**: 이 변경은 visual 트랙의 컨 셋 결정 입력값을 바꿈. 기존 trace 결과 (망작 등) 와 다른 후보가 나올 수 있음. 회귀 확인 필수.

---

## 변경 후 적용되는 분류 흐름 (한 줄 그림)

```
엑셀 CFS 셀  ──► excel-cfs ───┐
사용자 CFS 칸 ──► manual-cfs ──┤
distribute   ──► distributed-cfs ──┤── 컨 셋 결정 1순위
legacy DB    ──► legacy-cfs ──┘

엑셀 ABOUT  ──► c.aboutCbm ────────── 컨 셋 결정 2순위
모달 자동분배 (cbm 출처)──► distributed-cfs / distributed-about (UnitSize)
모달 사용자 직접──► user
모달 자동계산──► calculated ───────── 컨 셋 결정 3순위 (시스템 CBM 폴백)
```

---

## 검증 시나리오 (수정 후 회귀)

| 샘플 | 기대 결과 |
|---|---|
| 1ST SG | 40FT+20FT, 미배치 0 (변화 없음) |
| 2ST SG | 40FT×2, 미배치 0 (변화 없음) |
| 3ST SG | 40FT×2, 미배치 0, Rule G 유지 |
| 4ST SG | candidateUnion 시 40FT×3 valid 유지 또는 더 작은 셋 valid 시 채택 |
| 5ST SG | 컨 셋 재결정 후 미배치 0 (시각 배치 한계는 별도 단계에서 보강) |
| 망작 SG | 40FT 1대 후보 후속 단계에서 검토 가능 (calculated 만 채워진 행이 룰 1 우회) |
| 1ST HM | 40FT+20FT (W/L/H 0 인 카톤 행은 anyHasSize=false → 룰 1 발동 그대로) |
| 2ST HM | 40FT×2+20FT, 미배치 0 |
| 3ST HM | 40FT+20FT |
| 4ST HM | 40FT×2+20FT 후보 유지 (candidateUnion) |

---

## 회귀 위험 종합

| 위험 | 평가 |
|---|---|
| 기존 DB 데이터 호환성 | **낮음** — legacy 폴백으로 excel-cfs 동등 취급 |
| 알고리즘 동작 변화 | **중간** — visualCbm 산정 방식 변경 (system→CFS우선) |
| DB 마이그레이션 | **낮음** — ALTER ADD COLUMN, NULL 허용, 자동 폴백 |
| UI 호환성 | **낮음** — cbmSource 는 추가 필드, 기존 표시 영향 X |
| classify 룰 1 변화 | **중간** — calculated 만 채워진 행은 더 이상 룰 1 트리거 X. 1ST HM 처럼 진짜 카톤은 영향 X |
| 시각 배치 엔진 한계 (망작·4ST SG·5ST SG 미배치) | **별도 단계** — 이번 변경은 트럭 결정만 정확해짐. 시각 배치 미해결은 묶음 룰 완화/gap-fill/reposition 으로 다음 단계 처리 |

---

## 코드 수정 진행 전 최종 확인

| 항목 | 확인 필요 |
|---|---|
| ① 타입 추가 (cargo.ts) — 6 라인 | OK? |
| ② DB 마이그레이션 0011 — 1 컬럼 | OK? |
| ③ shipments.ts 직렬화 — parse + serialize + INSERT/SELECT | OK? |
| ④ ExcelImport.tsx 마킹 — 4 라인 | OK? |
| ⑤ CargoTable.tsx 마킹 — CargoRow 필드 + onChange + baseCbmOrigin prop | OK? |
| ⑥ UnitSizesModal.tsx 마킹 — props + defaultDraft + onChange + handleSave | OK? |
| ⑦ distributeBookingValues 분배 마킹 — 1 if 블록 | OK? |
| ⑧ algorithm.ts — 신규 헬퍼 + classify 룰 변경 + visualCbm/ctCbm 일원화 | OK? |

모두 OK 면 진행. 일부만 OK 면 그 부분만 적용 후 회귀.

특히 ⑧ **C (visualCbm/ctCbm 일원화) 는 회귀 영향 가장 큼** — 별도 단계로 분리 가능. ⑧A·⑧B 만 먼저 적용해서 cbmSource 도입 효과만 확인 후 ⑧C 적용 검토하는 안도 있음.
