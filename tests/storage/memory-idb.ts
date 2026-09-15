type Handler = ((event: Event) => void) | null;

class MemoryRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;

  succeed(value: T): void {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.(new Event("success")));
  }

  fail(error: DOMException): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.(new Event("error")));
  }
}

interface DatabaseState {
  version: number;
  stores: Map<string, Map<string, unknown>>;
}

function cloneStores(stores: Map<string, Map<string, unknown>>): Map<string, Map<string, unknown>> {
  return new Map([...stores].map(([name, records]) => [name, new Map([...records].map(([key, value]) => [key, structuredClone(value)]))]));
}

class MemoryTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  private readonly workingStores: Map<string, Map<string, unknown>>;
  private pending = 0;
  private completed = false;
  private aborted = false;

  constructor(private readonly state: DatabaseState, private readonly mode: IDBTransactionMode, private readonly names: readonly string[]) {
    this.workingStores = cloneStores(state.stores);
  }

  objectStore(name: string): IDBObjectStore {
    const records = this.workingStores.get(name);
    if (!records) throw new DOMException(`Unknown store: ${name}`, "NotFoundError");
    return new MemoryStore(records, this) as unknown as IDBObjectStore;
  }

  request<T>(work: () => T): IDBRequest<T> {
    const request = new MemoryRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        request.succeed(work());
      } catch (error) {
        const domError = error instanceof DOMException ? error : new DOMException("IndexedDB request failed", "UnknownError");
        request.fail(domError);
        this.abort(domError);
      } finally {
        this.pending -= 1;
        this.completeWhenIdle();
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  private abort(error: DOMException): void {
    if (this.aborted) return;
    this.aborted = true;
    this.error = error;
    queueMicrotask(() => {
      this.onerror?.(new Event("error"));
      this.onabort?.(new Event("abort"));
    });
  }

  private completeWhenIdle(): void {
    if (this.pending !== 0 || this.completed || this.aborted) return;
    this.completed = true;
    if (this.mode === "readwrite") {
      for (const name of this.names) {
        const records = this.workingStores.get(name);
        if (records) this.state.stores.set(name, records);
      }
    }
    queueMicrotask(() => this.oncomplete?.(new Event("complete")));
  }
}

class MemoryStore {
  constructor(private readonly records: Map<string, unknown>, private readonly transaction: MemoryTransaction) {}

  getAll(): IDBRequest<unknown[]> {
    return this.transaction.request(() => [...this.records.values()].map((record) => structuredClone(record)));
  }

  add(value: { key: string }): IDBRequest<IDBValidKey> {
    return this.transaction.request(() => {
      if (this.records.has(value.key)) throw new DOMException("Key exists", "ConstraintError");
      this.records.set(value.key, structuredClone(value));
      return value.key;
    }) as IDBRequest<IDBValidKey>;
  }

  put(value: { key: string }): IDBRequest<IDBValidKey> {
    return this.transaction.request(() => {
      this.records.set(value.key, structuredClone(value));
      return value.key;
    }) as IDBRequest<IDBValidKey>;
  }

  clear(): IDBRequest<undefined> {
    return this.transaction.request(() => {
      this.records.clear();
      return undefined;
    });
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.transaction.request(() => {
      this.records.delete(String(key));
      return undefined;
    });
  }
}

class MemoryDatabase {
  constructor(private readonly state: DatabaseState) {}

  get objectStoreNames(): DOMStringList {
    const stores = this.state.stores;
    return {
      contains: (name: string) => stores.has(name),
      item: (index: number) => [...stores.keys()][index] ?? null,
      get length() { return stores.size; },
      [Symbol.iterator]: function* () { yield* stores.keys(); },
    } as DOMStringList;
  }

  createObjectStore(name: string): IDBObjectStore {
    if (this.state.stores.has(name)) throw new DOMException(`Store already exists: ${name}`, "ConstraintError");
    const records = new Map<string, unknown>();
    this.state.stores.set(name, records);
    return new MemoryStore(records, new MemoryTransaction(this.state, "versionchange", [name])) as unknown as IDBObjectStore;
  }

  transaction(names: string | string[], mode: IDBTransactionMode): IDBTransaction {
    const selected = Array.isArray(names) ? names : [names];
    for (const name of selected) if (!this.state.stores.has(name)) throw new DOMException(`Unknown store: ${name}`, "NotFoundError");
    return new MemoryTransaction(this.state, mode, selected) as unknown as IDBTransaction;
  }

  close(): void {}
}

export function createMemoryIdbFactory(): IDBFactory {
  const state: DatabaseState = { version: 0, stores: new Map() };
  const database = new MemoryDatabase(state);

  return {
    open: (_name: string, version = 1) => {
      const request = new MemoryRequest<IDBDatabase>() as MemoryRequest<IDBDatabase> & { onupgradeneeded: Handler };
      request.onupgradeneeded = null;
      request.result = database as unknown as IDBDatabase;
      queueMicrotask(() => {
        if (version < state.version) {
          request.fail(new DOMException("Requested database version is older", "VersionError"));
          return;
        }
        if (version > state.version) {
          request.onupgradeneeded?.(new Event("upgradeneeded"));
          state.version = version;
        }
        queueMicrotask(() => request.succeed(database as unknown as IDBDatabase));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
