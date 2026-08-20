import { describe, expect, test } from "vitest";
import {
  CANVAS_CLICK_TOLERANCE_PX,
  canvasBoundsSelectBounds,
  canvasBoundsSelectRoute,
  canvasClientBounds,
  canvasGeometryBounds,
  canvasPointHitStack,
  canvasSelectionTraversal,
  nextCanvasPointHitTarget,
  nextCanvasTraversalTarget,
  reconcileCanvasSelection,
  selectionForCanvasContext,
} from "../../src/components/canvasSelection";

describe("canvas selection projection", () => {
  test("uses one screen-pixel click tolerance for direct canvas gestures", () => {
    expect(CANVAS_CLICK_TOLERANCE_PX).toBe(5);
    expect(Math.hypot(3, 4)).toBe(CANVAS_CLICK_TOLERANCE_PX);
    expect(Math.hypot(4, 4)).toBeGreaterThan(CANVAS_CLICK_TOLERANCE_PX);
  });

  test("preserves a multi-selection only when the context target belongs to it", () => {
    const selection = {
      kind: "multiple" as const,
      items: [
        { kind: "node" as const, levelId: "root", nodeId: "a" },
        { kind: "connection" as const, levelId: "root", connectionId: "a-b" },
      ],
    };
    const selectedTarget = { kind: "node" as const, levelId: "root", nodeId: "a" };
    const outsideTarget = { kind: "node" as const, levelId: "root", nodeId: "b" };

    expect(selectionForCanvasContext(selection, selectedTarget)).toBe(selection);
    expect(selectionForCanvasContext(selection, outsideTarget)).toEqual(outsideTarget);
    expect(selectionForCanvasContext(
      { kind: "port", levelId: "root", nodeId: "a", portId: "out" },
      selectedTarget,
    )).toEqual(selectedTarget);
  });

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

  test("orders point hits by explicit visual layers and real route distance", () => {
    const targets = [
      {
        id: "edge-behind",
        selectionKey: "connection:system:behind",
        layer: 0,
        order: 2,
        route: [{ x: 0, y: 40 }, { x: 200, y: 40 }],
        routeTolerance: 14,
      },
      {
        id: "empty-l-route",
        selectionKey: "connection:system:empty",
        layer: 0,
        order: 3,
        route: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }],
        routeTolerance: 14,
      },
      {
        id: "node-top",
        selectionKey: "node:system:top",
        layer: 1_002,
        order: 1,
        bounds: { left: 80, right: 180, top: 20, bottom: 120 },
      },
      {
        id: "edge-duplicate-leg",
        selectionKey: "connection:system:behind",
        layer: 0,
        order: 1,
        route: [{ x: 100, y: 0 }, { x: 100, y: 200 }],
        routeTolerance: 14,
      },
    ];

    expect(canvasPointHitStack({ x: 100, y: 40 }, targets).map((target) => target.id)).toEqual([
      "node-top",
      "edge-behind",
    ]);
    expect(canvasPointHitStack({ x: 100, y: 100 }, targets).map((target) => target.id)).toEqual([
      "node-top",
      "edge-duplicate-leg",
    ]);
  });

  test("cycles below the current selection, skips top-hit ancestors, and wraps", () => {
    const stack = [
      { id: "leaf", selectionKey: "node:l5:leaf", parentId: "container", layer: 1_007, order: 3 },
      { id: "container", selectionKey: "node:l4:container", layer: 1_004, order: 2 },
      { id: "sibling", selectionKey: "node:l5:sibling", layer: 1_003, order: 1 },
      { id: "edge", selectionKey: "connection:l5:edge", layer: 0, order: 0 },
    ];

    expect(nextCanvasPointHitTarget(stack, new Set())?.id).toBe("leaf");
    expect(nextCanvasPointHitTarget(stack, new Set(["node:l5:leaf"]))?.id).toBe("sibling");
    expect(nextCanvasPointHitTarget(stack, new Set(["node:l5:sibling"]))?.id).toBe("edge");
    expect(nextCanvasPointHitTarget(stack, new Set(["connection:l5:edge"]))?.id).toBe("leaf");
  });

  test("derives one depth-first keyboard order and canonicalizes repeated connection legs", () => {
    const traversal = canvasSelectionTraversal([
      { id: "parent", selectionKey: "node:root:parent", levelId: "root", kind: "node" },
      { id: "child-a", selectionKey: "node:child:a", levelId: "child", kind: "node", parentId: "parent" },
      { id: "child-b", selectionKey: "node:child:b", levelId: "child", kind: "node", parentId: "parent" },
      { id: "sibling", selectionKey: "node:root:sibling", levelId: "root", kind: "node" },
    ], [
      { id: "child-edge", selectionKey: "connection:child:flow", levelId: "child", kind: "connection" },
      { id: "child-edge-leg", selectionKey: "connection:child:flow", levelId: "child", kind: "connection" },
      { id: "root-edge", selectionKey: "connection:root:flow", levelId: "root", kind: "connection" },
    ]);

    expect(traversal.items.map((item) => item.selectionKey)).toEqual([
      "node:root:parent",
      "node:child:a",
      "node:child:b",
      "connection:child:flow",
      "node:root:sibling",
      "connection:root:flow",
    ]);
    expect(traversal.parentSelectionKeyByLevelId.get("child")).toBe("node:root:parent");
    expect(traversal.parentSelectionKeyByLevelId.has("root")).toBe(false);

    const ambiguousParent = canvasSelectionTraversal([
      { id: "parent-a", selectionKey: "node:root:parent-a", levelId: "root", kind: "node" },
      { id: "parent-b", selectionKey: "node:root:parent-b", levelId: "root", kind: "node" },
      { id: "child-a", selectionKey: "node:child:item", levelId: "child", kind: "node", parentId: "parent-a" },
      { id: "child-b", selectionKey: "node:child:item", levelId: "child", kind: "node", parentId: "parent-b" },
    ], []);
    expect(ambiguousParent.parentSelectionKeyByLevelId.has("child")).toBe(false);
  });

  test("moves forward and backward, wraps, and collapses non-primary selections predictably", () => {
    const items = [
      { id: "a", selectionKey: "node:root:a", levelId: "root", kind: "node" as const },
      { id: "b", selectionKey: "node:nested:b", levelId: "nested", kind: "node" as const },
      { id: "edge", selectionKey: "connection:root:edge", levelId: "root", kind: "connection" as const },
    ];

    expect(nextCanvasTraversalTarget(items, new Set(["node:root:a"]), "forward")?.id).toBe("b");
    expect(nextCanvasTraversalTarget(items, new Set(["node:root:a"]), "backward")?.id).toBe("edge");
    expect(nextCanvasTraversalTarget(items, new Set(["connection:root:edge"]), "forward")?.id).toBe("a");
    expect(nextCanvasTraversalTarget(items, new Set(), "forward", "nested")?.id).toBe("b");
    expect(nextCanvasTraversalTarget(items, new Set(["node:root:a", "node:nested:b"]), "backward")?.id).toBe("edge");
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
