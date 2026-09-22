import { NextResponse } from "next/server";
import { batchWrite, isValidSession, listRecords } from "../../../src/server/store";
import type { WriteOperation } from "../../../src/storage/protocol";

const headers = { "Cache-Control": "no-store", Vary: "Cookie" };

function sessionFrom(request: Request): string | undefined {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
}

function authorized(request: Request): boolean {
  return isValidSession(sessionFrom(request));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const store = new URL(request.url).searchParams.get("store");
  if (!store) return NextResponse.json({ error: "缺少 store" }, { status: 400 });
  try {
    return NextResponse.json({ records: listRecords(store) }, { headers });
  } catch {
    return NextResponse.json({ error: "未知的数据类别" }, { status: 400, headers });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "请求来源不允许" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415, headers });
  const body = await request.json().catch(() => null) as (WriteOperation & { operations?: WriteOperation[] }) | null;
  try {
    if (!body || typeof body !== "object") return NextResponse.json({ error: "请求格式不正确" }, { status: 400, headers });
    const result = batchWrite(body.operations ?? [body]);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const conflict = error instanceof Error && error.message.includes("UNIQUE constraint");
    return NextResponse.json({ error: conflict ? "记录已存在，请刷新后重试" : "数据格式不正确，保存未完成" }, { status: conflict ? 409 : 400, headers });
  }
}
