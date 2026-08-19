export interface SelectableCanvasItem {
  id: string;
  selected?: boolean;
}

/**
 * Projects workspace selection onto controlled React Flow items while keeping
 * every unaffected item reference stable.
 */
export function reconcileCanvasSelection<T extends SelectableCanvasItem>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  let changed = false;
  const reconciled = items.map((item) => {
    const selected = selectedIds.has(item.id);
    if (Boolean(item.selected) === selected) return item;
    changed = true;
    return { ...item, selected };
  });
  return changed ? reconciled : items as T[];
}
