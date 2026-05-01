/**
 * /api/samples/[key] — 샘플 양식 영속화
 *
 * 사용자가 샘플 버튼으로 불러온 양식을 편집·저장하면 같은 키로 PUT 되어
 * `data/samples/<key>.json` 에 저장된다. 다음 호출(GET) 시 xlsx 원본 대신
 * 이 JSON 이 반환되어 직전 편집 내용이 유지된다. JSON 이 없으면 404 — 호출자는
 * `public/samples/<key>.xlsx` 파싱으로 폴백한다.
 *
 * 키는 영문/숫자/하이픈만 허용 (디렉터리 트래버설 차단).
 */

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CargoRow } from "@/components/input/CargoTable";
import type { BookingFieldKey } from "@/lib/excel";

export interface SamplePayload {
  bookingPatch: Partial<Record<BookingFieldKey, string>>;
  /** rowKey/id 같은 휘발성 식별자는 제외하고 저장한다 */
  rows: Omit<CargoRow, "rowKey" | "id">[];
}

const SAFE_KEY = /^[a-z0-9-]{1,64}$/i;

function samplesDir(): string {
  return path.resolve(process.cwd(), "data", "samples");
}

function fileFor(key: string): string {
  return path.join(samplesDir(), `${key}.json`);
}

function badRequest(msg: string) {
  return NextResponse.json(
    { success: false as const, error: msg },
    { status: 400 },
  );
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;
  if (!SAFE_KEY.test(key)) return badRequest("invalid key");
  try {
    const buf = await fs.readFile(fileFor(key), "utf8");
    const data = JSON.parse(buf) as SamplePayload;
    return NextResponse.json({ success: true as const, data });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json(
        { success: false as const, error: "not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: false as const, error: "read failed" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;
  if (!SAFE_KEY.test(key)) return badRequest("invalid key");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid json");
  }
  if (!body || typeof body !== "object") return badRequest("invalid body");
  const obj = body as Record<string, unknown>;
  if (!obj.bookingPatch || typeof obj.bookingPatch !== "object") {
    return badRequest("missing bookingPatch");
  }
  if (!Array.isArray(obj.rows)) {
    return badRequest("missing rows array");
  }

  await fs.mkdir(samplesDir(), { recursive: true });
  await fs.writeFile(fileFor(key), JSON.stringify(body, null, 2), "utf8");
  return NextResponse.json({ success: true as const, data: { key } });
}
