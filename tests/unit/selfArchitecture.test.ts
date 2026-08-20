import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseBlockDesignDocument,
  validateBlockDesignDocument,
  type BlockDesignDocument,
} from "../../src/model";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const examplePath = resolve(
  repositoryRoot,
  "public/examples/architecture-block-studio.block-design.json",
);

function loadSelfArchitecture(): BlockDesignDocument {
  return parseBlockDesignDocument(JSON.parse(readFileSync(examplePath, "utf8")));
}

function hierarchyDepth(document: BlockDesignDocument): number {
  const levels = new Map(document.levels.map((level) => [level.id, level] as const));
  const visit = (levelId: string, ancestry: ReadonlySet<string>): number => {
    if (ancestry.has(levelId)) throw new Error(`Hierarchy cycle at ${levelId}.`);
    const level = levels.get(levelId);
    if (!level) throw new Error(`Missing hierarchy level ${levelId}.`);
    const nextAncestry = new Set(ancestry).add(levelId);
    const childDepths = level.nodes.flatMap((node) =>
      node.hierarchy ? [visit(node.hierarchy.childLevelId, nextAncestry)] : []
    );
    return 1 + Math.max(0, ...childDepths);
  };
  return visit(document.entryLevelId, new Set());
}

describe("generated Architecture Block Studio source architecture", () => {
  it("matches every currently resolved cross-module source dependency", () => {
    expect(() => execFileSync(
      process.execPath,
      ["scripts/generate-self-architecture.mjs", "--check"],
      { cwd: repositoryRoot, stdio: "pipe" },
    )).not.toThrow();
  });

  it("is a valid five-depth design with complete module and connection evidence", () => {
    const document = loadSelfArchitecture();
    expect(validateBlockDesignDocument(document)).toEqual([
      expect.objectContaining({ severity: "info", code: "BD-VALID" }),
    ]);
    expect(hierarchyDepth(document)).toBe(5);

    const moduleNodes = document.levels.flatMap((level) => level.nodes)
      .filter((node) => node.inspector.attributes.architectureRole === "source-module");
    expect(moduleNodes).toHaveLength(12);
    expect(new Set(moduleNodes.map((node) =>
      node.inspector.attributes.architectureModuleId
    )).size).toBe(12);
    expect(moduleNodes.reduce((count, node) =>
      count + Number(node.inspector.attributes.sourceFileCount), 0
    )).toBe(84);

    const connections = document.levels.flatMap((level) => level.connections);
    expect(connections).toHaveLength(27);
    expect(new Set(connections.map(({ id }) => id)).size).toBe(27);
    connections.forEach((connection) => {
      expect(connection.label).toMatch(/ · \d+ import declarations?$/);
      expect(document.interfaceDefinitions[connection.interfaceId]?.attributes.evidence)
        .toBe("TypeScript/CSS resolved relative import");
    });
  });
});
