import { describe, expect, test } from "vitest";
import {
  compactOrthogonalPoints,
  drawOrthogonalRoute,
  orthogonalRoutePoints,
  planRouteLaneOffsets,
  restoreManualRoute,
  routeFastOrthogonalInterface,
  routeOrthogonalInterface,
  routeLaneOffset,
  separateOrthogonalRoute,
} from "../../src/routing";

describe("orthogonal route primitives", () => {
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

  test("preserves an orthogonal reversal that keeps an endpoint approach outside its module", () => {
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

  test("parses and draws the same compact orthogonal path", () => {
    const points = orthogonalRoutePoints("M 0, 0 L 40, 0 L 80, 0 L 80, 40");

    expect(drawOrthogonalRoute(points)).toBe("M 0, 0 L 80, 0 L 80, 40");
  });

  test("keeps endpoint segments stable when only the internal lane separates", () => {
    const original = "M 0, 0 L 40, 0 L 40, 80 L 100, 80";

    const separated = orthogonalRoutePoints(separateOrthogonalRoute(original, 8).path);

    expect(separated).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: 48, y: 80 },
      { x: 100, y: 80 },
    ]);
  });

  test("adds a short source split only when the physical handle is shared", () => {
    const original = "M 0, 0 L 40, 0 L 40, 80 L 100, 80";

    const separated = orthogonalRoutePoints(
      separateOrthogonalRoute(original, 8, { separateSource: true }).path,
    );

    expect(separated.slice(0, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 8 },
    ]);
    expect(separated.at(-1)).toEqual({ x: 100, y: 80 });
  });

  test("keeps a separated route strictly orthogonal at both endpoints", () => {
    const original = "M 314, 329 L 348, 329 L 348, 72 L -4, 72";
    const separated = orthogonalRoutePoints(separateOrthogonalRoute(original, 12).path);

    expect(separated.slice(1).every((point, index) =>
      point.x === separated[index].x || point.y === separated[index].y
    )).toBe(true);
    expect(separated.at(-2)?.y).toBe(72);
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

  test("assigns a deterministic bounded lane per connection", () => {
    const first = routeLaneOffset("ui-session-command");

    expect(routeLaneOffset("ui-session-command")).toBe(first);
    expect([-12, -8, -4, 0, 4, 8, 12]).toContain(first);
  });

  test("assigns distinct lanes to connections sharing an endpoint or module channel", () => {
    const lanes = planRouteLaneOffsets([
      { connectionId: "first", sourceEndpointKey: "a:out", targetEndpointKey: "b:in", channelKey: "a:b" },
      { connectionId: "second", sourceEndpointKey: "b:in", targetEndpointKey: "c:in", channelKey: "b:c" },
      { connectionId: "third", sourceEndpointKey: "a:other", targetEndpointKey: "b:other", channelKey: "a:b" },
    ]);

    expect(lanes.get("first")).not.toBe(lanes.get("second"));
    expect(lanes.get("first")).not.toBe(lanes.get("third"));
  });

  test("routes a large-graph edge around an intervening module", () => {
    const route = routeFastOrthogonalInterface({
      nodes: [{
        id: "obstacle",
        data: {},
        position: { x: 120, y: 60 },
        measured: { width: 100, height: 100 },
      }],
      sourceX: 0,
      sourceY: 110,
      targetX: 340,
      targetY: 110,
      sourcePosition: "right",
      targetPosition: "left",
    });
    const points = orthogonalRoutePoints(route.path);

    expect(points[0]).toEqual({ x: 0, y: 110 });
    expect(points.at(-1)).toEqual({ x: 340, y: 110 });
    expect(points.slice(1).some((point) => point.y < 42 || point.y > 178)).toBe(true);
  });

  test("keeps normal routes outside opposed source and target port sides", () => {
    const route = routeOrthogonalInterface({
      nodes: [],
      sourceX: 240,
      sourceY: 250,
      targetX: 20,
      targetY: 70,
      sourcePosition: "right",
      targetPosition: "left",
    });

    expect(route).not.toBeInstanceOf(Error);
    const points = orthogonalRoutePoints((route as { svgPathString: string }).svgPathString);
    expect(points[1].x).toBeGreaterThan(240);
    expect(points[1].y).toBe(250);
    expect(points.at(-2)!.x).toBeLessThan(20);
    expect(points.at(-2)!.y).toBe(70);
    expect(points.slice(1).every((point, index) =>
      point.x === points[index].x || point.y === points[index].y
    )).toBe(true);
  });
});
