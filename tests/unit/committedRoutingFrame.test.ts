import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../../src/layout";
import {
  committedRoutingFrameKey,
  planRouteJumps,
  reconcileRouteJumpReferences,
  reconcileRoutingRouteReferences,
  type PlannedRoute,
} from "../../src/routing";

function route(legId: string, y: number): PlannedRoute {
  const points = [{ x: 0, y }, { x: 100, y }];
  return {
    legId,
    commodityId: legId,
    points,
    sourceStub: points[0],
    targetStub: points[1],
    locked: false,
    baselineLength: 100,
    length: 100,
    bends: 0,
  };
}

describe("committed routing frame identity", () => {
  it("pairs one disposable layout identity with its route revision", () => {
    const first: LayoutResult = { nodes: [], edges: [] };
    const second: LayoutResult = { nodes: [], edges: [] };
    expect(committedRoutingFrameKey(first, 4)).toBe(committedRoutingFrameKey(first, 4));
    expect(committedRoutingFrameKey(first, 5)).not.toBe(committedRoutingFrameKey(first, 4));
    expect(committedRoutingFrameKey(second, 4)).not.toBe(committedRoutingFrameKey(first, 4));
  });

  it("reuses only geometrically unchanged route and jump references", () => {
    const first = route("first", 20);
    const second = route("second", 40);
    const previousRoutes = new Map([[first.legId, first], [second.legId, second]]);
    const equivalentRoutes = new Map([
      [first.legId, structuredClone(first)],
      [second.legId, structuredClone(second)],
    ]);
    expect(reconcileRoutingRouteReferences(previousRoutes, equivalentRoutes)).toBe(previousRoutes);

    const movedSecond = route("second", 48);
    const reconciledRoutes = reconcileRoutingRouteReferences(previousRoutes, new Map([
      [first.legId, structuredClone(first)],
      [movedSecond.legId, movedSecond],
    ]));
    expect(reconciledRoutes).not.toBe(previousRoutes);
    expect(reconciledRoutes.get("first")).toBe(first);
    expect(reconciledRoutes.get("second")).toBe(movedSecond);

    const previousJumps = planRouteJumps(previousRoutes);
    const equivalentJumps = planRouteJumps(equivalentRoutes);
    expect(reconcileRouteJumpReferences(previousJumps, equivalentJumps)).toBe(previousJumps);
  });
});
