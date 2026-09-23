export type OpsResource = "products" | "business" | "ads" | "traffic" | "inventory" | "inbound" | "promotion" | "competitors" | "keywords" | "dailyOps" | "alerts";

export interface OpsFilter {
  marketplace?: string;
  startDate?: string;
  endDate?: string;
  asin?: string;
  sku?: string;
  keywordId?: string;
  competitorAsin?: string;
}

export interface ServerImportBatch {
  id: string;
  filename: string;
  importedAt: string;
  source?: string;
  issues?: readonly string[];
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface OpsRepository {
  list<T extends Record<string, unknown>>(resource: OpsResource, filter: OpsFilter): Promise<T[]>;
  upsertBatch(resource: OpsResource, records: readonly Record<string, unknown>[], batch: ServerImportBatch): Promise<UpsertResult>;
  delete(resource: OpsResource, stableKey: string): Promise<void>;
  listImports(): Promise<ServerImportBatch[]>;
  health(): Promise<{ ok: true; recordCount: number; importCount: number }>;
}

export function stableRecordKey(record: Record<string, unknown>): string {
  const direct = record.id ?? record.key;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  throw new Error("Every cloud record requires a stable key");
}
