import type {
  BlockConnection,
  BlockDesignDocument,
  DesignLevel,
  InterfaceKind,
  PortDirection,
} from "./design";

export interface ConnectablePortEndpoint {
  levelId: string;
  nodeId: string;
  nodeTitle: string;
  portId: string;
  label: string;
  direction: PortDirection;
}

export interface NormalizedConnectionEndpoints {
  levelId: string;
  source: ConnectablePortEndpoint;
  target: ConnectablePortEndpoint;
}

export interface ConnectionEndpointReference {
  nodeId: string;
  portId: string;
}

export type ModuleInterfaceDirection = "incoming" | "outgoing" | "loopback";
export type DirectConnectionDirection = "both" | "incoming" | "outgoing";

export interface ModuleInterfaceSummary {
  levelId: string;
  connectionId: string;
  interfaceId: string;
  title: string;
  kind?: InterfaceKind;
  direction: ModuleInterfaceDirection;
  localPortId: string;
  localPortLabel: string;
  peerNodeId: string;
  peerNodeTitle: string;
  peerPortId: string;
  peerPortLabel: string;
}

export function listLevelPortEndpoints(level: DesignLevel): ConnectablePortEndpoint[] {
  return level.nodes.flatMap((node) => node.ports.map((port) => ({
    levelId: level.id,
    nodeId: node.id,
    nodeTitle: node.title,
    portId: port.id,
    label: port.label,
    direction: port.direction,
  })));
}

export function listConnectionSourceEndpoints(level: DesignLevel): ConnectablePortEndpoint[] {
  return listLevelPortEndpoints(level).filter((endpoint) => endpoint.direction !== "input");
}

export function listConnectionTargetEndpoints(
  level: DesignLevel,
  source?: ConnectablePortEndpoint,
): ConnectablePortEndpoint[] {
  return listLevelPortEndpoints(level).filter((endpoint) => (
    endpoint.direction !== "output" &&
    (endpoint.nodeId !== source?.nodeId || endpoint.portId !== source.portId)
  ));
}

export function normalizeConnectionEndpoints(
  first: ConnectablePortEndpoint | undefined,
  second: ConnectablePortEndpoint | undefined,
): NormalizedConnectionEndpoints | undefined {
  if (!first || !second || first.levelId !== second.levelId) return undefined;
  if (first.nodeId === second.nodeId && first.portId === second.portId) return undefined;
  if (first.direction !== "input" && second.direction !== "output") {
    return { levelId: first.levelId, source: first, target: second };
  }
  if (second.direction !== "input" && first.direction !== "output") {
    return { levelId: first.levelId, source: second, target: first };
  }
  return undefined;
}

export function connectionEndpointsEqual(
  connection: Pick<BlockConnection, "source" | "target">,
  source: ConnectionEndpointReference,
  target: ConnectionEndpointReference,
): boolean {
  return connection.source.nodeId === source.nodeId &&
    connection.source.portId === source.portId &&
    connection.target.nodeId === target.nodeId &&
    connection.target.portId === target.portId;
}

export function firstConnectablePair(level: DesignLevel): NormalizedConnectionEndpoints | undefined {
  const sources = listConnectionSourceEndpoints(level);
  const targets = listConnectionTargetEndpoints(level);
  for (const preferDifferentNode of [true, false]) {
    for (const source of sources) {
      for (const target of targets) {
        if (source.nodeId === target.nodeId && source.portId === target.portId) continue;
        if (preferDifferentNode && source.nodeId === target.nodeId) continue;
        const normalized = normalizeConnectionEndpoints(source, target);
        if (normalized) return normalized;
      }
    }
  }
  return undefined;
}

export function connectionPortEndpoints(
  level: DesignLevel,
  connection: BlockConnection,
): NormalizedConnectionEndpoints | undefined {
  const endpoints = listLevelPortEndpoints(level);
  const source = endpoints.find((endpoint) => (
    endpoint.nodeId === connection.source.nodeId && endpoint.portId === connection.source.portId
  ));
  const target = endpoints.find((endpoint) => (
    endpoint.nodeId === connection.target.nodeId && endpoint.portId === connection.target.portId
  ));
  return normalizeConnectionEndpoints(source, target);
}

export function hasAlternativeConnectionEndpoints(
  level: DesignLevel,
  connection: BlockConnection,
): boolean {
  const current = connectionPortEndpoints(level, connection);
  if (!current) return false;
  const targets = listConnectionTargetEndpoints(level);
  for (const source of listConnectionSourceEndpoints(level)) {
    for (const target of targets) {
      if (source.nodeId === target.nodeId && source.portId === target.portId) continue;
      if (
        source.nodeId !== current.source.nodeId ||
        source.portId !== current.source.portId ||
        target.nodeId !== current.target.nodeId ||
        target.portId !== current.target.portId
      ) return true;
    }
  }
  return false;
}

/**
 * Returns each connection touching at least one existing node in the supplied
 * set exactly once and in document order. This is the graph-level adjacency
 * fact used by both inspection and workspace selection projections.
 */
export function listDirectConnections(
  level: DesignLevel,
  nodeIds: Iterable<string>,
  direction: DirectConnectionDirection = "both",
): BlockConnection[] {
  const existingNodeIds = new Set(level.nodes.map((node) => node.id));
  const selectedNodeIds = new Set(
    [...nodeIds].filter((nodeId) => existingNodeIds.has(nodeId)),
  );
  if (selectedNodeIds.size === 0) return [];
  return level.connections.filter((connection) => {
    const outgoing = selectedNodeIds.has(connection.source.nodeId);
    const incoming = selectedNodeIds.has(connection.target.nodeId);
    return direction === "incoming"
      ? incoming
      : direction === "outgoing"
        ? outgoing
        : outgoing || incoming;
  });
}

export function listModuleInterfaces(
  document: BlockDesignDocument,
  levelId: string,
  nodeId: string,
): ModuleInterfaceSummary[] {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level || !level.nodes.some((candidate) => candidate.id === nodeId)) return [];

  return listDirectConnections(level, [nodeId]).map((connection): ModuleInterfaceSummary => {
    const isSource = connection.source.nodeId === nodeId;
    const isTarget = connection.target.nodeId === nodeId;

    const direction: ModuleInterfaceDirection = isSource && isTarget
      ? "loopback"
      : isSource
        ? "outgoing"
        : "incoming";
    const localEndpoint = isSource ? connection.source : connection.target;
    const peerEndpoint = isSource ? connection.target : connection.source;
    const localNode = level.nodes.find((candidate) => candidate.id === localEndpoint.nodeId);
    const peerNode = level.nodes.find((candidate) => candidate.id === peerEndpoint.nodeId);
    const localPort = localNode?.ports.find((candidate) => candidate.id === localEndpoint.portId);
    const peerPort = peerNode?.ports.find((candidate) => candidate.id === peerEndpoint.portId);
    const definition = document.interfaceDefinitions[connection.interfaceId];

    return {
      levelId,
      connectionId: connection.id,
      interfaceId: connection.interfaceId,
      title: connection.label ?? definition?.title ?? connection.interfaceId,
      kind: definition?.kind,
      direction,
      localPortId: localEndpoint.portId,
      localPortLabel: localPort?.label ?? localEndpoint.portId,
      peerNodeId: peerEndpoint.nodeId,
      peerNodeTitle: peerNode?.title ?? peerEndpoint.nodeId,
      peerPortId: peerEndpoint.portId,
      peerPortLabel: peerPort?.label ?? peerEndpoint.portId,
    };
  });
}
