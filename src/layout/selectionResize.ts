import { preserveNodeAspectRatio, type NodeResizeDirection, type NodeResizeLimits, type NodeResizeRect } from "./nodeGeometry";

export interface SelectionResizeItem extends NodeResizeRect, NodeResizeLimits {
  id: string;
}

export interface ResizedSelectionItem {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface SelectionResizeResult {
  group: NodeResizeRect;
  items: readonly ResizedSelectionItem[];
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateItems(items: readonly SelectionResizeItem[]): void {
  if (items.length < 2) throw new RangeError("At least two modules are required for a group resize.");
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new RangeError("Each group-resized module must have a unique identity.");
  }
  items.forEach((item) => {
    if (![item.x, item.y].every(Number.isFinite) || ![
      item.width,
      item.height,
      item.minWidth,
      item.minHeight,
      item.maxWidth,
      item.maxHeight,
    ].every(finitePositive)) {
      throw new RangeError("Group resize geometry and limits must be finite and positive.");
    }
    if (item.minWidth > item.maxWidth || item.minHeight > item.maxHeight) {
      throw new RangeError(`Module ${item.id} has contradictory resize limits.`);
    }
  });
}

export function selectionResizeBounds(items: readonly SelectionResizeItem[]): NodeResizeRect {
  validateItems(items);
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionResizeLimits(
  items: readonly SelectionResizeItem[],
  group = selectionResizeBounds(items),
): NodeResizeLimits {
  validateItems(items);
  const minimumScaleX = Math.max(...items.map((item) => Math.min(1, item.minWidth / item.width)));
  const minimumScaleY = Math.max(...items.map((item) => Math.min(1, item.minHeight / item.height)));
  const maximumScaleX = Math.min(...items.map((item) => Math.max(1, item.maxWidth / item.width)));
  const maximumScaleY = Math.min(...items.map((item) => Math.max(1, item.maxHeight / item.height)));
  return {
    minWidth: group.width * minimumScaleX,
    minHeight: group.height * minimumScaleY,
    maxWidth: group.width * maximumScaleX,
    maxHeight: group.height * maximumScaleY,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function constrainedGroup(
  original: NodeResizeRect,
  requested: NodeResizeRect,
  direction: NodeResizeDirection,
  limits: NodeResizeLimits,
  preserveAspectRatio: boolean,
): NodeResizeRect {
  if (preserveAspectRatio) {
    return preserveNodeAspectRatio(original, requested, direction, limits);
  }
  const width = direction.x === 0
    ? original.width
    : clamp(requested.width, limits.minWidth, limits.maxWidth);
  const height = direction.y === 0
    ? original.height
    : clamp(requested.height, limits.minHeight, limits.maxHeight);
  return {
    x: direction.x < 0 ? original.x + original.width - width : original.x,
    y: direction.y < 0 ? original.y + original.height - height : original.y,
    width,
    height,
  };
}

export function requestedSelectionResizeRect(
  original: NodeResizeRect,
  delta: { x: number; y: number },
  direction: NodeResizeDirection,
): NodeResizeRect {
  const x = direction.x < 0 ? original.x + delta.x : original.x;
  const y = direction.y < 0 ? original.y + delta.y : original.y;
  const right = direction.x > 0 ? original.x + original.width + delta.x : original.x + original.width;
  const bottom = direction.y > 0 ? original.y + original.height + delta.y : original.y + original.height;
  return { x, y, width: right - x, height: bottom - y };
}

export function resizeSelectionGroup(
  items: readonly SelectionResizeItem[],
  requested: NodeResizeRect,
  direction: NodeResizeDirection,
  preserveAspectRatio = false,
): SelectionResizeResult {
  const original = selectionResizeBounds(items);
  if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite)) {
    throw new RangeError("Requested group resize geometry must be finite.");
  }
  const limits = selectionResizeLimits(items, original);
  const group = constrainedGroup(original, requested, direction, limits, preserveAspectRatio);
  const scaleX = group.width / original.width;
  const scaleY = group.height / original.height;
  return {
    group,
    items: items.map((item) => ({
      id: item.id,
      position: {
        x: Math.round(group.x + (item.x - original.x) * scaleX),
        y: Math.round(group.y + (item.y - original.y) * scaleY),
      },
      size: {
        width: Math.round(item.width * scaleX),
        height: Math.round(item.height * scaleY),
      },
    })),
  };
}
