import { NextResponse } from "next/server";
import { isValidSession } from "../../../../src/server/store";

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
  return NextResponse.json({ authenticated: isValidSession(token) });
}
