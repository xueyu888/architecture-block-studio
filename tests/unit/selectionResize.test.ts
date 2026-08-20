import { describe, expect, test } from "vitest";
import {
  requestedSelectionResizeRect,
  resizeSelectionGroup,
  selectionResizeBounds,
  selectionResizeLimits,
  type SelectionResizeItem,
} from "../../src/layout";

const items: SelectionResizeItem[] = [
  {
    id: "compact",
    x: 100,
    y: 80,
    width: 200,
    height: 120,
    minWidth: 180,
    minHeight: 100,
    maxWidth: 800,
    maxHeight: 600,
  },
  {
    id: "expanded",
    x: 380,
    y: 260,
    width: 300,
    height: 180,
    minWidth: 210,
    minHeight: 120,
    maxWidth: 900,
    maxHeight: 720,
  },
];

describe("selection group resize", () => {
  test("derives one group and applies the same affine transform to every module", () => {
    expect(selectionResizeBounds(items)).toEqual({ x: 100, y: 80, width: 580, height: 360 });
    const result = resizeSelectionGroup(
      items,
      { x: 100, y: 80, width: 870, height: 540 },
      { x: 1, y: 1 },
    );

    expect(result.group).toEqual({ x: 100, y: 80, width: 870, height: 540 });
    expect(result.items).toEqual([
      { id: "compact", position: { x: 100, y: 80 }, size: { width: 300, height: 180 } },
      { id: "expanded", position: { x: 520, y: 350 }, size: { width: 450, height: 270 } },
    ]);
    expect([...resizeSelectionGroup(
      [...items].reverse(),
      { x: 100, y: 80, width: 870, height: 540 },
      { x: 1, y: 1 },
    ).items].sort((left, right) => left.id.localeCompare(right.id))).toEqual(
      [...result.items].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  test("anchors the opposite sides and clamps the whole group before any module becomes unreadable", () => {
    expect(selectionResizeLimits(items)).toEqual({
      minWidth: 522,
      minHeight: 300,
      maxWidth: 1740,
      maxHeight: 1440,
    });
    const request = requestedSelectionResizeRect(
      selectionResizeBounds(items),
      { x: 500, y: 400 },
      { x: -1, y: -1 },
    );
    const result = resizeSelectionGroup(items, request, { x: -1, y: -1 });

    expect(result.group).toEqual({ x: 158, y: 140, width: 522, height: 300 });
    expect(result.items[0]).toEqual({
      id: "compact",
      position: { x: 158, y: 140 },
      size: { width: 180, height: 100 },
    });
    expect(result.items.every((item) => item.size.width > 0 && item.size.height > 0)).toBe(true);
  });

  test("keeps legacy out-of-range geometry selectable while only allowing movement toward valid limits", () => {
    const legacyItems: SelectionResizeItem[] = [
      { ...items[0], width: 160, minWidth: 180 },
      { ...items[1], width: 1700, maxWidth: 1600 },
    ];
    const bounds = selectionResizeBounds(legacyItems);
    expect(selectionResizeLimits(legacyItems, bounds)).toMatchObject({
      minWidth: bounds.width,
      maxWidth: bounds.width,
    });
    expect(resizeSelectionGroup(
      legacyItems,
      { ...bounds, width: bounds.width + 200 },
      { x: 1, y: 0 },
    ).group.width).toBe(bounds.width);
  });

  test("keeps the opposite boundary fixed for all four edges and four corners", () => {
    const original = selectionResizeBounds(items);
    const directions = [
      { x: -1 as const, y: -1 as const },
      { x: 0 as const, y: -1 as const },
      { x: 1 as const, y: -1 as const },
      { x: -1 as const, y: 0 as const },
      { x: 1 as const, y: 0 as const },
      { x: -1 as const, y: 1 as const },
      { x: 0 as const, y: 1 as const },
      { x: 1 as const, y: 1 as const },
    ];

    directions.forEach((direction) => {
      const delta = { x: direction.x * 64, y: direction.y * 48 };
      const result = resizeSelectionGroup(
        items,
        requestedSelectionResizeRect(original, delta, direction),
        direction,
      );
      if (direction.x < 0) expect(result.group.x + result.group.width).toBe(original.x + original.width);
      if (direction.x === 0) expect(result.group).toMatchObject({ x: original.x, width: original.width });
      if (direction.x > 0) expect(result.group.x).toBe(original.x);
      if (direction.y < 0) expect(result.group.y + result.group.height).toBe(original.y + original.height);
      if (direction.y === 0) expect(result.group).toMatchObject({ y: original.y, height: original.height });
      if (direction.y > 0) expect(result.group.y).toBe(original.y);
      expect(result.items).toHaveLength(items.length);
    });
  });

  test("uses one aspect scale for corner resizing and rejects malformed groups", () => {
    const result = resizeSelectionGroup(
      items,
      { x: 100, y: 80, width: 870, height: 400 },
      { x: 1, y: 1 },
      true,
    );
    expect(result.group).toEqual({ x: 100, y: 80, width: 870, height: 540 });
    expect(result.items[1].size).toEqual({ width: 450, height: 270 });
    expect(() => resizeSelectionGroup([items[0]], result.group, { x: 1, y: 1 }))
      .toThrow("At least two modules");
    expect(() => resizeSelectionGroup([items[0], { ...items[1], id: "compact" }], result.group, { x: 1, y: 1 }))
      .toThrow("unique identity");
  });
});
