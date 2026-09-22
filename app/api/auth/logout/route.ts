import { NextResponse } from "next/server";
import { deleteSession } from "../../../../src/server/store";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
  deleteSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set("santa_ops_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}
