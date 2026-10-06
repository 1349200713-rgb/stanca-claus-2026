import { NextResponse } from "next/server";
import { createSession, isValidSession } from "../../../../src/server/store";
import { isLocalPasswordlessRequest } from "../../../../src/server/local-access";

const headers = { "Cache-Control": "no-store", Vary: "Cookie, Host, Origin, Sec-Fetch-Site" };

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
  const authenticated = isValidSession(token);
  if (!isLocalPasswordlessRequest(request)) return NextResponse.json({ authenticated }, { headers });

  const response = NextResponse.json({ authenticated: true, localPasswordless: true }, { headers });
  if (!authenticated) {
    response.cookies.set("santa_ops_session", createSession(), {
      httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:",
      maxAge: 60 * 60 * 24 * 14, path: "/",
    });
  }
  return response;
}
