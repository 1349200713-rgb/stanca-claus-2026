import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpsRepository } from "./ops-repository";
import { createSqliteOpsRepository } from "./ops-sqlite";

let repository: OpsRepository | undefined;

export function getOpsRepository(): OpsRepository {
  if (repository) return repository;
  const path = resolve(process.env.SANTA_OPS_DB_PATH ?? "data/santa-ops.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  repository = createSqliteOpsRepository(new DatabaseSync(path));
  return repository;
}

export function configureOpsRepositoryForTests(next: OpsRepository | undefined): void {
  repository = next;
}
