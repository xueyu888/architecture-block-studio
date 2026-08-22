import type { BlockDesignDocument } from "../../src/model";

export interface PerformanceDesignSize {
  nodeCount: number;
  connectionCount: number;
}

function padded(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

export function performanceDesignDocument({
  nodeCount,
  connectionCount,
}: PerformanceDesignSize): BlockDesignDocument {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) throw new Error("nodeCount must be an integer of at least 2.");
  if (!Number.isInteger(connectionCount) || connectionCount < 1) {
    throw new Error("connectionCount must be a positive integer.");
  }
  const nodeDigits = Math.max(3, String(nodeCount - 1).length);
  const connectionDigits = Math.max(4, String(connectionCount - 1).length);
  const nodeId = (index: number) => `module-${padded(index, nodeDigits)}`;
  const scale = nodeCount >= 1000 ? "stress" : "large";
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const id = nodeId(index);
    return {
      id,
      title: `Module ${padded(index, nodeDigits)}`,
      kind: "module",
      tone: ["ui", "core", "tool", "platform", "plugin"][index % 5],
      owner: `Team ${index % 10}`,
      ports: [
        { id: "in", label: "Input", side: "left" as const, direction: "input" as const, required: false, offset: 0.5 },
        { id: "out", label: "Output", side: "right" as const, direction: "output" as const, required: false, offset: 0.5 },
      ],
      inspector: {
        principle: "One measurable module responsibility.",
        purpose: `Own the behavior of ${id}.`,
        boundary: "Communicate only through declared ports.",
        failure: "Return a typed failure without partial state.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
      layout: {
        position: { x: Math.floor(index / 10) * 300, y: (index % 10) * 190 },
        width: 236,
        height: 132,
        pinned: true,
      },
    };
  });

  const endpointPairs: Array<readonly [number, number]> = [];
  for (let offset = 10; endpointPairs.length < connectionCount && offset < nodeCount; offset += 10) {
    for (let source = 0; source + offset < nodeCount && endpointPairs.length < connectionCount; source += 1) {
      endpointPairs.push([source, source + offset]);
    }
  }
  if (endpointPairs.length !== connectionCount) {
    throw new Error(`Unable to create ${connectionCount} deterministic connections for ${nodeCount} nodes.`);
  }

  const interfaceDefinitions: BlockDesignDocument["interfaceDefinitions"] = {};
  const connections = endpointPairs.map(([source, target], index) => {
    const interfaceId = `perf.interface.${padded(index, connectionDigits)}`;
    interfaceDefinitions[interfaceId] = {
      kind: "dto",
      title: `Performance Interface ${padded(index, connectionDigits)}`,
      protocol: "Performance Fixture v1",
      owner: `Team ${source % 10}`,
      principle: "One directed dependency.",
      purpose: `Transfer data from ${nodeId(source)} to ${nodeId(target)}.`,
      boundary: "No hidden shared state.",
      failure: "Reject invalid payloads atomically.",
      code: "",
      codeLanguage: "jsonc",
      attributes: {},
    };
    return {
      id: `connection-${padded(index, connectionDigits)}`,
      interfaceId,
      source: { nodeId: nodeId(source), portId: "out" },
      target: { nodeId: nodeId(target), portId: "in" },
    };
  });

  return {
    schemaVersion: "2.3",
    id: `performance-${scale}`,
    title: `Performance ${scale === "stress" ? "Stress" : "Large"} Design`,
    summary: `Deterministic ${nodeCount} module / ${connectionCount} connection performance fixture.`,
    entryLevelId: "system",
    interfaceDefinitions,
    levels: [{
      id: "system",
      title: `${scale === "stress" ? "Stress" : "Large"} System`,
      description: "Reproducible performance baseline.",
      nodes,
      connections,
      layout: { direction: "RIGHT", spacing: 64, layerSpacing: 110 },
    }],
  };
}
