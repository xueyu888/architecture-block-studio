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

export type CanvasBoundsSelectionMode = "full" | "intersecting";

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

export interface CanvasPointHitTarget {
  /** Unique identity of this rendered geometry instance. */
  id: string;
  /** Canonical workspace selection identity shared by equivalent instances. */
  selectionKey: string;
  /** Explicit visual layer; larger values are painted above smaller values. */
  layer: number;
  /** Stable order inside one layer; larger values are painted later. */
  order: number;
  parentId?: string;
  bounds?: CanvasClientBounds;
  route?: readonly CanvasClientPoint[];
  routeTolerance?: number;
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

function canvasBoundsContainPoint(bounds: CanvasClientBounds, point: CanvasClientPoint): boolean {
  return point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom;
}

function canvasPointSegmentDistanceSquared(
  point: CanvasClientPoint,
  start: CanvasClientPoint,
  end: CanvasClientPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  const closestX = start.x + projection * deltaX;
  const closestY = start.y + projection * deltaY;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}

function canvasPointHitsRoute(
  point: CanvasClientPoint,
  route: readonly CanvasClientPoint[],
  tolerance: number,
): boolean {
  if (route.length === 0) return false;
  if (route.length === 1) {
    return canvasPointSegmentDistanceSquared(point, route[0], route[0]) <= tolerance ** 2;
  }
  return route.slice(1).some((end, index) =>
    canvasPointSegmentDistanceSquared(point, route[index], end) <= tolerance ** 2);
}

/**
 * Returns the visual hit stack from top to bottom without consulting DOM order.
 * Equivalent rendered legs of one canonical selection are represented once.
 */
export function canvasPointHitStack(
  point: CanvasClientPoint,
  targets: readonly CanvasPointHitTarget[],
): CanvasPointHitTarget[] {
  const ordered = targets
    .filter((target) =>
      Boolean(target.bounds && canvasBoundsContainPoint(target.bounds, point)) ||
      Boolean(target.route && canvasPointHitsRoute(point, target.route, target.routeTolerance ?? 0)))
    .sort((left, right) =>
      right.layer - left.layer || right.order - left.order || left.id.localeCompare(right.id));
  const seen = new Set<string>();
  return ordered.filter((target) => {
    if (seen.has(target.selectionKey)) return false;
    seen.add(target.selectionKey);
    return true;
  });
}

/**
 * Mirrors draw.io's transparent-click rule: the canonical selection is the
 * cursor. Ancestors of the top hit are skipped, and reaching the bottom wraps.
 */
export function nextCanvasPointHitTarget(
  stack: readonly CanvasPointHitTarget[],
  selectedKeys: ReadonlySet<string>,
): CanvasPointHitTarget | undefined {
  const top = stack[0];
  if (!top) return undefined;
  const byId = new Map(stack.map((target) => [target.id, target]));
  const topAncestorIds = new Set<string>();
  let parentId = top.parentId;
  while (parentId && !topAncestorIds.has(parentId)) {
    topAncestorIds.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  const eligible = stack.filter((target) => !topAncestorIds.has(target.id));
  const selectedIndex = eligible.findIndex((target) => selectedKeys.has(target.selectionKey));
  if (selectedIndex < 0) return eligible[0];
  return eligible.slice(selectedIndex + 1)
    .find((target) => !selectedKeys.has(target.selectionKey)) ?? eligible[0];
}

export function canvasBoundsSelectBounds(
  selection: CanvasClientBounds,
  candidate: CanvasClientBounds,
  mode: CanvasBoundsSelectionMode,
): boolean {
  if (mode === "full") {
    return candidate.left >= selection.left && candidate.right <= selection.right
      && candidate.top >= selection.top && candidate.bottom <= selection.bottom;
  }
  return candidate.right >= selection.left && candidate.left <= selection.right
    && candidate.bottom >= selection.top && candidate.top <= selection.bottom;
}

function canvasSegmentIntersectsBounds(
  start: CanvasClientPoint,
  end: CanvasClientPoint,
  bounds: CanvasClientBounds,
): boolean {
  if (canvasBoundsContainPoint(bounds, start) || canvasBoundsContainPoint(bounds, end)) return true;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  for (const [direction, distance] of [
    [-deltaX, start.x - bounds.left],
    [deltaX, bounds.right - start.x],
    [-deltaY, start.y - bounds.top],
    [deltaY, bounds.bottom - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return false;
  }
  return true;
}

export function canvasBoundsSelectRoute(
  selection: CanvasClientBounds,
  points: readonly CanvasClientPoint[],
  mode: CanvasBoundsSelectionMode,
): boolean {
  if (points.length === 0) return false;
  if (mode === "full") return points.every((point) => canvasBoundsContainPoint(selection, point));
  if (points.some((point) => canvasBoundsContainPoint(selection, point))) return true;
  return points.slice(1).some((point, index) =>
    canvasSegmentIntersectsBounds(points[index], point, selection));
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
