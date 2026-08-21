import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_ROUTING_POLICY,
  createRoutingSceneFromLayout,
  routingPolicyForScene,
  solveRoutingScene,
  verifyRoutingResult,
  type RoutingEndpoint,
  type RoutingLeg,
  type RoutingObstacle,
  type PlannedRoute,
  type RoutingScene,
} from "../../src/routing";
import { parseBlockDesignDocument } from "../../src/model";
import { layoutBlockDesign } from "../../src/layout";

const sourceObstacle: RoutingObstacle = {
  id: "source-node",
  kind: "module",
  bounds: { left: -40, right: 0, top: -24, bottom: 24 },
};
const targetObstacle: RoutingObstacle = {
  id: "target-node",
  kind: "module",
  bounds: { left: 100, right: 140, top: -24, bottom: 24 },
};

function endpoint(
  point: { x: number; y: number },
  outward: RoutingEndpoint["outward"],
  terminalObstacleId: string,
  physicalKey = terminalObstacleId,
): RoutingEndpoint {
  return { point, outward, terminalObstacleId, physicalKey };
}

function leg(id: string, commodityId = id): RoutingLeg {
  return {
    id,
    commodityId,
    source: endpoint({ x: 0, y: 0 }, "right", sourceObstacle.id, "source-node::out"),
    target: endpoint({ x: 100, y: 0 }, "left", targetObstacle.id, "target-node::in"),
    ignoredObstacleIds: [],
  };
}

function scene(legs: RoutingLeg[], obstacles: RoutingObstacle[] = []): RoutingScene {
  return { obstacles: [sourceObstacle, targetObstacle, ...obstacles], legs, gates: [] };
}

function translatedScene(input: RoutingScene, x: number, y: number): RoutingScene {
  const point = (value: { x: number; y: number }) => ({ x: value.x + x, y: value.y + y });
  const bounds = (value: { left: number; right: number; top: number; bottom: number }) => ({
    left: value.left + x,
    right: value.right + x,
    top: value.top + y,
    bottom: value.bottom + y,
  });
  return {
    obstacles: input.obstacles.map((obstacle) => ({ ...obstacle, bounds: bounds(obstacle.bounds) })),
    legs: input.legs.map((candidate) => ({
      ...candidate,
      source: { ...candidate.source, point: point(candidate.source.point) },
      target: { ...candidate.target, point: point(candidate.target.point) },
      routingBounds: candidate.routingBounds ? bounds(candidate.routingBounds) : undefined,
      lockedPoints: candidate.lockedPoints?.map(point),
    })),
    gates: input.gates.map((gate) => ({ ...gate, point: point(gate.point) })),
  };
}

function skewedHubScene(perSide: number): RoutingScene {
  const hub: RoutingObstacle = {
    id: "hub",
    kind: "module",
    bounds: { left: 0, right: 240, top: 0, bottom: perSide * 48 + 48 },
  };
  const obstacles: RoutingObstacle[] = [hub];
  const legs: RoutingLeg[] = [];
  for (let index = 0; index < perSide; index += 1) {
    const y = 48 + index * 48;
    const leftId = `left-${index.toString().padStart(3, "0")}`;
    const rightId = `right-${index.toString().padStart(3, "0")}`;
    obstacles.push(
      { id: leftId, kind: "module", bounds: { left: -440, right: -400, top: y - 5, bottom: y + 5 } },
      { id: rightId, kind: "module", bounds: { left: 640, right: 680, top: y - 5, bottom: y + 5 } },
    );
    legs.push(
      {
        id: `hub-input-${index.toString().padStart(3, "0")}`,
        commodityId: `hub-input-${index}`,
        source: endpoint({ x: -396, y }, "right", leftId, `${leftId}::out`),
        target: endpoint({ x: -4, y }, "left", hub.id, `hub::input-${index}`),
        ignoredObstacleIds: [],
      },
      {
        id: `hub-output-${index.toString().padStart(3, "0")}`,
        commodityId: `hub-output-${index}`,
        source: endpoint({ x: 244, y }, "right", hub.id, `hub::output-${index}`),
        target: endpoint({ x: 636, y }, "left", rightId, `${rightId}::in`),
        ignoredObstacleIds: [],
      },
    );
  }
  return { obstacles, legs, gates: [] };
}

function fiveLevelScene(commodityCount: number): RoutingScene {
  const containers = Array.from({ length: 5 }, (_, index): RoutingObstacle => ({
    id: `level-${index + 1}`,
    kind: "container",
    bounds: {
      left: index * 120,
      right: 1_100 - index * 20,
      top: -80 + index * 8,
      bottom: commodityCount * 48 + 80 - index * 8,
    },
  }));
  const obstacles: RoutingObstacle[] = [...containers];
  const legs: RoutingLeg[] = [];
  const gates: RoutingScene["gates"][number][] = [];
  for (let commodityIndex = 0; commodityIndex < commodityCount; commodityIndex += 1) {
    const commodityId = `nested-flow-${commodityIndex.toString().padStart(2, "0")}`;
    const y = 48 + commodityIndex * 48;
    const sourceId = `${commodityId}::source`;
    const targetId = `${commodityId}::target`;
    obstacles.push(
      { id: sourceId, kind: "module", bounds: { left: -100, right: -60, top: y - 5, bottom: y + 5 } },
      { id: targetId, kind: "module", bounds: { left: 760, right: 800, top: y - 5, bottom: y + 5 } },
    );
    const gatePoints = containers.map((container) => ({ x: container.bounds.left, y }));
    const outerLegId = `${commodityId}::outside`;
    legs.push({
      id: outerLegId,
      commodityId,
      source: endpoint({ x: -56, y }, "right", sourceId, `${sourceId}::out`),
      target: endpoint(gatePoints[0], "left", containers[0].id, `${containers[0].id}::${commodityId}`),
      ignoredObstacleIds: [],
    });
    let previousLegId = outerLegId;
    containers.forEach((container, levelIndex) => {
      const legId = `${commodityId}::level-${levelIndex + 1}`;
      const target = levelIndex < containers.length - 1
        ? endpoint(
            gatePoints[levelIndex + 1],
            "left",
            containers[levelIndex + 1].id,
            `${containers[levelIndex + 1].id}::${commodityId}`,
          )
        : endpoint({ x: 756, y }, "left", targetId, `${targetId}::in`);
      legs.push({
        id: legId,
        commodityId,
        source: endpoint(
          gatePoints[levelIndex],
          "right",
          container.id,
          `${container.id}::${commodityId}`,
        ),
        target,
        ignoredObstacleIds: containers.slice(0, levelIndex + 1).map((ancestor) => ancestor.id),
        routingBounds: container.bounds,
      });
      gates.push({
        id: `${commodityId}::gate-${levelIndex + 1}`,
        commodityId,
        point: gatePoints[levelIndex],
        ends: [
          { legId: previousLegId, end: "target" },
          { legId, end: "source" },
        ],
      });
      previousLegId = legId;
    });
  }
  return { obstacles, legs, gates };
}

describe("standalone scene router", () => {
  test("proves the unobstructed single-commodity route and keeps it monotone", () => {
    const input = scene([leg("direct")]);
    const result = solveRoutingScene(input);

    expect(result.status).toBe("Optimal");
    expect(result.certificate.proof).toBe("single-commodity-visibility-optimal");
    expect(result.routes.get("direct")?.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(verifyRoutingResult(input, result.routes, DEFAULT_ROUTING_POLICY)).toMatchObject({
      valid: true,
      objective: { capacityViolations: 0, crossings: 0, bends: 0 },
    });
  });

  test("uses an obstacle corner corridor without crossing the inflated safety domain", () => {
    const input = scene([leg("around")], [{
      id: "middle",
      kind: "module",
      bounds: { left: 40, right: 60, top: -12, bottom: 12 },
    }]);
    const result = solveRoutingScene(input);
    const route = result.routes.get("around")!;

    expect(result.status).toBe("Optimal");
    expect(route.points.some((point) => Math.abs(point.y) >= 31)).toBe(true);
    expect(result.certificate.verified).toBe(true);
  });

  test("separates truly shared corridors symmetrically after the fixed endpoint stubs", () => {
    const first = leg("first", "first");
    const second = leg("second", "second");
    const input = scene([first, second]);
    const result = solveRoutingScene(input);

    expect(result.status).toBe("Feasible");
    expect(result.certificate.proof).toBe("bounded-feasible");
    expect(result.routes.get("first")?.points).not.toEqual(result.routes.get("second")?.points);
    expect(result.certificate.objective.capacityViolations).toBe(0);
    expect(result.certificate.verified).toBe(true);
  });

  test("treats two hierarchy legs as one commodity through a direction-continuous gate", () => {
    const gatePoint = { x: 100, y: 0 };
    const outside: RoutingObstacle = {
      id: "outside",
      kind: "module",
      bounds: { left: -40, right: 0, top: -24, bottom: 24 },
    };
    const container: RoutingObstacle = {
      id: "container",
      kind: "container",
      bounds: { left: 100, right: 260, top: -80, bottom: 80 },
    };
    const child: RoutingObstacle = {
      id: "child",
      kind: "module",
      bounds: { left: 200, right: 240, top: -24, bottom: 24 },
    };
    const actual: RoutingLeg = {
      id: "actual",
      commodityId: "logical",
      source: endpoint({ x: 0, y: 0 }, "right", outside.id),
      target: endpoint(gatePoint, "left", container.id, "container::gate"),
      ignoredObstacleIds: [],
    };
    const continuation: RoutingLeg = {
      id: "continuation",
      commodityId: "logical",
      source: endpoint(gatePoint, "right", container.id, "container::gate"),
      target: endpoint({ x: 200, y: 0 }, "left", child.id),
      ignoredObstacleIds: [container.id],
      routingBounds: container.bounds,
    };
    const input: RoutingScene = {
      obstacles: [outside, container, child],
      legs: [actual, continuation],
      gates: [{
        id: "logical::gate",
        commodityId: "logical",
        point: gatePoint,
        ends: [
          { legId: actual.id, end: "target" },
          { legId: continuation.id, end: "source" },
        ],
      }],
    };
    const result = solveRoutingScene(input);

    expect(result.status).toBe("Feasible");
    expect(result.certificate.verified).toBe(true);
    expect(result.routes.get("actual")?.points.at(-1)).toEqual(gatePoint);
    expect(result.routes.get("continuation")?.points[0]).toEqual(gatePoint);
  });

  test("never changes a user-authored route and rejects an invalid locked route honestly", () => {
    const locked: RoutingLeg = {
      ...leg("locked"),
      lockedPoints: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 0 },
      ],
    };
    const input = scene([locked], [{
      id: "blocking",
      kind: "module",
      bounds: { left: 45, right: 55, top: 8, bottom: 30 },
    }]);
    const result = solveRoutingScene(input);

    expect(result.status).toBe("InvalidInput");
    expect(result.routes.get("locked")?.points).toEqual(locked.lockedPoints);
    expect(result.diagnostics.some((entry) => entry.message.includes("blocking"))).toBe(true);
  });

  test("the independent verifier rejects reversals and routes beyond the explicit detour bound", () => {
    const input = scene([leg("quality")]);
    const route: PlannedRoute = {
      legId: "quality",
      commodityId: "quality",
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 200 },
        { x: 100, y: 200 },
        { x: 100, y: 0 },
      ],
      sourceStub: { x: 12, y: 0 },
      targetStub: { x: 88, y: 0 },
      locked: false,
      baselineLength: 100,
      length: 500,
      bends: 3,
    };
    const detourVerification = verifyRoutingResult(input, new Map([[route.legId, route]]), DEFAULT_ROUTING_POLICY);
    expect(detourVerification.diagnostics.some((entry) => entry.message.includes("detour bound"))).toBe(true);

    const reversed: PlannedRoute = {
      ...route,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 40 },
        { x: 100, y: 40 },
        { x: 100, y: 0 },
      ],
      length: 200,
    };
    const reversalVerification = verifyRoutingResult(input, new Map([[reversed.legId, reversed]]), DEFAULT_ROUTING_POLICY);
    expect(reversalVerification.diagnostics.some((entry) => entry.message.includes("reversal"))).toBe(true);

    const backtracked: PlannedRoute = {
      ...route,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
        { x: 20, y: 30 },
        { x: 20, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 0 },
      ],
      length: 240,
    };
    const backtrackVerification = verifyRoutingResult(input, new Map([[backtracked.legId, backtracked]]), DEFAULT_ROUTING_POLICY);
    expect(backtrackVerification.diagnostics.some((entry) => entry.message.includes("backtracks"))).toBe(true);
  });

  test("is deterministic for identical normalized scene input", () => {
    const input = scene([leg("first", "first"), leg("second", "second")]);
    const first = solveRoutingScene(input);
    const second = solveRoutingScene(input);

    expect([...second.routes]).toEqual([...first.routes]);
    expect(second.certificate).toEqual(first.certificate);
  });

  test("keeps route choice invariant when the complete scene is translated", () => {
    const input = scene([
      leg("first", "first"),
      { ...leg("second", "second"), source: endpoint({ x: 0, y: 8 }, "right", sourceObstacle.id, "source-node::out-2") },
    ], [{ id: "detour", kind: "module", bounds: { left: 40, right: 60, top: -8, bottom: 26 } }]);
    const offset = { x: 2_320, y: -1_440 };
    const original = solveRoutingScene(input);
    const translated = solveRoutingScene(translatedScene(input, offset.x, offset.y));

    expect(translated.status).toBe(original.status);
    expect(translated.certificate.objective).toEqual(original.certificate.objective);
    for (const [legId, route] of original.routes) {
      expect(translated.routes.get(legId)?.points.map((point) => ({
        x: point.x - offset.x,
        y: point.y - offset.y,
      }))).toEqual(route.points);
    }
  });

  test("plans every visible leg in the real double-expanded reference design without shared capacity", async () => {
    const document = parseBlockDesignDocument(JSON.parse(readFileSync(
      new URL("../../public/examples/aio-agent-runtime.block-design.json", import.meta.url),
      "utf8",
    )));
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(["core", "tool"]),
      placementMode: "automatic",
    });
    const input = createRoutingSceneFromLayout(layout.nodes, layout.edges);
    const result = solveRoutingScene(input);

    expect({
      status: result.status,
      routes: result.routes.size,
      legs: input.legs.length,
      objective: result.certificate.objective,
      diagnostics: result.diagnostics,
    }).toMatchObject({
      status: "Feasible",
      routes: input.legs.length,
      legs: input.legs.length,
      objective: { capacityViolations: 0 },
      diagnostics: [],
    });
  }, 10_000);

  test("plans every source dependency through the complete authored hierarchy projection", async () => {
    const document = parseBlockDesignDocument(JSON.parse(readFileSync(
      new URL("../../public/examples/architecture-block-studio.block-design.json", import.meta.url),
      "utf8",
    )));
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set([
        "windows-desktop-runtime",
        "workbench-composition",
        "source-architecture",
        "runtime-modules",
      ]),
      placementMode: "authored",
      rootLevelId: "product-boundary",
    });
    const input = createRoutingSceneFromLayout(layout.nodes, layout.edges);
    const result = solveRoutingScene(input, routingPolicyForScene(input));

    expect({
      status: result.status,
      routes: result.routes.size,
      legs: input.legs.length,
      objective: result.certificate.objective,
      diagnostics: result.diagnostics,
    }).toMatchObject({
      status: "Feasible",
      routes: 29,
      legs: 29,
      objective: { capacityViolations: 0 },
      diagnostics: [],
    });
  }, 10_000);

  test("audits every line and every line pair in a severely skewed 120-connection hub", () => {
    const input = skewedHubScene(60);
    const policy = routingPolicyForScene(input);
    const result = solveRoutingScene(input, policy);
    const verification = verifyRoutingResult(input, result.routes, policy);

    expect(policy).toMatchObject({ version: "orthogonal-scene-v1", conflictSweepIterations: 0 });
    expect(result.status).toBe("Feasible");
    expect(result.routes.size).toBe(120);
    expect(verification.valid).toBe(true);
    expect(verification.audit.auditedLegIds).toEqual(input.legs.map((item) => item.id).sort());
    expect(verification.audit.auditedPairCount).toBe(120 * 119 / 2);
    expect(verification.objective).toMatchObject({
      unrouted: 0,
      capacityViolations: 0,
      crossings: 0,
      shortSegments: 0,
    });
  }, 20_000);

  test("audits every leg and pair across five nested hierarchy domains", () => {
    const input = fiveLevelScene(12);
    const result = solveRoutingScene(input);
    const verification = verifyRoutingResult(input, result.routes, DEFAULT_ROUTING_POLICY);

    expect(result.status).toBe("Feasible");
    expect(result.certificate.verified).toBe(true);
    expect(result.routes.size).toBe(72);
    expect(verification.audit.auditedLegIds).toEqual(input.legs.map((item) => item.id).sort());
    expect(verification.audit.auditedPairCount).toBe(72 * 71 / 2);
    expect(verification.objective).toMatchObject({
      unrouted: 0,
      capacityViolations: 0,
      crossings: 0,
      shortSegments: 0,
    });
    input.legs.filter((item) => item.routingBounds).forEach((item) => {
      expect(result.routes.get(item.id)?.points.every((point) =>
        point.x >= item.routingBounds!.left && point.x <= item.routingBounds!.right &&
        point.y >= item.routingBounds!.top && point.y <= item.routingBounds!.bottom
      )).toBe(true);
    });
  });

  test("never reports a dense shared-port scene as feasible when lanes cannot be separated", () => {
    const shared = Array.from({ length: 12 }, (_, index): RoutingLeg => ({
      ...leg(`shared-port-${index.toString().padStart(2, "0")}`),
      source: endpoint({ x: 0, y: 0 }, "right", sourceObstacle.id, "source-node::one-physical-port"),
      target: endpoint({ x: 100, y: 0 }, "left", targetObstacle.id, "target-node::one-physical-port"),
    }));
    const input = scene(shared);
    const result = solveRoutingScene(input);

    expect(result.status).toBe("Unresolved");
    expect(result.certificate.verified).toBe(false);
    expect(result.certificate.audit.auditedLegIds).toHaveLength(shared.length);
    expect(result.certificate.objective.capacityViolations).toBeGreaterThan(0);
  });
});
