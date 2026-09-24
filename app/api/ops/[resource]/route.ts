import { getOpsRepository } from "../../../../db/ops-server";
import { isAuthorizedOpsRequest, opsWriteAuthorizationError, unauthorizedResponse } from "../../../../src/server/ops-auth";
import { parseOpsResource, validateResourceWrite } from "../../../../src/server/ops-validation";

interface RouteContext { params: Promise<{ resource: string }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!isAuthorizedOpsRequest(request)) return unauthorizedResponse();
  const resource = parseOpsResource((await context.params).resource);
  if (!resource) return Response.json({ error: "未知数据类型" }, { status: 404 });
  const url = new URL(request.url);
  const records = await getOpsRepository().list(resource, {
    marketplace: url.searchParams.get("marketplace") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    asin: url.searchParams.get("asin") ?? undefined,
    sku: url.searchParams.get("sku") ?? undefined,
    keywordId: url.searchParams.get("keywordId") ?? undefined,
    competitorAsin: url.searchParams.get("competitorAsin") ?? undefined,
  });
  return Response.json({ records });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const authorizationError = opsWriteAuthorizationError(request);
  if (authorizationError) return authorizationError;
  const resource = parseOpsResource((await context.params).resource);
  if (!resource) return Response.json({ error: "未知数据类型" }, { status: 404 });
  try {
    const payload = validateResourceWrite(await request.json());
    const result = await getOpsRepository().upsertBatch(resource, payload.records, payload.importBatch);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无效请求" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const authorizationError = opsWriteAuthorizationError(request);
  if (authorizationError) return authorizationError;
  const resource = parseOpsResource((await context.params).resource);
  if (!resource) return Response.json({ error: "未知数据类型" }, { status: 404 });
  const stableKey = new URL(request.url).searchParams.get("key");
  if (!stableKey) return Response.json({ error: "缺少 key" }, { status: 400 });
  await getOpsRepository().delete(resource, stableKey);
  return new Response(null, { status: 204 });
}
