import { describe, expect, test } from "vitest";
import {
  canvasBoundsSelectBounds,
  canvasBoundsSelectRoute,
  canvasClientBounds,
  canvasGeometryBounds,
  reconcileCanvasSelection,
} from "../../src/components/canvasSelection";

describe("canvas selection projection", () => {
  test("normalizes gesture endpoints without depending on intermediate rendered frames", () => {
    expect(canvasClientBounds({ x: 320, y: 180 }, { x: 40, y: 90 })).toEqual({
      left: 40,
      right: 320,
      top: 90,
      bottom: 180,
    });
  });

  test("distinguishes fully enclosed and intersecting module bounds", () => {
    const selection = { left: 100, right: 300, top: 80, bottom: 240 };
    expect(canvasBoundsSelectBounds(
      selection,
      { left: 120, right: 280, top: 100, bottom: 220 },
      "full",
    )).toBe(true);
    expect(canvasBoundsSelectBounds(
      selection,
      { left: 280, right: 420, top: 120, bottom: 200 },
      "full",
    )).toBe(false);
    expect(canvasBoundsSelectBounds(
      selection,
      { left: 280, right: 420, top: 120, bottom: 200 },
      "intersecting",
    )).toBe(true);
    expect(canvasBoundsSelectBounds(
      selection,
      { left: 320, right: 420, top: 120, bottom: 200 },
      "intersecting",
    )).toBe(false);
  });

  test("selects only routes whose actual segments enter the selection bounds", () => {
    const selection = { left: 100, right: 160, top: 90, bottom: 150 };
    const crossingRoute = [{ x: 40, y: 120 }, { x: 220, y: 120 }, { x: 220, y: 260 }];
    const routeAroundEmptyBoundingSpace = [{ x: 40, y: 40 }, { x: 220, y: 40 }, { x: 220, y: 260 }];

    expect(canvasBoundsSelectRoute(selection, crossingRoute, "full")).toBe(false);
    expect(canvasBoundsSelectRoute(selection, crossingRoute, "intersecting")).toBe(true);
    expect(canvasBoundsSelectRoute(selection, routeAroundEmptyBoundingSpace, "intersecting")).toBe(false);
    expect(canvasBoundsSelectRoute(
      { left: 20, right: 240, top: 20, bottom: 280 },
      crossingRoute,
      "full",
    )).toBe(true);
  });

  test("unifies selected module rectangles and complete route points into one fit bound", () => {
    expect(canvasGeometryBounds(
      [{ x: 100, y: 80, width: 240, height: 160 }],
      [[{ x: 340, y: 120 }, { x: 520, y: 120 }, { x: 520, y: 400 }]],
    )).toEqual({ x: 100, y: 80, width: 420, height: 320 });
    expect(canvasGeometryBounds([], [[{ x: 8, y: 12 }, { x: 8, y: 12 }]])).toEqual({
      x: 8,
      y: 12,
      width: 1,
      height: 1,
    });
    expect(canvasGeometryBounds([], [])).toBeUndefined();
  });

  test("changes only newly selected items", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const next = reconcileCanvasSelection(items, new Set(["two"]));

    expect(next).not.toBe(items);
    expect(next[0]).toBe(items[0]);
    expect(next[1]).not.toBe(items[1]);
    expect(next[1].selected).toBe(true);
    expect(next[2]).toBe(items[2]);
  });

  test("changes only previous and next items when selection moves", () => {
    const items = [{ id: "one" }, { id: "two", selected: true }, { id: "three" }];
    const next = reconcileCanvasSelection(items, new Set(["three"]));

    expect(next[0]).toBe(items[0]);
    expect(next[1]).toEqual({ id: "two", selected: false });
    expect(next[2]).toEqual({ id: "three", selected: true });
  });

  test("returns the same array when projection is already current", () => {
    const items = [{ id: "one" }, { id: "two", selected: true }];
    expect(reconcileCanvasSelection(items, new Set(["two"]))).toBe(items);
  });
});
