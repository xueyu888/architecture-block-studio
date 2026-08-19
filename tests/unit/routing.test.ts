import { describe, expect, test } from "vitest";
import {
  adaptRouteEndpoints,
  compactOrthogonalPoints,
  drawOrthogonalRoute,
  planRouteJumps,
  routeConnectionPreview,
  restoreManualRoute,
  type PlannedRoute,
} from "../../src/routing";

describe("orthogonal route primitives", () => {
  test("ignores browser measurement noise instead of creating endpoint micro-bends", () => {
    expect(adaptRouteEndpoints(
      [
        { x: 314, y: 328.625 },
        { x: 326, y: 328.625 },
        { x: 326, y: 300.375 },
        { x: 446, y: 300.375 },
      ],
      { x: 313.9998, y: 328.6562 },
      { x: 445.9999, y: 300.3281 },
      "right",
      "left",
    )).toEqual([
      { x: 314, y: 328.625 },
      { x: 326, y: 328.625 },
      { x: 326, y: 300.375 },
      { x: 446, y: 300.375 },
    ]);
  });

  test("moves adjacent endpoint legs during a real node gesture", () => {
    expect(adaptRouteEndpoints(
      [
        { x: 314, y: 328 },
        { x: 326, y: 328 },
        { x: 326, y: 300 },
        { x: 446, y: 300 },
      ],
      { x: 330, y: 344 },
      { x: 446, y: 300 },
      "right",
      "left",
    )).toEqual([
      { x: 330, y: 344 },
      { x: 326, y: 344 },
      { x: 326, y: 300 },
      { x: 446, y: 300 },
    ]);
  });

  test("removes duplicate and collinear points", () => {
    expect(compactOrthogonalPoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
    ]);
  });

  test("preserves an orthogonal reversal for explicit locked routes", () => {
    expect(compactOrthogonalPoints([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 20, y: 0 },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  test("draws a compact orthogonal path", () => {
    expect(drawOrthogonalRoute([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
    ])).toBe("M 0, 0 L 80, 0 L 80, 40");
  });

  test("keeps both attached preview endpoints normal with a deterministic orthogonal middle", () => {
    const preview = routeConnectionPreview({
      from: { x: 100, y: 120 },
      to: { x: 300, y: 220 },
      fromPosition: "right",
      toPosition: "left",
      targetAttached: true,
    });

    expect(preview).toEqual([
      { x: 100, y: 120 },
      { x: 200, y: 120 },
      { x: 200, y: 220 },
      { x: 300, y: 220 },
    ]);
    expect(preview.slice(1).every((point, index) =>
      point.x === preview[index].x || point.y === preview[index].y
    )).toBe(true);
  });

  test("keeps an attached mixed-side preview outside both terminal cards", () => {
    const sourceBounds = { left: 0, right: 100, top: 80, bottom: 160 };
    const targetBounds = { left: 180, right: 340, top: 100, bottom: 240 };
    const preview = routeConnectionPreview({
      from: { x: 100, y: 120 },
      to: { x: 260, y: 240 },
      fromPosition: "right",
      toPosition: "bottom",
      targetAttached: true,
      fromBounds: sourceBounds,
      toBounds: targetBounds,
    });

    const crossesInterior = (bounds: typeof sourceBounds) => preview.slice(1).some((point, index) => {
      const previous = preview[index];
      return previous.y === point.y
        ? previous.y > bounds.top && previous.y < bounds.bottom &&
            Math.max(previous.x, point.x) > bounds.left && Math.min(previous.x, point.x) < bounds.right
        : previous.x > bounds.left && previous.x < bounds.right &&
            Math.max(previous.y, point.y) > bounds.top && Math.min(previous.y, point.y) < bounds.bottom;
    });
    expect(crossesInterior(sourceBounds)).toBe(false);
    expect(crossesInterior(targetBounds)).toBe(false);
    expect(preview).toEqual([
      { x: 100, y: 120 },
      { x: 114, y: 120 },
      { x: 114, y: 254 },
      { x: 260, y: 254 },
      { x: 260, y: 240 },
    ]);
  });

  test("keeps only the fixed port normal while the preview target is free", () => {
    const preview = routeConnectionPreview({
      from: { x: 80, y: 160 },
      to: { x: 210, y: 260 },
      fromPosition: "top",
      toPosition: "bottom",
      targetAttached: false,
    });

    expect(preview).toEqual([
      { x: 80, y: 160 },
      { x: 80, y: 146 },
      { x: 80, y: 260 },
      { x: 210, y: 260 },
    ]);
  });

  test("renders a deterministic bridge for an unavoidable route crossing", () => {
    const route = (
      legId: string,
      points: PlannedRoute["points"],
    ): PlannedRoute => ({
      legId,
      commodityId: legId,
      points,
      sourceStub: points[0],
      targetStub: points.at(-1)!,
      locked: false,
      baselineLength: 80,
      length: 80,
      bends: 0,
    });
    const horizontal = route("horizontal", [{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    const vertical = route("vertical", [{ x: 50, y: 0 }, { x: 50, y: 80 }]);
    const jumps = planRouteJumps(new Map([
      [horizontal.legId, horizontal],
      [vertical.legId, vertical],
    ]));

    expect(jumps.get("horizontal")).toEqual([{
      segmentIndex: 0,
      point: { x: 50, y: 40 },
      radius: 5,
    }]);
    expect(jumps.get("vertical")).toEqual([]);
    expect(drawOrthogonalRoute(horizontal.points, jumps.get("horizontal"))).toBe(
      "M 0, 40 L 45, 40 Q 50, 30 55, 40 L 100, 40",
    );
  });

  test("restores local waypoints and aligns them to horizontal endpoint ports", () => {
    const restored = restoreManualRoute({
      source: { x: 120, y: 140 },
      target: { x: 420, y: 260 },
      waypoints: [{ x: 40, y: 40 }, { x: 180, y: 40 }, { x: 180, y: 160 }],
      origin: { x: 100, y: 100 },
      sourcePosition: "right",
      targetPosition: "left",
    });

    expect(restored).toEqual([
      { x: 120, y: 140 },
      { x: 280, y: 140 },
      { x: 280, y: 260 },
      { x: 420, y: 260 },
    ]);
  });

  test("inserts an elbow when endpoint alignment would otherwise create a diagonal", () => {
    const restored = restoreManualRoute({
      source: { x: 314, y: 329 },
      target: { x: -4, y: 72 },
      waypoints: [
        { x: 325, y: 329 },
        { x: 325, y: 341 },
        { x: 348, y: 341 },
        { x: 348, y: 84 },
        { x: -16, y: 84 },
      ],
      origin: { x: 0, y: 0 },
      sourcePosition: "right",
      targetPosition: "left",
    });

    expect(restored.slice(1).every((point, index) =>
      point.x === restored[index].x || point.y === restored[index].y
    )).toBe(true);
    expect(restored.at(-2)).toEqual({ x: -16, y: 72 });
  });
});
