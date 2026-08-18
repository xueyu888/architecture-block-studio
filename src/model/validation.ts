import type {
  BlockConnection,
  BlockDesignDocument,
  BlockNode,
  BlockPort,
  DesignLevel,
} from "./design";

export type DesignIssueSeverity = "error" | "warning" | "info";

export interface DesignIssue {
  id: string;
  severity: DesignIssueSeverity;
  code: string;
  message: string;
  levelId?: string;
  nodeId?: string;
  portId?: string;
  connectionId?: string;
}

interface LevelIndex {
  level: DesignLevel;
  nodes: Map<string, BlockNode>;
  ports: Map<string, Map<string, BlockPort>>;
}

function issue(
  issues: DesignIssue[],
  severity: DesignIssueSeverity,
  code: string,
  message: string,
  target: Omit<DesignIssue, "id" | "severity" | "code" | "message"> = {},
): void {
  issues.push({
    id: `${code}:${issues.length + 1}`,
    severity,
    code,
    message,
    ...target,
  });
}

function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  });
  return repeated;
}

function buildLevelIndex(level: DesignLevel, issues: DesignIssue[]): LevelIndex {
  const nodes = new Map<string, BlockNode>();
  const ports = new Map<string, Map<string, BlockPort>>();

  duplicates(level.nodes.map((node) => node.id)).forEach((nodeId) => {
    issue(issues, "error", "BD-NODE-DUPLICATE", `Level ${level.id} contains duplicate block id ${nodeId}.`, {
      levelId: level.id,
      nodeId,
    });
  });

  level.nodes.forEach((node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    const nodePorts = new Map<string, BlockPort>();
    duplicates(node.ports.map((port) => port.id)).forEach((portId) => {
      issue(issues, "error", "BD-PORT-DUPLICATE", `Block ${node.id} contains duplicate port id ${portId}.`, {
        levelId: level.id,
        nodeId: node.id,
        portId,
      });
    });
    node.ports.forEach((port) => {
      if (!nodePorts.has(port.id)) nodePorts.set(port.id, port);
    });
    ports.set(node.id, nodePorts);
  });

  return { level, nodes, ports };
}

function resolveEndpoint(
  index: LevelIndex,
  connection: BlockConnection,
  endpoint: "source" | "target",
  issues: DesignIssue[],
): BlockPort | undefined {
  const ref = connection[endpoint];
  const node = index.nodes.get(ref.nodeId);
  if (!node) {
    issue(
      issues,
      "error",
      "BD-CONNECTION-NODE-MISSING",
      `Connection ${connection.id} references missing ${endpoint} block ${ref.nodeId}.`,
      { levelId: index.level.id, nodeId: ref.nodeId, connectionId: connection.id },
    );
    return undefined;
  }

  const port = index.ports.get(ref.nodeId)?.get(ref.portId);
  if (!port) {
    issue(
      issues,
      "error",
      "BD-CONNECTION-PORT-MISSING",
      `Connection ${connection.id} references missing ${endpoint} port ${ref.nodeId}.${ref.portId}.`,
      {
        levelId: index.level.id,
        nodeId: ref.nodeId,
        portId: ref.portId,
        connectionId: connection.id,
      },
    );
  }
  return port;
}

function validateConnection(
  document: BlockDesignDocument,
  index: LevelIndex,
  connection: BlockConnection,
  issues: DesignIssue[],
): void {
  if (!document.interfaceDefinitions[connection.interfaceId]) {
    issue(
      issues,
      "error",
      "BD-INTERFACE-MISSING",
      `Connection ${connection.id} references missing interface definition ${connection.interfaceId}.`,
      { levelId: index.level.id, connectionId: connection.id },
    );
  }

  const sourcePort = resolveEndpoint(index, connection, "source", issues);
  const targetPort = resolveEndpoint(index, connection, "target", issues);

  if (sourcePort?.direction === "input") {
    issue(
      issues,
      "error",
      "BD-SOURCE-DIRECTION",
      `Input-only port ${connection.source.nodeId}.${sourcePort.id} cannot be a connection source.`,
      {
        levelId: index.level.id,
        nodeId: connection.source.nodeId,
        portId: sourcePort.id,
        connectionId: connection.id,
      },
    );
  }

  if (targetPort?.direction === "output") {
    issue(
      issues,
      "error",
      "BD-TARGET-DIRECTION",
      `Output-only port ${connection.target.nodeId}.${targetPort.id} cannot be a connection target.`,
      {
        levelId: index.level.id,
        nodeId: connection.target.nodeId,
        portId: targetPort.id,
        connectionId: connection.id,
      },
    );
  }
}

function reachableLevels(document: BlockDesignDocument, indexes: Map<string, LevelIndex>): Set<string> {
  const reachable = new Set<string>();
  const pending = [document.entryLevelId];
  while (pending.length > 0) {
    const levelId = pending.pop();
    if (!levelId || reachable.has(levelId)) continue;
    reachable.add(levelId);
    indexes.get(levelId)?.level.nodes.forEach((node) => {
      if (node.hierarchy) pending.push(node.hierarchy.childLevelId);
    });
  }
  return reachable;
}

function validateHierarchy(
  parentIndex: LevelIndex,
  indexes: Map<string, LevelIndex>,
  node: BlockNode,
  issues: DesignIssue[],
): void {
  const hierarchy = node.hierarchy;
  if (!hierarchy) return;

  const childIndex = indexes.get(hierarchy.childLevelId);
  if (!childIndex) {
    issue(
      issues,
      "error",
      "BD-CHILD-LEVEL-MISSING",
      `Block ${node.id} references missing child level ${hierarchy.childLevelId}.`,
      { levelId: parentIndex.level.id, nodeId: node.id },
    );
    return;
  }

  if (childIndex.level.parentLevelId !== parentIndex.level.id) {
    issue(
      issues,
      "error",
      "BD-PARENT-LEVEL-MISMATCH",
      `Child level ${childIndex.level.id} must declare parent ${parentIndex.level.id}.`,
      { levelId: childIndex.level.id, nodeId: node.id },
    );
  }

  duplicates(hierarchy.portBindings.map((binding) => binding.parentPortId)).forEach((portId) => {
    issue(
      issues,
      "error",
      "BD-HIERARCHY-BINDING-DUPLICATE",
      `Hierarchy block ${node.id} binds parent port ${portId} more than once.`,
      { levelId: parentIndex.level.id, nodeId: node.id, portId },
    );
  });

  const bindings = new Map(
    hierarchy.portBindings.map((binding) => [binding.parentPortId, binding] as const),
  );
  node.ports.forEach((parentPort) => {
    if (!bindings.has(parentPort.id)) {
      issue(
        issues,
        "error",
        "BD-HIERARCHY-BINDING-MISSING",
        `Hierarchy block ${node.id} does not bind parent port ${parentPort.id}.`,
        { levelId: parentIndex.level.id, nodeId: node.id, portId: parentPort.id },
      );
    }
  });

  hierarchy.portBindings.forEach((binding) => {
    const parentPort = parentIndex.ports.get(node.id)?.get(binding.parentPortId);
    if (!parentPort) {
      issue(
        issues,
        "error",
        "BD-HIERARCHY-PARENT-PORT-MISSING",
        `Hierarchy block ${node.id} binds missing parent port ${binding.parentPortId}.`,
        { levelId: parentIndex.level.id, nodeId: node.id, portId: binding.parentPortId },
      );
      return;
    }

    const childNode = childIndex.nodes.get(binding.childEndpoint.nodeId);
    const childPort = childIndex.ports
      .get(binding.childEndpoint.nodeId)
      ?.get(binding.childEndpoint.portId);
    if (!childNode || !childPort) {
      issue(
        issues,
        "error",
        "BD-HIERARCHY-CHILD-ENDPOINT-MISSING",
        `Hierarchy block ${node.id} binds ${parentPort.id} to missing child endpoint ${binding.childEndpoint.nodeId}.${binding.childEndpoint.portId}.`,
        { levelId: childIndex.level.id, nodeId: binding.childEndpoint.nodeId, portId: binding.childEndpoint.portId },
      );
      return;
    }

  });
}

function validateContractText(
  issues: DesignIssue[],
  contract: { principle?: string; purpose: string; boundary: string; failure: string },
  target: Omit<DesignIssue, "id" | "severity" | "code" | "message">,
  label: string,
): void {
  (["purpose", "boundary", "failure"] as const).forEach((field) => {
    if (contract[field].trim()) return;
    issue(
      issues,
      "warning",
      `BD-CONTRACT-${field.toUpperCase()}-MISSING`,
      `${label} does not define its ${field}.`,
      target,
    );
  });
}

export function validateBlockDesignDocument(document: BlockDesignDocument): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const levelIds = document.levels.map((level) => level.id);
  const duplicateLevelIds = duplicates(levelIds);

  duplicateLevelIds.forEach((levelId) => {
    issue(issues, "error", "BD-LEVEL-DUPLICATE", `Document contains duplicate level id ${levelId}.`, {
      levelId,
    });
  });

  const indexes = new Map<string, LevelIndex>();
  document.levels.forEach((level) => {
    if (!indexes.has(level.id)) indexes.set(level.id, buildLevelIndex(level, issues));
  });

  if (!indexes.has(document.entryLevelId)) {
    issue(
      issues,
      "error",
      "BD-ENTRY-LEVEL-MISSING",
      `Entry level ${document.entryLevelId} does not exist.`,
      { levelId: document.entryLevelId },
    );
  }

  const externallyBoundPorts = new Map<string, Set<string>>();
  document.levels.forEach((parentLevel) => {
    parentLevel.nodes.forEach((node) => {
      const hierarchy = node.hierarchy;
      if (!hierarchy) return;
      const childPorts = externallyBoundPorts.get(hierarchy.childLevelId) ?? new Set<string>();
      hierarchy.portBindings.forEach((binding) => {
        childPorts.add(`${binding.childEndpoint.nodeId}:${binding.childEndpoint.portId}`);
      });
      externallyBoundPorts.set(hierarchy.childLevelId, childPorts);
    });
  });

  indexes.forEach((index) => {
    const { level } = index;
    duplicates(level.connections.map((connection) => connection.id)).forEach((connectionId) => {
      issue(
        issues,
        "error",
        "BD-CONNECTION-DUPLICATE",
        `Level ${level.id} contains duplicate connection id ${connectionId}.`,
        { levelId: level.id, connectionId },
      );
    });

    level.nodes.forEach((node) => {
      validateHierarchy(index, indexes, node, issues);
      validateContractText(
        issues,
        node.inspector,
        { levelId: level.id, nodeId: node.id },
        `Block ${node.id}`,
      );
    });

    level.connections.forEach((connection) => {
      validateConnection(document, index, connection, issues);
      const definition = document.interfaceDefinitions[connection.interfaceId];
      if (definition) {
        validateContractText(
          issues,
          definition,
          { levelId: level.id, connectionId: connection.id },
          `Interface ${connection.interfaceId}`,
        );
      }
    });

    const connectedPorts = new Set(externallyBoundPorts.get(level.id));
    level.connections.forEach((connection) => {
      connectedPorts.add(`${connection.source.nodeId}:${connection.source.portId}`);
      connectedPorts.add(`${connection.target.nodeId}:${connection.target.portId}`);
    });
    level.nodes.forEach((node) => {
      node.ports.forEach((port) => {
        if (port.required && !connectedPorts.has(`${node.id}:${port.id}`)) {
          issue(
            issues,
            "warning",
            "BD-PORT-UNCONNECTED",
            `Required port ${node.id}.${port.id} is not connected.`,
            { levelId: level.id, nodeId: node.id, portId: port.id },
          );
        }
      });
    });
  });

  const reachable = reachableLevels(document, indexes);
  indexes.forEach((_, levelId) => {
    if (!reachable.has(levelId)) {
      issue(issues, "warning", "BD-LEVEL-ORPHAN", `Level ${levelId} is not reachable from the entry level.`, {
        levelId,
      });
    }
  });

  if (issues.length === 0) {
    issue(issues, "info", "BD-VALID", "Design validation completed without errors or warnings.");
  }

  return issues;
}
