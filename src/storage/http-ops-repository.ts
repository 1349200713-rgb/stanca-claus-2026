import type { OpsFilter, OpsResource, ServerImportBatch, UpsertResult } from "../../db/ops-repository";
import type { ClientOpsRepository } from "./ops-repository";

interface HttpOpsOptions {
  fetch?: typeof globalThis.fetch;
  authorization?: () => string;
  baseUrl?: string;
}

async function payloadOrError<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    const error = new Error(payload.error ?? `经营数据请求失败（${response.status}）`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload as T;
}

export function createHttpOpsRepository(options: HttpOpsOptions = {}): ClientOpsRepository {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "/api/ops";
  const endpoint = (path: string) => new URL(`${baseUrl}/${path}`, globalThis.location?.origin ?? "http://localhost").toString();
  const headers = (json = false): Headers => {
    const result = new Headers();
    const authorization = options.authorization?.();
    if (authorization) result.set("authorization", authorization);
    if (json) result.set("content-type", "application/json");
    return result;
  };
  const unlockAndRetry = async <T>(operation: () => Promise<T>): Promise<T> => operation().catch(async (error: Error & { status?: number }) => {
    if (error.status !== 428 || typeof window === "undefined") throw error;
    const password = window.prompt("请输入操作密码");
    if (!password) throw new Error("取消操作");
    const unlock = await request(new Request(endpoint("../auth/operation"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ password }),
    }));
    await payloadOrError(unlock);
    return operation();
  });
  return {
    async list<T extends Record<string, unknown>>(resource: OpsResource, filter: OpsFilter = {}): Promise<T[]> {
      const query = new URLSearchParams();
      Object.entries(filter).forEach(([key, value]) => { if (value) query.set(key, value); });
      const suffix = query.size ? `?${query}` : "";
      const response = await request(new Request(endpoint(`${resource}${suffix}`), { headers: headers() }));
      return (await payloadOrError<{ records: T[] }>(response)).records;
    },
    async upsertBatch(resource: OpsResource, records: readonly Record<string, unknown>[], importBatch: ServerImportBatch): Promise<UpsertResult> {
      return unlockAndRetry(async () => {
        const response = await request(new Request(endpoint(resource), { method: "POST", headers: headers(true), body: JSON.stringify({ records, importBatch }) }));
        return payloadOrError<UpsertResult>(response);
      });
    },
    async delete(resource: OpsResource, stableKey: string): Promise<void> {
      return unlockAndRetry(async () => {
        const response = await request(new Request(endpoint(`${resource}?key=${encodeURIComponent(stableKey)}`), { method: "DELETE", headers: headers() }));
        if (!response.ok) await payloadOrError(response);
      });
    },
  };
}
