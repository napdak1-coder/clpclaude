/**
 * /api/shipments — 부킹 목록 조회 / 생성
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  createShipment,
  listShipments,
  type CargoItemInput,
  type ShipmentInput,
} from "@/lib/repositories/shipments";

interface ApiOk<T> {
  success: true;
  data: T;
}

interface ApiErr {
  success: false;
  error: string;
}

function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiOk<T>>({ success: true, data }, { status });
}

function fail(error: string, status = 400) {
  return NextResponse.json<ApiErr>({ success: false, error }, { status });
}

/** 입력 유효성 검사 — 필수 화물 사이즈와 양수 검증 */
function validateInput(input: unknown): ShipmentInput {
  if (!input || typeof input !== "object") {
    throw new Error("요청 본문이 비어 있거나 객체가 아닙니다");
  }
  const obj = input as Record<string, unknown>;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: CargoItemInput[] = itemsRaw.map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`items[${idx}]가 객체가 아닙니다`);
    }
    const it = raw as Record<string, unknown>;
    const widthCm = Number(it.widthCm);
    const lengthCm = Number(it.lengthCm);
    const heightCm = Number(it.heightCm);
    const quantity = Number(it.quantity);
    const weightPerUnitKg = Number(it.weightPerUnitKg);
    if (!Number.isFinite(widthCm) || widthCm <= 0) {
      throw new Error(`items[${idx}].widthCm 가 유효하지 않습니다`);
    }
    if (!Number.isFinite(lengthCm) || lengthCm <= 0) {
      throw new Error(`items[${idx}].lengthCm 가 유효하지 않습니다`);
    }
    if (!Number.isFinite(heightCm) || heightCm <= 0) {
      throw new Error(`items[${idx}].heightCm 가 유효하지 않습니다`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${idx}].quantity 는 양의 정수여야 합니다`);
    }
    if (!Number.isFinite(weightPerUnitKg) || weightPerUnitKg < 0) {
      throw new Error(`items[${idx}].weightPerUnitKg 가 유효하지 않습니다`);
    }
    return {
      id: typeof it.id === "string" ? it.id : undefined,
      sortOrder: typeof it.sortOrder === "number" ? it.sortOrder : idx,
      itemName: typeof it.itemName === "string" ? it.itemName : null,
      actualShipperName:
        typeof it.actualShipperName === "string"
          ? it.actualShipperName
          : null,
      shipperName:
        typeof it.shipperName === "string" ? it.shipperName : null,
      widthCm,
      lengthCm,
      heightCm,
      quantity,
      weightPerUnitKg,
      cbm: typeof it.cbm === "number" ? it.cbm : null,
      noStacking: it.noStacking === true,
      topOnly: it.topOnly === true,
      orientation:
        it.orientation === "fixed" || it.orientation === "long_along_length"
          ? it.orientation
          : "free",
      heavierBelow: it.heavierBelow === true,
      itemRemark: typeof it.itemRemark === "string" ? it.itemRemark : null,
    };
  });

  return {
    displayNo:
      typeof obj.displayNo === "number" ? obj.displayNo : null,
    houseBlNo: typeof obj.houseBlNo === "string" ? obj.houseBlNo : null,
    destination:
      typeof obj.destination === "string" ? obj.destination : null,
    bookingNo: typeof obj.bookingNo === "string" ? obj.bookingNo : null,
    shipmentRound:
      typeof obj.shipmentRound === "number" ? obj.shipmentRound : null,
    hb: typeof obj.hb === "string" ? obj.hb : null,
    ep: typeof obj.ep === "string" ? obj.ep : null,
    n: typeof obj.n === "string" ? obj.n : null,
    actualShipperName:
      typeof obj.actualShipperName === "string"
        ? obj.actualShipperName
        : null,
    shipperName:
      typeof obj.shipperName === "string" ? obj.shipperName : null,
    about: typeof obj.about === "string" ? obj.about : null,
    generalRemark:
      typeof obj.generalRemark === "string" ? obj.generalRemark : null,
    status:
      obj.status === "draft" ||
      obj.status === "calculated" ||
      obj.status === "shipped" ||
      obj.status === "archived"
        ? obj.status
        : undefined,
    items,
  };
}

export async function GET() {
  try {
    const items = await listShipments();
    return ok(items);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "목록 조회 실패";
    return fail(msg, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const input = validateInput(body);
    const created = await createShipment(input);
    return ok(created, 201);
  } catch (e: unknown) {
    if (e instanceof SyntaxError) {
      return fail("JSON 파싱 실패", 400);
    }
    const msg = e instanceof Error ? e.message : "생성 실패";
    // 검증 오류는 400, 그 외는 500
    const status = /유효|필수|아닙니다|양의/.test(msg) ? 400 : 500;
    return fail(msg, status);
  }
}
