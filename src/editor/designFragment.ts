import { z } from "zod";
import {
  connectionSchema,
  interfaceDefinitionSchema,
  levelSchema,
  nodeSchema,
  type BlockConnection,
  type BlockDesignDocument,
  type BlockNode,
  type DesignLevel,
  type InterfaceDefinition,
} from "../model";
import { uniqueId } from "./identifiers";

export const DESIGN_FRAGMENT_KIND = "architecture-block-studio/design-fragment" as const;
export const DESIGN_FRAGMENT_VERSION = 1 as const;

const designFragmentSchema = z.object({
  kind: z.literal(DESIGN_FRAGMENT_KIND),
  version: z.literal(DESIGN_FRAGMENT_VERSION),
  source: z.object({
    documentId: z.string().min(1),
    levelId: z.string().min(1),
  }),
  nodes: z.array(nodeSchema).min(1),
  connections: z.array(connectionSchema),
  levels: z.array(levelSchema),
  interfaceDefinitions: z.record(interfaceDefinitionSchema),
});

export type DesignFragment = z.infer<typeof designFragmentSchema>;

export interface DesignFragmentInsert {
  levelId: string;
  fragment: DesignFragment;
  offset: { x: number; y: number };
}

export class DesignFragmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignFragmentError";
  }
}

function fragmentError(message: string): never {
  throw new DesignFragmentError(message);
}

function requireUniqueIds(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) fragmentError(`${label} ${value} is duplicated and cannot be copied safely.`);
    seen.add(value);
  });
}

function uniqueFragmentId(id: string, reserved: ReadonlySet<string>): string {
  const numbered = /^(.*)-(\d+)$/.exec(id);
  const base = numbered && reserved.has(numbered[1]) ? numbered[1] : id;
  return uniqueId(base, reserved);
}

function validateLevelReferences(
  levelLabel: string,
  nodes: readonly BlockNode[],
  connections: readonly BlockConnection[],
  interfaceIds: ReadonlySet<string>,
): void {
  requireUniqueIds(nodes.map((node) => node.id), `Module in ${levelLabel}`);
  requireUniqueIds(connections.map((connection) => connection.id), `Connection in ${levelLabel}`);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => requireUniqueIds(node.ports.map((port) => port.id), `Port on ${node.id}`));
  connections.forEach((connection) => {
    const sourceNode = nodeById.get(connection.source.nodeId) ?? fragmentError(
      `Connection ${connection.id} references module ${connection.source.nodeId} outside ${levelLabel}.`,
    );
    const targetNode = nodeById.get(connection.target.nodeId) ?? fragmentError(
      `Connection ${connection.id} references module ${connection.target.nodeId} outside ${levelLabel}.`,
    );
    if (!sourceNode.ports.some((port) => port.id === connection.source.portId)) {
      fragmentError(`Connection ${connection.id} references missing port ${sourceNode.id}.${connection.source.portId}.`);
    }
    if (!targetNode.ports.some((port) => port.id === connection.target.portId)) {
      fragmentError(`Connection ${connection.id} references missing port ${targetNode.id}.${connection.target.portId}.`);
    }
    if (!interfaceIds.has(connection.interfaceId)) {
      fragmentError(`Interface ${connection.interfaceId} is not included in the fragment.`);
    }
  });
}

function validateFragmentReferences(fragment: DesignFragment): Set<string> {
  requireUniqueIds(fragment.levels.map((level) => level.id), "Child design");
  if (fragment.levels.some((level) => level.id === fragment.source.levelId)) {
    fragmentError(`Child designs cannot reuse source level id ${fragment.source.levelId}.`);
  }
  const levelById = new Map(fragment.levels.map((level) => [level.id, level]));
  const interfaceIds = new Set(Object.keys(fragment.interfaceDefinitions));
  const usedInterfaceIds = new Set<string>();
  fragment.nodes.forEach((node) => {
    const position = node.layout.position;
    if (!position || ![position.x, position.y].every(Number.isFinite)) {
      fragmentError(`Root module ${node.id} must include a finite diagram position.`);
    }
  });
  validateLevelReferences(fragment.source.levelId, fragment.nodes, fragment.connections, interfaceIds);
  fragment.connections.forEach((connection) => usedInterfaceIds.add(connection.interfaceId));
  fragment.levels.forEach((level) => {
    validateLevelReferences(level.id, level.nodes, level.connections, interfaceIds);
    level.connections.forEach((connection) => usedInterfaceIds.add(connection.interfaceId));
  });

  const visitedLevels = new Set<string>();
  const pending = fragment.nodes.flatMap((node) =>
    node.hierarchy ? [{ ownerLevelId: fragment.source.levelId, node }] : []
  );
  while (pending.length > 0) {
    const { ownerLevelId, node } = pending.shift()!;
    const hierarchy = node.hierarchy!;
    const childLevel = levelById.get(hierarchy.childLevelId) ?? fragmentError(
      `Child design ${hierarchy.childLevelId} is not included in the fragment.`,
    );
    if (childLevel.parentLevelId !== ownerLevelId) {
      fragmentError(`Child design ${childLevel.id} must declare parent ${ownerLevelId}.`);
    }
    const parentPortIds = new Set(node.ports.map((port) => port.id));
    const childNodes = new Map(childLevel.nodes.map((childNode) => [childNode.id, childNode]));
    requireUniqueIds(
      hierarchy.portBindings.map((binding) => binding.parentPortId),
      `Hierarchy binding on ${node.id}`,
    );
    hierarchy.portBindings.forEach((binding) => {
      if (!parentPortIds.has(binding.parentPortId)) {
        fragmentError(`Hierarchy binding references missing port ${node.id}.${binding.parentPortId}.`);
      }
      const childNode = childNodes.get(binding.childEndpoint.nodeId) ?? fragmentError(
        `Hierarchy binding references missing module ${binding.childEndpoint.nodeId} in ${childLevel.id}.`,
      );
      if (!childNode.ports.some((port) => port.id === binding.childEndpoint.portId)) {
        fragmentError(
          `Hierarchy binding references missing port ${childNode.id}.${binding.childEndpoint.portId} in ${childLevel.id}.`,
        );
      }
    });
    if (visitedLevels.has(childLevel.id)) continue;
    visitedLevels.add(childLevel.id);
    childLevel.nodes.forEach((childNode) => {
      if (childNode.hierarchy) pending.push({ ownerLevelId: childLevel.id, node: childNode });
    });
  }
  const orphan = fragment.levels.find((level) => !visitedLevels.has(level.id));
  if (orphan) fragmentError(`Child design ${orphan.id} is not reachable from the copied modules.`);

  const unusedInterface = [...interfaceIds].find((interfaceId) => !usedInterfaceIds.has(interfaceId));
  if (unusedInterface) fragmentError(`Interface ${unusedInterface} is not used by the fragment.`);
  return usedInterfaceIds;
}

function descendantLevels(
  document: BlockDesignDocument,
  rootNodes: readonly BlockNode[],
): DesignLevel[] {
  const levels = new Map(document.levels.map((level) => [level.id, level]));
  const result: DesignLevel[] = [];
  const pending = rootNodes.flatMap((node) => node.hierarchy ? [node.hierarchy.childLevelId] : []);
  const seen = new Set<string>();
  while (pending.length > 0) {
    const levelId = pending.shift()!;
    if (seen.has(levelId)) continue;
    seen.add(levelId);
    const level = levels.get(levelId) ?? fragmentError(
      `Child design ${levelId} is missing, so the selected hierarchy is not self-contained.`,
    );
    result.push(level);
    level.nodes.forEach((node) => {
      if (node.hierarchy) pending.push(node.hierarchy.childLevelId);
    });
  }
  return result;
}

function referencedDefinitions(
  document: BlockDesignDocument,
  connections: readonly BlockConnection[],
): Record<string, InterfaceDefinition> {
  const result: Record<string, InterfaceDefinition> = {};
  connections.forEach((connection) => {
    const definition = document.interfaceDefinitions[connection.interfaceId] ?? fragmentError(
      `Interface ${connection.interfaceId} is missing, so its connection cannot be copied safely.`,
    );
    result[connection.interfaceId] = structuredClone(definition);
  });
  return result;
}

export function createDesignFragment(
  document: BlockDesignDocument,
  levelId: string,
  nodeIds: readonly string[],
  positions: ReadonlyMap<string, { x: number; y: number }> = new Map(),
): DesignFragment {
  if (nodeIds.length === 0) fragmentError("Select at least one module to copy.");
  requireUniqueIds(nodeIds, "Selected module");
  const level = document.levels.find((candidate) => candidate.id === levelId) ?? fragmentError(
    `Level ${levelId} does not exist.`,
  );
  const selectedIds = new Set(nodeIds);
  const nodes = nodeIds.map((nodeId) => {
    const source = level.nodes.find((node) => node.id === nodeId) ?? fragmentError(
      `Module ${nodeId} does not exist in ${level.title}.`,
    );
    const node = structuredClone(source);
    const position = positions.get(nodeId) ?? node.layout.position;
    if (!position) fragmentError(`Module ${node.title} has no resolved diagram position yet.`);
    node.layout = {
      ...node.layout,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      pinned: true,
    };
    return node;
  });
  const connections = level.connections
    .filter((connection) => selectedIds.has(connection.source.nodeId) && selectedIds.has(connection.target.nodeId))
    .map((connection) => structuredClone(connection));
  const levels = descendantLevels(document, nodes).map((childLevel) => structuredClone(childLevel));
  requireUniqueIds(levels.map((childLevel) => childLevel.id), "Child design");
  const descendantConnections = levels.flatMap((childLevel) => childLevel.connections);

  const fragment = designFragmentSchema.parse({
    kind: DESIGN_FRAGMENT_KIND,
    version: DESIGN_FRAGMENT_VERSION,
    source: { documentId: document.id, levelId },
    nodes,
    connections,
    levels,
    interfaceDefinitions: referencedDefinitions(document, [...connections, ...descendantConnections]),
  });
  validateFragmentReferences(fragment);
  return fragment;
}

export function serializeDesignFragment(fragment: DesignFragment): string {
  return JSON.stringify(designFragmentSchema.parse(fragment), null, 2);
}

export function parseDesignFragment(value: string | unknown): DesignFragment {
  try {
    const fragment = designFragmentSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
    validateFragmentReferences(fragment);
    return fragment;
  } catch (error) {
    if (error instanceof SyntaxError) fragmentError("The clipboard does not contain valid JSON.");
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      fragmentError(`The clipboard is not a compatible design fragment${first ? `: ${first.message}` : "."}`);
    }
    throw error;
  }
}

function remapHierarchy(
  node: BlockNode,
  levelIds: ReadonlyMap<string, string>,
): BlockNode {
  if (!node.hierarchy) return node;
  const childLevelId = levelIds.get(node.hierarchy.childLevelId) ?? fragmentError(
    `Child design ${node.hierarchy.childLevelId} is not included in the fragment.`,
  );
  return {
    ...node,
    hierarchy: { ...node.hierarchy, childLevelId },
  };
}

function remapConnection(
  connection: BlockConnection,
  nodeIds: ReadonlyMap<string, string>,
  interfaceIds: ReadonlyMap<string, string>,
  connectionId: string,
  offset: { x: number; y: number },
): BlockConnection {
  const sourceNodeId = nodeIds.get(connection.source.nodeId) ?? fragmentError(
    `Connection ${connection.id} references module ${connection.source.nodeId} outside the fragment.`,
  );
  const targetNodeId = nodeIds.get(connection.target.nodeId) ?? fragmentError(
    `Connection ${connection.id} references module ${connection.target.nodeId} outside the fragment.`,
  );
  const interfaceId = interfaceIds.get(connection.interfaceId) ?? fragmentError(
    `Interface ${connection.interfaceId} is not included in the fragment.`,
  );
  return {
    ...connection,
    id: connectionId,
    interfaceId,
    source: { ...connection.source, nodeId: sourceNodeId },
    target: { ...connection.target, nodeId: targetNodeId },
    routing: connection.routing
      ? {
          waypoints: connection.routing.waypoints.map((point) => ({
            x: point.x + offset.x,
            y: point.y + offset.y,
          })),
        }
      : undefined,
  };
}

export function insertDesignFragment(
  document: BlockDesignDocument,
  request: DesignFragmentInsert,
): void {
  const fragment = designFragmentSchema.parse(request.fragment);
  validateFragmentReferences(fragment);
  if (![request.offset.x, request.offset.y].every(Number.isFinite)) {
    fragmentError("Fragment insertion offset must contain finite coordinates.");
  }
  const targetLevel = document.levels.find((level) => level.id === request.levelId) ?? fragmentError(
    `Level ${request.levelId} does not exist.`,
  );
  const reservedLevelIds = new Set(document.levels.map((level) => level.id));
  const levelIds = new Map<string, string>();
  fragment.levels.forEach((level) => {
    const nextId = uniqueFragmentId(level.id, reservedLevelIds);
    reservedLevelIds.add(nextId);
    levelIds.set(level.id, nextId);
  });

  const reservedInterfaceIds = new Set(Object.keys(document.interfaceDefinitions));
  const interfaceIds = new Map<string, string>();
  Object.keys(fragment.interfaceDefinitions).sort().forEach((interfaceId) => {
    const nextId = uniqueFragmentId(interfaceId, reservedInterfaceIds);
    reservedInterfaceIds.add(nextId);
    interfaceIds.set(interfaceId, nextId);
    document.interfaceDefinitions[nextId] = structuredClone(fragment.interfaceDefinitions[interfaceId]);
  });

  const reservedRootNodeIds = new Set(targetLevel.nodes.map((node) => node.id));
  const rootNodeIds = new Map<string, string>();
  fragment.nodes.forEach((node) => {
    const nextId = uniqueFragmentId(node.id, reservedRootNodeIds);
    reservedRootNodeIds.add(nextId);
    rootNodeIds.set(node.id, nextId);
  });
  const insertedNodes = fragment.nodes.map((source) => {
    const node = remapHierarchy(structuredClone(source), levelIds);
    return {
      ...node,
      id: rootNodeIds.get(source.id)!,
      layout: {
        ...node.layout,
        position: {
          x: Math.round(node.layout.position!.x + request.offset.x),
          y: Math.round(node.layout.position!.y + request.offset.y),
        },
        pinned: true,
      },
    };
  });

  const reservedRootConnectionIds = new Set(targetLevel.connections.map((connection) => connection.id));
  const insertedConnections = fragment.connections.map((connection) => {
    const connectionId = uniqueFragmentId(connection.id, reservedRootConnectionIds);
    reservedRootConnectionIds.add(connectionId);
    return remapConnection(connection, rootNodeIds, interfaceIds, connectionId, request.offset);
  });

  const insertedLevels = fragment.levels.map((sourceLevel) => {
    const nodeIds = new Map(sourceLevel.nodes.map((node) => [node.id, node.id]));
    const connectionIds = new Set<string>();
    const parentLevelId = sourceLevel.parentLevelId === fragment.source.levelId
      ? targetLevel.id
      : levelIds.get(sourceLevel.parentLevelId ?? "") ?? fragmentError(
          `Parent design ${sourceLevel.parentLevelId ?? "(missing)"} is not included in the fragment.`,
        );
    return {
      ...structuredClone(sourceLevel),
      id: levelIds.get(sourceLevel.id)!,
      parentLevelId,
      nodes: sourceLevel.nodes.map((node) => remapHierarchy(structuredClone(node), levelIds)),
      connections: sourceLevel.connections.map((connection) => {
        const connectionId = uniqueId(connection.id, connectionIds);
        connectionIds.add(connectionId);
        return remapConnection(connection, nodeIds, interfaceIds, connectionId, { x: 0, y: 0 });
      }),
    };
  });

  targetLevel.nodes.push(...insertedNodes);
  targetLevel.connections.push(...insertedConnections);
  document.levels.push(...insertedLevels);
}
