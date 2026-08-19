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

export interface CanvasGeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasGeometryPoint {
  x: number;
  y: number;
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

export function canvasGeometryBounds(
  rectangles: readonly CanvasGeometryRect[],
  paths: readonly (readonly CanvasGeometryPoint[])[],
): CanvasGeometryRect | undefined {
  const values = [
    ...rectangles.flatMap((rectangle) => [
      { x: rectangle.x, y: rectangle.y },
      { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
    ]),
    ...paths.flat(),
  ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (values.length === 0) return undefined;
  const xs = values.map((point) => point.x);
  const ys = values.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
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
