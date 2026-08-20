import { describe, expect, test } from "vitest";
import {
  clampContextMenuPosition,
  contextMenuAccessibleName,
  contextMenuCommandGroups,
} from "../../src/components/contextMenuModel";

describe("canvas context menu model", () => {
  const node = { kind: "node" as const, levelId: "root", nodeId: "api" };
  const connection = { kind: "connection" as const, levelId: "root", connectionId: "api-core" };

  test("projects object-relevant command identities without copying command facts", () => {
    expect(contextMenuCommandGroups(node, node)).toEqual([
      ["addPort", "addChildDesign"],
      ["copySelection", "cutSelection", "duplicateSelection", "deleteSelection"],
      ["selectDirectInterfaces", "selectDirectNeighborhood"],
      ["fitSelection"],
    ]);
    expect(contextMenuCommandGroups(connection, connection)).toEqual([
      ["reconnectConnection", "deleteSelection"],
      ["fitSelection"],
    ]);
  });

  test("adds arrangement only for an all-module multi-selection", () => {
    const modules = { kind: "multiple" as const, items: [
      node,
      { kind: "node" as const, levelId: "root", nodeId: "core" },
    ] };
    const mixed = { kind: "multiple" as const, items: [node, connection] };

    expect(contextMenuCommandGroups(modules, node).flat()).toContain("distributeSelectionVertically");
    expect(contextMenuCommandGroups(mixed, node).flat()).not.toContain("alignSelectionLeft");
    expect(contextMenuCommandGroups(mixed, node).flat()).toContain("selectOutgoingNeighborhood");
    expect(contextMenuAccessibleName(modules, node)).toBe("Selected diagram objects actions");
  });

  test("clamps all four edges while preserving an interior anchor", () => {
    const size = { width: 304, height: 360 };
    const viewport = { width: 1000, height: 700 };
    expect(clampContextMenuPosition({ x: 400, y: 120 }, size, viewport)).toEqual({ x: 400, y: 120 });
    expect(clampContextMenuPosition({ x: -20, y: -30 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampContextMenuPosition({ x: 980, y: 690 }, size, viewport)).toEqual({ x: 688, y: 332 });
  });
});
