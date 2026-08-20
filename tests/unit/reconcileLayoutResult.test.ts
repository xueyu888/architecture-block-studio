import { describe, expect, it } from "vitest";
import { reconcileLayoutResult, type LayoutResult } from "../../src/layout";

function layout(width = 200): LayoutResult {
  return {
    nodes: [
      {
        id: "system::left",
        type: "block",
        position: { x: 0, y: 0 },
        width,
        height: 120,
        data: {
          block: {
            id: "left",
            title: "Left",
            kind: "module",
            tone: "neutral",
            ports: [],
            inspector: { principle: "", purpose: "", boundary: "", failure: "", code: "", codeLanguage: "jsonc", attributes: {} },
            layout: { position: { x: 0, y: 0 }, width, height: 120, pinned: true },
          },
          levelId: "system",
          expanded: false,
          hierarchyDepth: 0,
          designPosition: { x: 0, y: 0 },
          projectedPosition: { x: 0, y: 0 },
          positionEditable: true,
        },
      },
      {
        id: "system::right",
        type: "block",
        position: { x: 320, y: 0 },
        width: 200,
        height: 120,
        data: {
          block: {
            id: "right",
            title: "Right",
            kind: "module",
            tone: "neutral",
            ports: [],
            inspector: { principle: "", purpose: "", boundary: "", failure: "", code: "", codeLanguage: "jsonc", attributes: {} },
            layout: { position: { x: 320, y: 0 }, width: 200, height: 120, pinned: true },
          },
          levelId: "system",
          expanded: false,
          hierarchyDepth: 0,
          designPosition: { x: 320, y: 0 },
          projectedPosition: { x: 320, y: 0 },
          positionEditable: true,
        },
      },
    ],
    edges: [],
  };
}

describe("layout result reconciliation", () => {
  it("reuses a completely equivalent disposable projection", () => {
    const previous = layout();
    expect(reconcileLayoutResult(previous, structuredClone(previous))).toBe(previous);
  });

  it("replaces only the item whose complete projection changed", () => {
    const previous = layout();
    const next = layout(240);
    const reconciled = reconcileLayoutResult(previous, next);
    expect(reconciled).not.toBe(previous);
    expect(reconciled.nodes[0]).toBe(next.nodes[0]);
    expect(reconciled.nodes[1]).toBe(previous.nodes[1]);
  });
});
