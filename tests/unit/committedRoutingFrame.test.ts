import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../../src/layout";
import { CommittedRoutingFrameStore } from "../../src/routing/committedRoutingFrameStore";
import {
  applyCommittedRoutingFrameMapPatch,
  committedRoutingFrameKey,
  createCommittedRoutingFrameMapPatch,
  planRouteJumps,
  reconcileRouteJumpReferences,
  reconcileRoutingRouteReferences,
  type PlannedRoute,
  type RoutingScene,
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

function scene(targetY = 0): RoutingScene {
  return {
    obstacles: [
      { id: "source", kind: "module", bounds: { left: -40, right: 0, top: -24, bottom: 24 } },
      { id: "target", kind: "module", bounds: { left: 200, right: 240, top: targetY - 24, bottom: targetY + 24 } },
    ],
    legs: [{
      id: "leg",
      commodityId: "leg",
      source: {
        point: { x: 0, y: 0 },
        outward: "right",
        terminalObstacleId: "source",
        physicalKey: "source::out",
      },
      target: {
        point: { x: 200, y: targetY },
        outward: "left",
        terminalObstacleId: "target",
        physicalKey: "target::in",
      },
      ignoredObstacleIds: [],
    }],
    gates: [],
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

  it("rebases from a Worker-owned frame key and safely solves in full after eviction", () => {
    const frames = new CommittedRoutingFrameStore(1);
    const initial = frames.compute({ frameKey: "frame-1", scene: scene(), forceFull: false });
    expect(initial.mode).toBe("full");

    const rebased = frames.compute({
      frameKey: "frame-2",
      previousFrameKey: "frame-1",
      scene: scene(24),
      forceFull: false,
    });
    expect(rebased.mode).toBe("rebased");
    expect(rebased.result.certificate.verified).toBe(true);

    const evictedFallback = frames.compute({
      frameKey: "frame-3",
      previousFrameKey: "frame-1",
      scene: scene(48),
      forceFull: false,
    });
    expect(evictedFallback.mode).toBe("full");
    expect(evictedFallback.result.certificate.verified).toBe(true);
  });

  it("transports only changed map entries and requires the exact certified base", () => {
    const first = route("first", 20);
    const second = route("second", 40);
    const previous = new Map([[first.legId, first], [second.legId, second]]);
    const moved = route("second", 48);
    const next = new Map([[first.legId, first], [moved.legId, moved]]);
    const patch = createCommittedRoutingFrameMapPatch("frame-1", previous, next);

    expect([...patch.upserted.keys()]).toEqual(["second"]);
    expect(patch.removedIds).toEqual([]);
    expect(applyCommittedRoutingFrameMapPatch(patch, "stale-frame", previous)).toBeUndefined();
    const reconstructed = applyCommittedRoutingFrameMapPatch(patch, "frame-1", previous);
    expect(reconstructed?.get("first")).toBe(first);
    expect(reconstructed?.get("second")).toBe(moved);
  });
});
