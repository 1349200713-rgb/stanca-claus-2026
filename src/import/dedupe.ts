export interface KeyedRecord {
  key: string;
}

export function findDuplicates<T extends KeyedRecord>(existing: readonly T[], incoming: readonly T[]) {
  const seenByKey = new Map(existing.map((record) => [record.key, record]));
  const unique: T[] = [];
  const duplicates: T[] = [];
  const comparisons: Array<{ key: string; existing: T; incoming: T }> = [];

  for (const record of incoming) {
    const previous = seenByKey.get(record.key);
    if (previous) {
      duplicates.push(record);
      comparisons.push({ key: record.key, existing: previous, incoming: record });
      continue;
    }
    seenByKey.set(record.key, record);
    unique.push(record);
  }

  return { unique, duplicates, comparisons };
}
