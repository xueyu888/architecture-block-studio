import type { BlockDesignDocument, BlockNode } from "../../src/model";

function inspector(purpose: string): BlockNode["inspector"] {
  return {
    principle: "A selected module group moves as one geometric subject.",
    purpose,
    boundary: "Alignment changes positions but never interface ownership.",
    failure: "Reject partial group movement and preserve the prior design.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

export function groupAlignmentDesignDocument(): BlockDesignDocument {
  return {
    schemaVersion: "2.1",
    id: "group-alignment-proof",
    title: "Group Alignment Proof",
    summary: "Different-sized modules expose one stable selection boundary and one shared correction.",
    entryLevelId: "system",
    interfaceDefinitions: {
      "group.internal": {
        kind: "internal",
        title: "Group Internal",
        protocol: "Group Protocol v1",
        owner: "Architecture Team",
        principle: "Internal contracts move with the selected group.",
        purpose: "Keep the group route readable while both endpoints move.",
        boundary: "The contract stays inside the selected pair.",
        failure: "Preserve the previous route when movement is rejected.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
      "group.review": {
        kind: "event",
        title: "Group Review",
        protocol: "Review Protocol v1",
        owner: "Review Team",
        principle: "The target remains independent from the moving group.",
        purpose: "Expose the external route affected by group alignment.",
        boundary: "Only the endpoint modules own this contract.",
        failure: "Keep the last reviewed route visible.",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
    },
    levels: [{
      id: "system",
      title: "Group Boundary Alignment",
      description: "Drag either selected module: the same group edge aligns with Review Target.",
      layout: { direction: "RIGHT", spacing: 80, layerSpacing: 160 },
      connections: [
        {
          id: "group-internal",
          interfaceId: "group.internal",
          source: { nodeId: "group-a", portId: "internal-out" },
          target: { nodeId: "group-b", portId: "internal-in" },
        },
        {
          id: "group-review",
          interfaceId: "group.review",
          source: { nodeId: "group-b", portId: "review-out" },
          target: { nodeId: "target", portId: "review-in" },
        },
      ],
      nodes: [
        {
          id: "group-a",
          title: "Compact Author",
          kind: "module",
          tone: "ui",
          owner: "Architecture Team",
          ports: [{
            id: "internal-out",
            label: "group.internal",
            side: "bottom",
            direction: "output",
            required: true,
          }],
          inspector: inspector("Represent the compact member of the moving selection."),
          layout: { position: { x: 64, y: 64 }, width: 192, height: 144, pinned: true },
        },
        {
          id: "group-b",
          title: "Expanded Coordinator",
          kind: "module",
          tone: "core",
          owner: "Runtime Team",
          ports: [
            {
              id: "internal-in",
              label: "group.internal",
              side: "top",
              direction: "input",
              required: true,
            },
            {
              id: "review-out",
              label: "group.review",
              side: "bottom",
              direction: "output",
              required: true,
            },
          ],
          inspector: inspector("Represent the larger member and preserve group-relative geometry."),
          layout: { position: { x: 320, y: 288 }, width: 256, height: 192, pinned: true },
        },
        {
          id: "target",
          title: "Review Target",
          kind: "module",
          tone: "platform",
          owner: "Review Team",
          ports: [{
            id: "review-in",
            label: "group.review",
            side: "top",
            direction: "input",
            required: true,
          }],
          inspector: inspector("Provide the stable candidate edge used by the group guide."),
          layout: { position: { x: 1124, y: 600 }, width: 208, height: 208, pinned: true },
        },
      ],
    }],
  };
}
