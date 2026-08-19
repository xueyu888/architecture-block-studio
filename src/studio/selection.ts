import type {
  BlockDesignDocument,
  BlockNode,
  DesignIssue,
  DesignLevel,
} from "../model";

export type SelectionRef =
  | { kind: "document" }
  | { kind: "level"; levelId: string }
  | { kind: "node"; levelId: string; nodeId: string }
  | { kind: "port"; levelId: string; nodeId: string; portId: string }
  | { kind: "connection"; levelId: string; connectionId: string };

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
  if (left.kind !== right.kind) return false;
  if (left.kind === "document" && right.kind === "document") return true;
  if (left.kind === "level" && right.kind === "level") return left.levelId === right.levelId;
  if (left.kind === "node" && right.kind === "node") {
    return left.levelId === right.levelId && left.nodeId === right.nodeId;
  }
  if (left.kind === "port" && right.kind === "port") {
    return left.levelId === right.levelId && left.nodeId === right.nodeId && left.portId === right.portId;
  }
  return left.kind === "connection" && right.kind === "connection" &&
    left.levelId === right.levelId && left.connectionId === right.connectionId;
}

export function levelForSelection(document: BlockDesignDocument, selection: SelectionRef): DesignLevel {
  if (selection.kind !== "document") {
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
  if (selection.kind === "level") return `level:${selection.levelId}`;
  if (selection.kind === "node") return `node:${selection.levelId}:${selection.nodeId}`;
  if (selection.kind === "port") {
    return `port:${selection.levelId}:${selection.nodeId}:${selection.portId}`;
  }
  return `connection:${selection.levelId}:${selection.connectionId}`;
}
