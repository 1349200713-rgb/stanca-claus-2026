import { NextResponse } from "next/server";
import { deleteOperationSession, deleteSession } from "../../../../src/server/store";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_session=([^;]+)/)?.[1];
  deleteSession(token);
  const operationToken = request.headers.get("cookie")?.match(/(?:^|;\s*)santa_ops_write=([^;]+)/)?.[1];
  deleteOperationSession(operationToken);
  const response = NextResponse.json({ ok: true });
  response.cookies.set("santa_ops_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("santa_ops_write", "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}

