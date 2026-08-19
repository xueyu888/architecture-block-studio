import type { BlockDesignDocument, DesignLevel, InterfaceKind, PortDirection } from "./design";

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

export type ModuleInterfaceDirection = "incoming" | "outgoing" | "loopback";

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

export function firstConnectablePair(level: DesignLevel): NormalizedConnectionEndpoints | undefined {
  const endpoints = listLevelPortEndpoints(level);
  for (const preferDifferentNode of [true, false]) {
    for (const first of endpoints) {
      for (const second of endpoints) {
        if (preferDifferentNode && first.nodeId === second.nodeId) continue;
        const normalized = normalizeConnectionEndpoints(first, second);
        if (normalized) return normalized;
      }
    }
  }
  return undefined;
}

export function listModuleInterfaces(
  document: BlockDesignDocument,
  levelId: string,
  nodeId: string,
): ModuleInterfaceSummary[] {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level || !level.nodes.some((candidate) => candidate.id === nodeId)) return [];

  return level.connections.flatMap((connection): ModuleInterfaceSummary[] => {
    const isSource = connection.source.nodeId === nodeId;
    const isTarget = connection.target.nodeId === nodeId;
    if (!isSource && !isTarget) return [];

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

    return [{
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
    }];
  });
}
