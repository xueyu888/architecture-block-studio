export interface CommittedRoutingFrameMapPatch<T> {
  baseFrameKey?: string;
  upserted: ReadonlyMap<string, T>;
  removedIds: readonly string[];
}

/** Creates the smallest reference-stable map transport against one certified base frame. */
export function createCommittedRoutingFrameMapPatch<T>(
  baseFrameKey: string | undefined,
  previous: ReadonlyMap<string, T> | undefined,
  next: ReadonlyMap<string, T>,
): CommittedRoutingFrameMapPatch<T> {
  if (!baseFrameKey || !previous) {
    return { upserted: next, removedIds: [] };
  }
  return {
    baseFrameKey,
    upserted: new Map([...next].filter(([id, value]) => previous.get(id) !== value)),
    removedIds: [...previous.keys()].filter((id) => !next.has(id)).sort(),
  };
}

/** Reconstructs a complete map only when its exact certified base is available. */
export function applyCommittedRoutingFrameMapPatch<T>(
  patch: CommittedRoutingFrameMapPatch<T>,
  availableFrameKey: string | undefined,
  available: ReadonlyMap<string, T> | undefined,
): ReadonlyMap<string, T> | undefined {
  if (!patch.baseFrameKey) return patch.upserted;
  if (patch.baseFrameKey !== availableFrameKey || !available) return undefined;
  if (patch.upserted.size === 0 && patch.removedIds.length === 0) return available;
  const result = new Map(available);
  patch.removedIds.forEach((id) => result.delete(id));
  patch.upserted.forEach((value, id) => result.set(id, value));
  return result;
}
