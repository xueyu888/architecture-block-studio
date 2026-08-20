import { describe, expect, test } from "vitest";
import { constrainCoordinateDelta, constrainResizeRectToOrigin } from "../../src/layout";

describe("stable Level coordinate geometry", () => {
  test("clamps one common move delta without changing relative geometry", () => {
    expect(constrainCoordinateDelta(
      { x: -80, y: 40 },
      { minimum: { x: -32, y: -64 }, maximum: { x: 0, y: 96 } },
    )).toEqual({
      delta: { x: -32, y: 40 },
      clampedX: true,
      clampedY: false,
    });
  });

  test("preserves right and bottom edges while constraining resize start edges", () => {
    expect(constrainResizeRectToOrigin(
      { x: -40, y: -24, width: 240, height: 160 },
      { minimum: { x: 0, y: 0 } },
    )).toEqual({ x: 0, y: 0, width: 200, height: 136 });
    expect(constrainResizeRectToOrigin(
      { x: 32, y: 48, width: 168, height: 88 },
      { minimum: { x: -64, y: -32 }, maximum: { x: 0, y: 16 } },
    )).toEqual({ x: 0, y: 16, width: 200, height: 120 });
  });

  test("rejects malformed or contradictory constraints", () => {
    expect(() => constrainCoordinateDelta(
      { x: 0, y: 0 },
      { minimum: { x: 1, y: 0 }, maximum: { x: 0, y: 1 } },
    )).toThrow("contradictory");
    expect(() => constrainResizeRectToOrigin(
      { x: 0, y: 0, width: 100, height: 100 },
      { minimum: { x: 10, y: 0 }, maximum: { x: 0, y: 20 } },
    )).toThrow("contradictory");
  });
});
