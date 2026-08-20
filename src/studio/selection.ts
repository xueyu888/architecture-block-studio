import {
  listDirectConnections,
  type BlockConnection,
  type BlockDesignDocument,
  type BlockNode,
  type DesignIssue,
  type DesignLevel,
  type DirectConnectionDirection,
} from "../model";

export type DiagramSelectionRef =
  | { kind: "node"; levelId: string; nodeId: string }
  | { kind: "connection"; levelId: string; connectionId: string };

export type SelectionRef =
  | { kind: "document" }
  | { kind: "level"; levelId: string }
  | DiagramSelectionRef
  | { kind: "port"; levelId: string; nodeId: string; portId: string }
  | { kind: "multiple"; items: readonly DiagramSelectionRef[] };

export function diagramSelectionKey(selection: DiagramSelectionRef): string {
  return selection.kind === "node"
    ? `node:${selection.levelId}:${selection.nodeId}`
    : `connection:${selection.levelId}:${selection.connectionId}`;
}

function canonicalDiagramItems(items: readonly DiagramSelectionRef[]): DiagramSelectionRef[] {
  const unique = new Map(items.map((item) => [diagramSelectionKey(item), item]));
  return [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, item]) => item);
}

export function diagramSelectionItems(selection: SelectionRef): readonly DiagramSelectionRef[] {
  if (selection.kind === "node" || selection.kind === "connection") return [selection];
  return selection.kind === "multiple" ? selection.items : [];
}

export function replaceDiagramSelection(
  items: readonly DiagramSelectionRef[],
  fallbackLevelId: string,
): SelectionRef {
  const canonical = canonicalDiagramItems(items);
  if (canonical.length === 0) return { kind: "level", levelId: fallbackLevelId };
  if (canonical.length === 1) return canonical[0];
  return { kind: "multiple", items: canonical };
}

export function selectAllInLevel(level: DesignLevel): SelectionRef {
  return replaceDiagramSelection([
    ...level.nodes.map((node) => ({
      kind: "node" as const,
      levelId: level.id,
      nodeId: node.id,
    })),
    ...level.connections.map((connection) => ({
      kind: "connection" as const,
      levelId: level.id,
      connectionId: connection.id,
    })),
  ], level.id);
}

export function selectDiagramKindInLevel(
  level: DesignLevel,
  kind: DiagramSelectionRef["kind"],
): SelectionRef {
  return replaceDiagramSelection(
    kind === "node"
      ? level.nodes.map((node) => ({ kind, levelId: level.id, nodeId: node.id }))
      : level.connections.map((connection) => ({
        kind,
        levelId: level.id,
        connectionId: connection.id,
      })),
    level.id,
  );
}

export type DirectInterfaceSelectionExpansion =
  | {
    available: true;
    selection: SelectionRef;
    selectedNodeCount: number;
    directInterfaceCount: number;
    addedInterfaceCount: number;
  }
  | {
    available: false;
    reason: "no-modules" | "no-direct-interfaces" | "all-direct-interfaces-selected";
    selectedNodeCount: number;
    directInterfaceCount: number;
    addedInterfaceCount: 0;
  };

interface DirectSelectionContext {
  selectedItems: readonly DiagramSelectionRef[];
  selectedNodeCount: number;
  directInterfaces: readonly DiagramSelectionRef[];
  neighborhoodNodes: readonly DiagramSelectionRef[];
}

function directSelectionContext(
  document: BlockDesignDocument,
  selection: SelectionRef,
  direction: DirectConnectionDirection,
): DirectSelectionContext {
  const selectedItems = diagramSelectionItems(selection);
  const existingNodeIdsByLevel = new Map(
    document.levels.map((level) => [level.id, new Set(level.nodes.map((node) => node.id))]),
  );
  const nodeIdsByLevel = new Map<string, Set<string>>();
  selectedItems.forEach((item) => {
    if (item.kind !== "node") return;
    if (!existingNodeIdsByLevel.get(item.levelId)?.has(item.nodeId)) return;
    const nodeIds = nodeIdsByLevel.get(item.levelId) ?? new Set<string>();
    nodeIds.add(item.nodeId);
    nodeIdsByLevel.set(item.levelId, nodeIds);
  });

  const directInterfaces: DiagramSelectionRef[] = [];
  const neighborhoodNodes: DiagramSelectionRef[] = [];
  document.levels.forEach((level) => {
    const selectedNodeIds = nodeIdsByLevel.get(level.id);
    if (!selectedNodeIds) return;
    const neighborNodeIds = new Set<string>();
    listDirectConnections(level, selectedNodeIds, direction).forEach((connection) => {
      directInterfaces.push({
        kind: "connection",
        levelId: level.id,
        connectionId: connection.id,
      });
      neighborNodeIds.add(connection.source.nodeId);
      neighborNodeIds.add(connection.target.nodeId);
    });
    level.nodes.forEach((node) => {
      if (neighborNodeIds.has(node.id)) {
        neighborhoodNodes.push({ kind: "node", levelId: level.id, nodeId: node.id });
      }
    });
  });

  return {
    selectedItems,
    selectedNodeCount: [...nodeIdsByLevel.values()]
      .reduce((count, nodeIds) => count + nodeIds.size, 0),
    directInterfaces,
    neighborhoodNodes,
  };
}

/**
 * Expands selected modules to their incident interfaces without changing the
 * design document. Adjacency comes from the model graph; this layer only owns
 * canonical workspace selection composition across one or more levels.
 */
export function directInterfaceSelectionExpansion(
  document: BlockDesignDocument,
  selection: SelectionRef,
  direction: DirectConnectionDirection = "both",
): DirectInterfaceSelectionExpansion {
  const context = directSelectionContext(document, selection, direction);
  const { selectedItems, selectedNodeCount, directInterfaces } = context;
  if (selectedNodeCount === 0) {
    return {
      available: false,
      reason: "no-modules",
      selectedNodeCount: 0,
      directInterfaceCount: 0,
      addedInterfaceCount: 0,
    };
  }

  if (directInterfaces.length === 0) {
    return {
      available: false,
      reason: "no-direct-interfaces",
      selectedNodeCount,
      directInterfaceCount: 0,
      addedInterfaceCount: 0,
    };
  }

  const selectedKeys = new Set(selectedItems.map(diagramSelectionKey));
  const addedInterfaceCount = directInterfaces.filter(
    (item) => !selectedKeys.has(diagramSelectionKey(item)),
  ).length;
  if (addedInterfaceCount === 0) {
    return {
      available: false,
      reason: "all-direct-interfaces-selected",
      selectedNodeCount,
      directInterfaceCount: directInterfaces.length,
      addedInterfaceCount: 0,
    };
  }

  return {
    available: true,
    selection: replaceDiagramSelection(
      [...selectedItems, ...directInterfaces],
      document.entryLevelId,
    ),
    selectedNodeCount,
    directInterfaceCount: directInterfaces.length,
    addedInterfaceCount,
  };
}

export type DirectNeighborhoodSelectionExpansion =
  | {
    available: true;
    selection: SelectionRef;
    selectedNodeCount: number;
    neighborhoodNodeCount: number;
    directInterfaceCount: number;
    addedNodeCount: number;
    addedInterfaceCount: number;
  }
  | {
    available: false;
    reason: "no-modules" | "no-direct-interfaces" | "all-direct-neighborhood-selected";
    selectedNodeCount: number;
    neighborhoodNodeCount: number;
    directInterfaceCount: number;
    addedNodeCount: 0;
    addedInterfaceCount: 0;
  };

/**
 * Expands selected modules to the local subgraph formed by every incident
 * interface and both of its existing endpoint modules. Unrelated selected
 * objects are preserved; the design and viewport remain outside this owner.
 */
export function directNeighborhoodSelectionExpansion(
  document: BlockDesignDocument,
  selection: SelectionRef,
  direction: DirectConnectionDirection = "both",
): DirectNeighborhoodSelectionExpansion {
  const context = directSelectionContext(document, selection, direction);
  const {
    selectedItems,
    selectedNodeCount,
    directInterfaces,
    neighborhoodNodes,
  } = context;
  if (selectedNodeCount === 0) {
    return {
      available: false,
      reason: "no-modules",
      selectedNodeCount: 0,
      neighborhoodNodeCount: 0,
      directInterfaceCount: 0,
      addedNodeCount: 0,
      addedInterfaceCount: 0,
    };
  }
  if (directInterfaces.length === 0) {
    return {
      available: false,
      reason: "no-direct-interfaces",
      selectedNodeCount,
      neighborhoodNodeCount: 0,
      directInterfaceCount: 0,
      addedNodeCount: 0,
      addedInterfaceCount: 0,
    };
  }

  const selectedKeys = new Set(selectedItems.map(diagramSelectionKey));
  const addedNodeCount = neighborhoodNodes.filter(
    (item) => !selectedKeys.has(diagramSelectionKey(item)),
  ).length;
  const addedInterfaceCount = directInterfaces.filter(
    (item) => !selectedKeys.has(diagramSelectionKey(item)),
  ).length;
  if (addedNodeCount === 0 && addedInterfaceCount === 0) {
    return {
      available: false,
      reason: "all-direct-neighborhood-selected",
      selectedNodeCount,
      neighborhoodNodeCount: neighborhoodNodes.length,
      directInterfaceCount: directInterfaces.length,
      addedNodeCount: 0,
      addedInterfaceCount: 0,
    };
  }

  return {
    available: true,
    selection: replaceDiagramSelection(
      [...selectedItems, ...neighborhoodNodes, ...directInterfaces],
      document.entryLevelId,
    ),
    selectedNodeCount,
    neighborhoodNodeCount: neighborhoodNodes.length,
    directInterfaceCount: directInterfaces.length,
    addedNodeCount,
    addedInterfaceCount,
  };
}

export function toggleDiagramSelection(
  selection: SelectionRef,
  items: readonly DiagramSelectionRef[],
  fallbackLevelId: string,
): SelectionRef {
  const toggled = new Map(
    diagramSelectionItems(selection).map((item) => [diagramSelectionKey(item), item]),
  );
  canonicalDiagramItems(items).forEach((item) => {
    const key = diagramSelectionKey(item);
    if (toggled.has(key)) toggled.delete(key);
    else toggled.set(key, item);
  });
  return replaceDiagramSelection([...toggled.values()], fallbackLevelId);
}

export function selectionContains(selection: SelectionRef, item: DiagramSelectionRef): boolean {
  const key = diagramSelectionKey(item);
  return diagramSelectionItems(selection).some((candidate) => diagramSelectionKey(candidate) === key);
}

export function selectionForIssue(issue: DesignIssue): SelectionRef {
  if (issue.levelId && issue.connectionId) {
    return { kind: "connection", levelId: issue.levelId, connectionId: issue.connectionId };
  }
  if (issue.levelId && issue.nodeId && issue.portId) {
    return { kind: "port", levelId: issue.levelId, nodeId: issue.nodeId, portId: issue.portId };
  }
  if (issue.levelId && issue.nodeId) {
    return { kind: "node", levelId: issue.levelId, nodeId: issue.nodeId };
  }
  if (issue.levelId) return { kind: "level", levelId: issue.levelId };
  return { kind: "document" };
}

export function hierarchyLevelTrail(
  document: BlockDesignDocument,
  levelId: string,
): DesignLevel[] {
  const path: DesignLevel[] = [];
  const seen = new Set<string>();
  let current = document.levels.find((level) => level.id === levelId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    if (current.id === document.entryLevelId) return path;
    current = current.parentLevelId
      ? document.levels.find((level) => level.id === current?.parentLevelId)
      : undefined;
  }
  return [];
}

export function hierarchyLevelPath(document: BlockDesignDocument, levelId: string): string[] {
  return hierarchyLevelTrail(document, levelId).slice(1).map((level) => level.id);
}

export function hierarchyLevelIsWithin(
  document: BlockDesignDocument,
  ancestorLevelId: string,
  levelId: string,
): boolean {
  return hierarchyLevelTrail(document, levelId)
    .some((level) => level.id === ancestorLevelId);
}

export function hierarchyParentSelection(
  document: BlockDesignDocument,
  levelId: string,
): SelectionRef | undefined {
  const trail = hierarchyLevelTrail(document, levelId);
  const parent = trail.at(-2);
  if (!parent) return undefined;
  const owners = parent.nodes.filter((node) => node.hierarchy?.childLevelId === levelId);
  return owners.length === 1
    ? { kind: "node", levelId: parent.id, nodeId: owners[0].id }
    : { kind: "level", levelId: parent.id };
}

export function selectionExists(document: BlockDesignDocument, selection: SelectionRef): boolean {
  if (selection.kind === "document") return true;
  if (selection.kind === "multiple") {
    return selection.items.length >= 2 && selection.items.every((item) => selectionExists(document, item));
  }
  const level = document.levels.find((candidate) => candidate.id === selection.levelId);
  if (!level) return false;
  if (selection.kind === "level") return true;
  if (selection.kind === "connection") {
    return level.connections.some((candidate) => candidate.id === selection.connectionId);
  }
  const node = level.nodes.find((candidate) => candidate.id === selection.nodeId);
  if (!node) return false;
  return selection.kind === "node" || node.ports.some((candidate) => candidate.id === selection.portId);
}

export function sameSelection(left: SelectionRef, right: SelectionRef): boolean {
  return selectionKey(left) === selectionKey(right);
}

export function levelForSelection(document: BlockDesignDocument, selection: SelectionRef): DesignLevel {
  if (selection.kind === "multiple") {
    const first = selection.items[0];
    const selectedLevel = first && document.levels.find((level) => level.id === first.levelId);
    if (selectedLevel) return selectedLevel;
  }
  if (selection.kind !== "document" && selection.kind !== "multiple") {
    const selectedLevel = document.levels.find((level) => level.id === selection.levelId);
    if (selectedLevel) return selectedLevel;
  }
  return document.levels.find((level) => level.id === document.entryLevelId)!;
}

export function nodeForSelection(
  document: BlockDesignDocument,
  selection: SelectionRef,
): { level: DesignLevel; node: BlockNode } | undefined {
  if (selection.kind !== "node" && selection.kind !== "port") return undefined;
  const level = document.levels.find((candidate) => candidate.id === selection.levelId);
  const node = level?.nodes.find((candidate) => candidate.id === selection.nodeId);
  return level && node ? { level, node } : undefined;
}

export function connectionForSelection(
  document: BlockDesignDocument,
  selection: SelectionRef,
): { level: DesignLevel; connection: BlockConnection } | undefined {
  if (selection.kind !== "connection") return undefined;
  const level = document.levels.find((candidate) => candidate.id === selection.levelId);
  const connection = level?.connections.find(
    (candidate) => candidate.id === selection.connectionId,
  );
  return level && connection ? { level, connection } : undefined;
}

export function selectionKey(selection: SelectionRef): string {
  if (selection.kind === "document") return "document";
  if (selection.kind === "multiple") {
    return `multiple:${canonicalDiagramItems(selection.items).map(diagramSelectionKey).join("|")}`;
  }
  if (selection.kind === "level") return `level:${selection.levelId}`;
  if (selection.kind === "node") return `node:${selection.levelId}:${selection.nodeId}`;
  if (selection.kind === "port") {
    return `port:${selection.levelId}:${selection.nodeId}:${selection.portId}`;
  }
  return `connection:${selection.levelId}:${selection.connectionId}`;
}
