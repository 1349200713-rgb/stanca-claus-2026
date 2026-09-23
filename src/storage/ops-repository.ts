import type { OpsFilter, OpsResource, ServerImportBatch, UpsertResult } from "../../db/ops-repository";

export interface ClientOpsRepository {
  list<T extends Record<string, unknown>>(resource: OpsResource, filter?: OpsFilter): Promise<T[]>;
  upsertBatch(resource: OpsResource, records: readonly Record<string, unknown>[], batch: ServerImportBatch): Promise<UpsertResult>;
  delete(resource: OpsResource, stableKey: string): Promise<void>;
}
