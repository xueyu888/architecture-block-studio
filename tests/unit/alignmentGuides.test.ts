import { describe, expect, test } from "vitest";
import {
  alignmentRectBounds,
  snapMovingRect,
  snapResizingRect,
  type AlignmentRect,
} from "../../src/layout";

const limits = { minWidth: 40, minHeight: 40, maxWidth: 500, maxHeight: 500 };

function rect(id: string, x: number, y: number, width = 100, height = 80): AlignmentRect {
  return { id, x, y, width, height };
}

describe("alignment guides", () => {
  test("derives one stable subject rectangle from every member in a moving group", () => {
    expect(alignmentRectBounds("selection:a|b", [
      rect("a", 64, 64, 192, 144),
      rect("b", 320, 288, 256, 192),
    ])).toEqual({
      id: "selection:a|b",
      x: 64,
      y: 64,
      width: 512,
      height: 416,
    });
    expect(alignmentRectBounds("empty", [])).toBeUndefined();
  });

  test("snaps the moving group bounds instead of whichever member was grabbed", () => {
    const target = rect("target", 1124, 600, 208, 208);
    const groupPreview = rect("selection:a|b", 608, 64, 512, 416);
    const result = snapMovingRect(groupPreview, [target], 6);

    expect(result.rect.x).toBe(612);
    expect(result.rect.x + result.rect.width).toBe(target.x);
    expect(result.guides).toEqual([
      expect.objectContaining({
        kind: "line",
        axis: "x",
        coordinate: 1124,
        subjectAnchor: "end",
        targetAnchor: "start",
        targetId: "target",
      }),
    ]);
  });

  test("snaps a moving edge and center with one deterministic guide per axis", () => {
    const result = snapMovingRect(
      rect("subject", 96, 43),
      [rect("right", 200, 40), rect("center", 400, 40)],
      5,
    );

    expect(result.rect).toMatchObject({ x: 100, y: 40 });
    expect(result.guides).toEqual([
      expect.objectContaining({
        kind: "line",
        axis: "x",
        coordinate: 200,
        subjectAnchor: "end",
        targetAnchor: "start",
        targetId: "right",
      }),
      expect.objectContaining({
        kind: "line",
        axis: "y",
        coordinate: 80,
        subjectAnchor: "center",
        targetAnchor: "center",
        targetId: "center",
      }),
    ]);
  });

  test("uses alignment before the parent-relative grid on each movement axis", () => {
    const result = snapMovingRect(
      rect("subject", 191, 107),
      [rect("target", 294, 300)],
      5,
      { x: 16, y: 16, originX: 6, originY: 10 },
    );

    expect(result.rect).toMatchObject({ x: 194, y: 106 });
    expect(result.guides).toEqual([
      expect.objectContaining({ kind: "line", axis: "x", coordinate: 294 }),
    ]);
  });

  test("leaves moving geometry unchanged outside the screen-derived tolerance", () => {
    const subject = rect("subject", 90, 40);
    expect(snapMovingRect(subject, [rect("target", 200, 200)], 5)).toEqual({
      rect: subject,
      guides: [],
    });
  });

  test("snaps the active resize edge without moving the opposite edge", () => {
    const result = snapResizingRect(
      rect("subject", 0, 0),
      rect("subject", 0, 0, 196, 80),
      [rect("target", 200, 160)],
      5,
      limits,
    );

    expect(result.rect).toMatchObject({ x: 0, width: 200 });
    expect(result.guides).toEqual([
      expect.objectContaining({
        kind: "line",
        axis: "x",
        coordinate: 200,
        subjectAnchor: "end",
        targetAnchor: "start",
      }),
    ]);
  });

  test("matches a sibling width when no positional guide is nearby", () => {
    const result = snapResizingRect(
      rect("subject", 0, 0),
      rect("subject", 0, 0, 148, 80),
      [rect("target", 400, 240, 150, 120)],
      4,
      limits,
    );

    expect(result.rect.width).toBe(150);
    expect(result.guides).toEqual([
      expect.objectContaining({ kind: "size", axis: "width", targetId: "target" }),
    ]);
  });

  test("snaps unmatched active resize edges to the parent-relative grid", () => {
    const result = snapResizingRect(
      rect("subject", 6, 10, 100, 80),
      rect("subject", 6, 10, 109, 87),
      [],
      4,
      limits,
      { x: 16, y: 16, originX: 6, originY: 10 },
    );

    expect(result.rect).toEqual(rect("subject", 6, 10, 112, 80));
    expect(result.guides).toEqual([]);
  });

  test("keeps resize results inside the content and workspace limits", () => {
    const result = snapResizingRect(
      rect("subject", 0, 0, 100, 80),
      rect("subject", 57, 0, 43, 80),
      [rect("target", 59, 200, 100, 80)],
      2,
      { ...limits, minWidth: 42 },
    );

    expect(result.rect).toMatchObject({ x: 57, width: 43 });
    expect(result.guides).toEqual([]);
  });
});
