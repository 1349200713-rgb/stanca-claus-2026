import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "../../../../src/server/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !verifyPassword(body.password)) {
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("santa_ops_session", createSession(), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), maxAge: 60 * 60 * 24 * 14, path: "/" });
  return response;
}
