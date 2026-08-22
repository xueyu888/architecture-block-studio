import type { BlockDesignDocument, BlockNode, BlockPort, DesignLevel } from "../../src/model";

const FLOW_COUNT = 2;
const NESTED_LEVEL_COUNT = 5;
const MODULE_WIDTH = 200;
const MODULE_HEIGHT = 96;
const BOUNDARY_WIDTH = 900;
const BOUNDARY_HEIGHT = 460;

function inspector(purpose: string): BlockNode["inspector"] {
  return {
    principle: "One explicit responsibility per hierarchy boundary.",
    purpose,
    boundary: "Communicate only through declared typed ports.",
    failure: "Surface an unresolved route instead of drawing ambiguous geometry.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

function boundaryPorts(): BlockPort[] {
  return Array.from({ length: FLOW_COUNT }, (_, index) => ({
    id: `flow-${index.toString().padStart(2, "0")}`,
    label: `flow.${index.toString().padStart(2, "0")}`,
    side: "left" as const,
    direction: "input" as const,
    required: false,
    offset: (index + 1) / (FLOW_COUNT + 1),
  }));
}

function leafPosition(index: number): { x: number; y: number } {
  return { x: 100, y: 90 + index * 180 };
}

function sourceNode(index: number): BlockNode {
  const suffix = index.toString().padStart(2, "0");
  return {
    id: `source-${suffix}`,
    title: `Source ${suffix}`,
    kind: "module",
    tone: "platform",
    owner: "Source Team",
    ports: [{ id: "out", label: "out", side: "right", direction: "output", required: false, offset: 0.5 }],
    inspector: inspector("Own one root-level source flow."),
    layout: { position: leafPosition(index), width: MODULE_WIDTH, height: MODULE_HEIGHT, pinned: true },
  };
}

function relayNode(levelNumber: number, index: number): BlockNode {
  const suffix = index.toString().padStart(2, "0");
  return {
    id: `relay-${levelNumber}-${suffix}`,
    title: `L${levelNumber} Relay ${suffix}`,
    kind: "module",
    tone: levelNumber % 2 === 0 ? "tool" : "core",
    owner: `Layer ${levelNumber} Team`,
    ports: [
      { id: "in", label: "in", side: "left", direction: "input", required: false, offset: 0.5 },
      { id: "out", label: "out", side: "right", direction: "output", required: false, offset: 0.5 },
    ],
    inspector: inspector(`Relay one declared flow through hierarchy layer ${levelNumber}.`),
    layout: { position: leafPosition(index), width: MODULE_WIDTH, height: MODULE_HEIGHT, pinned: true },
  };
}

function targetNode(index: number): BlockNode {
  const suffix = index.toString().padStart(2, "0");
  return {
    id: `target-${suffix}`,
    title: `Target ${suffix}`,
    kind: "module",
    tone: "ui",
    owner: "Target Team",
    ports: [{ id: "in", label: "in", side: "left", direction: "input", required: false, offset: 0.5 }],
    inspector: inspector("Own one deepest-level target flow."),
    layout: { position: leafPosition(index), width: MODULE_WIDTH, height: MODULE_HEIGHT, pinned: true },
  };
}

function boundaryNode(levelNumber: number): BlockNode {
  const deepest = levelNumber === NESTED_LEVEL_COUNT;
  return {
    id: `layer-${levelNumber}`,
    title: `Layer ${levelNumber} Boundary`,
    kind: "boundary",
    tone: levelNumber % 2 === 0 ? "tool" : "core",
    owner: `Layer ${levelNumber} Team`,
    ports: boundaryPorts(),
    hierarchy: {
      childLevelId: `level-${levelNumber}`,
      portBindings: Array.from({ length: FLOW_COUNT }, (_, index) => ({
        parentPortId: `flow-${index.toString().padStart(2, "0")}`,
        childEndpoint: deepest
          ? { nodeId: `target-${index.toString().padStart(2, "0")}`, portId: "in" }
          : { nodeId: `relay-${levelNumber}-${index.toString().padStart(2, "0")}`, portId: "in" },
      })),
    },
    inspector: inspector(`Own hierarchy boundary ${levelNumber} and its two explicit bindings.`),
    layout: {
      position: { x: 500, y: 0 },
      width: BOUNDARY_WIDTH,
      height: BOUNDARY_HEIGHT,
      pinned: true,
    },
  };
}

function connections(levelNumber: number): DesignLevel["connections"] {
  return Array.from({ length: FLOW_COUNT }, (_, index) => {
    const suffix = index.toString().padStart(2, "0");
    return {
      id: `layer-${levelNumber}-flow-${suffix}`,
      interfaceId: "five-level.flow",
      source: levelNumber === 1
        ? { nodeId: `source-${suffix}`, portId: "out" }
        : { nodeId: `relay-${levelNumber - 1}-${suffix}`, portId: "out" },
      target: { nodeId: `layer-${levelNumber}`, portId: `flow-${suffix}` },
    };
  });
}

export function fiveLevelRoutingDesignDocument(): BlockDesignDocument {
  const levels: DesignLevel[] = [{
    id: "system",
    title: "Five-Level Routing System",
    description: "Two sparse flows cross five independently expanded hierarchy boundaries.",
    nodes: [
      ...Array.from({ length: FLOW_COUNT }, (_, index) => sourceNode(index)),
      boundaryNode(1),
    ],
    connections: connections(1),
    layout: { direction: "RIGHT", spacing: 64, layerSpacing: 120 },
  }];
  for (let levelNumber = 1; levelNumber <= NESTED_LEVEL_COUNT; levelNumber += 1) {
    const deepest = levelNumber === NESTED_LEVEL_COUNT;
    levels.push({
      id: `level-${levelNumber}`,
      title: `Layer ${levelNumber}`,
      description: `Hierarchy layer ${levelNumber} of ${NESTED_LEVEL_COUNT}.`,
      parentLevelId: levelNumber === 1 ? "system" : `level-${levelNumber - 1}`,
      nodes: deepest
        ? Array.from({ length: FLOW_COUNT }, (_, index) => targetNode(index))
        : [
            ...Array.from({ length: FLOW_COUNT }, (_, index) => relayNode(levelNumber, index)),
            boundaryNode(levelNumber + 1),
          ],
      connections: deepest ? [] : connections(levelNumber + 1),
      layout: { direction: "RIGHT", spacing: 64, layerSpacing: 120 },
    });
  }
  return {
    schemaVersion: "2.2",
    id: "five-level-routing-stress",
    title: "Five-Level Routing Stress",
    summary: "Two sparse typed flows, five nested hierarchy boundaries, and exhaustive route auditing.",
    entryLevelId: "system",
    interfaceDefinitions: {
      "five-level.flow": {
        kind: "dto",
        title: "Five-Level Flow",
        protocol: "Hierarchy Routing v1",
        owner: "Connection Geometry",
        principle: "One typed flow per declared boundary port.",
        purpose: "Exercise deep hierarchy routing without ambiguous continuation geometry.",
        boundary: "Every layer owns its relay and explicit child binding.",
        failure: "Return a visible routing diagnostic when a legal route cannot be proven.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
    },
    levels,
  };
}
