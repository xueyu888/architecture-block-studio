import { describe, expect, it } from "vitest";
import {
  connectionForSelection,
  diagramSelectionItems,
  hierarchyLevelPath,
  levelForSelection,
  nodeForSelection,
  replaceDiagramSelection,
  sameSelection,
  selectAllInLevel,
  selectionContains,
  selectionExists,
  selectionForIssue,
  selectionKey,
  toggleDiagramSelection,
  type SelectionRef,
} from "../../src/studio/selection";
import type { DesignIssue } from "../../src/model";
import { connectedDesign, hierarchicalDesign } from "./designFixture";

describe("workspace selection protocol", () => {
  it("gives each selectable object a stable identity and validates it against the document", () => {
    const document = connectedDesign();
    const selections: SelectionRef[] = [
      { kind: "document" },
      { kind: "level", levelId: "system" },
      { kind: "node", levelId: "system", nodeId: "source" },
      { kind: "port", levelId: "system", nodeId: "source", portId: "out" },
      { kind: "connection", levelId: "system", connectionId: "source-to-target" },
    ];

    expect(new Set(selections.map(selectionKey)).size).toBe(selections.length);
    selections.forEach((selection) => expect(selectionExists(document, selection)).toBe(true));
    expect(selectionExists(document, { kind: "node", levelId: "system", nodeId: "missing" })).toBe(false);
    expect(selectionExists(document, { kind: "port", levelId: "system", nodeId: "source", portId: "missing" })).toBe(false);
    expect(selectionExists(document, { kind: "connection", levelId: "system", connectionId: "missing" })).toBe(false);
    expect(sameSelection(selections[3], { kind: "port", levelId: "system", nodeId: "source", portId: "out" })).toBe(true);
    expect(sameSelection(selections[2], selections[3])).toBe(false);
  });

  it("maps a DRC issue to its most specific selectable target", () => {
    const issue = (values: Partial<DesignIssue>): DesignIssue => ({
      id: "test",
      severity: "warning",
      code: "TEST",
      message: "Test issue",
      remediation: "Test remediation",
      ...values,
    });

    expect(selectionForIssue(issue({}))).toEqual({ kind: "document" });
    expect(selectionForIssue(issue({ levelId: "system" }))).toEqual({ kind: "level", levelId: "system" });
    expect(selectionForIssue(issue({ levelId: "system", nodeId: "source" }))).toEqual({
      kind: "node",
      levelId: "system",
      nodeId: "source",
    });
    expect(selectionForIssue(issue({ levelId: "system", nodeId: "source", portId: "out" }))).toEqual({
      kind: "port",
      levelId: "system",
      nodeId: "source",
      portId: "out",
    });
    expect(selectionForIssue(issue({ levelId: "system", connectionId: "source-to-target" }))).toEqual({
      kind: "connection",
      levelId: "system",
      connectionId: "source-to-target",
    });
  });

  it("resolves selected context and the ancestor expansion path without owning document state", () => {
    const document = hierarchicalDesign();
    const childSelection: SelectionRef = {
      kind: "node",
      levelId: "parent-internal",
      nodeId: "child",
    };

    expect(hierarchyLevelPath(document, "system")).toEqual([]);
    expect(hierarchyLevelPath(document, "parent-internal")).toEqual(["parent-internal"]);
    expect(levelForSelection(document, childSelection).id).toBe("parent-internal");
    expect(levelForSelection(document, { kind: "level", levelId: "missing" }).id).toBe("system");
    expect(nodeForSelection(document, childSelection)?.node.id).toBe("child");
    expect(nodeForSelection(document, { kind: "connection", levelId: "system", connectionId: "missing" })).toBeUndefined();
    expect(connectionForSelection(connectedDesign(), {
      kind: "connection",
      levelId: "system",
      connectionId: "source-to-target",
    })).toMatchObject({
      level: { id: "system" },
      connection: { id: "source-to-target" },
    });
    expect(connectionForSelection(document, childSelection)).toBeUndefined();
  });

  it("owns canonical replace and toggle semantics for diagram multi-selection", () => {
    const source = { kind: "node", levelId: "system", nodeId: "source" } as const;
    const target = { kind: "node", levelId: "system", nodeId: "target" } as const;
    const connection = { kind: "connection", levelId: "system", connectionId: "source-to-target" } as const;

    const multiple = replaceDiagramSelection([target, source, target], "system");
    expect(multiple).toEqual({ kind: "multiple", items: [source, target] });
    expect(selectionContains(multiple, source)).toBe(true);
    expect(selectionContains(multiple, connection)).toBe(false);
    expect(sameSelection(multiple, { kind: "multiple", items: [target, source] })).toBe(true);

    const mixed = toggleDiagramSelection(multiple, [target, connection], "system");
    expect(diagramSelectionItems(mixed)).toEqual([connection, source]);
    expect(toggleDiagramSelection(mixed, [connection], "system")).toEqual(source);
    expect(toggleDiagramSelection(source, [source], "system")).toEqual({ kind: "level", levelId: "system" });
  });

  it("selects every module and interface in one design level without inventing document state", () => {
    const document = connectedDesign();
    const level = document.levels.find((candidate) => candidate.id === "system")!;

    expect(diagramSelectionItems(selectAllInLevel(level))).toEqual([
      { kind: "connection", levelId: "system", connectionId: "source-to-target" },
      { kind: "node", levelId: "system", nodeId: "source" },
      { kind: "node", levelId: "system", nodeId: "target" },
    ]);
    expect(selectAllInLevel({ ...level, nodes: [], connections: [] })).toEqual({
      kind: "level",
      levelId: "system",
    });
  });

  it("validates every member of a multi-selection without persisting it in the document", () => {
    const document = connectedDesign();
    const valid: SelectionRef = {
      kind: "multiple",
      items: [
        { kind: "node", levelId: "system", nodeId: "source" },
        { kind: "connection", levelId: "system", connectionId: "source-to-target" },
      ],
    };
    expect(selectionExists(document, valid)).toBe(true);
    expect(selectionExists(document, {
      ...valid,
      items: [...valid.items, { kind: "node", levelId: "system", nodeId: "missing" }],
    })).toBe(false);
  });
});
