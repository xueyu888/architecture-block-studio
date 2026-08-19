import { describe, expect, it } from "vitest";
import {
  BLOCK_NODE_GEOMETRY,
  baseNodeDimensions,
  portLabelWidth,
  portRailOffset,
  portsForSide,
} from "../../src/layout";
import { createBlock, createPort } from "../../src/editor/designEditor";

describe("block node geometry", () => {
  it("keeps the default card size when no port rail needs more room", () => {
    expect(baseNodeDimensions(createBlock({ id: "module", title: "Module" }))).toEqual({
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
});
