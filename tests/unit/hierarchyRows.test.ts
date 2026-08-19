import { describe, expect, it } from "vitest";
import { projectHierarchyRows } from "../../src/components/hierarchyRows";
import { hierarchicalDesign } from "./designFixture";

describe("hierarchy display projection", () => {
  it("keeps complete document order while deriving expansion as display state", () => {
    const document = hierarchicalDesign();
    const collapsed = projectHierarchyRows(document, new Set());
    const expanded = projectHierarchyRows(document, new Set(["parent-internal"]));

    expect(collapsed.map((row) => row.key)).toEqual([
      "document:hierarchy-test",
      "level:system",
      "node:system:parent",
    ]);
    expect(expanded.map((row) => [row.key, row.depth])).toEqual([
      ["document:hierarchy-test", 0],
      ["level:system", 0],
      ["node:system:parent", 0],
      ["level:parent-internal", 1],
      ["node:parent-internal:child", 1],
    ]);
    expect(document.levels).toHaveLength(2);
  });
});
