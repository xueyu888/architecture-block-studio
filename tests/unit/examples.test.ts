import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { parseBlockDesignDocument, validateBlockDesignDocument } from "../../src/model";

async function loadExample(name: string) {
  const source = await readFile(new URL(`../../public/examples/${name}`, import.meta.url), "utf8");
  return parseBlockDesignDocument(JSON.parse(source));
}

describe("published design examples", () => {
  test.each([
    "aio-agent-runtime.block-design.json",
    "architecture-block-studio.block-design.json",
    "aio-context-management.block-design.json",
  ])("loads %s through the current schema without design-rule failures", async (name) => {
    const document = await loadExample(name);
    const diagnostics = validateBlockDesignDocument(document);

    expect(document.schemaVersion).toBe("2.3");
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== "info")).toEqual([]);
  });

  test("keeps every AIO Context interface unidirectional and removes ownership-only lines", async () => {
    const document = await loadExample("aio-context-management.block-design.json");
    const forbiddenInterfaces = [
      "context.configuration.receipt",
      "context.configuration.snapshot",
      "context.catalog.snapshot",
      "context.store.history",
      "context.store.receipt",
      "context.canonical.access",
      "context.region.membership",
      "context.prompt.build",
    ];

    expect(forbiddenInterfaces.filter((id) => document.interfaceDefinitions[id])).toEqual([]);
    document.levels.forEach((level) => {
      const ports = new Map(level.nodes.flatMap((node) =>
        node.ports.map((port) => [`${node.id}:${port.id}`, port] as const)
      ));
      level.nodes.forEach((node) => node.ports.forEach((port) => {
        expect(port.side).toBe(port.direction === "input" ? "left" : "right");
      }));
      level.connections.forEach((connection) => {
        expect(ports.get(`${connection.source.nodeId}:${connection.source.portId}`)?.direction).toBe("output");
        expect(ports.get(`${connection.target.nodeId}:${connection.target.portId}`)?.direction).toBe("input");
      });
    });

    const internalLevel = document.levels.find((level) => level.id === "context-manager-internals")!;
    expect(internalLevel.connections).toEqual([]);
    expect(internalLevel.nodes.find((node) => node.id === "canonical-context")?.ports).toEqual([]);
    expect(internalLevel.nodes.find((node) => node.id === "prompt")?.ports).toEqual([
      expect.objectContaining({ id: "prompt", direction: "output", side: "right" }),
    ]);
  });
});
