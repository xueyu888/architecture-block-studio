import { describe, expect, it } from "vitest";
import {
  applyDesignOperation,
  createBlankDesign,
  createBlock,
  createDesignLevel,
} from "../../src/editor";
import {
  authoredProjectionGap,
  layoutBlockDesign,
  levelMovementLimits,
  nodeResizeStartLimits,
} from "../../src/layout";
import { fiveLevelRoutingDesignDocument } from "../fixtures/fiveLevelRoutingDesign";
import { hierarchicalDesign } from "./designFixture";

describe("hierarchy view root projection", () => {
  it("publishes the expanded child Level origin and visible drop surface", async () => {
    const layout = await layoutBlockDesign(hierarchicalDesign(), {
      expandedLevelIds: new Set(["parent-internal"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const owner = layout.nodes.find((node) => node.id === "system::parent");

    expect(owner?.data.childLevelProjection).toEqual({
      levelId: "parent-internal",
      title: "Parent Internal",
      hierarchyDepth: 1,
      designOrigin: { x: 72, y: 68 },
      coordinateOrigin: { x: 0, y: 0 },
      dropBounds: { x: 2, y: 32, width: 382, height: 232 },
    });
  });

  it("gives an expanded empty child Level a complete default-module drop surface", async () => {
    let document = createBlankDesign("empty-child", "Empty Child");
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "boundary", title: "Empty Boundary" }),
    });
    document = applyDesignOperation(document, {
      type: "hierarchy/add",
      levelId: "system",
      nodeId: "boundary",
      childLevel: createDesignLevel("empty-level", "Empty Level", "system"),
    });

    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(["empty-level"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const owner = layout.nodes.find((node) => node.id === "system::boundary");

    expect(owner).toMatchObject({ width: 386, height: 266 });
    expect(owner?.data.childLevelProjection).toEqual({
      levelId: "empty-level",
      title: "Empty Level",
      hierarchyDepth: 1,
      designOrigin: { x: 72, y: 68 },
      coordinateOrigin: { x: 0, y: 0 },
      dropBounds: { x: 2, y: 32, width: 382, height: 232 },
    });
  });

  it("keeps one authored coordinate system through five expanded hierarchy layers", async () => {
    const document = fiveLevelRoutingDesignDocument();
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(["level-1", "level-2", "level-3", "level-4", "level-5"]),
      placementMode: "authored",
      rootLevelId: "system",
    });

    for (const level of document.levels) {
      for (const node of level.nodes) {
        const projections = layout.nodes.filter((candidate) =>
          candidate.data.levelId === level.id && candidate.data.block.id === node.id
        );
        expect(projections, `${level.id}/${node.id}`).toHaveLength(1);
        expect(projections[0].data.designPosition, `${level.id}/${node.id}`).toEqual(
          node.layout.position,
        );
        expect(projections[0].data.positionEditable, `${level.id}/${node.id}`).toBe(true);
      }
    }
  });

  it("does not let expansion override a newly authored position in an ancestor Level", async () => {
    const source = fiveLevelRoutingDesignDocument();
    const requestedPosition = { x: 10_000, y: 224 };
    const document = applyDesignOperation(source, {
      type: "node/add",
      levelId: "level-2",
      node: createBlock({
        id: "review-gate",
        title: "Review Gate",
        position: requestedPosition,
      }),
    });
    const layout = await layoutBlockDesign(document, {
      expandedLevelIds: new Set(["level-1", "level-2", "level-3", "level-4", "level-5"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const projection = layout.nodes.find((candidate) =>
      candidate.data.levelId === "level-2" && candidate.data.block.id === "review-gate"
    );
    const owner = layout.nodes.find((candidate) =>
      candidate.data.childLevelProjection?.levelId === "level-2"
    );
    const designOrigin = owner?.data.childLevelProjection?.designOrigin;

    expect(projection?.data.designPosition).toEqual(requestedPosition);
    expect(designOrigin).toBeDefined();
    expect(projection?.position).toEqual({
      x: requestedPosition.x + designOrigin!.x,
      y: requestedPosition.y + designOrigin!.y,
    });
    expect(projection?.data.positionEditable).toBe(true);
  });

  it("encloses negative authored geometry without changing document coordinates", async () => {
    let beforeDocument = hierarchicalDesign();
    beforeDocument = applyDesignOperation(beforeDocument, {
      type: "node/move",
      levelId: "parent-internal",
      nodeId: "child",
      position: { x: 160, y: 96 },
    });
    const before = await layoutBlockDesign(beforeDocument, {
      expandedLevelIds: new Set(["parent-internal"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const beforeOwner = before.nodes.find((node) => node.data.block.id === "parent");
    const beforeChild = before.nodes.find((node) => node.data.block.id === "child");

    const afterDocument = applyDesignOperation(beforeDocument, {
      type: "node/add",
      levelId: "parent-internal",
      node: createBlock({
        id: "negative-review",
        title: "Negative Review",
        position: { x: -64, y: -32 },
      }),
    });
    const after = await layoutBlockDesign(afterDocument, {
      expandedLevelIds: new Set(["parent-internal"]),
      placementMode: "authored",
      rootLevelId: "system",
    });
    const afterOwner = after.nodes.find((node) => node.data.block.id === "parent");
    const afterChild = after.nodes.find((node) => node.data.block.id === "child");
    const afterNegative = after.nodes.find((node) => node.data.block.id === "negative-review");

    const absoluteOrigin = (owner: NonNullable<typeof beforeOwner>) => ({
      x: owner.position.x + owner.data.childLevelProjection!.designOrigin.x,
      y: owner.position.y + owner.data.childLevelProjection!.designOrigin.y,
    });
    const absoluteChild = (
      owner: NonNullable<typeof beforeOwner>,
      child: NonNullable<typeof beforeChild>,
    ) => ({ x: owner.position.x + child.position.x, y: owner.position.y + child.position.y });

    expect(absoluteOrigin(beforeOwner!)).toEqual({ x: 72, y: 68 });
    expect(absoluteOrigin(afterOwner!)).toEqual({ x: 72, y: 68 });
    expect(absoluteChild(beforeOwner!, beforeChild!)).toEqual({ x: 232, y: 164 });
    expect(absoluteChild(afterOwner!, afterChild!)).toEqual({ x: 232, y: 164 });
    expect(afterNegative?.data.designPosition).toEqual({ x: -64, y: -32 });
    expect(absoluteChild(afterOwner!, afterNegative!)).toEqual({ x: 8, y: 36 });
    expect(afterOwner?.data.designPosition).toEqual(beforeOwner?.data.designPosition);
    expect(afterOwner?.position).toEqual({ x: -64, y: -32 });

    const negativeLimits = levelMovementLimits(after.nodes, new Set([afterNegative!.id]));
    expect(negativeLimits).toEqual({
      minimum: { x: 0, y: 0 },
      maximum: { x: 0, y: 0 },
    });
    expect(nodeResizeStartLimits(afterNegative!, after.nodes, new Set([afterNegative!.id]))).toEqual({
      minimum: { x: 72, y: 68 },
      maximum: { x: 72, y: 68 },
    });
  });

  it("projects expanded authored siblings without overlap and keeps later inserts append-stable", async () => {
    let document = hierarchicalDesign();
    document = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "sibling", title: "Sibling", position: { x: 100, y: 0 } }),
    });
    const options = {
      expandedLevelIds: new Set(["parent-internal"]),
      placementMode: "authored" as const,
      rootLevelId: "system",
    };
    const before = await layoutBlockDesign(document, options);
    const beforeParent = before.nodes.find((node) => node.data.block.id === "parent")!;
    const beforeSibling = before.nodes.find((node) => node.data.block.id === "sibling")!;
    const gap = authoredProjectionGap(document.levels[0], options.expandedLevelIds);
    const separated =
      beforeParent.data.projectedPosition.x + beforeParent.width! + gap <= beforeSibling.data.projectedPosition.x ||
      beforeSibling.data.projectedPosition.x + beforeSibling.width! + gap <= beforeParent.data.projectedPosition.x ||
      beforeParent.data.projectedPosition.y + beforeParent.height! + gap <= beforeSibling.data.projectedPosition.y ||
      beforeSibling.data.projectedPosition.y + beforeSibling.height! + gap <= beforeParent.data.projectedPosition.y;
    expect(separated).toBe(true);
    expect(beforeSibling.data.projectedPosition).not.toEqual(beforeSibling.data.designPosition);

    const appendedPosition = { x: 2_000, y: 0 };
    const appended = applyDesignOperation(document, {
      type: "node/add",
      levelId: "system",
      node: createBlock({ id: "appended", title: "Appended", position: appendedPosition }),
    });
    const after = await layoutBlockDesign(appended, options);
    const afterParent = after.nodes.find((node) => node.data.block.id === "parent")!;
    const afterSibling = after.nodes.find((node) => node.data.block.id === "sibling")!;
    const afterAppended = after.nodes.find((node) => node.data.block.id === "appended")!;

    expect(afterParent.data.projectedPosition).toEqual(beforeParent.data.projectedPosition);
    expect(afterSibling.data.projectedPosition).toEqual(beforeSibling.data.projectedPosition);
    expect(afterAppended.data.designPosition).toEqual(appendedPosition);
    expect(afterAppended.data.projectedPosition).toEqual(appendedPosition);
  });

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
