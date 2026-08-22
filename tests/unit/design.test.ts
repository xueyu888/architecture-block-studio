import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import {
  applyDesignOperation,
  createBlankDesign,
  DesignEditError,
} from "../../src/editor/designEditor";
import { serializeDesign } from "../../src/io/saveDesign";
import {
  blockDesignSchemaCompatibility,
  parseBlockDesignDocument,
} from "../../src/model";
import { connectedDesign } from "./designFixture";

const legacyFixturePath = fileURLToPath(
  new URL("../fixtures/legacy-v2.0.block-design.json", import.meta.url),
);
const migratedFixturePath = fileURLToPath(
  new URL("../fixtures/migrated-v2.3.block-design.json", import.meta.url),
);
const v21FixturePath = fileURLToPath(
  new URL("../fixtures/migrated-v2.1.block-design.json", import.meta.url),
);

describe("BlockDesignDocument contract", () => {
  test("publishes the complete supported input compatibility matrix", () => {
    expect(blockDesignSchemaCompatibility).toEqual([
      { inputVersion: "2.0", outputVersion: "2.3", mode: "migrate" },
      { inputVersion: "2.1", outputVersion: "2.3", mode: "migrate" },
      { inputVersion: "2.2", outputVersion: "2.3", mode: "migrate" },
      { inputVersion: "2.3", outputVersion: "2.3", mode: "current" },
    ]);
    expect(Object.isFrozen(blockDesignSchemaCompatibility)).toBe(true);
    expect(blockDesignSchemaCompatibility.every(Object.isFrozen)).toBe(true);
  });

  test("migrates the 2.0 golden input through every step to the exact 2.3 golden output", async () => {
    const legacy = JSON.parse(await readFile(legacyFixturePath, "utf8"));
    const before = structuredClone(legacy);
    const expected = JSON.parse(await readFile(migratedFixturePath, "utf8"));

    const migrated = parseBlockDesignDocument(legacy);

    expect(migrated).toEqual(expected);
    expect(legacy).toEqual(before);
  });

  test("migrates a 2.1 document to the same exact 2.3 output", async () => {
    const v21 = JSON.parse(await readFile(v21FixturePath, "utf8"));
    const expected = JSON.parse(await readFile(migratedFixturePath, "utf8"));

    expect(parseBlockDesignDocument(v21)).toEqual(expected);
  });

  test("migrates 2.2 port placement from logical direction instead of preserving a contradictory side", async () => {
    const legacy = JSON.parse(await readFile(new URL("../fixtures/migrated-v2.2.block-design.json", import.meta.url), "utf8"));
    legacy.levels[0].nodes[0].ports[0].side = "left";
    legacy.levels[0].nodes[1].ports[0].side = "top";

    const migrated = parseBlockDesignDocument(legacy);

    expect(migrated.levels[0].nodes[0].ports[0]).toMatchObject({ direction: "output", side: "right" });
    expect(migrated.levels[0].nodes[1].ports[0]).toMatchObject({ direction: "input", side: "left" });
  });

  test("infers an unambiguous legacy bidirectional port from its connection role", async () => {
    const legacy = JSON.parse(await readFile(new URL("../fixtures/migrated-v2.2.block-design.json", import.meta.url), "utf8"));
    legacy.levels[0].nodes[0].ports[0].direction = "bidirectional";

    expect(parseBlockDesignDocument(legacy).levels[0].nodes[0].ports[0]).toMatchObject({
      direction: "output",
      side: "right",
    });
  });

  test("rejects an ambiguous legacy bidirectional port instead of inventing a call direction", async () => {
    const legacy = JSON.parse(await readFile(new URL("../fixtures/migrated-v2.2.block-design.json", import.meta.url), "utf8"));
    legacy.levels[0].connections = [];
    legacy.levels[0].nodes[0].ports[0].direction = "bidirectional";

    expect(() => parseBlockDesignDocument(legacy)).toThrow(
      "split it into one input port and one output port before migrating to 2.3",
    );
  });

  test.each(["1.0", "2.4", "3.0"])("rejects unsupported schema version %s at the version boundary", (schemaVersion) => {
    const document = { ...createBlankDesign("version-test", "Version Test"), schemaVersion };

    try {
      parseBlockDesignDocument(document);
      throw new Error("Expected an unsupported schema version to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toContainEqual(expect.objectContaining({
        path: ["schemaVersion"],
        message: `Unsupported BlockDesignDocument schemaVersion "${schemaVersion}". Supported versions: 2.0, 2.1, 2.2, 2.3.`,
      }));
    }
  });

  test("rejects a missing or non-string schema version", () => {
    expect(() => parseBlockDesignDocument({})).toThrow(ZodError);
    expect(() => parseBlockDesignDocument({ schemaVersion: 2.1 })).toThrow(ZodError);
  });

  test("rejects newer routing facts disguised as a 2.0 document instead of dropping them", async () => {
    const legacy = JSON.parse(await readFile(legacyFixturePath, "utf8"));
    legacy.levels[0].connections[0].routing = {
      waypoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    };

    expect(() => parseBlockDesignDocument(legacy)).toThrow(ZodError);
  });

  test("serializes the same document deterministically with a trailing newline", () => {
    const document = connectedDesign();

    expect(serializeDesign(document)).toBe(serializeDesign(structuredClone(document)));
    expect(serializeDesign(document)).toMatch(/^\{[\s\S]*\}\n$/);
  });
});

describe("connection route operations", () => {
  test("rounds and stores level-local waypoints", () => {
    const document = connectedDesign();

    const routed = applyDesignOperation(document, {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: { waypoints: [{ x: 20.4, y: 30.6 }, { x: 180.7, y: 30.6 }] },
    });

    expect(routed.levels[0].connections[0].routing?.waypoints).toEqual([
      { x: 20, y: 31 },
      { x: 181, y: 31 },
    ]);
    expect(document.levels[0].connections[0].routing).toBeUndefined();
  });

  test("clears a manual route without changing the connection", () => {
    const document = applyDesignOperation(connectedDesign(), {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: { waypoints: [{ x: 20, y: 30 }, { x: 180, y: 30 }] },
    });

    const automatic = applyDesignOperation(document, {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: undefined,
    });

    expect(automatic.levels[0].connections[0]).toEqual({
      id: "source-to-target",
      interfaceId: "source.output",
      source: { nodeId: "source", portId: "out" },
      target: { nodeId: "target", portId: "in" },
    });
  });

  test("fails atomically when the connection does not exist", () => {
    const document = connectedDesign();
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "connection/route",
      levelId: "system",
      connectionId: "missing",
      routing: { waypoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    })).toThrow(DesignEditError);
    expect(serializeDesign(document)).toBe(before);
  });

  test("rejects an invalid route through the document contract", () => {
    const document = connectedDesign();

    expect(() => applyDesignOperation(document, {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: { waypoints: [{ x: 10, y: 10 }] },
    })).toThrow(ZodError);
  });

  test("rejects diagonal waypoint segments from external JSON", () => {
    const document = connectedDesign();
    document.levels[0].connections[0].routing = {
      waypoints: [{ x: 10, y: 10 }, { x: 30, y: 40 }],
    };

    expect(() => parseBlockDesignDocument(document)).toThrow(
      "Consecutive route waypoints must share an x or y coordinate.",
    );
  });
});

describe("connection reconnect operations", () => {
  test("moves endpoints atomically and clears route geometry owned by the old endpoints", () => {
    const document = applyDesignOperation(connectedDesign(), {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: { waypoints: [{ x: 20, y: 30 }, { x: 180, y: 30 }] },
    });
    const target = document.levels[0].nodes.find((node) => node.id === "target")!;
    target.ports.push({
      id: "feedback",
      label: "feedback",
      side: "left",
      direction: "input",
      required: false,
      offset: 0.75,
    });

    const reconnected = applyDesignOperation(document, {
      type: "connection/reconnect",
      levelId: "system",
      connectionId: "source-to-target",
      source: { nodeId: "source", portId: "out" },
      target: { nodeId: "target", portId: "feedback" },
    });

    expect(reconnected.levels[0].connections[0]).toEqual({
      id: "source-to-target",
      interfaceId: "source.output",
      source: { nodeId: "source", portId: "out" },
      target: { nodeId: "target", portId: "feedback" },
    });
    expect(document.levels[0].connections[0].routing).toBeDefined();
  });

  test("preserves manual geometry when a reconnect resolves to the existing endpoints", () => {
    const document = applyDesignOperation(connectedDesign(), {
      type: "connection/route",
      levelId: "system",
      connectionId: "source-to-target",
      routing: { waypoints: [{ x: 20, y: 30 }, { x: 180, y: 30 }] },
    });

    const unchanged = applyDesignOperation(document, {
      type: "connection/reconnect",
      levelId: "system",
      connectionId: "source-to-target",
      source: { nodeId: "source", portId: "out" },
      target: { nodeId: "target", portId: "in" },
    });

    expect(unchanged.levels[0].connections[0]).toEqual(document.levels[0].connections[0]);
    expect(unchanged.levels[0].connections[0].routing).toBeDefined();
  });

  test("rejects invalid endpoint direction without mutating the source document", () => {
    const document = connectedDesign();
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "connection/reconnect",
      levelId: "system",
      connectionId: "source-to-target",
      source: { nodeId: "target", portId: "in" },
      target: { nodeId: "source", portId: "out" },
    })).toThrow("input-only and cannot start");
    expect(serializeDesign(document)).toBe(before);
  });
});
