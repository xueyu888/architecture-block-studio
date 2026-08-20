import type { LayoutFlowEdge, LayoutFlowNode, LayoutResult } from "./types";

const projectionSignatures = new WeakMap<object, string>();

function projectionSignature(value: object): string {
  const cached = projectionSignatures.get(value);
  if (cached !== undefined) return cached;
  const signature = JSON.stringify(value);
  projectionSignatures.set(value, signature);
  return signature;
}

function reconcileItems<T extends LayoutFlowNode | LayoutFlowEdge>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item] as const));
  let unchanged = previous.length === next.length;
  const reconciled = next.map((item, index) => {
    const candidate = previousById.get(item.id);
    const resolved = candidate && projectionSignature(candidate) === projectionSignature(item)
      ? candidate
      : item;
    if (resolved !== previous[index]) unchanged = false;
    return resolved;
  });
  return unchanged ? previous as T[] : reconciled;
}

/**
 * Restores structural sharing after a pure document-to-layout projection.
 *
 * Layout remains a disposable derivative. Reusing an object is legal only
 * when its complete serialized projection is unchanged; changed geometry or
 * presentation data always keeps the newly computed object. This lets React
 * Flow observe the actual change set instead of treating a two-node edit as a
 * replacement of the entire scene.
 */
export function reconcileLayoutResult(
  previous: LayoutResult,
  next: LayoutResult,
): LayoutResult {
  const nodes = reconcileItems(previous.nodes, next.nodes);
  const edges = reconcileItems(previous.edges, next.edges);
  return nodes === previous.nodes && edges === previous.edges
    ? previous
    : { nodes, edges };
}
