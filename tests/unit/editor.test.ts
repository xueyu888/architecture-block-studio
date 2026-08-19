import { describe, expect, test } from "vitest";
import {
  applyDesignOperation,
  createBlankDesign,
  createBlock,
  createDesignLevel,
  createInterfaceDefinition,
  createPort,
  DesignEditError,
} from "../../src/editor/designEditor";
import { serializeDesign } from "../../src/io/saveDesign";
import { connectedDesign, hierarchicalDesign } from "./designFixture";

describe("public design operations", () => {
  test("updates document and level facts without mutating the source", () => {
    const document = createBlankDesign("operation-test", "Operation Test");
    const updatedDocument = applyDesignOperation(document, {
      type: "document/update",
      values: { title: "  Reviewed Design  ", summary: "  Stable boundaries  " },
    });
    const updatedLevel = applyDesignOperation(updatedDocument, {
      type: "level/update",
      levelId: "system",
      values: {
        title: "  Runtime  ",
        description: "  Runtime responsibilities  ",
        layout: { direction: "DOWN", spacing: 72, layerSpacing: 128 },
      },
    });

    expect(document.title).toBe("Operation Test");
    expect(updatedDocument.title).toBe("Reviewed Design");
    expect(updatedDocument.summary).toBe("Stable boundaries");
    expect(updatedLevel.levels[0]).toMatchObject({
      title: "Runtime",
      description: "Runtime responsibilities",
      layout: { direction: "DOWN", spacing: 72, layerSpacing: 128 },
    });
  });

  test("adds, updates, and pins a moved module", () => {
    const document = createBlankDesign("node-operations", "Node Operations");
    const worker = createBlock({ id: "worker", title: "Worker", owner: "Runtime" });
    const added = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: worker,
    });
    const updated = applyDesignOperation(added, {
      type: "node/update",
      levelId: "system",
      nodeId: "worker",
      values: {
        title: "  Worker Core  ",
        kind: "service",
        tone: "core",
        process: "worker-process",
        summary: "Own queued work.",
        owner: "Core Runtime",
        inspector: { ...worker.inspector, purpose: "Execute accepted work." },
      },
    });
    const moved = applyDesignOperation(updated, {
      type: "node/move",
      levelId: "system",
      nodeId: "worker",
      position: { x: 144, y: 288 },
    });

    expect(document.levels[0].nodes).toEqual([]);
    expect(updated.levels[0].nodes[0]).toMatchObject({
      title: "Worker Core",
      owner: "Core Runtime",
      inspector: { purpose: "Execute accepted work." },
    });
    expect(moved.levels[0].nodes[0].layout).toEqual({
      pinned: true,
      position: { x: 144, y: 288 },
    });
  });

  test("adds and updates a port while preserving its identity", () => {
    let document = createBlankDesign("port-operations", "Port Operations");
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "api", title: "API" }),
    });
    const added = applyDesignOperation(document, {
      type: "port/add",
      levelId: "system",
      nodeId: "api",
      port: createPort({
        id: "requests",
        label: "Requests",
        side: "left",
        direction: "input",
        required: true,
      }),
    });
    const updated = applyDesignOperation(added, {
      type: "port/update",
      levelId: "system",
      nodeId: "api",
      portId: "requests",
      values: {
        label: "Commands",
        side: "right",
        direction: "output",
        dataType: "Command",
        required: false,
        order: 3,
      },
    });

    expect(document.levels[0].nodes[0].ports).toEqual([]);
    expect(updated.levels[0].nodes[0].ports[0]).toEqual({
      id: "requests",
      label: "Commands",
      side: "right",
      direction: "output",
      dataType: "Command",
      required: false,
      order: 3,
    });
  });

  test("replaces and removes a hierarchy binding by parent port", () => {
    let document = hierarchicalDesign();
    document = applyDesignOperation(document, {
      type: "port/add",
      levelId: "parent-internal",
      nodeId: "child",
      port: createPort({
        id: "alternate",
        label: "Alternate",
        side: "right",
        direction: "output",
        required: false,
      }),
    });
    const rebound = applyDesignOperation(document, {
      type: "hierarchy/bind",
      levelId: "system",
      nodeId: "parent",
      binding: {
        parentPortId: "public",
        childEndpoint: { nodeId: "child", portId: "alternate" },
      },
    });
    const unbound = applyDesignOperation(rebound, {
      type: "hierarchy/unbind",
      levelId: "system",
      nodeId: "parent",
      parentPortId: "public",
    });

    expect(rebound.levels[0].nodes[0].hierarchy?.portBindings).toEqual([{
      parentPortId: "public",
      childEndpoint: { nodeId: "child", portId: "alternate" },
    }]);
    expect(unbound.levels[0].nodes[0].hierarchy?.portBindings).toEqual([]);
  });

  test("updates a connection label and its shared contract atomically", () => {
    const document = connectedDesign();
    const definition = {
      ...document.interfaceDefinitions["source.output"],
      title: "Reviewed Source Output",
      owner: "Architecture Review",
    };
    const updated = applyDesignOperation(document, {
      type: "connection/update",
      levelId: "system",
      connectionId: "source-to-target",
      values: { label: "  reviewed transfer  " },
      definition,
    });

    expect(document.levels[0].connections[0].label).toBeUndefined();
    expect(updated.levels[0].connections[0].label).toBe("reviewed transfer");
    expect(updated.interfaceDefinitions["source.output"]).toEqual(definition);
  });
});

describe("operation invariants", () => {
  test("rejects a child design with the wrong declared parent atomically", () => {
    let document = createBlankDesign("hierarchy-atomic", "Hierarchy Atomic");
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "parent", title: "Parent" }),
    });
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "hierarchy/add",
      levelId: "system",
      nodeId: "parent",
      childLevel: createDesignLevel("parent-internal", "Parent Internal", "other"),
    })).toThrow("must declare parent system");
    expect(serializeDesign(document)).toBe(before);
  });

  test("rejects an input-only connection source without installing its interface", () => {
    let document = createBlankDesign("connection-atomic", "Connection Atomic");
    const source = createBlock({ id: "source", title: "Source" });
    source.ports.push(createPort({
      id: "in",
      label: "Input",
      side: "left",
      direction: "input",
      required: false,
    }));
    const target = createBlock({ id: "target", title: "Target" });
    target.ports.push(createPort({
      id: "in",
      label: "Input",
      side: "left",
      direction: "input",
      required: false,
    }));
    document = applyDesignOperation(document, { type: "node/add", levelId: "system", node: source });
    document = applyDesignOperation(document, { type: "node/add", levelId: "system", node: target });
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "connection/add",
      levelId: "system",
      connection: {
        id: "invalid-direction",
        interfaceId: "invalid.direction",
        source: { nodeId: "source", portId: "in" },
        target: { nodeId: "target", portId: "in" },
      },
      definition: createInterfaceDefinition({
        id: "invalid.direction",
        title: "Invalid Direction",
        kind: "dto",
        owner: "Test",
      }),
    })).toThrow("input-only");
    expect(serializeDesign(document)).toBe(before);
  });
});

describe("reference cleanup", () => {
  test("deleting a module removes attached connections and unused interfaces", () => {
    const document = connectedDesign();

    const next = applyDesignOperation(document, {
      type: "node/delete",
      levelId: "system",
      nodeId: "source",
    });

    expect(next.levels[0].nodes.map((node) => node.id)).toEqual(["target"]);
    expect(next.levels[0].connections).toEqual([]);
    expect(next.interfaceDefinitions).toEqual({});
  });

  test("deleting one connection keeps a definition referenced by another", () => {
    const document = connectedDesign();
    document.levels[0].connections.push({
      ...structuredClone(document.levels[0].connections[0]),
      id: "source-to-target-second",
    });

    const oneRemaining = applyDesignOperation(document, {
      type: "connection/delete",
      levelId: "system",
      connectionId: "source-to-target",
    });

    expect(oneRemaining.levels[0].connections.map((connection) => connection.id)).toEqual([
      "source-to-target-second",
    ]);
    expect(oneRemaining.interfaceDefinitions["source.output"]).toBeDefined();

    const noneRemaining = applyDesignOperation(oneRemaining, {
      type: "connection/delete",
      levelId: "system",
      connectionId: "source-to-target-second",
    });
    expect(noneRemaining.interfaceDefinitions["source.output"]).toBeUndefined();
  });

  test("deleting a child port removes the parent hierarchy binding", () => {
    const document = hierarchicalDesign();

    const next = applyDesignOperation(document, {
      type: "port/delete",
      levelId: "parent-internal",
      nodeId: "child",
      portId: "out",
    });

    expect(next.levels[0].nodes[0].hierarchy?.portBindings).toEqual([]);
    expect(next.levels[1].nodes[0].ports).toEqual([]);
  });

  test("deleting a hierarchy owner removes its exclusively referenced level tree", () => {
    const document = hierarchicalDesign();

    const next = applyDesignOperation(document, {
      type: "node/delete",
      levelId: "system",
      nodeId: "parent",
    });

    expect(next.levels.map((level) => level.id)).toEqual(["system"]);
    expect(next.levels[0].nodes).toEqual([]);
  });

  test("deleting one hierarchy owner preserves a child level referenced elsewhere", () => {
    let document = hierarchicalDesign();
    const secondParent = createBlock({ id: "second-parent", title: "Second Parent" });
    secondParent.ports.push(createPort({
      id: "public",
      label: "Public",
      side: "right",
      direction: "output",
      required: false,
    }));
    secondParent.hierarchy = {
      childLevelId: "parent-internal",
      portBindings: [{
        parentPortId: "public",
        childEndpoint: { nodeId: "child", portId: "out" },
      }],
    };
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: secondParent,
    });

    const next = applyDesignOperation(document, {
      type: "node/delete",
      levelId: "system",
      nodeId: "parent",
    });

    expect(next.levels.map((level) => level.id)).toEqual(["system", "parent-internal"]);
    expect(next.levels[0].nodes[0].id).toBe("second-parent");
  });
});

describe("atomic editing failures", () => {
  test("keeps the source document untouched when deletion cannot resolve its target", () => {
    const document = hierarchicalDesign();
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "node/delete",
      levelId: "system",
      nodeId: "missing",
    })).toThrow(DesignEditError);
    expect(serializeDesign(document)).toBe(before);
  });
});
