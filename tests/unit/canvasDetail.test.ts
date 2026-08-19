import { describe, expect, it } from "vitest";
import { canvasDetailLevel } from "../../src/components/canvasDetail";

describe("canvas detail level", () => {
  it("keeps only readable primary facts in an overview and restores full detail when zoomed in", () => {
    expect(canvasDetailLevel(0.18)).toBe("overview");
    expect(canvasDetailLevel(0.679)).toBe("overview");
    expect(canvasDetailLevel(0.68)).toBe("full");
    expect(canvasDetailLevel(2.4)).toBe("full");
  });
});
