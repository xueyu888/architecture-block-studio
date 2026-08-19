import { describe, expect, test } from "vitest";
import { validateBlockDesignDocument } from "../../src/model";
import { completeContracts, connectedDesign } from "./designFixture";

describe("design rule diagnostics", () => {
  test("returns one addressable success diagnostic for a complete design", () => {
    const issues = validateBlockDesignDocument(completeContracts(connectedDesign()));

    expect(issues).toEqual([{
      id: "BD-VALID:document",
      severity: "info",
      code: "BD-VALID",
      message: "Design validation completed without errors or warnings.",
      remediation: "No action is required.",
    }]);
  });

  test("keeps an issue id stable when an unrelated earlier diagnostic appears", () => {
    const document = connectedDesign();
    const baseline = validateBlockDesignDocument(document);
    const sourcePurpose = baseline.find((issue) =>
      issue.code === "BD-CONTRACT-PURPOSE-MISSING" && issue.nodeId === "source"
    );
    const changed = structuredClone(document);
    changed.levels[0].nodes.push(structuredClone(changed.levels[0].nodes[1]));

    const withDuplicate = validateBlockDesignDocument(changed);
    const sameSourcePurpose = withDuplicate.find((issue) =>
      issue.code === "BD-CONTRACT-PURPOSE-MISSING" && issue.nodeId === "source"
    );

    expect(sourcePurpose?.id).toBe("BD-CONTRACT-PURPOSE-MISSING:level=system|node=source|case=node:source");
    expect(sameSourcePurpose?.id).toBe(sourcePurpose?.id);
  });

  test("keeps endpoint roles unique and preserves cross-probe targets", () => {
    const document = completeContracts(connectedDesign());
    const connection = document.levels[0].connections[0];
    connection.source = { nodeId: "missing", portId: "out" };
    connection.target = { nodeId: "missing", portId: "in" };

    const issues = validateBlockDesignDocument(document);
    const missingEndpoints = issues.filter((issue) => issue.code === "BD-CONNECTION-NODE-MISSING");

    expect(missingEndpoints).toHaveLength(2);
    expect(new Set(missingEndpoints.map((issue) => issue.id)).size).toBe(2);
    expect(missingEndpoints.map((issue) => ({
      levelId: issue.levelId,
      nodeId: issue.nodeId,
      connectionId: issue.connectionId,
    }))).toEqual([
      { levelId: "system", nodeId: "missing", connectionId: "source-to-target" },
      { levelId: "system", nodeId: "missing", connectionId: "source-to-target" },
    ]);
    expect(missingEndpoints.map((issue) => issue.id)).toEqual([
      "BD-CONNECTION-NODE-MISSING:level=system|node=missing|connection=source-to-target|case=source",
      "BD-CONNECTION-NODE-MISSING:level=system|node=missing|connection=source-to-target|case=target",
    ]);
  });

  test("reports orphan levels without mutating the document", () => {
    const document = completeContracts(connectedDesign());
    document.levels.push({
      id: "orphan",
      title: "Orphan",
      description: "",
      nodes: [],
      connections: [],
      layout: { direction: "RIGHT", spacing: 64, layerSpacing: 110 },
    });
    const before = structuredClone(document);

    const issues = validateBlockDesignDocument(document);

    expect(issues).toContainEqual({
      id: "BD-LEVEL-ORPHAN:level=orphan",
      severity: "warning",
      code: "BD-LEVEL-ORPHAN",
      message: "Level orphan is not reachable from the entry level.",
      remediation: "Reference this level from a hierarchy rooted at the entry level, or remove the orphan level.",
      levelId: "orphan",
    });
    expect(document).toEqual(before);
  });
});
