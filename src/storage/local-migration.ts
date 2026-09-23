import type { OpsResource } from "../../db/ops-repository";
import { opsDb, type OpsStore } from "./db";

type MigrationTarget = Pick<ReturnType<typeof targetShape>, "upsertBatch">;
function targetShape() { return { upsertBatch: async (_resource: OpsResource, _records: readonly Record<string, unknown>[], _batch: { id: string; filename: string; importedAt: string }) => ({ inserted: 0, updated: 0, skipped: 0 }) }; }

const resourceStores: Partial<Record<OpsResource, OpsStore>> = {
  business: "business",
  ads: "ads",
  inventory: "inventory",
  inbound: "inbound",
  promotion: "promotionPlan",
  dailyOps: "dailyOps",
};

let state: { completed: boolean; failedResource?: OpsResource } = { completed: false };

export async function previewLocalMigration(): Promise<Record<string, number>> {
  const entries = await Promise.all(Object.entries(resourceStores).map(async ([resource, store]) => [resource, (await opsDb.list(store)).length] as const));
  return Object.fromEntries(entries);
}

export async function migrateLocalData(input: { resources: OpsResource[]; target: MigrationTarget }): Promise<void> {
  state = { completed: false };
  for (const resource of input.resources) {
    const store = resourceStores[resource];
    if (!store) continue;
    try {
      const records = await opsDb.list(store) as unknown as Record<string, unknown>[];
      if (!records.length) continue;
      const importedAt = new Date().toISOString();
      await input.target.upsertBatch(resource, records, { id: `local-migration:${resource}:${importedAt}`, filename: `IndexedDB ${store}`, importedAt });
    } catch (error) {
      state = { completed: false, failedResource: resource };
      throw error;
    }
  }
  state = { completed: true };
}

export function migrationState() { return { ...state }; }
export function resetMigrationStateForTests(): void { state = { completed: false }; }
