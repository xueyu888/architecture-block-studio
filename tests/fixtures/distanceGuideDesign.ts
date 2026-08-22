import type { BlockDesignDocument, BlockNode, InterfaceDefinition } from "../../src/model";

function inspector(purpose: string): BlockNode["inspector"] {
  return {
    principle: "Equal spacing is derived from neighboring module geometry.",
    purpose,
    boundary: "Spacing feedback never changes interface ownership or contract semantics.",
    failure: "Fall back to alignment or grid placement when no valid spacing pair exists.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

function interfaceDefinition(title: string): InterfaceDefinition {
  return {
    kind: "internal",
    title,
    protocol: "Spacing Proof v1",
    owner: "Architecture Team",
    principle: "The interface remains readable while its endpoint module moves.",
    purpose: "Expose route behavior during equal-distance placement.",
    boundary: "The route does not define module spacing.",
    failure: "Preserve the previous document geometry when movement is rejected.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

export function distanceGuideDesignDocument(): BlockDesignDocument {
  return {
    schemaVersion: "2.3",
    id: "distance-guide-proof",
    title: "Equal Distance Guide Proof",
    summary: "A moving module snaps between its nearest overlapping neighbors.",
    entryLevelId: "system",
    interfaceDefinitions: {
      "spacing.left": interfaceDefinition("Left Spacing Contract"),
      "spacing.right": interfaceDefinition("Right Spacing Contract"),
    },
    levels: [{
      id: "system",
      title: "Single Module Equal Spacing",
      description: "Move Coordinator until both neighboring gaps are equal.",
      layout: { direction: "RIGHT", spacing: 80, layerSpacing: 160 },
      connections: [
        {
          id: "left-to-subject",
          interfaceId: "spacing.left",
          source: { nodeId: "left", portId: "out" },
          target: { nodeId: "subject", portId: "in" },
        },
        {
          id: "subject-to-right",
          interfaceId: "spacing.right",
          source: { nodeId: "subject", portId: "out" },
          target: { nodeId: "right", portId: "in" },
        },
      ],
      nodes: [
        {
          id: "left",
          title: "Request Source",
          kind: "module",
          tone: "ui",
          owner: "UI Team",
          ports: [{ id: "out", label: "request", side: "right", direction: "output", required: true, offset: 0.5 }],
          inspector: inspector("Provide the fixed neighbor before the moving module."),
          layout: { position: { x: 64, y: 170 }, width: 192, height: 120, pinned: true },
        },
        {
          id: "subject",
          title: "Runtime Coordinator",
          kind: "module",
          tone: "core",
          owner: "Runtime Team",
          ports: [
            { id: "in", label: "request", side: "left", direction: "input", required: true, offset: 0.5 },
            { id: "out", label: "result", side: "right", direction: "output", required: true, offset: 0.5 },
          ],
          inspector: inspector("Represent the single moving module and its live distance feedback."),
          layout: { position: { x: 320, y: 240 }, width: 256, height: 192, pinned: true },
        },
        {
          id: "right",
          title: "Review Sink",
          kind: "module",
          tone: "platform",
          owner: "Review Team",
          ports: [{ id: "in", label: "result", side: "left", direction: "input", required: true, offset: 0.5 }],
          inspector: inspector("Provide the fixed neighbor after the moving module."),
          layout: { position: { x: 1000, y: 390 }, width: 208, height: 120, pinned: true },
        },
      ],
    }],
  };
}

export function groupDistanceGuideDesignDocument(): BlockDesignDocument {
  return {
    schemaVersion: "2.3",
    id: "group-distance-guide-proof",
    title: "Group Equal Distance Guide Proof",
    summary: "A differently sized module group snaps as one spacing subject.",
    entryLevelId: "system",
    interfaceDefinitions: {
      ingress: interfaceDefinition("Group Ingress"),
      internal: interfaceDefinition("Group Internal"),
      egress: interfaceDefinition("Group Egress"),
    },
    levels: [{
      id: "system",
      title: "Group Equal Spacing",
      description: "Drag either selected member until the whole group has equal outside gaps.",
      layout: { direction: "RIGHT", spacing: 80, layerSpacing: 160 },
      connections: [
        {
          id: "ingress",
          interfaceId: "ingress",
          source: { nodeId: "left", portId: "out" },
          target: { nodeId: "group-a", portId: "in" },
        },
        {
          id: "internal",
          interfaceId: "internal",
          source: { nodeId: "group-a", portId: "out" },
          target: { nodeId: "group-b", portId: "in" },
        },
        {
          id: "egress",
          interfaceId: "egress",
          source: { nodeId: "group-b", portId: "out" },
          target: { nodeId: "right", portId: "in" },
        },
      ],
      nodes: [
        {
          id: "left",
          title: "External Source",
          kind: "module",
          tone: "ui",
          owner: "UI Team",
          ports: [{ id: "out", label: "ingress", side: "right", direction: "output", required: true, offset: 0.5 }],
          inspector: inspector("Provide the fixed neighbor before the selected group."),
          layout: { position: { x: 64, y: 240 }, width: 192, height: 208, pinned: true },
        },
        {
          id: "group-a",
          title: "Compact Adapter",
          kind: "module",
          tone: "core",
          owner: "Runtime Team",
          ports: [
            { id: "in", label: "ingress", side: "left", direction: "input", required: true, offset: 0.5 },
            { id: "out", label: "internal", side: "right", direction: "output", required: true, offset: 0.5 },
          ],
          inspector: inspector("Represent the compact member of the moving group."),
          layout: { position: { x: 320, y: 160 }, width: 192, height: 144, pinned: true },
        },
        {
          id: "group-b",
          title: "Expanded Runtime",
          kind: "module",
          tone: "tool",
          owner: "Tool Team",
          ports: [
            { id: "in", label: "internal", side: "left", direction: "input", required: true, offset: 0.5 },
            { id: "out", label: "egress", side: "right", direction: "output", required: true, offset: 0.5 },
          ],
          inspector: inspector("Represent the larger member and preserve relative geometry."),
          layout: { position: { x: 352, y: 400 }, width: 256, height: 192, pinned: true },
        },
        {
          id: "right",
          title: "External Sink",
          kind: "module",
          tone: "platform",
          owner: "Review Team",
          ports: [{ id: "in", label: "egress", side: "left", direction: "input", required: true, offset: 0.5 }],
          inspector: inspector("Provide the fixed neighbor after the selected group."),
          layout: { position: { x: 1120, y: 240 }, width: 208, height: 208, pinned: true },
        },
      ],
    }],
  };
}
