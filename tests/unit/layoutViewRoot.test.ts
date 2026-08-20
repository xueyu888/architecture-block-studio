import { describe, expect, it } from "vitest";
import { layoutBlockDesign } from "../../src/layout";
import { hierarchicalDesign } from "./designFixture";

describe("hierarchy view root projection", () => {
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
