import { describe, expect, test } from "vitest";
import { applyDesignOperation } from "../../src/editor/designEditor";
import {
  layoutBlockDesign,
  projectAuthoredNodeGeometry,
} from "../../src/layout";
import { connectedDesign } from "./designFixture";

describe("authored node geometry projection", () => {
  test("changes only targeted flat nodes and retains every edge", async () => {
    const document = connectedDesign();
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const resized = applyDesignOperation(document, {
      type: "node/resize",
      levelId: "system",
      nodeId: "source",
      position: { x: 64, y: 96 },
      size: { width: 320, height: 192 },
    });

    const projected = projectAuthoredNodeGeometry(
      resized,
      layout,
      "system",
      new Set(),
      "authored",
      [{ levelId: "system", nodeId: "source" }],
    );

    expect(projected).toBeDefined();
    expect(projected!.edges).toBe(layout.edges);
    expect(projected!.nodes[0]).not.toBe(layout.nodes[0]);
    expect(projected!.nodes[1]).toBe(layout.nodes[1]);
    expect(projected!.nodes[0]).toMatchObject({
      position: { x: 64, y: 96 },
      width: 320,
      height: 192,
      data: {
        block: resized.levels[0].nodes[0],
        designPosition: { x: 64, y: 96 },
        projectedPosition: { x: 64, y: 96 },
      },
    });
  });

  test("defers non-local placement dependencies to the complete composer", async () => {
    const document = connectedDesign();
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(),
      placementMode: "authored",
    });
    const change = [{ levelId: "system", nodeId: "source" }];

    expect(projectAuthoredNodeGeometry(
      document,
      layout,
      "system",
      new Set(["child-level"]),
      "authored",
      change,
    )).toBeUndefined();
    expect(projectAuthoredNodeGeometry(
      document,
      layout,
      "system",
      new Set(),
      "automatic",
      change,
    )).toBeUndefined();
  });
});
