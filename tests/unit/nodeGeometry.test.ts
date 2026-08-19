import { describe, expect, it } from "vitest";
import {
  BLOCK_NODE_GEOMETRY,
  baseNodeDimensions,
  minimumNodeDimensions,
  portAnchorOffset,
  portLabelWidth,
  portRailOffset,
  portsForSide,
  preserveNodeAspectRatio,
} from "../../src/layout";
import { createBlock, createPort } from "../../src/editor/designEditor";

describe("block node geometry", () => {
  it("uses the rendered border box and handle edge as the routing anchor", () => {
    const ports = [
      createPort({ id: "first", label: "First", side: "right", direction: "output", required: true }),
      createPort({ id: "second", label: "Second", side: "right", direction: "output", required: true }),
    ];
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

  it("derives one safe horizontal rail from port labels and clamps undersized authored geometry", () => {
    const node = createBlock({ id: "module", title: "Module" });
    node.layout.width = 120;
    node.layout.height = 80;
    ["project.lifecycle.command", "knowledge.lifecycle.command", "workspace.lifecycle.command"].forEach(
      (label, order) => node.ports.push(createPort({
        id: `port-${order}`,
        label,
        side: "top",
        direction: "output",
        order,
        required: false,
      })),
    );

    const ports = portsForSide(node.ports, "top");
    const dimensions = baseNodeDimensions(node);
    const widths = ports.map((port) => portLabelWidth(port.label));
    const centers = ports.map((_, index) => dimensions.width * portRailOffset(ports, index) / 100);

    expect(dimensions).toEqual({ width: 422, height: 114 });
    expect(centers[0] - widths[0] / 2).toBeGreaterThanOrEqual(BLOCK_NODE_GEOMETRY.horizontalRailPadding);
    expect(centers[1] - centers[0]).toBeGreaterThanOrEqual(
      (widths[0] + widths[1]) / 2 + BLOCK_NODE_GEOMETRY.horizontalPortGap,
    );
    expect(dimensions.width - (centers[2] + widths[2] / 2))
      .toBeGreaterThanOrEqual(BLOCK_NODE_GEOMETRY.horizontalRailPadding);
  });

  it("reserves vertical slots for dense side ports without changing document data", () => {
    const node = createBlock({ id: "module", title: "Module" });
    for (let index = 0; index < 5; index += 1) {
      node.ports.push(createPort({
        id: `port-${index}`,
        label: `event-${index}`,
        side: "right",
        direction: "output",
        order: index,
        required: false,
      }));
    }

    expect(baseNodeDimensions(node).height).toBe(180);
    expect(node.layout).toEqual({ pinned: false });
  });

  it("preserves authored geometry when it already satisfies the label contract", () => {
    const node = createBlock({ id: "module", title: "Module" });
    node.layout.width = 236;
    node.layout.height = 132;
    node.ports.push(
      createPort({ id: "in", label: "Input", side: "left", direction: "input", required: false }),
      createPort({ id: "out", label: "Output", side: "right", direction: "output", required: false }),
    );

    expect(baseNodeDimensions(node)).toEqual({ width: 236, height: 132 });
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
