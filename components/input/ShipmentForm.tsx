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
    itemName: string | null;
    actualShipperName: string | null;
    shipperName: string | null;
    widthCm: number;
    lengthCm: number;
    heightCm: number;
    quantity: number;
    weightPerUnitKg: number;
    cbm: number | null;
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
    itemName: it.itemName ?? "",
    actualShipperName: it.actualShipperName ?? "",
    shipperName: it.shipperName ?? "",
    widthCm: it.width,
    lengthCm: it.length,
    heightCm: it.height,
    quantity: it.quantity,
    weightPerUnitKg: it.weightPerUnit,
    cbm: it.cbm ?? null,
    cbmAuto: it.cbm == null,
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
    for (const r of rows) {
      if (r.widthCm <= 0 || r.lengthCm <= 0 || r.heightCm <= 0) {
        setError("모든 화물 사이즈는 0보다 커야 합니다");
        return;
      }
      if (!Number.isInteger(r.quantity) || r.quantity <= 0) {
        setError("수량은 양의 정수여야 합니다");
        return;
      }
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
        itemName: toNullableText(r.itemName),
        actualShipperName: toNullableText(r.actualShipperName),
        shipperName: toNullableText(r.shipperName),
        widthCm: r.widthCm,
        lengthCm: r.lengthCm,
        heightCm: r.heightCm,
        quantity: r.quantity,
        weightPerUnitKg: r.weightPerUnitKg,
        cbm: r.cbm,
        noStacking: r.noStacking,
        topOnly: r.topOnly,
        orientation: r.orientation,
        heavierBelow: r.heavierBelow,
        itemRemark: toNullableText(r.itemRemark),
      })),
    };

    setBusy(true);
    try {
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
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">
          부킹 정보
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="No." htmlFor="display_no">
            <input
              id="display_no"
              type="number"
              value={booking.displayNo}
              onChange={(e) => updateBooking({ displayNo: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="House B/L" htmlFor="house_bl">
            <input
              id="house_bl"
              type="text"
              value={booking.houseBlNo}
              onChange={(e) => updateBooking({ houseBlNo: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="DEST" htmlFor="dest">
            <input
              id="dest"
              type="text"
              value={booking.destination}
              onChange={(e) => updateBooking({ destination: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Booking No" htmlFor="booking_no">
            <input
              id="booking_no"
              type="text"
              value={booking.bookingNo}
              onChange={(e) => updateBooking({ bookingNo: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="차수" htmlFor="round">
            <input
              id="round"
              type="number"
              value={booking.shipmentRound}
              onChange={(e) =>
                updateBooking({ shipmentRound: e.target.value })
              }
              className={inputCls}
            />
          </Field>
          <Field label="H/B" htmlFor="hb">
            <input
              id="hb"
              type="text"
              value={booking.hb}
              onChange={(e) => updateBooking({ hb: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="E/P" htmlFor="ep">
            <input
              id="ep"
              type="text"
              value={booking.ep}
              onChange={(e) => updateBooking({ ep: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="N" htmlFor="n">
            <input
              id="n"
              type="text"
              value={booking.n}
              onChange={(e) => updateBooking({ n: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="실화주" htmlFor="actual_shipper">
            <input
              id="actual_shipper"
              type="text"
              value={booking.actualShipperName}
              onChange={(e) =>
                updateBooking({ actualShipperName: e.target.value })
              }
              className={inputCls}
            />
          </Field>
          <Field label="화주" htmlFor="shipper">
            <input
              id="shipper"
              type="text"
              value={booking.shipperName}
              onChange={(e) => updateBooking({ shipperName: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="ABOUT" htmlFor="about">
            <input
              id="about"
              type="text"
              value={booking.about}
              onChange={(e) => updateBooking({ about: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="REMARK(부킹)" htmlFor="general_remark">
            <input
              id="general_remark"
              type="text"
              value={booking.generalRemark}
              onChange={(e) =>
                updateBooking({ generalRemark: e.target.value })
              }
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      <section>
        <ExcelImport
          onImport={({ bookingPatch, rows: importedRows }) => {
            // 부킹 자동 채움: 사용자가 이미 입력한 칸은 보존, 빈 칸만 덮어쓰기
            if (Object.keys(bookingPatch).length > 0) {
              setBooking((prev) => {
                const next: BookingState = { ...prev };
                for (const [k, v] of Object.entries(bookingPatch)) {
                  const key = k as keyof BookingState;
                  if (!prev[key]) next[key] = v;
                }
                return next;
              });
            }
            // 화물은 기존 표 끝에 추가 (빈 기본 행이 1개만 있으면 교체)
            if (importedRows.length > 0) {
              setRows((prev) => {
                const onlyEmpty =
                  prev.length === 1 &&
                  prev[0].widthCm === 0 &&
                  prev[0].lengthCm === 0 &&
                  prev[0].heightCm === 0 &&
                  !prev[0].itemName;
                return onlyEmpty ? importedRows : [...prev, ...importedRows];
              });
            }
          }}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-800">
          화물 명세
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
