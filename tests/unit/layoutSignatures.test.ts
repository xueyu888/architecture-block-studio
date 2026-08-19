import { describe, expect, test } from "vitest";
import {
  layoutGeometrySignature,
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
    expect(layoutGeometrySignature(edited)).toBe(layoutGeometrySignature(document));
  });

  test("tracks every visible node and route fact without treating them all as geometry", () => {
    const document = completedDesignDocument();
    const renamed = structuredClone(document);
    renamed.levels[0].nodes[0].title = "Renamed source";
    expect(layoutProjectionSignature(renamed)).not.toBe(layoutProjectionSignature(document));
    expect(layoutGeometrySignature(renamed)).toBe(layoutGeometrySignature(document));

    const rerouted = structuredClone(document);
    rerouted.levels[0].connections[0].routing = {
      waypoints: [{ x: 100, y: 20 }, { x: 100, y: 80 }],
    };
    expect(layoutProjectionSignature(rerouted)).not.toBe(layoutProjectionSignature(document));
    expect(layoutGeometrySignature(rerouted)).toBe(layoutGeometrySignature(document));
  });

  test("tracks topology, ordering inputs, dimensions, and entry hierarchy as geometry", () => {
    const document = completedDesignDocument();
    const moved = structuredClone(document);
    moved.levels[0].nodes[0].layout.position = { x: 320, y: 160 };
    expect(layoutGeometrySignature(moved)).not.toBe(layoutGeometrySignature(document));

    const retargeted = structuredClone(document);
    retargeted.levels[0].connections[0].target.nodeId = retargeted.levels[0].nodes[0].id;
    expect(layoutGeometrySignature(retargeted)).not.toBe(layoutGeometrySignature(document));
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
