import { describe, expect, test } from "vitest";
import {
  DEFAULT_ROUTING_POLICY,
  solveLiveRoutingPreview,
  solveRoutingScene,
  verifyRoutingResult,
  type RoutingLeg,
  type RoutingObstacle,
  type RoutingScene,
} from "../../src/routing";

function horizontalScene(count: number): RoutingScene {
  const obstacles: RoutingObstacle[] = [];
  const legs: RoutingLeg[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = index * 96;
    const sourceId = `source-${index}`;
    const targetId = `target-${index}`;
    obstacles.push(
      { id: sourceId, kind: "module", bounds: { left: -40, right: 0, top: y - 24, bottom: y + 24 } },
      { id: targetId, kind: "module", bounds: { left: 200, right: 240, top: y - 24, bottom: y + 24 } },
    );
    legs.push({
      id: `leg-${index}`,
      commodityId: `commodity-${index}`,
      source: { point: { x: 0, y }, outward: "right", terminalObstacleId: sourceId, physicalKey: `${sourceId}::out` },
      target: { point: { x: 200, y }, outward: "left", terminalObstacleId: targetId, physicalKey: `${targetId}::in` },
      ignoredObstacleIds: [],
    });
  }
  return { obstacles, legs, gates: [] };
}

describe("live routing preview", () => {
  test("retains the committed result when the disposable frame has no routing change", () => {
    const scene = horizontalScene(2);
    const committed = solveRoutingScene(scene);
    const preview = solveLiveRoutingPreview(scene, scene, committed, DEFAULT_ROUTING_POLICY);

    expect(preview).toMatchObject({ mode: "retained", affectedLegIds: [], neighborhoodLegIds: [] });
    expect(preview.routes).toBe(committed.routes);
  });

  test("reroutes only the affected bounded neighborhood in a large sparse scene", () => {
    const committedScene = horizontalScene(40);
    const committed = solveRoutingScene(committedScene, DEFAULT_ROUTING_POLICY);
    const liveScene: RoutingScene = {
      ...committedScene,
      obstacles: committedScene.obstacles.map((obstacle) => obstacle.id === "target-0"
        ? { ...obstacle, bounds: { ...obstacle.bounds, top: 0, bottom: 48 } }
        : obstacle),
      legs: committedScene.legs.map((leg) => leg.id === "leg-0"
        ? { ...leg, target: { ...leg.target, point: { x: 200, y: 24 } } }
        : leg),
    };
    const preview = solveLiveRoutingPreview(
      committedScene,
      liveScene,
      committed,
      DEFAULT_ROUTING_POLICY,
    );

    expect(preview.mode).toBe("incremental");
    expect(preview.affectedLegIds).toEqual(["leg-0"]);
    expect(preview.neighborhoodLegIds.length).toBeGreaterThan(0);
    expect(preview.neighborhoodLegIds.length).toBeLessThan(40);
    expect(preview.routes.get("leg-0")?.points.at(-1)).toEqual({ x: 200, y: 24 });
    expect(preview.routes.get("leg-39")).toBe(committed.routes.get("leg-39"));
  });

  test("marks an unchanged connection affected when a moved obstacle enters its route", () => {
    const committedScene = horizontalScene(1);
    const committed = solveRoutingScene(committedScene);
    const blocker: RoutingObstacle = {
      id: "blocker",
      kind: "module",
      bounds: { left: 80, right: 120, top: 80, bottom: 120 },
    };
    const original: RoutingScene = {
      ...committedScene,
      obstacles: [...committedScene.obstacles, blocker],
    };
    const originalResult = solveRoutingScene(original);
    const live: RoutingScene = {
      ...original,
      obstacles: original.obstacles.map((obstacle) => obstacle.id === "blocker"
        ? { ...obstacle, bounds: { left: 80, right: 120, top: -20, bottom: 20 } }
        : obstacle),
    };
    const preview = solveLiveRoutingPreview(original, live, originalResult, DEFAULT_ROUTING_POLICY);

    expect(preview.mode).toBe("exact");
    expect(preview.affectedLegIds).toEqual(["leg-0"]);
    expect(verifyRoutingResult(live, preview.routes, DEFAULT_ROUTING_POLICY).valid).toBe(true);
    expect(preview.routes.get("leg-0")?.points).not.toEqual(committed.routes.get("leg-0")?.points);
  });

  test("closes the affected set across a hierarchy gate", () => {
    const scene: RoutingScene = {
      obstacles: [
        { id: "source", kind: "module", bounds: { left: -40, right: 0, top: -24, bottom: 24 } },
        { id: "target", kind: "module", bounds: { left: 200, right: 240, top: -24, bottom: 24 } },
      ],
      legs: [{
        id: "leg-0",
        commodityId: "shared",
        source: { point: { x: 0, y: 0 }, outward: "right", terminalObstacleId: "source", physicalKey: "source::out" },
        target: { point: { x: 100, y: 0 }, outward: "left", physicalKey: "boundary::port" },
        ignoredObstacleIds: [],
      }, {
        id: "leg-1",
        commodityId: "shared",
        source: { point: { x: 100, y: 0 }, outward: "right", physicalKey: "boundary::port" },
        target: { point: { x: 200, y: 0 }, outward: "left", terminalObstacleId: "target", physicalKey: "target::in" },
        ignoredObstacleIds: [],
      }],
      gates: [{
        id: "gate",
        commodityId: "shared",
        point: { x: 100, y: 0 },
        ends: [
          { legId: "leg-0", end: "target" },
          { legId: "leg-1", end: "source" },
        ],
      }],
    };
    const committed = solveRoutingScene(scene);
    expect(committed.routes.size).toBe(2);
    const live: RoutingScene = {
      ...scene,
      legs: scene.legs.map((leg) => leg.id === "leg-0"
        ? { ...leg, source: { ...leg.source, point: { x: 0, y: 8 } } }
        : leg),
    };
    const preview = solveLiveRoutingPreview(scene, live, committed, DEFAULT_ROUTING_POLICY);

    expect(preview.affectedLegIds).toEqual(["leg-0", "leg-1"]);
  });
});
