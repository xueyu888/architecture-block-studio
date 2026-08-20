import { describe, expect, it } from "vitest";
import {
  applyDesignOperation,
  createBlankDesign,
  createBlock,
  createDesignLevel,
} from "../../src/editor";
import { layoutBlockDesign } from "../../src/layout";
import { hierarchicalDesign } from "./designFixture";

describe("hierarchy view root projection", () => {
  it("publishes the expanded child Level origin and visible drop surface", async () => {
    const layout = await layoutBlockDesign(hierarchicalDesign(), {
      expandedLevelIds: new Set(["parent-internal"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const owner = layout.nodes.find((node) => node.id === "system::parent");

    expect(owner?.data.childLevelProjection).toEqual({
      levelId: "parent-internal",
      title: "Parent Internal",
      hierarchyDepth: 1,
      designOrigin: { x: 72, y: 68 },
      dropBounds: { x: 2, y: 32, width: 382, height: 232 },
    });
  });

  it("gives an expanded empty child Level a complete default-module drop surface", async () => {
    let document = createBlankDesign("empty-child", "Empty Child");
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "boundary", title: "Empty Boundary" }),
    });
    document = applyDesignOperation(document, {
      type: "hierarchy/add",
      levelId: "system",
      nodeId: "boundary",
      childLevel: createDesignLevel("empty-level", "Empty Level", "system"),
    });

    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(["empty-level"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const owner = layout.nodes.find((node) => node.id === "system::boundary");

    expect(owner).toMatchObject({ width: 386, height: 266 });
    expect(owner?.data.childLevelProjection).toEqual({
      levelId: "empty-level",
      title: "Empty Level",
      hierarchyDepth: 1,
      designOrigin: { x: 72, y: 68 },
      dropBounds: { x: 2, y: 32, width: 382, height: 232 },
    });
  });

  it("projects a child level as a complete graph without mutating the document entry", async () => {
    const document = hierarchicalDesign();
    const before = structuredClone(document);
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(),
      placementMode: "authored",
      rootLevelId: "parent-internal",
    });

    expect(layout.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      levelId: node.data.levelId,
      hierarchyDepth: node.data.hierarchyDepth,
    }))).toEqual([{
      id: "parent-internal::child",
      parentId: undefined,
      levelId: "parent-internal",
      hierarchyDepth: 0,
    }]);
    expect(layout.edges).toEqual([]);
    expect(document).toEqual(before);
    expect(document.entryLevelId).toBe("system");
  });

  it("rejects a missing view root instead of falling back to another level", async () => {
    await expect(layoutBlockDesign(hierarchicalDesign(), {
      expandedLevelIds: new Set(),
      placementMode: "authored",
      rootLevelId: "missing",
    })).rejects.toThrow("Cannot lay out missing level missing");
  });
});
