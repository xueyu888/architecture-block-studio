export interface SelectableCanvasItem {
  id: string;
  selected?: boolean;
}

export interface CanvasClientPoint {
  x: number;
  y: number;
}

export interface CanvasClientBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function canvasClientBounds(
  start: CanvasClientPoint,
  end: CanvasClientPoint,
): CanvasClientBounds {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
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
