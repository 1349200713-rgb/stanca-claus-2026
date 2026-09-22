import { NextResponse } from "next/server";
import { createOperationSession, isValidSession, verifyOperationPassword } from "../../../../src/server/store";

function sessionFrom(request: Request): string | undefined {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
}

export async function POST(request: Request) {
  if (!isValidSession(sessionFrom(request))) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string" || !verifyOperationPassword(body.password)) {
    return NextResponse.json({ error: "操作密码不正确" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("santa_ops_write", createOperationSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 60 * 30,
    path: "/",
  });
  return response;
}

