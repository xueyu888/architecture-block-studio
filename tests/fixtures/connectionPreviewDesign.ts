import type { BlockDesignDocument, BlockNode } from "../../src/model";

function inspector(purpose: string): BlockNode["inspector"] {
  return {
    principle: "One explicit responsibility behind one declared port.",
    purpose,
    boundary: "Communicate only through typed interfaces.",
    failure: "Reject an invalid request without partial state.",
    code: "",
    codeLanguage: "jsonc",
    attributes: {},
  };
}

export function connectionPreviewDesignDocument(): BlockDesignDocument {
  return {
    schemaVersion: "2.2",
    id: "scene-aware-connection-preview",
    title: "Scene-Aware Connection Preview",
    summary: "A deliberate center obstacle proves that live pointer routing consumes the full scene.",
    entryLevelId: "system",
    interfaceDefinitions: {},
    levels: [{
      id: "system",
      title: "Preview Routing System",
      description: "Source and target are separated by an unrelated blocking module.",
      layout: { direction: "RIGHT", spacing: 80, layerSpacing: 160 },
      connections: [],
      nodes: [
        {
          id: "source",
          title: "Command Source",
          kind: "module",
          tone: "ui",
          owner: "Interaction Team",
          ports: [{
            id: "command",
            label: "command",
            side: "right",
            direction: "output",
            required: false,
            offset: 0.5,
          }],
          inspector: inspector("Emit one reviewed command."),
          layout: { position: { x: 0, y: 190 }, width: 250, height: 150, pinned: true },
        },
        {
          id: "blocker",
          title: "Independent Policy",
          kind: "module",
          tone: "platform",
          owner: "Policy Team",
          ports: [],
          inspector: inspector("Own policy independently from the command path."),
          layout: { position: { x: 390, y: 70 }, width: 260, height: 390, pinned: true },
        },
        {
          id: "target",
          title: "Command Target",
          kind: "module",
          tone: "core",
          owner: "Runtime Team",
          ports: [{
            id: "command",
            label: "command",
            side: "left",
            direction: "input",
            required: false,
            offset: 0.5,
          }],
          inspector: inspector("Accept one reviewed command."),
          layout: { position: { x: 790, y: 190 }, width: 250, height: 150, pinned: true },
        },
      ],
    }],
  };
}
