import { describe, expect, test } from "vitest";
import {
  canvasClientBounds,
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
