import { describe, expect, test } from "vitest";
import {
  applyDesignOperation,
  createBlock,
  createDesignFragment,
  parseDesignFragment,
  serializeDesignFragment,
  type DesignFragment,
} from "../../src/editor";
import {
  DESIGN_FRAGMENT_PLACEMENT_GRID,
  designFragmentBounds,
  findBlockPlacementAtPoint,
  findDesignFragmentPlacement,
  findDesignFragmentPlacementAtPoint,
} from "../../src/studio/fragmentPlacement";
import {
  applyHistoryOperation,
  createDesignHistory,
  redoDesignHistory,
  undoDesignHistory,
} from "../../src/editor/designHistory";
import { serializeDesign } from "../../src/io/saveDesign";
import { fiveLevelRoutingDesignDocument } from "../fixtures/fiveLevelRoutingDesign";
import { routingStressDesignDocument } from "../fixtures/routingStressDesign";
import { connectedDesign, hierarchicalDesign } from "./designFixture";

const rootPositions = new Map([
  ["source", { x: 40, y: 80 }],
  ["target", { x: 440, y: 80 }],
]);

describe("self-contained design fragments", () => {
  test("copies only interfaces internal to the selected module subgraph", () => {
    const document = connectedDesign();

    const oneModule = createDesignFragment(
      document,
      "system",
      ["source"],
      new Map([["source", rootPositions.get("source")!]]),
    );
    const connectedModules = createDesignFragment(document, "system", ["source", "target"], rootPositions);

    expect(oneModule.nodes.map((node) => node.id)).toEqual(["source"]);
    expect(oneModule.connections).toEqual([]);
    expect(oneModule.interfaceDefinitions).toEqual({});
    expect(connectedModules.connections.map((connection) => connection.id)).toEqual(["source-to-target"]);
    expect(Object.keys(connectedModules.interfaceDefinitions)).toEqual(["source.output"]);
    expect(connectedModules.nodes.map((node) => node.layout)).toEqual([
      { pinned: true, position: { x: 40, y: 80 } },
      { pinned: true, position: { x: 440, y: 80 } },
    ]);
  });

  test("serializes a portable fragment and rejects missing or unused interface facts", () => {
    const fragment = createDesignFragment(connectedDesign(), "system", ["source", "target"], rootPositions);

    expect(parseDesignFragment(serializeDesignFragment(fragment))).toEqual(fragment);

    const missing = structuredClone(fragment) as DesignFragment;
    delete missing.interfaceDefinitions["source.output"];
    expect(() => parseDesignFragment(missing)).toThrow("Interface source.output is not included");

    const extra = structuredClone(fragment) as DesignFragment;
    extra.interfaceDefinitions.unused = structuredClone(fragment.interfaceDefinitions["source.output"]);
    expect(() => parseDesignFragment(extra)).toThrow("Interface unused is not used");

    const unplaced = structuredClone(fragment) as DesignFragment;
    delete unplaced.nodes[0].layout.position;
    expect(() => parseDesignFragment(unplaced)).toThrow("Root module source must include a finite diagram position");
  });

  test("inserts remapped modules, interfaces, routes, and deterministic offsets atomically", () => {
    const document = connectedDesign();
    document.levels[0].connections[0].routing = {
      waypoints: [{ x: 240, y: 112 }, { x: 320, y: 112 }],
    };
    const fragment = createDesignFragment(document, "system", ["source", "target"], rootPositions);
    const occupied = document.levels[0].nodes.map((node) => ({
      x: rootPositions.get(node.id)!.x,
      y: rootPositions.get(node.id)!.y,
      width: 242,
      height: 144,
    }));
    const firstOffset = findDesignFragmentPlacement(fragment, occupied, 1);

    const first = applyDesignOperation(document, {
      type: "fragment/insert",
      levelId: "system",
      fragment,
      offset: firstOffset,
    });
    const copiedAgain = createDesignFragment(
      first,
      "system",
      ["source-2", "target-2"],
      new Map(first.levels[0].nodes.slice(-2).map((node) => [node.id, node.layout.position!])),
    );
    const secondOffset = findDesignFragmentPlacement(copiedAgain, first.levels[0].nodes.map((node) => ({
      x: node.layout.position?.x ?? rootPositions.get(node.id.replace(/-2$/, ""))!.x,
      y: node.layout.position?.y ?? rootPositions.get(node.id.replace(/-2$/, ""))!.y,
      width: 242,
      height: 144,
    })), 2);
    const second = applyDesignOperation(first, {
      type: "fragment/insert",
      levelId: "system",
      fragment: copiedAgain,
      offset: secondOffset,
    });

    expect(first.levels[0].nodes.slice(-2).map((node) => [node.id, node.layout.position])).toEqual([
      ["source-2", { x: 40 + firstOffset.x, y: 80 + firstOffset.y }],
      ["target-2", { x: 440 + firstOffset.x, y: 80 + firstOffset.y }],
    ]);
    expect(first.levels[0].connections.at(-1)).toMatchObject({
      id: "source-to-target-2",
      interfaceId: "source.output-2",
      source: { nodeId: "source-2", portId: "out" },
      target: { nodeId: "target-2", portId: "in" },
      routing: {
        waypoints: [
          { x: 240 + firstOffset.x, y: 112 + firstOffset.y },
          { x: 320 + firstOffset.x, y: 112 + firstOffset.y },
        ],
      },
    });
    expect(Object.keys(first.interfaceDefinitions).sort()).toEqual(["source.output", "source.output-2"]);
    expect(second.levels[0].nodes.slice(-2).map((node) => [node.id, node.layout.position])).toEqual([
      ["source-3", { x: 40 + firstOffset.x + secondOffset.x, y: 80 + firstOffset.y + secondOffset.y }],
      ["target-3", { x: 440 + firstOffset.x + secondOffset.x, y: 80 + firstOffset.y + secondOffset.y }],
    ]);
    expect(firstOffset.x % DESIGN_FRAGMENT_PLACEMENT_GRID).toBe(0);
    expect(firstOffset.y % DESIGN_FRAGMENT_PLACEMENT_GRID).toBe(0);
    expect(firstOffset).not.toEqual({ x: DESIGN_FRAGMENT_PLACEMENT_GRID, y: 0 });
    expect(document.levels[0].nodes).toHaveLength(2);
  });

  test("anchors Paste Here at the snapped point and finds the nearest clear placement", () => {
    const fragment = createDesignFragment(connectedDesign(), "system", ["source", "target"], rootPositions);
    const bounds = designFragmentBounds(fragment);
    const point = { x: 1000, y: 700 };
    const exact = findDesignFragmentPlacementAtPoint(fragment, [], point);

    expect({ x: bounds.x + exact.x, y: bounds.y + exact.y }).toEqual({ x: 992, y: 704 });

    const occupied = [{
      x: bounds.x + exact.x,
      y: bounds.y + exact.y,
      width: bounds.width,
      height: bounds.height,
    }];
    const avoided = findDesignFragmentPlacementAtPoint(fragment, occupied, point);
    expect(avoided).not.toEqual(exact);
    expect(findDesignFragmentPlacementAtPoint(fragment, occupied, point)).toEqual(avoided);
    const avoidedBounds = {
      x: bounds.x + avoided.x,
      y: bounds.y + avoided.y,
      width: bounds.width,
      height: bounds.height,
    };
    expect(
      avoidedBounds.x + avoidedBounds.width + 24 <= occupied[0].x ||
      avoidedBounds.x >= occupied[0].x + occupied[0].width + 24 ||
      avoidedBounds.y + avoidedBounds.height + 24 <= occupied[0].y ||
      avoidedBounds.y >= occupied[0].y + occupied[0].height + 24
    ).toBe(true);
    expect(() => findDesignFragmentPlacementAtPoint(fragment, [], { x: Number.NaN, y: 0 }))
      .toThrow("finite coordinates");

    const denseBounds = [{ x: -10_000, y: -10_000, width: 20_000, height: 20_000 }];
    const outside = findDesignFragmentPlacementAtPoint(fragment, denseBounds, { x: 0, y: 0 });
    const outsideOrigin = { x: bounds.x + outside.x, y: bounds.y + outside.y };
    expect(
      outsideOrigin.x >= 10_000 + 24 ||
      outsideOrigin.x + bounds.width + 24 <= -10_000 ||
      outsideOrigin.y >= 10_000 + 24 ||
      outsideOrigin.y + bounds.height + 24 <= -10_000
    ).toBe(true);
  });

  test("centers a new module on the point and reuses deterministic collision clearance", () => {
    const block = createBlock({ id: "review", title: "Review Module" });
    const point = { x: 640, y: 480 };
    const exact = findBlockPlacementAtPoint(block, [], point);

    expect(exact).toEqual({ x: 512, y: 416 });
    const occupied = [{ x: exact.x, y: exact.y, width: 242, height: 144 }];
    const avoided = findBlockPlacementAtPoint(block, occupied, point);
    expect(avoided).not.toEqual(exact);
    expect(findBlockPlacementAtPoint(block, occupied, point)).toEqual(avoided);
    expect(() => findBlockPlacementAtPoint(block, [], { x: Number.POSITIVE_INFINITY, y: 0 }))
      .toThrow("finite coordinates");
  });

  test("duplicates an owned hierarchy as one self-contained level tree", () => {
    const document = hierarchicalDesign();
    const fragment = createDesignFragment(
      document,
      "system",
      ["parent"],
      new Map([["parent", { x: 100, y: 140 }]]),
    );

    const duplicated = applyDesignOperation(document, {
      type: "fragment/insert",
      levelId: "system",
      fragment,
      offset: { x: 320, y: 0 },
    });
    const parent = duplicated.levels[0].nodes.at(-1)!;
    const childLevel = duplicated.levels.find((level) => level.id === "parent-internal-2")!;

    expect(fragment.levels.map((level) => level.id)).toEqual(["parent-internal"]);
    expect(parent).toMatchObject({
      id: "parent-2",
      hierarchy: {
        childLevelId: "parent-internal-2",
        portBindings: [{
          parentPortId: "public",
          childEndpoint: { nodeId: "child", portId: "out" },
        }],
      },
    });
    expect(childLevel).toMatchObject({
      parentLevelId: "system",
      nodes: [{ id: "child" }],
    });
    expect(document.levels).toHaveLength(2);
  });

  test("does not mutate the document or history when a fragment is not self-contained", () => {
    const document = connectedDesign();
    const fragment = createDesignFragment(document, "system", ["source", "target"], rootPositions);
    const broken = structuredClone(fragment) as DesignFragment;
    broken.connections[0].target.nodeId = "outside";
    const before = serializeDesign(document);

    expect(() => applyDesignOperation(document, {
      type: "fragment/insert",
      levelId: "system",
      fragment: broken,
      offset: { x: 320, y: 0 },
    })).toThrow("outside system");
    expect(serializeDesign(document)).toBe(before);

    const history = createDesignHistory(document, true);
    expect(() => applyHistoryOperation(history, {
      type: "fragment/insert",
      levelId: "system",
      fragment: broken,
      offset: { x: 320, y: 0 },
    })).toThrow();
    expect(history.past).toEqual([]);
    expect(history.document).toBe(document);
  });

  test("records a whole subgraph insertion as one undoable operation", () => {
    const document = connectedDesign();
    const fragment = createDesignFragment(document, "system", ["source", "target"], rootPositions);
    const initial = createDesignHistory(document, true);
    const inserted = applyHistoryOperation(initial, {
      type: "fragment/insert",
      levelId: "system",
      fragment,
      offset: { x: 320, y: 0 },
    });
    const undone = undoDesignHistory(inserted)!;
    const redone = redoDesignHistory(undone)!;

    expect(inserted.past).toHaveLength(1);
    expect(inserted.document.levels[0].nodes).toHaveLength(4);
    expect(undone.document.levels[0].nodes).toHaveLength(2);
    expect(redone.document.levels[0].nodes).toHaveLength(4);
    expect(redone.document.levels[0].connections).toHaveLength(2);
  });

  test("prepares a five-level fragment before one undoable root deletion", () => {
    const document = fiveLevelRoutingDesignDocument();
    const before = serializeDesign(document);
    const fragment = createDesignFragment(
      document,
      "system",
      ["layer-1"],
      new Map([["layer-1", { x: 500, y: 0 }]]),
    );
    const initial = createDesignHistory(document, true);
    const cut = applyHistoryOperation(initial, {
      type: "objects/delete",
      targets: [{ kind: "node", levelId: "system", nodeId: "layer-1" }],
    });
    const restored = undoDesignHistory(cut)!;

    expect(fragment.levels).toHaveLength(5);
    expect(fragment.connections).toEqual([]);
    expect(cut.past).toHaveLength(1);
    expect(cut.document.levels.map((level) => level.id)).toEqual(["system"]);
    expect(cut.document.levels[0].nodes.some((node) => node.id === "layer-1")).toBe(false);
    expect(restored.document).toEqual(document);
    expect(serializeDesign(document)).toBe(before);
  });

  test("preserves every reference across five owned hierarchy layers", () => {
    const document = fiveLevelRoutingDesignDocument();
    const fragment = createDesignFragment(
      document,
      "system",
      ["layer-1"],
      new Map([["layer-1", { x: 500, y: 0 }]]),
    );
    const duplicated = applyDesignOperation(document, {
      type: "fragment/insert",
      levelId: "system",
      fragment,
      offset: { x: 1_024, y: 0 },
    });
    const insertedRoot = duplicated.levels[0].nodes.find((node) => node.id === "layer-1-2")!;
    const insertedLevels = duplicated.levels.filter((level) => /level-[1-5]-2/.test(level.id));

    expect(fragment.levels).toHaveLength(5);
    expect(insertedRoot.hierarchy?.childLevelId).toBe("level-1-2");
    expect(insertedLevels).toHaveLength(5);
    insertedLevels.forEach((level, index) => {
      expect(level.parentLevelId).toBe(index === 0 ? "system" : `level-${index}-2`);
      const childOwner = level.nodes.find((node) => node.hierarchy);
      if (index < 4) expect(childOwner?.hierarchy?.childLevelId).toBe(`level-${index + 2}-2`);
      level.connections.forEach((connection) => {
        expect(level.nodes.some((node) => node.id === connection.source.nodeId)).toBe(true);
        expect(level.nodes.some((node) => node.id === connection.target.nodeId)).toBe(true);
        expect(duplicated.interfaceDefinitions[connection.interfaceId]).toBeDefined();
      });
    });
  });

  test("duplicates a non-uniform 100-line hub without dropping any sparse leaf", () => {
    const document = routingStressDesignDocument();
    const level = document.levels[0];
    const positions = new Map(level.nodes.map((node) => [node.id, node.layout.position!]));
    const fragment = createDesignFragment(document, "system", level.nodes.map((node) => node.id), positions);
    const occupied = level.nodes.map((node) => ({
      ...node.layout.position!,
      width: node.layout.width!,
      height: node.layout.height!,
    }));
    const offset = findDesignFragmentPlacement(fragment, occupied, 1);
    const duplicated = applyDesignOperation(document, {
      type: "fragment/insert",
      levelId: "system",
      fragment,
      offset,
    });
    const insertedNodes = new Set(duplicated.levels[0].nodes.slice(level.nodes.length).map((node) => node.id));
    const insertedConnections = duplicated.levels[0].connections.slice(level.connections.length);

    expect(fragment.nodes).toHaveLength(101);
    expect(fragment.connections).toHaveLength(100);
    expect(insertedNodes.size).toBe(101);
    expect(insertedConnections).toHaveLength(100);
    insertedConnections.forEach((connection) => {
      expect(insertedNodes.has(connection.source.nodeId)).toBe(true);
      expect(insertedNodes.has(connection.target.nodeId)).toBe(true);
      expect(connection.interfaceId).toBe("stress.flow-2");
    });
  });
});
