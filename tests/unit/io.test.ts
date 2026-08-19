import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DesignLoadError,
  loadDesignFromFile,
  loadDesignFromObject,
  loadDesignFromUrl,
} from "../../src/io/loadDesign";
import {
  normalizeDesignFileName,
  serializeDesign,
  serializeDesignSnapshot,
  suggestedDesignFileName,
} from "../../src/io/saveDesign";
import { connectedDesign } from "./designFixture";

afterEach(() => vi.restoreAllMocks());

describe("design loading", () => {
  test("wraps schema failures with an addressable field path", () => {
    expect(() => loadDesignFromObject({ schemaVersion: "2.1" })).toThrow(DesignLoadError);
    try {
      loadDesignFromObject({ schemaVersion: "2.1" });
    } catch (error) {
      expect(error).toBeInstanceOf(DesignLoadError);
      expect((error as DesignLoadError).causeDetail).toContain("levels");
    }
  });

  test("reports unsupported versions at the schemaVersion field", () => {
    let caught: unknown;
    try {
      loadDesignFromObject({ schemaVersion: "2.2" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DesignLoadError);
    expect((caught as DesignLoadError).causeDetail).toContain(
      "schemaVersion: Unsupported BlockDesignDocument schemaVersion \"2.2\"",
    );
  });

  test("keeps the local file name in malformed JSON feedback", async () => {
    const file = new File(["{"], "broken.block-design.json", { type: "application/json" });

    await expect(loadDesignFromFile(file)).rejects.toMatchObject({
      name: "DesignLoadError",
      message: "Unable to parse broken.block-design.json.",
    });
  });

  test("reports HTTP status without attempting to install a document", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

    await expect(loadDesignFromUrl("https://example.test/missing.json")).rejects.toMatchObject({
      name: "DesignLoadError",
      causeDetail: "HTTP 404 Not Found",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/missing.json", {
      headers: { Accept: "application/json" },
    });
  });
});

describe("design serialization names", () => {
  test("normalizes unsafe file-name characters and keeps supported suffixes", () => {
    expect(normalizeDesignFileName("  team/api:v2  ")).toBe("team-api-v2.block-design.json");
    expect(normalizeDesignFileName("design.json")).toBe("design.json");
    expect(() => normalizeDesignFileName("  ")).toThrow("File name cannot be empty.");
  });

  test("derives the suggested name and serialized body from the same document", () => {
    const document = connectedDesign();

    expect(suggestedDesignFileName(document)).toBe("test-design.block-design.json");
    expect(JSON.parse(serializeDesign(document))).toEqual(document);
  });

  test("canonicalizes unordered records without mutating design facts or reordering arrays", () => {
    const first = connectedDesign();
    first.interfaceDefinitions["source.output"].attributes = { zebra: "last", alpha: "first" };
    first.interfaceDefinitions["z.extra"] = {
      ...structuredClone(first.interfaceDefinitions["source.output"]),
      title: "Extra Interface",
      attributes: { zebra: "last", alpha: "first" },
    };
    first.levels[0].nodes[0].inspector.attributes = { zebra: "last", alpha: "first" };
    const before = structuredClone(first);

    const second = structuredClone(first);
    second.interfaceDefinitions = {
      "z.extra": {
        ...second.interfaceDefinitions["z.extra"],
        attributes: { alpha: "first", zebra: "last" },
      },
      "source.output": {
        ...second.interfaceDefinitions["source.output"],
        attributes: { alpha: "first", zebra: "last" },
      },
    };
    second.levels[0].nodes[0].inspector.attributes = { alpha: "first", zebra: "last" };

    const serialized = serializeDesign(first);

    expect(serialized).toBe(serializeDesign(second));
    expect(serializeDesignSnapshot(first)).toBe(serializeDesignSnapshot(second));
    expect(serializeDesignSnapshot(first).length).toBeLessThan(serialized.length);
    expect(first).toEqual(before);
    const saved = JSON.parse(serialized);
    expect(Object.keys(saved.interfaceDefinitions)).toEqual(["source.output", "z.extra"]);
    expect(Object.keys(saved.interfaceDefinitions["source.output"].attributes)).toEqual(["alpha", "zebra"]);
    expect(Object.keys(saved.levels[0].nodes[0].inspector.attributes)).toEqual(["alpha", "zebra"]);
    expect(saved.levels[0].nodes.map((node: { id: string }) => node.id)).toEqual(
      first.levels[0].nodes.map((node) => node.id),
    );
  });
});
