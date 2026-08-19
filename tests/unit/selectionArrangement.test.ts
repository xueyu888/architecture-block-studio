import { describe, expect, test } from "vitest";
import {
  alignSelection,
  distributeSelection,
  type ArrangementRect,
} from "../../src/layout";

function rect(id: string, x: number, y: number, width = 100, height = 80): ArrangementRect {
  return { id, x, y, width, height };
}

describe("selection arrangement", () => {
  test("aligns edges against the selection bounds without changing the other axis", () => {
    const items = [rect("a", 40, 20, 100, 80), rect("b", 260, 110, 140, 120)];

    expect(alignSelection(items, "left")).toEqual([
      { id: "a", position: { x: 40, y: 20 } },
      { id: "b", position: { x: 40, y: 110 } },
    ]);
    expect(alignSelection(items, "right")).toEqual([
      { id: "a", position: { x: 300, y: 20 } },
      { id: "b", position: { x: 260, y: 110 } },
    ]);
    expect(alignSelection(items, "top")).toEqual([
      { id: "a", position: { x: 40, y: 20 } },
      { id: "b", position: { x: 260, y: 20 } },
    ]);
    expect(alignSelection(items, "bottom")).toEqual([
      { id: "a", position: { x: 40, y: 150 } },
      { id: "b", position: { x: 260, y: 110 } },
    ]);
  });

  test("aligns centers against the canonical selection envelope", () => {
    const items = [rect("wide", 20, 30, 160, 60), rect("tall", 300, 170, 80, 140)];

    expect(alignSelection(items, "center")).toEqual([
      { id: "wide", position: { x: 120, y: 30 } },
      { id: "tall", position: { x: 160, y: 170 } },
    ]);
    expect(alignSelection(items, "middle")).toEqual([
      { id: "wide", position: { x: 20, y: 140 } },
      { id: "tall", position: { x: 300, y: 100 } },
    ]);
  });

  test("distributes centers stably while keeping the outer modules fixed", () => {
    const items = [
      rect("last", 500, 70, 160, 80),
      rect("first", 20, 10, 100, 80),
      rect("middle", 100, 40, 120, 80),
    ];

    expect(distributeSelection(items, "horizontal")).toEqual([
      { id: "first", position: { x: 20, y: 10 } },
      { id: "middle", position: { x: 265, y: 40 } },
      { id: "last", position: { x: 500, y: 70 } },
    ]);
  });

  test("distributes vertically and rejects incomplete or invalid geometry", () => {
    const items = [rect("bottom", 10, 400), rect("top", 30, 0), rect("middle", 20, 50)];

    expect(distributeSelection(items, "vertical")).toEqual([
      { id: "top", position: { x: 30, y: 0 } },
      { id: "middle", position: { x: 20, y: 200 } },
      { id: "bottom", position: { x: 10, y: 400 } },
    ]);
    expect(() => distributeSelection(items.slice(0, 2), "horizontal")).toThrow("At least 3 modules");
    expect(() => alignSelection([rect("same", 0, 0), rect("same", 10, 10)], "left"))
      .toThrow("unique identity");
    expect(() => alignSelection([rect("valid", 0, 0), rect("invalid", 10, 10, -1)], "top"))
      .toThrow("positive dimensions");
  });
});
