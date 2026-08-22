import { describe, expect, test } from "vitest";
import {
  layoutFrameSignature,
  layoutProjectionSignature,
} from "../../src/layout";
import { completeContracts, connectedDesign } from "./designFixture";

function completedDesignDocument() {
  return completeContracts(connectedDesign());
}

describe("layout document signatures", () => {
  test("ignores prose that belongs only to document, level, and Inspector views", () => {
    const document = completedDesignDocument();
    const edited = structuredClone(document);
    edited.title = "Renamed architecture";
    edited.summary = "Rewritten summary";
    edited.levels[0].title = "Renamed level";
    edited.levels[0].description = "Rewritten level description";
    edited.levels[0].nodes[0].inspector.purpose = "Rewritten contract purpose";
    edited.interfaceDefinitions["source.output"].purpose = "Rewritten interface purpose";

    expect(layoutProjectionSignature(edited)).toBe(layoutProjectionSignature(document));
    expect(layoutFrameSignature(edited)).toBe(layoutFrameSignature(document));
  });

  test("tracks every visible node and route fact without treating them all as geometry", () => {
    const document = completedDesignDocument();
    const renamed = structuredClone(document);
    renamed.levels[0].nodes[0].title = "Renamed source";
    expect(layoutProjectionSignature(renamed)).not.toBe(layoutProjectionSignature(document));
    expect(layoutFrameSignature(renamed)).toBe(layoutFrameSignature(document));

    const rerouted = structuredClone(document);
    rerouted.levels[0].connections[0].routing = {
      waypoints: [{ x: 100, y: 20 }, { x: 100, y: 80 }],
    };
    expect(layoutProjectionSignature(rerouted)).not.toBe(layoutProjectionSignature(document));
    expect(layoutFrameSignature(rerouted)).toBe(layoutFrameSignature(document));
  });

  test("keeps direct authored geometry in the current frame and tracks structural changes", () => {
    const document = completedDesignDocument();
    const moved = structuredClone(document);
    moved.levels[0].nodes[0].layout.position = { x: 320, y: 160 };
    expect(layoutFrameSignature(moved)).toBe(layoutFrameSignature(document));

    const resized = structuredClone(document);
    resized.levels[0].nodes[0].layout.width = 420;
    expect(layoutFrameSignature(resized)).toBe(layoutFrameSignature(document));

    const retargeted = structuredClone(document);
    retargeted.levels[0].connections[0].target.nodeId = retargeted.levels[0].nodes[0].id;
    expect(layoutFrameSignature(retargeted)).not.toBe(layoutFrameSignature(document));

    const addedPort = structuredClone(document);
    addedPort.levels[0].nodes[0].ports.push({
      id: "status",
      label: "Status",
      side: "right",
      direction: "output",
      required: false,
    });
    expect(layoutFrameSignature(addedPort)).not.toBe(layoutFrameSignature(document));
  });

  test("canonicalizes interface definition record order", () => {
    const document = completedDesignDocument();
    document.interfaceDefinitions["unused"] = {
      ...structuredClone(document.interfaceDefinitions["source.output"]),
      kind: "internal",
    };
    const reordered = structuredClone(document);
    reordered.interfaceDefinitions = Object.fromEntries(
      Object.entries(reordered.interfaceDefinitions).reverse(),
    );

    expect(layoutProjectionSignature(reordered)).toBe(layoutProjectionSignature(document));
  });
});
