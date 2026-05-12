"use client";

/**
 * 부킹(Shipment) + 화물(items) 통합 입력 폼
 *
 * - 상단: 부킹 헤더 정보(House B/L, DEST, Booking 등)
 * - 중단: 엑셀/CSV 가져오기
 * - 하단: 화물 표(CargoTable)
 * - 저장: onSubmit 콜백에 정규화된 ShipmentInput 형태로 전달
 */

import { useState } from "react";
import type { ShipmentDetail } from "@/lib/repositories/shipments";
import type { CargoType, UnitSize } from "@/types/cargo";
import { CargoTable, makeEmptyRow, type CargoRow } from "./CargoTable";
import { ExcelImport } from "./ExcelImport";

/** API ShipmentInput 와 동일한 형태(items 는 CargoItemInput 형태로 변환됨) */
export interface ShipmentFormSubmit {
  displayNo: number | null;
  houseBlNo: string | null;
  destination: string | null;
  bookingNo: string | null;
  shipmentRound: number | null;
  hb: string | null;
  ep: string | null;
  n: string | null;
  actualShipperName: string | null;
  shipperName: string | null;
  about: string | null;
  generalRemark: string | null;
  items: {
    id?: string;
    sortOrder: number;
    cargoType: CargoType;
    bookingNo?: string | null;
    itemName: string | null;
    actualShipperName: string | null;
    shipperName: string | null;
    widthCm: number;
    lengthCm: number;
    heightCm: number;
    quantity: number;
    weightPerUnitKg: number;
    cbm: number | null;
    aboutCbm: number | null;
    unitSizes: UnitSize[] | null;
    noStacking: boolean;
    topOnly: boolean;
    orientation: "free" | "long_along_length" | "fixed";
    heavierBelow: boolean;
    itemRemark: string | null;
  }[];
}

interface ShipmentFormProps {
  /** 수정 모드일 때 초기값 */
  initial?: ShipmentDetail;
  onSubmit: (data: ShipmentFormSubmit) => Promise<void>;
  submitLabel?: string;
}

interface BookingState {
  displayNo: string;
  houseBlNo: string;
  destination: string;
  bookingNo: string;
  shipmentRound: string;
  hb: string;
  ep: string;
  n: string;
  actualShipperName: string;
  shipperName: string;
  about: string;
  generalRemark: string;
}

function emptyBooking(): BookingState {
  return {
    displayNo: "",
    houseBlNo: "",
    destination: "",
    bookingNo: "",
    shipmentRound: "",
    hb: "",
    ep: "",
    n: "",
    actualShipperName: "",
    shipperName: "",
    about: "",
    generalRemark: "",
  };
}

function bookingFromInitial(d: ShipmentDetail): BookingState {
  return {
    displayNo: d.displayNo == null ? "" : String(d.displayNo),
    houseBlNo: d.houseBlNo ?? "",
    destination: d.destination ?? "",
    bookingNo: d.bookingNo ?? "",
    shipmentRound: d.shipmentRound == null ? "" : String(d.shipmentRound),
    hb: d.hb ?? "",
    ep: d.ep ?? "",
    n: d.n ?? "",
    actualShipperName: d.actualShipperName ?? "",
    shipperName: d.shipperName ?? "",
    about: d.about ?? "",
    generalRemark: d.generalRemark ?? "",
  };
}

function rowsFromInitial(d: ShipmentDetail): CargoRow[] {
  return d.items.map((it, idx) => ({
    rowKey: it.id || crypto.randomUUID(),
    id: it.id,
    sortOrder: it.sortOrder ?? idx,
    cargoType: it.cargoType ?? "CT",
    bookingNo: it.bookingNo ?? "",
    houseBlNo: it.houseBlNo ?? "",
    destination: it.destination ?? "",
    itemName: it.itemName ?? "",
    actualShipperName: it.actualShipperName ?? "",
    shipperName: it.shipperName ?? "",
    widthCm: it.width,
    lengthCm: it.length,
    heightCm: it.height,
    quantity: it.quantity,
    weightPerUnitKg: it.weightPerUnit,
    cbm: it.cbm ?? null,
    aboutCbm: it.aboutCbm ?? null,
    unitSizes: it.unitSizes,
    noStacking: it.remarks.noStacking,
    topOnly: it.remarks.topOnly,
    orientation: it.remarks.orientation,
    heavierBelow: it.remarks.heavierBelow,
    itemRemark: it.remarks.notes ?? "",
  }));
}

function toNullableNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toNullableText(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

/**
 * 샘플 갱신용 페이로드 작성 후 PUT.
 * - bookingPatch: 비어있지 않은 booking 필드를 모두 포함 (사용자가 비운 칸은 빠지므로
 *                 다음 로드 시에는 비어있던 칸도 비어있는 채로 복원된다)
 * - rows: rowKey/id 같은 휘발성 식별자는 제외
 */
async function syncSample(
  key: string,
  booking: BookingState,
  rows: CargoRow[],
): Promise<void> {
  const bookingPatch: Record<string, string> = {};
  for (const [k, v] of Object.entries(booking)) {
    if (typeof v === "string" && v.trim() !== "") bookingPatch[k] = v;
  }
  const persistedRows = rows.map((r) => {
    // rowKey, id 만 제외 — 나머지는 그대로 유지
    const { rowKey: _rk, id: _id, ...rest } = r;
    return rest;
  });
  const res = await fetch(`/api/samples/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookingPatch, rows: persistedRows }),
  });
  if (!res.ok) {
    throw new Error(`샘플 갱신 실패 (${res.status})`);
  }
}

export function ShipmentForm({
  initial,
  onSubmit,
  submitLabel = "저장",
}: ShipmentFormProps) {
  const [booking, setBooking] = useState<BookingState>(
    initial ? bookingFromInitial(initial) : emptyBooking(),
  );
  const [rows, setRows] = useState<CargoRow[]>(
    initial ? rowsFromInitial(initial) : [makeEmptyRow()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 샘플 버튼으로 로드된 경우의 키. 저장이 성공하면 같은 키로 PUT 해 샘플을 갱신한다.
   * 일반 파일 import / 직접 입력은 null 로 비워둔다.
   */
  const [sampleKey, setSampleKey] = useState<string | null>(null);

  const updateBooking = (patch: Partial<BookingState>) =>
    setBooking((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 클라이언트 측 1차 검증 — 서버에서도 다시 검증되지만 즉시 피드백을 위해
    if (rows.length === 0) {
      setError("화물을 1개 이상 입력하세요");
      return;
    }
    // 사이즈/수량 미기재 행이어도 저장 허용 — 서버에서 placeholder 자동 채움.
    // 단 음수 중량 같은 명백한 입력 오류만 차단.
    for (const r of rows) {
      if (r.weightPerUnitKg < 0) {
        setError("중량은 음수일 수 없습니다");
        return;
      }
    }

    const payload: ShipmentFormSubmit = {
      displayNo: toNullableNumber(booking.displayNo),
      houseBlNo: toNullableText(booking.houseBlNo),
      destination: toNullableText(booking.destination),
      bookingNo: toNullableText(booking.bookingNo),
      shipmentRound: toNullableNumber(booking.shipmentRound),
      hb: toNullableText(booking.hb),
      ep: toNullableText(booking.ep),
      n: toNullableText(booking.n),
      actualShipperName: toNullableText(booking.actualShipperName),
      shipperName: toNullableText(booking.shipperName),
      about: toNullableText(booking.about),
      generalRemark: toNullableText(booking.generalRemark),
      items: rows.map((r, idx) => ({
        id: r.id,
        sortOrder: r.sortOrder ?? idx,
        cargoType: r.cargoType,
        bookingNo: toNullableText(r.bookingNo),
        houseBlNo: toNullableText(r.houseBlNo),
        destination: toNullableText(r.destination),
        itemName: toNullableText(r.itemName),
        actualShipperName: toNullableText(r.actualShipperName),
        shipperName: toNullableText(r.shipperName),
        widthCm: r.widthCm,
        lengthCm: r.lengthCm,
        heightCm: r.heightCm,
        quantity: r.quantity,
        weightPerUnitKg: r.weightPerUnitKg,
        cbm: r.cbm,
        aboutCbm: r.aboutCbm,
        unitSizes: r.unitSizes && r.unitSizes.length > 0 ? r.unitSizes : null,
        noStacking: r.noStacking,
        topOnly: r.topOnly,
        orientation: r.orientation,
        heavierBelow: r.heavierBelow,
        selfStackOnly: r.selfStackOnly ?? false,
        itemRemark: toNullableText(r.itemRemark),
      })),
    };

    setBusy(true);
    try {
      // 샘플 동기화는 부킹 저장 전에 먼저. 부킹 저장이 router.push 로 페이지를 떠나면
      // 이후 fetch 가 중단될 수 있어 순서를 명시적으로 잡는다. 실패해도 본 저장은 진행.
      if (sampleKey) {
        await syncSample(sampleKey, booking, rows).catch((e) => {
          console.warn("샘플 동기화 실패", e);
        });
      }
      await onSubmit(payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "저장 실패";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 부킹 정보 입력 영역은 UI에서 제거됨 — 부킹 레벨 데이터는 엑셀 import 또는 초기값 그대로 유지·저장된다 */}

      <section>
        <ExcelImport
          onImport={({ bookingPatch, rows: importedRows }, source) => {
            // 샘플에서 로드된 경우 키 보관, 그 외엔 클리어 (일반 파일은 샘플 갱신 대상 아님)
            setSampleKey(source?.sampleKey ?? null);

            // 샘플 로드는 booking 도 강제 덮어쓰기 (편집본을 그대로 복원하기 위함).
            // 일반 파일 import 는 사용자 입력 보존 (빈 칸만 덮어쓰기).
            if (Object.keys(bookingPatch).length > 0) {
              setBooking((prev) => {
                const next: BookingState = { ...prev };
                for (const [k, v] of Object.entries(bookingPatch)) {
                  const key = k as keyof BookingState;
                  if (source?.sampleKey || !prev[key]) next[key] = v;
                }
                return next;
              });
            }
            // 화물 행 처리:
            //  - 샘플 로드: 항상 교체 (편집본을 그대로 복원)
            //  - 일반 import + 빈 기본 행 1개뿐: 교체
            //  - 그 외: 사용자 확인 (교체/추가)
            if (importedRows.length > 0) {
              setRows((prev) => {
                if (source?.sampleKey) return importedRows;
                const onlyEmpty =
                  prev.length === 1 &&
                  prev[0].widthCm === 0 &&
                  prev[0].lengthCm === 0 &&
                  prev[0].heightCm === 0 &&
                  !prev[0].itemName;
                if (onlyEmpty) return importedRows;
                const replace = window.confirm(
                  `기존 화물 ${prev.length}행이 있습니다.\n\n확인: 교체 (기존 행 모두 삭제 후 새 ${importedRows.length}행만)\n취소: 끝에 추가 (총 ${prev.length + importedRows.length}행)`,
                );
                return replace ? importedRows : [...prev, ...importedRows];
              });
            }
          }}
        />
        {sampleKey && (
          <div className="mt-2 flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
            <span>
              샘플 <b>{sampleKey}</b> 로드됨 — 저장 시 이 샘플도 같이 갱신됩니다.
            </span>
            <button
              type="button"
              onClick={() => setSampleKey(null)}
              className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-emerald-700 hover:bg-emerald-100"
              title="이번 저장은 샘플에 반영하지 않음"
            >
              샘플 연결 해제
            </button>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-800">
          화물 목록
        </h3>
        <CargoTable rows={rows} onChange={setRows} />
      </section>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "저장 중…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-neutral-600"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
