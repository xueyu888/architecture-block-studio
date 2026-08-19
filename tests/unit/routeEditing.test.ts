import { Position } from "@xyflow/react";
import { describe, expect, test } from "vitest";
import {
  editableOrthogonalRoute,
  editableRouteBends,
  moveRouteBend,
  moveRouteSegment,
  removeRouteBend,
  type RoutePoint,
} from "../../src/routing";

function expectOrthogonal(points: RoutePoint[]): void {
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    expect(point.x === previous.x || point.y === previous.y).toBe(true);
  });
}

describe("route editing geometry", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 80 },
    { x: 160, y: 80 },
    { x: 160, y: 120 },
    { x: 200, y: 120 },
  ];

  test("projects bend and segment handles without changing route facts", () => {
    const editable = editableOrthogonalRoute(route);

    expect(editable.points).toEqual(route);
    expect(editable.segments.map(({ index, axis }) => ({ index, axis }))).toEqual([
      { index: 1, axis: "v" },
      { index: 2, axis: "h" },
      { index: 3, axis: "v" },
    ]);
    expect(editableRouteBends(route)).toHaveLength(4);
  });

  test("moves an orthogonal segment without changing either endpoint", () => {
    const moved = moveRouteSegment(route, { index: 2, axis: "h" }, 96);

    expect(moved[0]).toEqual(route[0]);
    expect(moved.at(-1)).toEqual(route.at(-1));
    expect(moved[2].y).toBe(96);
    expect(moved[3].y).toBe(96);
    expectOrthogonal(moved);
  });

  test("moves a middle bend by shifting its two adjoining segments", () => {
    const moved = moveRouteBend(route, 2, { x: 72, y: 56 });

    expect(moved[0]).toEqual(route[0]);
    expect(moved.at(-1)).toEqual(route.at(-1));
    expect(moved[2]).toEqual({ x: 72, y: 56 });
    expectOrthogonal(moved);
  });

  test("keeps a port endpoint fixed when moving its adjacent bend", () => {
    const moved = moveRouteBend(route, 1, { x: 64, y: 32 });

    expect(moved[0]).toEqual(route[0]);
    expect(moved[1]).toEqual({ x: 64, y: 0 });
    expectOrthogonal(moved);
  });

  test("deletes a bend pair and reconnects the remaining path orthogonally", () => {
    const reduced = removeRouteBend(route, 2, Position.Right, Position.Left);

    expect(reduced).toBeDefined();
    expect(reduced!.length).toBeLessThan(route.length);
    expect(reduced![0]).toEqual(route[0]);
    expect(reduced!.at(-1)).toEqual(route.at(-1));
    expectOrthogonal(reduced!);
  });
});
