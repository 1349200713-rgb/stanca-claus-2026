import { timingSafeEqual } from "node:crypto";

function sameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isAuthorizedOpsRequest(request: Request): boolean {
  if (request.headers.get("oai-authenticated-user-id")) return true;
  const expected = process.env.SANTA_OPS_API_TOKEN;
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const actual = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(actual) && sameSecret(actual, expected);
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "未认证，无法访问经营数据" }, { status: 401 });
}
