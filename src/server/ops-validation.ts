import { stableRecordKey, type OpsResource, type ServerImportBatch } from "../../db/ops-repository";

const resources = new Set<OpsResource>(["products", "business", "ads", "traffic", "inventory", "inbound", "promotion", "competitors", "keywords", "dailyOps", "alerts"]);

export function parseOpsResource(value: string): OpsResource | null {
  return resources.has(value as OpsResource) ? value as OpsResource : null;
}

export function validateResourceWrite(payload: unknown): { records: Record<string, unknown>[]; importBatch: ServerImportBatch } {
  if (!payload || typeof payload !== "object") throw new Error("请求内容必须是对象");
  const candidate = payload as { records?: unknown; importBatch?: unknown };
  if (!Array.isArray(candidate.records) || !candidate.importBatch || typeof candidate.importBatch !== "object") throw new Error("缺少 records 或 importBatch");
  const records = candidate.records as Record<string, unknown>[];
  records.forEach(stableRecordKey);
  const batch = candidate.importBatch as Partial<ServerImportBatch>;
  if (!batch.id || !batch.filename || !batch.importedAt) throw new Error("导入批次缺少 id、filename 或 importedAt");
  return { records, importBatch: batch as ServerImportBatch };
}
