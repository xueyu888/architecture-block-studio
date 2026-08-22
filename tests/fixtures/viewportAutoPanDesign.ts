import type { BlockDesignDocument, BlockNode } from "../../src/model";

function inspector(purpose: string): BlockNode["inspector"] {
  return {
    principle: "Keep one explicit responsibility behind one declared port.",
    purpose,
    boundary: "Communicate only through the reviewed interface.",
    failure: "Reject invalid input without partial state.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

export function viewportAutoPanDesignDocument(): BlockDesignDocument {
  return {
    schemaVersion: "2.3",
    id: "viewport-auto-pan-proof",
    title: "Viewport Edge Auto-Pan",
    summary: "A sparse, obstruction-free scene for reviewing continuous route editing at the viewport edge.",
    entryLevelId: "system",
    interfaceDefinitions: {
      "review.flow": {
        kind: "event",
        title: "Reviewed Flow",
        protocol: "Review Protocol v1",
        owner: "Architecture Team",
        principle: "One visible route carries one reviewed contract.",
        purpose: "Prove that route editing remains attached to the pointer during viewport motion.",
        boundary: "The route stays outside both module boundaries.",
        failure: "Canceling the gesture preserves the committed route.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
    },
    levels: [{
      id: "system",
      title: "Viewport Interaction Proof",
      description: "An output-right to input-left connection leaves a clear horizontal corridor to the viewport edge.",
      layout: { direction: "DOWN", spacing: 120, layerSpacing: 180 },
      connections: [{
        id: "review-flow",
        interfaceId: "review.flow",
        source: { nodeId: "source", portId: "review-out" },
        target: { nodeId: "target", portId: "review-in" },
      }],
      nodes: [
        {
          id: "source",
          title: "Review Source",
          kind: "module",
          tone: "ui",
          owner: "Architecture Team",
          ports: [{
            id: "review-out",
            label: "review.flow",
            side: "right",
            direction: "output",
            required: true,
            offset: 0.5,
          }],
          inspector: inspector("Emit one reviewed architecture fact."),
          layout: { position: { x: 120, y: 80 }, width: 300, height: 170, pinned: true },
        },
        {
          id: "target",
          title: "Review Target",
          kind: "module",
          tone: "core",
          owner: "Runtime Team",
          ports: [{
            id: "review-in",
            label: "review.flow",
            side: "left",
            direction: "input",
            required: true,
            offset: 0.5,
          }],
          inspector: inspector("Accept one reviewed architecture fact."),
          layout: { position: { x: 720, y: 80 }, width: 300, height: 170, pinned: true },
        },
      ],
    }],
  };
}
