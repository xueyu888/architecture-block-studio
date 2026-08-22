import type { BlockDesignDocument, BlockPort, PortSide } from "../../src/model";

const HUB_X = 1_200;
const HUB_Y = 1_000;
const HUB_WIDTH = 5_000;
const HUB_HEIGHT = 3_500;
const SATELLITE_WIDTH = 180;
const SATELLITE_HEIGHT = 112;
const PORTS_PER_SIDE = 50;

function hubPort(side: PortSide, index: number): BlockPort {
  const incoming = side === "left";
  return {
    id: `${side}-${index.toString().padStart(2, "0")}`,
    label: `${side}.${index.toString().padStart(2, "0")}`,
    side,
    direction: incoming ? "input" : "output",
    required: false,
    offset: (index + 1) / (PORTS_PER_SIDE + 1),
  };
}

function portCoordinate(side: PortSide, index: number): { x: number; y: number } {
  const fraction = (index + 1) / (PORTS_PER_SIDE + 1);
  return {
    x: HUB_X + (side === "left" ? 0 : HUB_WIDTH),
    y: HUB_Y + HUB_HEIGHT * fraction,
  };
}

export function routingStressDesignDocument(): BlockDesignDocument {
  const sides: PortSide[] = ["left", "right"];
  const ports = sides.flatMap((side) =>
    Array.from({ length: PORTS_PER_SIDE }, (_, index) => hubPort(side, index))
  );
  const connections: BlockDesignDocument["levels"][number]["connections"] = [];
  const satellites = ports.map((port, flatIndex) => {
    const index = flatIndex % PORTS_PER_SIDE;
    const coordinate = portCoordinate(port.side, index);
    const satelliteId = `satellite-${port.side}-${index.toString().padStart(2, "0")}`;
    const hubIsSource = port.direction === "output";
    const satellitePort: BlockPort = {
      id: "link",
      label: "link",
      side: port.side === "left" ? "right" : "left",
      direction: hubIsSource ? "input" : "output",
      required: false,
      offset: 0.5,
    };
    const position = port.side === "left"
      ? { x: 800, y: coordinate.y - SATELLITE_HEIGHT / 2 }
      : { x: 6_400, y: coordinate.y - SATELLITE_HEIGHT / 2 };
    connections.push({
      id: `hub-${port.side}-${index.toString().padStart(2, "0")}`,
      interfaceId: "stress.flow",
      source: hubIsSource
        ? { nodeId: "hub", portId: port.id }
        : { nodeId: satelliteId, portId: satellitePort.id },
      target: hubIsSource
        ? { nodeId: satelliteId, portId: satellitePort.id }
        : { nodeId: "hub", portId: port.id },
    });
    return {
      id: satelliteId,
      title: `Satellite ${port.side} ${index.toString().padStart(2, "0")}`,
      kind: "module",
      tone: "platform",
      owner: "Satellite Team",
      ports: [satellitePort],
      inspector: {
        principle: "One leaf connection.",
        purpose: "Prove that low-degree modules remain readable beside a high-degree hub.",
        boundary: "Own exactly one declared interface.",
        failure: "Reject invalid input atomically.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
      layout: {
        position,
        width: SATELLITE_WIDTH,
        height: SATELLITE_HEIGHT,
        pinned: true,
      },
    };
  });

  return {
    schemaVersion: "2.3",
    id: "routing-skew-stress",
    title: "Routing Skew Stress",
    summary: "One 100-connection hub surrounded by 100 one-connection modules.",
    entryLevelId: "system",
    interfaceDefinitions: {
      "stress.flow": {
        kind: "dto",
        title: "Stress Flow",
        protocol: "Routing Stress v1",
        owner: "Connection Geometry",
        principle: "One visible typed connection.",
        purpose: "Exercise deterministic high-degree routing.",
        boundary: "No hidden shared state or implicit endpoint.",
        failure: "An unreadable route must not be reported as feasible.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
    },
    levels: [{
      id: "system",
      title: "Skewed Routing System",
      description: "A deliberately non-uniform degree distribution.",
      nodes: [{
        id: "hub",
        title: "Routing Hub",
        kind: "module",
        tone: "core",
        owner: "Connection Geometry",
        ports,
        inspector: {
          principle: "Own one high-degree integration boundary.",
          purpose: "Prove that a module with 100 interfaces remains inspectable.",
          boundary: "Every connection terminates at a distinct declared port.",
          failure: "Surface capacity failure instead of drawing coincident routes.",
          code: "",
          codeLanguage: "jsonc",
          attributes: {},
        },
        layout: {
          position: { x: HUB_X, y: HUB_Y },
          width: HUB_WIDTH,
          height: HUB_HEIGHT,
          pinned: true,
        },
      }, ...satellites],
      connections,
      layout: { direction: "RIGHT", spacing: 64, layerSpacing: 120 },
    }],
  };
}
