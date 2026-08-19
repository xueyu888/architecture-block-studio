import { describe, expect, test } from "vitest";
import {
  adaptRouteEndpoints,
  compactOrthogonalPoints,
  DEFAULT_ROUTING_POLICY,
  drawOrthogonalRoute,
  planRouteJumps,
  restoreManualRoute,
  solveConnectionPreview,
  type PlannedRoute,
  type RoutingPreviewEnvironment,
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

  test("routes an attached pointer preview around every scene obstacle", () => {
    const environment: RoutingPreviewEnvironment = {
      obstacles: [
        { id: "source", kind: "module", bounds: { left: 0, right: 100, top: 0, bottom: 100 } },
        { id: "blocker", kind: "module", bounds: { left: 150, right: 250, top: 0, bottom: 100 } },
        { id: "target", kind: "module", bounds: { left: 300, right: 400, top: 0, bottom: 100 } },
      ],
      nodes: new Map([
        ["source", {
          id: "source",
          ancestorObstacleIds: [],
          endpoints: new Map([["out", { point: { x: 100, y: 50 }, outward: "right", physicalKey: "source::out" }]]),
        }],
        ["target", {
          id: "target",
          ancestorObstacleIds: [],
          endpoints: new Map([["in", { point: { x: 300, y: 50 }, outward: "left", physicalKey: "target::in" }]]),
        }],
      ]),
    };
    const request = {
      source: { nodeId: "source", handleId: "out" },
      target: { kind: "attached" as const, nodeId: "target", handleId: "in" },
    };

    const first = solveConnectionPreview(environment, request, DEFAULT_ROUTING_POLICY);
    const second = solveConnectionPreview(environment, request, DEFAULT_ROUTING_POLICY);

    expect(first.status).toBe("routed");
    expect(first.points).toEqual(second.points);
    expect(first.points.at(1)?.y).toBe(50);
    expect(first.points.at(-2)?.y).toBe(50);
    expect(first.points.some((point) => point.y < -18 || point.y > 118)).toBe(true);
    expect(first.obstacleCount).toBe(3);
  });

  test("does not fall back to a line through an unrelated obstacle", () => {
    const environment: RoutingPreviewEnvironment = {
      obstacles: [
        { id: "source", kind: "module", bounds: { left: 0, right: 100, top: 0, bottom: 100 } },
        { id: "blocker", kind: "module", bounds: { left: 150, right: 250, top: 0, bottom: 100 } },
      ],
      nodes: new Map([
        ["source", {
          id: "source",
          ancestorObstacleIds: [],
          endpoints: new Map([["out", { point: { x: 100, y: 50 }, outward: "right", physicalKey: "source::out" }]]),
        }],
      ]),
    };

    const preview = solveConnectionPreview(environment, {
      source: { nodeId: "source", handleId: "out" },
      target: { kind: "pointer", point: { x: 200, y: 50 } },
    }, DEFAULT_ROUTING_POLICY);

    expect(preview.status).toBe("unresolved");
    expect(preview.points).toEqual([]);
    expect(preview.diagnostics.length).toBeGreaterThan(0);
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
