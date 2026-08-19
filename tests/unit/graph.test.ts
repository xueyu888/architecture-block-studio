import { describe, expect, test } from "vitest";
import {
  firstConnectablePair,
  listLevelPortEndpoints,
  listModuleInterfaces,
  normalizeConnectionEndpoints,
} from "../../src/model";
import { connectedDesign } from "./designFixture";

describe("module interface summaries", () => {
  test("derives stable outgoing and incoming views from the same connection", () => {
    const document = connectedDesign();

    expect(listModuleInterfaces(document, "system", "source")).toEqual([expect.objectContaining({
      connectionId: "source-to-target",
      interfaceId: "source.output",
      title: "Source Output",
      kind: "dto",
      direction: "outgoing",
      localPortLabel: "Output",
      peerNodeTitle: "Target",
      peerPortLabel: "Input",
    })]);
    expect(listModuleInterfaces(document, "system", "target")).toEqual([expect.objectContaining({
      connectionId: "source-to-target",
      direction: "incoming",
      localPortLabel: "Input",
      peerNodeTitle: "Source",
      peerPortLabel: "Output",
    })]);
  });

  test("returns an empty derived view for missing modules", () => {
    expect(listModuleInterfaces(connectedDesign(), "system", "missing")).toEqual([]);
  });

  test("falls back to ids when a semantically invalid reference is unresolved", () => {
    const document = connectedDesign();
    delete document.interfaceDefinitions["source.output"];
    document.levels[0].nodes = document.levels[0].nodes.filter((node) => node.id !== "target");

    expect(listModuleInterfaces(document, "system", "source")).toEqual([expect.objectContaining({
      title: "source.output",
      kind: undefined,
      peerNodeTitle: "target",
      peerPortLabel: "in",
    })]);
  });
});

describe("connection endpoint normalization", () => {
  test("normalizes either gesture order to output then input", () => {
    const level = connectedDesign().levels[0];
    const [output, input] = listLevelPortEndpoints(level);

    expect(normalizeConnectionEndpoints(output, input)).toEqual({
      levelId: "system",
      source: output,
      target: input,
    });
    expect(normalizeConnectionEndpoints(input, output)).toEqual({
      levelId: "system",
      source: output,
      target: input,
    });
  });

  test("rejects the same endpoint and incompatible direction pairs", () => {
    const level = connectedDesign().levels[0];
    const [output, input] = listLevelPortEndpoints(level);

    expect(normalizeConnectionEndpoints(output, output)).toBeUndefined();
    expect(normalizeConnectionEndpoints({ ...input, portId: "other-input" }, input)).toBeUndefined();
  });

  test("finds the first compatible pair in stable document order", () => {
    const level = connectedDesign().levels[0];

    expect(firstConnectablePair(level)).toEqual(expect.objectContaining({
      source: expect.objectContaining({ nodeId: "source", portId: "out" }),
      target: expect.objectContaining({ nodeId: "target", portId: "in" }),
    }));
  });
});
