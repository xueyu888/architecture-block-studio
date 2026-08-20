import { describe, expect, test } from "vitest";
import {
  BLOCK_CONTAINER_GEOMETRY,
  layoutNodeRenderDimensions,
  projectCompoundNodeGrowth,
  type LayoutFlowNode,
} from "../../src/layout";

function node(
  id: string,
  parentId: string | undefined,
  depth: number,
  position: { x: number; y: number },
  size: { width: number; height: number },
  expanded: boolean,
): LayoutFlowNode {
  return {
    id,
    type: "block",
    parentId,
    position,
    width: size.width,
    height: size.height,
    style: size,
    data: {
      levelId: `level-${depth}`,
      expanded,
      hierarchyDepth: depth,
      designPosition: position,
      projectedPosition: position,
      positionEditable: true,
      block: {
        id,
        title: id,
        kind: "module",
        tone: "platform",
        owner: "Geometry",
        ports: [],
        inspector: {
          principle: "One frame.",
          purpose: "Test compound growth.",
          boundary: "Geometry only.",
          failure: "Reject invalid geometry.",
          code: "",
          codeLanguage: "text",
          attributes: {},
        },
      },
    },
  };
}

describe("compound node preview geometry", () => {
  test("propagates one deepest east/south change through five owners without moving any origin", () => {
    const committed = [
      node("owner-1", undefined, 0, { x: 40, y: 40 }, { width: 500, height: 420 }, true),
      node("owner-2", "owner-1", 1, { x: 72, y: 68 }, { width: 400, height: 320 }, true),
      node("owner-3", "owner-2", 2, { x: 72, y: 68 }, { width: 320, height: 260 }, true),
      node("owner-4", "owner-3", 3, { x: 72, y: 68 }, { width: 270, height: 220 }, true),
      node("owner-5", "owner-4", 4, { x: 72, y: 68 }, { width: 242, height: 190 }, true),
      node("leaf", "owner-5", 5, { x: 72, y: 68 }, { width: 120, height: 80 }, false),
    ];
    const live = committed.map((item) => item.id === "leaf"
      ? { ...item, position: { x: 310, y: 240 } }
      : item);

    const projected = projectCompoundNodeGrowth(live, committed);
    const byId = new Map(projected.map((item) => [item.id, item] as const));
    expect(layoutNodeRenderDimensions(byId.get("owner-5")!)).toEqual({
      width: 310 + 120 + BLOCK_CONTAINER_GEOMETRY.horizontalPadding,
      height: 240 + 80 + BLOCK_CONTAINER_GEOMETRY.bottomPadding,
    });
    for (const ownerId of ["owner-1", "owner-2", "owner-3", "owner-4", "owner-5"]) {
      const before = committed.find((item) => item.id === ownerId)!;
      const after = byId.get(ownerId)!;
      expect(after.position, `${ownerId} origin`).toEqual(before.position);
      expect(layoutNodeRenderDimensions(after).width, `${ownerId} width`)
        .toBeGreaterThanOrEqual(layoutNodeRenderDimensions(before).width);
      expect(layoutNodeRenderDimensions(after).height, `${ownerId} height`)
        .toBeGreaterThanOrEqual(layoutNodeRenderDimensions(before).height);
    }
    expect(byId.get("leaf")!.position).toEqual({ x: 310, y: 240 });
    expect(committed.find((item) => item.id === "owner-5")!.width).toBe(242);
  });

  test("returns to the committed minimum frame when the disposable child preview returns", () => {
    const committed = [
      node("owner", undefined, 0, { x: 0, y: 0 }, { width: 360, height: 260 }, true),
      node("leaf", "owner", 1, { x: 72, y: 68 }, { width: 180, height: 112 }, false),
    ];
    const enlarged = projectCompoundNodeGrowth([
      committed[0],
      { ...committed[1], position: { x: 420, y: 300 } },
    ], committed);
    expect(layoutNodeRenderDimensions(enlarged[0]).width).toBeGreaterThan(360);
    expect(projectCompoundNodeGrowth(committed, committed).map(layoutNodeRenderDimensions)).toEqual([
      { width: 360, height: 260 },
      { width: 180, height: 112 },
    ]);
  });
});
