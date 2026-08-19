import type {
  BlockDesignDocument,
  BlockNode,
  DesignIssue,
  DesignLevel,
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

export function hierarchyLevelPath(document: BlockDesignDocument, levelId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = document.levels.find((level) => level.id === levelId);
  while (current && current.id !== document.entryLevelId && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentLevelId
      ? document.levels.find((level) => level.id === current?.parentLevelId)
      : undefined;
  }
  return path;
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
