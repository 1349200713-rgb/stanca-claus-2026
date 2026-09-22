export const storeNames = ["business", "ads", "manual", "imports", "mappings", "rawImports", "rawRows", "derivedResults", "activePlan", "planChanges", "inventory", "inbound", "promotionPlan", "dailyOps"] as const;
export type OpsStore = typeof storeNames[number];
export type WriteMode = "insert" | "replace" | "merge";
export interface WriteOperation {
  store: OpsStore;
  records?: readonly unknown[];
  mode?: WriteMode;
  clear?: boolean;
  deleteKeys?: string[];
}
export interface WriteResult { written: number; skipped: number }

// JSON cannot carry ArrayBuffer; preserve original imported files explicitly.
export function encodeData(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (Object.prototype.toString.call(item) !== "[object ArrayBuffer]") return item;
    const bytes = new Uint8Array(item);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { $santaBytes: btoa(binary) };
  });
}

export function decodeData<T>(text: string): T {
  return JSON.parse(text, (_, item) => {
    if (item && typeof item === "object" && Object.keys(item).length === 1 && typeof item.$santaBytes === "string") {
      return Uint8Array.from(atob(item.$santaBytes), (character) => character.charCodeAt(0)).buffer;
    }
    return item;
  });
}
