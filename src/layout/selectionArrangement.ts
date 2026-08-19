export type SelectionAlignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type SelectionDistribution = "horizontal" | "vertical";

export interface ArrangementRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangementPosition {
  id: string;
  position: { x: number; y: number };
}

function requireValidItems(items: readonly ArrangementRect[], minimum: number): void {
  if (items.length < minimum) {
    throw new RangeError(`At least ${minimum} modules are required for this arrangement.`);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new RangeError("Each arranged module must have a unique identity.");
  }
  if (items.some((item) =>
    ![item.x, item.y, item.width, item.height].every(Number.isFinite) ||
    item.width <= 0 || item.height <= 0
  )) {
    throw new RangeError("Arrangement geometry must contain finite positions and positive dimensions.");
  }
}

function roundedPosition(id: string, x: number, y: number): ArrangementPosition {
  return { id, position: { x: Math.round(x), y: Math.round(y) } };
}

export function alignSelection(
  items: readonly ArrangementRect[],
  alignment: SelectionAlignment,
): ArrangementPosition[] {
  requireValidItems(items, 2);
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const top = Math.min(...items.map((item) => item.y));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;

  return items.map((item) => {
    switch (alignment) {
      case "left":
        return roundedPosition(item.id, left, item.y);
      case "center":
        return roundedPosition(item.id, center - item.width / 2, item.y);
      case "right":
        return roundedPosition(item.id, right - item.width, item.y);
      case "top":
        return roundedPosition(item.id, item.x, top);
      case "middle":
        return roundedPosition(item.id, item.x, middle - item.height / 2);
      case "bottom":
        return roundedPosition(item.id, item.x, bottom - item.height);
    }
  });
}

export function distributeSelection(
  items: readonly ArrangementRect[],
  direction: SelectionDistribution,
): ArrangementPosition[] {
  requireValidItems(items, 3);
  const horizontal = direction === "horizontal";
  const ordered = [...items].sort((left, right) => {
    const leftCenter = horizontal ? left.x + left.width / 2 : left.y + left.height / 2;
    const rightCenter = horizontal ? right.x + right.width / 2 : right.y + right.height / 2;
    return leftCenter - rightCenter || left.id.localeCompare(right.id);
  });
  const first = ordered[0];
  const last = ordered.at(-1)!;
  const firstCenter = horizontal ? first.x + first.width / 2 : first.y + first.height / 2;
  const lastCenter = horizontal ? last.x + last.width / 2 : last.y + last.height / 2;
  const interval = (lastCenter - firstCenter) / (ordered.length - 1);

  return ordered.map((item, index) => {
    const targetCenter = firstCenter + interval * index;
    return horizontal
      ? roundedPosition(item.id, targetCenter - item.width / 2, item.y)
      : roundedPosition(item.id, item.x, targetCenter - item.height / 2);
  });
}
