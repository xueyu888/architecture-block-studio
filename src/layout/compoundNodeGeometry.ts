import type { LayoutFlowNode } from "./types";
import { BLOCK_CONTAINER_GEOMETRY } from "./nodeGeometry";

interface RenderDimensions {
  width: number;
  height: number;
}

function numericStyle(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function layoutNodeRenderDimensions(node: LayoutFlowNode): RenderDimensions {
  const style = node.style && !Array.isArray(node.style) ? node.style : undefined;
  const width = node.measured?.width ?? node.width ?? numericStyle(style?.width);
  const height = node.measured?.height ?? node.height ?? numericStyle(style?.height);
  if (!(width && height)) throw new Error(`Layout geometry is unavailable for node ${node.id}.`);
  return { width, height };
}

/**
 * Projects east/south-only growth for expanded compound nodes.
 *
 * Live child position and size are the temporary input; committed layout is
 * the minimum parent frame. Processing deepest owners first lets one child
 * expansion propagate through every visible ancestor without changing any
 * child coordinate or writing document geometry.
 */
export function projectCompoundNodeGrowth<T extends LayoutFlowNode>(
  liveNodes: readonly T[],
  committedNodes: readonly T[],
): T[] {
  const committedById = new Map(committedNodes.map((node) => [node.id, node] as const));
  const projectedById = new Map(liveNodes.map((node) => [node.id, node] as const));
  const childIdsByParent = new Map<string, string[]>();
  liveNodes.forEach((node) => {
    if (!node.parentId) return;
    childIdsByParent.set(node.parentId, [...(childIdsByParent.get(node.parentId) ?? []), node.id]);
  });

  [...liveNodes]
    .filter((node) => node.data.expanded && childIdsByParent.has(node.id))
    .sort((left, right) => right.data.hierarchyDepth - left.data.hierarchyDepth || left.id.localeCompare(right.id))
    .forEach((sourceParent) => {
      const parent = projectedById.get(sourceParent.id)!;
      const baseline = committedById.get(parent.id) ?? parent;
      const baselineSize = layoutNodeRenderDimensions(baseline);
      const childFrames = (childIdsByParent.get(parent.id) ?? [])
        .map((id) => projectedById.get(id))
        .filter((node): node is T => Boolean(node));
      const contentRight = Math.max(0, ...childFrames.map((node) => {
        const size = layoutNodeRenderDimensions(node);
        return node.position.x + size.width;
      }));
      const contentBottom = Math.max(0, ...childFrames.map((node) => {
        const size = layoutNodeRenderDimensions(node);
        return node.position.y + size.height;
      }));
      const width = Math.max(
        baselineSize.width,
        contentRight + BLOCK_CONTAINER_GEOMETRY.horizontalPadding,
      );
      const height = Math.max(
        baselineSize.height,
        contentBottom + BLOCK_CONTAINER_GEOMETRY.bottomPadding,
      );
      if (width === layoutNodeRenderDimensions(parent).width && height === layoutNodeRenderDimensions(parent).height) {
        return;
      }
      projectedById.set(parent.id, {
        ...parent,
        width,
        height,
        measured: { ...parent.measured, width, height },
        style: { ...parent.style, width, height },
      });
    });

  return liveNodes.map((node) => projectedById.get(node.id) ?? node);
}
