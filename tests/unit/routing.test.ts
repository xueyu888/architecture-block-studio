import { describe, expect, test } from "vitest";
import {
  adaptRouteEndpoints,
  compactOrthogonalPoints,
  drawRoute,
  editableOrthogonalRoute,
  manualRouteChannelAxis,
  materializeManualRoute,
  projectConnectionRoutes,
  restoreManualRoute,
} from "../../src/routing";
import { layoutBlockDesign } from "../../src/layout";
import { connectedDesign } from "./designFixture";

describe("connection route projection", () => {
  test("draws an automatic diagonal as one direct segment", () => {
    expect(drawRoute([{ x: 12, y: 28 }, { x: 160, y: 94 }]))
      .toBe("M 12, 28 L 160, 94");
  });

  test("keeps an automatic route direct while rendered endpoints move", () => {
    expect(adaptRouteEndpoints(
      [{ x: 100, y: 50 }, { x: 300, y: 180 }],
      { x: 112, y: 64 },
      { x: 286, y: 172 },
      "right",
      "left",
    )).toEqual([{ x: 112, y: 64 }, { x: 286, y: 172 }]);
  });

  test("adapts only endpoint legs of a user-authored orthogonal route", () => {
    expect(adaptRouteEndpoints(
      [
        { x: 100, y: 50 },
        { x: 180, y: 50 },
        { x: 180, y: 180 },
        { x: 300, y: 180 },
      ],
      { x: 112, y: 64 },
      { x: 286, y: 172 },
      "right",
      "left",
    )).toEqual([
      { x: 112, y: 64 },
      { x: 180, y: 64 },
      { x: 180, y: 172 },
      { x: 286, y: 172 },
    ]);
  });

  test("removes duplicate and forward-collinear manual points", () => {
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

  test("materializes a direct horizontal connection with endpoint stubs and one editable channel", () => {
    const source = { x: 100, y: 80 };
    const target = { x: 400, y: 80 };
    const control = { x: 250, y: 144 };
    expect(manualRouteChannelAxis(source, target, "right", "left")).toBe("h");
    const route = materializeManualRoute(source, target, "right", "left", control);
    expect(route).toEqual([
      source,
      { x: 132, y: 80 },
      { x: 132, y: 144 },
      { x: 368, y: 144 },
      { x: 368, y: 80 },
      target,
    ]);
    expect(editableOrthogonalRoute(route).segments).toContainEqual({
      index: 2,
      axis: "h",
      midpoint: { x: 250, y: 144 },
      length: 236,
    });
  });

  test("materializes a direct vertical connection with endpoint stubs and one editable channel", () => {
    const source = { x: 160, y: 100 };
    const target = { x: 160, y: 420 };
    const control = { x: 224, y: 260 };
    expect(manualRouteChannelAxis(source, target, "bottom", "top")).toBe("v");
    expect(materializeManualRoute(source, target, "bottom", "top", control)).toEqual([
      source,
      { x: 160, y: 132 },
      { x: 224, y: 132 },
      { x: 224, y: 388 },
      { x: 160, y: 388 },
      target,
    ]);
  });

  test("restores local document waypoints as an orthogonal route", () => {
    expect(restoreManualRoute({
      source: { x: 120, y: 140 },
      target: { x: 420, y: 260 },
      waypoints: [{ x: 40, y: 40 }, { x: 180, y: 40 }, { x: 180, y: 160 }],
      origin: { x: 100, y: 100 },
      sourcePosition: "right",
      targetPosition: "left",
    })).toEqual([
      { x: 120, y: 140 },
      { x: 280, y: 140 },
      { x: 280, y: 260 },
      { x: 420, y: 260 },
    ]);
  });

  test("uses exactly two projected points until the document owns manual waypoints", async () => {
    const document = connectedDesign();
    const level = document.levels[0];
    level.nodes[0].layout = { pinned: true, position: { x: 0, y: 0 } };
    level.nodes[1].layout = { pinned: true, position: { x: 420, y: 180 } };
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const edge = layout.edges[0];
    const automatic = projectConnectionRoutes(layout.nodes, layout.edges).get(edge.id)!;
    expect(automatic).toHaveLength(2);
    expect(automatic[0]).not.toEqual(automatic[1]);

    level.connections[0].routing = {
      waypoints: [{ x: 300, y: 72 }, { x: 300, y: 220 }],
    };
    const manualLayout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const manual = projectConnectionRoutes(manualLayout.nodes, manualLayout.edges).get(manualLayout.edges[0].id)!;
    expect(manual.length).toBeGreaterThan(2);
    expect(manual.slice(1).every((point, index) =>
      point.x === manual[index].x || point.y === manual[index].y
    )).toBe(true);
  });

  test("waits for both endpoint frames without inventing transient geometry", async () => {
    const layout = await layoutBlockDesign(connectedDesign(), {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const edge = layout.edges[0];
    const sourceOnly = layout.nodes.filter((node) => node.id === edge.source);
    expect(projectConnectionRoutes(sourceOnly, [edge]).has(edge.id)).toBe(false);
  });

  test("preserves route identity when a projection produces the same geometry", async () => {
    const layout = await layoutBlockDesign(connectedDesign(), {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const first = projectConnectionRoutes(layout.nodes, layout.edges);
    const second = projectConnectionRoutes(layout.nodes, layout.edges, first);
    expect(second.get(layout.edges[0].id)).toBe(first.get(layout.edges[0].id));
  });
});
