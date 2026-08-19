import {
  BLOCK_DESIGN_SCHEMA_VERSION,
  parseBlockDesignDocument,
  type BlockConnection,
  type BlockDesignDocument,
  type BlockNode,
  type BlockPort,
  type ConnectionEndpoint,
  type DesignLevel,
  type HierarchyPortBinding,
  type InspectorDefinition,
  type InterfaceDefinition,
  type InterfaceKind,
  type PortDirection,
  type PortSide,
} from "../model";
import { insertDesignFragment, type DesignFragment } from "./designFragment";
import { isAuthorId } from "./identifiers";
export { suggestId, uniqueId } from "./identifiers";

export class DesignEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignEditError";
  }
}

export interface BlockDraft {
  id: string;
  title: string;
  owner?: string;
}

export interface PortDraft {
  id: string;
  label: string;
  side: PortSide;
  direction: PortDirection;
  dataType?: string;
  required: boolean;
}

export interface InterfaceDraft {
  id: string;
  title: string;
  kind: InterfaceKind;
  owner: string;
}

export interface NodeMove {
  levelId: string;
  nodeId: string;
  position: { x: number; y: number };
}

export type DesignOperation =
  | {
      type: "document/update";
      values: Pick<BlockDesignDocument, "title" | "summary">;
    }
  | {
      type: "level/update";
      levelId: string;
      values: Pick<DesignLevel, "title" | "description" | "layout">;
    }
  | { type: "node/add"; levelId: string; node: BlockNode }
  | {
      type: "node/update";
      levelId: string;
      nodeId: string;
      values: Pick<BlockNode, "title" | "kind" | "tone" | "process" | "summary" | "owner" | "inspector">;
    }
  | { type: "node/move"; levelId: string; nodeId: string; position: { x: number; y: number } }
  | { type: "nodes/move"; moves: readonly NodeMove[] }
  | { type: "fragment/insert"; levelId: string; fragment: DesignFragment; offset: { x: number; y: number } }
  | {
      type: "node/resize";
      levelId: string;
      nodeId: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }
  | { type: "node/delete"; levelId: string; nodeId: string }
  | { type: "port/add"; levelId: string; nodeId: string; port: BlockPort }
  | {
      type: "port/update";
      levelId: string;
      nodeId: string;
      portId: string;
      values: Omit<BlockPort, "id">;
    }
  | { type: "port/delete"; levelId: string; nodeId: string; portId: string }
  | { type: "hierarchy/add"; levelId: string; nodeId: string; childLevel: DesignLevel }
  | {
      type: "hierarchy/bind";
      levelId: string;
      nodeId: string;
      binding: HierarchyPortBinding;
    }
  | { type: "hierarchy/unbind"; levelId: string; nodeId: string; parentPortId: string }
  | {
      type: "connection/add";
      levelId: string;
      connection: BlockConnection;
      definition: InterfaceDefinition;
    }
  | {
      type: "connection/update";
      levelId: string;
      connectionId: string;
      values: Pick<BlockConnection, "label">;
      definition: InterfaceDefinition;
    }
  | {
      type: "connection/route";
      levelId: string;
      connectionId: string;
      routing: BlockConnection["routing"];
    }
  | {
      type: "connection/reconnect";
      levelId: string;
      connectionId: string;
      source: ConnectionEndpoint;
      target: ConnectionEndpoint;
    }
  | { type: "connection/delete"; levelId: string; connectionId: string };

function editError(message: string): never {
  throw new DesignEditError(message);
}

function requireAuthorId(id: string, label: string): void {
  if (!isAuthorId(id)) {
    editError(`${label} must start with a letter or number and contain only letters, numbers, dot, dash, or underscore.`);
  }
}

function requireLevel(document: BlockDesignDocument, levelId: string): DesignLevel {
  return document.levels.find((level) => level.id === levelId) ?? editError(`Level ${levelId} does not exist.`);
}

function requireNode(level: DesignLevel, nodeId: string): BlockNode {
  return level.nodes.find((node) => node.id === nodeId) ?? editError(`Block ${nodeId} does not exist in ${level.id}.`);
}

function requirePort(node: BlockNode, portId: string): BlockPort {
  return node.ports.find((port) => port.id === portId) ?? editError(`Port ${node.id}.${portId} does not exist.`);
}

function moveNodes(document: BlockDesignDocument, moves: readonly NodeMove[]): void {
  if (moves.length === 0) editError("At least one module is required for a move operation.");
  const identities = new Set<string>();
  moves.forEach((move) => {
    const identity = `${move.levelId}\u0000${move.nodeId}`;
    if (identities.has(identity)) editError(`Module ${move.nodeId} can only be moved once per operation.`);
    identities.add(identity);
    const node = requireNode(requireLevel(document, move.levelId), move.nodeId);
    node.layout = {
      ...node.layout,
      position: {
        x: Math.round(move.position.x),
        y: Math.round(move.position.y),
      },
      pinned: true,
    };
  });
}

function cleanupUnusedInterfaces(document: BlockDesignDocument, candidates: Iterable<string>): void {
  const used = new Set(document.levels.flatMap((level) => level.connections.map((connection) => connection.interfaceId)));
  for (const interfaceId of candidates) {
    if (!used.has(interfaceId)) delete document.interfaceDefinitions[interfaceId];
  }
}

function removeConnections(
  document: BlockDesignDocument,
  predicate: (connection: BlockConnection, level: DesignLevel) => boolean,
): void {
  const removedInterfaceIds = new Set<string>();
  document.levels.forEach((level) => {
    level.connections = level.connections.filter((connection) => {
      if (!predicate(connection, level)) return true;
      removedInterfaceIds.add(connection.interfaceId);
      return false;
    });
  });
  cleanupUnusedInterfaces(document, removedInterfaceIds);
}

function descendantLevelIds(document: BlockDesignDocument, rootLevelId: string): Set<string> {
  const result = new Set<string>();
  const pending = [rootLevelId];
  while (pending.length > 0) {
    const levelId = pending.pop();
    if (!levelId || result.has(levelId)) continue;
    result.add(levelId);
    document.levels
      .find((level) => level.id === levelId)
      ?.nodes.forEach((node) => {
        if (node.hierarchy) pending.push(node.hierarchy.childLevelId);
      });
  }
  return result;
}

function removeUnreferencedLevelTree(document: BlockDesignDocument, rootLevelId: string): void {
  const candidates = descendantLevelIds(document, rootLevelId);
  const protectedLevels = new Set<string>();

  document.levels.forEach((level) => {
    if (candidates.has(level.id)) return;
    level.nodes.forEach((node) => {
      if (node.hierarchy && candidates.has(node.hierarchy.childLevelId)) {
        protectedLevels.add(node.hierarchy.childLevelId);
      }
    });
  });

  const protectedDescendants = new Set<string>();
  protectedLevels.forEach((levelId) => {
    descendantLevelIds(document, levelId).forEach((descendant) => protectedDescendants.add(descendant));
  });
  const removed = new Set([...candidates].filter((levelId) => !protectedDescendants.has(levelId)));
  if (removed.size === 0) return;

  const removedInterfaceIds = new Set<string>();
  document.levels.forEach((level) => {
    if (!removed.has(level.id)) return;
    level.connections.forEach((connection) => removedInterfaceIds.add(connection.interfaceId));
  });
  document.levels = document.levels.filter((level) => !removed.has(level.id));
  cleanupUnusedInterfaces(document, removedInterfaceIds);
}

function validateConnectionEndpoints(
  level: DesignLevel,
  connection: BlockConnection,
): void {
  const sourceNode = requireNode(level, connection.source.nodeId);
  const targetNode = requireNode(level, connection.target.nodeId);
  const sourcePort = requirePort(sourceNode, connection.source.portId);
  const targetPort = requirePort(targetNode, connection.target.portId);
  if (sourceNode.id === targetNode.id && sourcePort.id === targetPort.id) {
    editError("A port cannot connect to itself.");
  }
  if (sourcePort.direction === "input") {
    editError(`${sourceNode.title}.${sourcePort.label} is input-only and cannot start a connection.`);
  }
  if (targetPort.direction === "output") {
    editError(`${targetNode.title}.${targetPort.label} is output-only and cannot end a connection.`);
  }
}

export function applyDesignOperation(
  document: BlockDesignDocument,
  operation: DesignOperation,
): BlockDesignDocument {
  const next = structuredClone(document);

  switch (operation.type) {
    case "document/update":
      next.title = operation.values.title.trim();
      next.summary = operation.values.summary.trim();
      break;
    case "level/update": {
      const level = requireLevel(next, operation.levelId);
      level.title = operation.values.title.trim();
      level.description = operation.values.description.trim();
      level.layout = operation.values.layout;
      break;
    }
    case "node/add": {
      const level = requireLevel(next, operation.levelId);
      requireAuthorId(operation.node.id, "Block id");
      if (level.nodes.some((node) => node.id === operation.node.id)) {
        editError(`Block id ${operation.node.id} already exists in ${level.title}.`);
      }
      level.nodes.push(operation.node);
      break;
    }
    case "node/update": {
      const node = requireNode(requireLevel(next, operation.levelId), operation.nodeId);
      Object.assign(node, operation.values);
      node.title = node.title.trim();
      break;
    }
    case "node/move": {
      moveNodes(next, [operation]);
      break;
    }
    case "nodes/move": {
      moveNodes(next, operation.moves);
      break;
    }
    case "fragment/insert": {
      insertDesignFragment(next, operation);
      break;
    }
    case "node/resize": {
      const node = requireNode(requireLevel(next, operation.levelId), operation.nodeId);
      node.layout = {
        ...node.layout,
        position: {
          x: Math.round(operation.position.x),
          y: Math.round(operation.position.y),
        },
        width: Math.round(operation.size.width),
        height: Math.round(operation.size.height),
        pinned: true,
      };
      break;
    }
    case "node/delete": {
      const level = requireLevel(next, operation.levelId);
      const node = requireNode(level, operation.nodeId);
      const childLevelId = node.hierarchy?.childLevelId;
      level.nodes = level.nodes.filter((candidate) => candidate.id !== node.id);
      removeConnections(next, (connection, candidateLevel) =>
        candidateLevel.id === level.id &&
        (connection.source.nodeId === node.id || connection.target.nodeId === node.id),
      );
      next.levels.forEach((parentLevel) => {
        parentLevel.nodes.forEach((parentNode) => {
          if (parentNode.hierarchy?.childLevelId !== level.id) return;
          parentNode.hierarchy.portBindings = parentNode.hierarchy.portBindings.filter(
            (binding) => binding.childEndpoint.nodeId !== node.id,
          );
        });
      });
      if (childLevelId) removeUnreferencedLevelTree(next, childLevelId);
      break;
    }
    case "port/add": {
      const node = requireNode(requireLevel(next, operation.levelId), operation.nodeId);
      requireAuthorId(operation.port.id, "Port id");
      if (node.ports.some((port) => port.id === operation.port.id)) {
        editError(`Port id ${operation.port.id} already exists on ${node.title}.`);
      }
      node.ports.push(operation.port);
      break;
    }
    case "port/update": {
      const port = requirePort(requireNode(requireLevel(next, operation.levelId), operation.nodeId), operation.portId);
      Object.assign(port, operation.values);
      break;
    }
    case "port/delete": {
      const level = requireLevel(next, operation.levelId);
      const node = requireNode(level, operation.nodeId);
      requirePort(node, operation.portId);
      node.ports = node.ports.filter((port) => port.id !== operation.portId);
      if (node.hierarchy) {
        node.hierarchy.portBindings = node.hierarchy.portBindings.filter(
          (binding) => binding.parentPortId !== operation.portId,
        );
      }
      removeConnections(next, (connection, candidateLevel) =>
        candidateLevel.id === level.id &&
        ((connection.source.nodeId === node.id && connection.source.portId === operation.portId) ||
          (connection.target.nodeId === node.id && connection.target.portId === operation.portId)),
      );
      next.levels.forEach((parentLevel) => {
        parentLevel.nodes.forEach((parentNode) => {
          if (parentNode.hierarchy?.childLevelId !== level.id) return;
          parentNode.hierarchy.portBindings = parentNode.hierarchy.portBindings.filter(
            (binding) =>
              binding.childEndpoint.nodeId !== node.id || binding.childEndpoint.portId !== operation.portId,
          );
        });
      });
      break;
    }
    case "hierarchy/add": {
      const level = requireLevel(next, operation.levelId);
      const node = requireNode(level, operation.nodeId);
      if (node.hierarchy) editError(`${node.title} already owns a child design.`);
      requireAuthorId(operation.childLevel.id, "Child design id");
      if (next.levels.some((candidate) => candidate.id === operation.childLevel.id)) {
        editError(`Level id ${operation.childLevel.id} already exists.`);
      }
      if (operation.childLevel.parentLevelId !== level.id) {
        editError(`Child design ${operation.childLevel.id} must declare parent ${level.id}.`);
      }
      next.levels.push(operation.childLevel);
      node.hierarchy = { childLevelId: operation.childLevel.id, portBindings: [] };
      break;
    }
    case "hierarchy/bind": {
      const level = requireLevel(next, operation.levelId);
      const node = requireNode(level, operation.nodeId);
      const hierarchy = node.hierarchy ?? editError(`${node.title} has no child design.`);
      requirePort(node, operation.binding.parentPortId);
      const childLevel = requireLevel(next, hierarchy.childLevelId);
      requirePort(
        requireNode(childLevel, operation.binding.childEndpoint.nodeId),
        operation.binding.childEndpoint.portId,
      );
      hierarchy.portBindings = [
        ...hierarchy.portBindings.filter(
          (binding) => binding.parentPortId !== operation.binding.parentPortId,
        ),
        operation.binding,
      ];
      break;
    }
    case "hierarchy/unbind": {
      const node = requireNode(requireLevel(next, operation.levelId), operation.nodeId);
      const hierarchy = node.hierarchy ?? editError(`${node.title} has no child design.`);
      hierarchy.portBindings = hierarchy.portBindings.filter(
        (binding) => binding.parentPortId !== operation.parentPortId,
      );
      break;
    }
    case "connection/add": {
      const level = requireLevel(next, operation.levelId);
      requireAuthorId(operation.connection.id, "Connection id");
      requireAuthorId(operation.connection.interfaceId, "Interface id");
      if (level.connections.some((connection) => connection.id === operation.connection.id)) {
        editError(`Connection id ${operation.connection.id} already exists in ${level.title}.`);
      }
      if (next.interfaceDefinitions[operation.connection.interfaceId]) {
        editError(`Interface id ${operation.connection.interfaceId} already exists.`);
      }
      validateConnectionEndpoints(level, operation.connection);
      next.interfaceDefinitions[operation.connection.interfaceId] = operation.definition;
      level.connections.push(operation.connection);
      break;
    }
    case "connection/update": {
      const level = requireLevel(next, operation.levelId);
      const connection = level.connections.find((candidate) => candidate.id === operation.connectionId) ??
        editError(`Connection ${operation.connectionId} does not exist in ${level.title}.`);
      connection.label = operation.values.label?.trim() || undefined;
      if (!next.interfaceDefinitions[connection.interfaceId]) {
        editError(`Interface ${connection.interfaceId} does not exist.`);
      }
      next.interfaceDefinitions[connection.interfaceId] = operation.definition;
      break;
    }
    case "connection/route": {
      const level = requireLevel(next, operation.levelId);
      const connection = level.connections.find((candidate) => candidate.id === operation.connectionId) ??
        editError(`Connection ${operation.connectionId} does not exist in ${level.title}.`);
      connection.routing = operation.routing
        ? {
            waypoints: operation.routing.waypoints.map((point) => ({
              x: Math.round(point.x),
              y: Math.round(point.y),
            })),
          }
        : undefined;
      break;
    }
    case "connection/reconnect": {
      const level = requireLevel(next, operation.levelId);
      const connection = level.connections.find((candidate) => candidate.id === operation.connectionId) ??
        editError(`Connection ${operation.connectionId} does not exist in ${level.title}.`);
      const reconnected = {
        ...connection,
        source: { ...operation.source },
        target: { ...operation.target },
        // Authored waypoints describe the old endpoint geometry. Keeping them
        // after an endpoint change would turn stale coordinates into design
        // facts and commonly creates loops next to the new port.
        routing: undefined,
      };
      validateConnectionEndpoints(level, reconnected);
      Object.assign(connection, reconnected);
      break;
    }
    case "connection/delete": {
      const level = requireLevel(next, operation.levelId);
      const connection = level.connections.find((candidate) => candidate.id === operation.connectionId) ??
        editError(`Connection ${operation.connectionId} does not exist in ${level.title}.`);
      level.connections = level.connections.filter((candidate) => candidate.id !== connection.id);
      cleanupUnusedInterfaces(next, [connection.interfaceId]);
      break;
    }
  }

  if (!next.title.trim()) editError("Design title cannot be empty.");
  return parseBlockDesignDocument(next);
}

export function createBlankDesign(id: string, title: string): BlockDesignDocument {
  requireAuthorId(id, "Design id");
  const normalizedTitle = title.trim();
  if (!normalizedTitle) editError("Design title cannot be empty.");
  return parseBlockDesignDocument({
    schemaVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    id,
    title: normalizedTitle,
    summary: "",
    entryLevelId: "system",
    interfaceDefinitions: {},
    levels: [createDesignLevel("system", "System")],
  });
}

export function createDesignLevel(id: string, title: string, parentLevelId?: string): DesignLevel {
  requireAuthorId(id, "Level id");
  return {
    id,
    title: title.trim() || id,
    description: "",
    parentLevelId,
    nodes: [],
    connections: [],
    layout: { direction: "RIGHT", spacing: 64, layerSpacing: 110 },
  };
}

export function createBlock(draft: BlockDraft): BlockNode {
  requireAuthorId(draft.id, "Block id");
  return {
    id: draft.id,
    title: draft.title.trim() || draft.id,
    kind: "module",
    tone: "neutral",
    owner: draft.owner?.trim() || undefined,
    ports: [],
    inspector: emptyInspector(),
    layout: { pinned: false },
  };
}

export function createPort(draft: PortDraft): BlockPort {
  requireAuthorId(draft.id, "Port id");
  return {
    id: draft.id,
    label: draft.label.trim() || draft.id,
    side: draft.side,
    direction: draft.direction,
    dataType: draft.dataType?.trim() || undefined,
    required: draft.required,
  };
}

export function createInterfaceDefinition(draft: InterfaceDraft): InterfaceDefinition {
  requireAuthorId(draft.id, "Interface id");
  if (!draft.owner.trim()) editError("Interface owner cannot be empty.");
  return {
    kind: draft.kind,
    title: draft.title.trim() || draft.id,
    owner: draft.owner.trim(),
    principle: "",
    purpose: "",
    boundary: "",
    failure: "",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

export function emptyInspector(): InspectorDefinition {
  return {
    principle: "",
    purpose: "",
    boundary: "",
    failure: "",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}
