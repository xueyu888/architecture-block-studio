import { describe, expect, it } from "vitest";
import {
  selectModuleDropTarget,
  type ModuleDropTargetCandidate,
} from "../../src/components/moduleDropTarget";

const root: ModuleDropTargetCandidate = {
  levelId: "system",
  title: "System",
  hierarchyDepth: 0,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  designOrigin: { x: 0, y: 0 },
};

describe("module drop target projection", () => {
  it("chooses the deepest visible Level under the pointer", () => {
    const levelOne: ModuleDropTargetCandidate = {
      levelId: "level-1",
      title: "Level 1",
      hierarchyDepth: 1,
      bounds: { x: 100, y: 100, width: 700, height: 500 },
      designOrigin: { x: 120, y: 130 },
      ownerFlowNodeId: "system::boundary-1",
    };
    const levelTwo: ModuleDropTargetCandidate = {
      levelId: "level-2",
      title: "Level 2",
      hierarchyDepth: 2,
      bounds: { x: 300, y: 220, width: 320, height: 240 },
      designOrigin: { x: 330, y: 260 },
      ownerFlowNodeId: "system::boundary-1::boundary-2",
    };

    expect(selectModuleDropTarget({ x: 420, y: 320 }, [root, levelOne, levelTwo]))
      .toBe(levelTwo);
    expect(selectModuleDropTarget({ x: 180, y: 180 }, [root, levelOne, levelTwo]))
      .toBe(levelOne);
  });

  it("falls back to the current view root outside child containers", () => {
    expect(selectModuleDropTarget({ x: 40, y: 40 }, [root])).toBe(root);
  });

  it("breaks impossible same-depth overlaps by smaller surface and stable Level id", () => {
    const wide = {
      ...root,
      levelId: "wide",
      hierarchyDepth: 2,
      bounds: { x: 20, y: 20, width: 400, height: 300 },
    };
    const narrowB = {
      ...wide,
      levelId: "narrow-b",
      bounds: { x: 40, y: 40, width: 200, height: 160 },
    };
    const narrowA = { ...narrowB, levelId: "narrow-a" };

    expect(selectModuleDropTarget({ x: 100, y: 100 }, [wide, narrowB])).toBe(narrowB);
    expect(selectModuleDropTarget({ x: 100, y: 100 }, [narrowB, narrowA])).toBe(narrowA);
  });

  it("returns no target outside every projected surface", () => {
    expect(selectModuleDropTarget({ x: -1, y: 40 }, [root])).toBeUndefined();
  });
});
