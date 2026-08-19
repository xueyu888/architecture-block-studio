import type {
  BlockDesignDocument,
  BlockNode,
  BlockPort,
} from "../model";

function compareIds(left: readonly [string, unknown], right: readonly [string, unknown]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

function portGeometry(port: BlockPort) {
  return {
    id: port.id,
    label: port.label,
    side: port.side,
    order: port.order,
  };
}

function nodeGeometry(node: BlockNode) {
  return {
    id: node.id,
    layout: node.layout,
    childLevelId: node.hierarchy?.childLevelId,
    ports: node.ports.map(portGeometry),
  };
}

function geometryProjection(document: BlockDesignDocument) {
  return {
    entryLevelId: document.entryLevelId,
    levels: document.levels.map((level) => ({
      id: level.id,
      layout: level.layout,
      nodes: level.nodes.map(nodeGeometry),
      connections: level.connections.map((connection) => ({
        source: connection.source,
        target: connection.target,
      })),
    })),
  };
}

/**
 * Fingerprints only document facts that can change node placement or bounds.
 * Studio uses it to decide whether a document edit warrants refitting the view.
 */
export function layoutGeometrySignature(document: BlockDesignDocument): string {
  return JSON.stringify(geometryProjection(document));
}

/**
 * Fingerprints the complete document projection consumed by layout and canvas
 * rendering. Inspector-only contract text and document/level prose stay out of
 * this projection, so editing them cannot rebuild a large React Flow graph.
 */
export function layoutProjectionSignature(document: BlockDesignDocument): string {
  const usedInterfaceIds = new Set(
    document.levels.flatMap((level) =>
      level.connections.map((connection) => connection.interfaceId),
    ),
  );
  const interfaceKinds = Object.entries(document.interfaceDefinitions)
    .filter(([interfaceId]) => usedInterfaceIds.has(interfaceId))
    .sort(compareIds)
    .map(([interfaceId, definition]) => [interfaceId, definition.kind]);

  return JSON.stringify({
    geometry: geometryProjection(document),
    interfaceKinds,
    levels: document.levels.map((level) => ({
      id: level.id,
      nodes: level.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        tone: node.tone,
        process: node.process,
        summary: node.summary,
        owner: node.owner,
        hierarchy: node.hierarchy,
        ports: node.ports.map((port) => ({
          id: port.id,
          label: port.label,
          side: port.side,
          direction: port.direction,
          dataType: port.dataType,
          order: port.order,
        })),
      })),
      connections: level.connections.map((connection) => ({
        id: connection.id,
        interfaceId: connection.interfaceId,
        source: connection.source,
        target: connection.target,
        routing: connection.routing,
      })),
    })),
  });
}
