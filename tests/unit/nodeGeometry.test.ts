import { describe, expect, it } from "vitest";
import {
  BLOCK_NODE_GEOMETRY,
  baseNodeDimensions,
  minimumNodeDimensions,
  portAnchorOffset,
  portLabelWidth,
  preserveNodeAspectRatio,
  resolvePortPlacement,
} from "../../src/layout";
import { createBlock, createPort } from "../../src/editor/designEditor";

describe("block node geometry", () => {
  it("uses the rendered border box and handle edge as the routing anchor", () => {
    const ports = [
      createPort({ id: "first", label: "First", direction: "output", required: true }),
      createPort({ id: "second", label: "Second", direction: "output", required: true }),
    ];
    ports[0].offset = 1 / 3;
    ports[1].offset = 2 / 3;
    expect(portAnchorOffset({ width: 250, height: 175 }, ports, ports[0], false)).toEqual({
      x: 254,
      y: 1 + 173 / 3,
    });
    expect(portAnchorOffset({ width: 250, height: 175 }, ports, ports[1], true)).toEqual({
      x: 253,
      y: 2 + (171 * 2) / 3,
    });
  });

  it("keeps the default card size when no port rail needs more room", () => {
    const node = createBlock({ id: "module", title: "Module" });
    expect(minimumNodeDimensions(node)).toEqual({
      width: BLOCK_NODE_GEOMETRY.minimumWidth,
      height: BLOCK_NODE_GEOMETRY.minimumHeight,
    });
    expect(baseNodeDimensions(node)).toEqual({
      width: BLOCK_NODE_GEOMETRY.defaultWidth,
      height: BLOCK_NODE_GEOMETRY.defaultHeight,
    });
  });

  it("derives the right edge from output direction and reserves readable label width", () => {
    const node = createBlock({ id: "module", title: "Module" });
    node.layout.width = 120;
    node.layout.height = 80;
    ["project.lifecycle.command", "knowledge.lifecycle.command", "workspace.lifecycle.command"].forEach(
      (label, order) => {
        const port = createPort({
          id: `port-${order}`,
          label,
          direction: "output",
          required: false,
        });
        port.offset = (order + 1) / 4;
        node.ports.push(port);
      },
    );

    const dimensions = baseNodeDimensions(node);

    expect(node.ports.every((port) => port.side === "right")).toBe(true);
    expect(dimensions).toEqual({ width: 270, height: 180 });
  });

  it("reserves vertical slots for dense side ports without changing document data", () => {
    const node = createBlock({ id: "module", title: "Module" });
    for (let index = 0; index < 5; index += 1) {
      const port = createPort({
        id: `port-${index}`,
        label: `event-${index}`,
        direction: "output",
        required: false,
      });
      port.offset = (index + 1) / 6;
      node.ports.push(port);
    }

    expect(baseNodeDimensions(node).height).toBe(270);
    expect(node.layout).toEqual({ pinned: false });
  });

  it("expands the card when authored side offsets are too close to render distinctly", () => {
    const node = createBlock({ id: "module", title: "Module" });
    const first = createPort({ id: "first", label: "First", direction: "output", required: false });
    const second = createPort({ id: "second", label: "Second", direction: "output", required: false });
    first.offset = 0.49;
    second.offset = 0.51;
    node.ports.push(first, second);

    expect(minimumNodeDimensions(node).height).toBe(1300);
  });

  it("preserves authored geometry when it already satisfies the label contract", () => {
    const node = createBlock({ id: "module", title: "Module" });
    node.layout.width = 260;
    node.layout.height = 132;
    node.ports.push(
      createPort({ id: "in", label: "Input", direction: "input", required: false }),
      createPort({ id: "out", label: "Output", direction: "output", required: false }),
    );

    expect(baseNodeDimensions(node)).toEqual({ width: 260, height: 132 });
  });

  it("keeps an input on the left edge while moving its vertical offset", () => {
    const ports = [
      createPort({ id: "moving", label: "Moving", direction: "input", required: false }),
      createPort({ id: "fixed", label: "Fixed", direction: "input", required: false }),
    ];
    ports[1].offset = 0.5;

    expect(resolvePortPlacement(
      { width: 240, height: 160 },
      ports,
      "moving",
      { x: 236, y: 80 },
    )).toEqual({ side: "left", offset: 0.3375 });
    expect(resolvePortPlacement(
      { width: 240, height: 160 },
      ports,
      "moving",
      { x: 120, y: 3 },
    )).toEqual({ side: "left", offset: 0.2813 });
  });

  it("preserves resize proportions around the opposite corner and clamps both dimensions together", () => {
    const original = { x: 100, y: 200, width: 240, height: 145 };
    const limits = { minWidth: 180, minHeight: 112, maxWidth: 400, maxHeight: 300 };

    expect(preserveNodeAspectRatio(
      original,
      { x: 100, y: 200, width: 360, height: 160 },
      { x: 1, y: 1 },
      limits,
    )).toEqual({ x: 100, y: 200, width: 360, height: 218 });
    expect(preserveNodeAspectRatio(
      original,
      { x: -100, y: 0, width: 500, height: 400 },
      { x: -1, y: -1 },
      limits,
    )).toEqual({ x: -60, y: 103, width: 400, height: 242 });
  });
});
