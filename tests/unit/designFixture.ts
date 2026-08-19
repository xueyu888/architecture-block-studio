import {
  applyDesignOperation,
  createBlankDesign,
  createBlock,
  createDesignLevel,
  createInterfaceDefinition,
  createPort,
} from "../../src/editor/designEditor";
import type { BlockDesignDocument } from "../../src/model";

export function connectedDesign(): BlockDesignDocument {
  let document = createBlankDesign("test-design", "Test Design");
  const source = createBlock({ id: "source", title: "Source" });
  source.ports.push(createPort({
    id: "out",
    label: "Output",
    side: "right",
    direction: "output",
    required: true,
  }));
  const target = createBlock({ id: "target", title: "Target" });
  target.ports.push(createPort({
    id: "in",
    label: "Input",
    side: "left",
    direction: "input",
    required: true,
  }));
  document = applyDesignOperation(document, { type: "node/add", levelId: "system", node: source });
  document = applyDesignOperation(document, { type: "node/add", levelId: "system", node: target });
  return applyDesignOperation(document, {
    type: "connection/add",
    levelId: "system",
    connection: {
      id: "source-to-target",
      interfaceId: "source.output",
      source: { nodeId: "source", portId: "out" },
      target: { nodeId: "target", portId: "in" },
    },
    definition: createInterfaceDefinition({
      id: "source.output",
      title: "Source Output",
      kind: "dto",
      owner: "Source",
    }),
  });
}

export function completeContracts(document: BlockDesignDocument): BlockDesignDocument {
  const completed = structuredClone(document);
  completed.levels.flatMap((level) => level.nodes).forEach((node) => {
    node.inspector.purpose = `${node.title} purpose`;
    node.inspector.boundary = `${node.title} boundary`;
    node.inspector.failure = `${node.title} failure`;
  });
  Object.values(completed.interfaceDefinitions).forEach((definition) => {
    definition.purpose = `${definition.title} purpose`;
    definition.boundary = `${definition.title} boundary`;
    definition.failure = `${definition.title} failure`;
  });
  return completed;
}

export function hierarchicalDesign(): BlockDesignDocument {
  let document = createBlankDesign("hierarchy-test", "Hierarchy Test");
  const parent = createBlock({ id: "parent", title: "Parent" });
  parent.ports.push(createPort({
    id: "public",
    label: "Public",
    side: "right",
    direction: "output",
    required: false,
  }));
  document = applyDesignOperation(document, {
    type: "node/add",
    levelId: "system",
    node: parent,
  });
  document = applyDesignOperation(document, {
    type: "hierarchy/add",
    levelId: "system",
    nodeId: "parent",
    childLevel: createDesignLevel("parent-internal", "Parent Internal", "system"),
  });
  const child = createBlock({ id: "child", title: "Child" });
  child.ports.push(createPort({
    id: "out",
    label: "Output",
    side: "right",
    direction: "output",
    required: false,
  }));
  document = applyDesignOperation(document, {
    type: "node/add",
    levelId: "parent-internal",
    node: child,
  });
  return applyDesignOperation(document, {
    type: "hierarchy/bind",
    levelId: "system",
    nodeId: "parent",
    binding: {
      parentPortId: "public",
      childEndpoint: { nodeId: "child", portId: "out" },
    },
  });
}
