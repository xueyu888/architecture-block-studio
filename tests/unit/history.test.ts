import { describe, expect, test } from "vitest";
import {
  applyHistoryOperation,
  createDesignHistory,
  isDesignHistoryDirty,
  markDesignHistorySaved,
  redoDesignHistory,
  replaceDesignHistory,
  undoDesignHistory,
} from "../../src/editor/designHistory";
import { createBlankDesign } from "../../src/editor/designEditor";
import { connectedDesign } from "./designFixture";
import { serializeDesignSnapshot } from "../../src/io/saveDesign";

function rename(title: string) {
  return {
    type: "document/update" as const,
    values: { title, summary: "" },
  };
}

describe("design history state machine", () => {
  test("tracks saved and unsaved initial documents", () => {
    const document = createBlankDesign("history", "History");

    expect(isDesignHistoryDirty(createDesignHistory(document, true))).toBe(false);
    expect(isDesignHistoryDirty(createDesignHistory(document, false))).toBe(true);
  });

  test("applies, undoes, and redoes without moving the saved baseline", () => {
    const document = createBlankDesign("history", "History");
    const initial = createDesignHistory(document, true);
    const edited = applyHistoryOperation(initial, rename("Edited"));

    expect(edited.document.title).toBe("Edited");
    expect(edited.past).toHaveLength(1);
    expect(isDesignHistoryDirty(edited)).toBe(true);

    const undone = undoDesignHistory(edited)!;
    expect(undone.document.title).toBe("History");
    expect(isDesignHistoryDirty(undone)).toBe(false);

    const redone = redoDesignHistory(undone)!;
    expect(redone.document.title).toBe("Edited");
    expect(isDesignHistoryDirty(redone)).toBe(true);
  });

  test("clears redo only after a new authored operation", () => {
    const initial = createDesignHistory(createBlankDesign("history", "History"), true);
    const first = applyHistoryOperation(initial, rename("First"));
    const undone = undoDesignHistory(first)!;
    expect(undone.future).toHaveLength(1);

    const branched = applyHistoryOperation(undone, rename("Branch"));

    expect(branched.future).toEqual([]);
    expect(redoDesignHistory(branched)).toBeUndefined();
  });

  test("does not create history or clear redo for a semantic no-op", () => {
    const initial = createDesignHistory(createBlankDesign("history", "History"), true);
    const edited = applyHistoryOperation(initial, rename("First"));
    const undone = undoDesignHistory(edited)!;

    const unchanged = applyHistoryOperation(undone, rename("History"));

    expect(unchanged).toBe(undone);
    expect(unchanged.past).toEqual([]);
    expect(unchanged.future).toHaveLength(1);
    expect(redoDesignHistory(unchanged)?.document.title).toBe("First");
  });

  test("marks the exact current snapshot as saved", () => {
    const initial = createDesignHistory(createBlankDesign("history", "History"), true);
    const edited = applyHistoryOperation(initial, rename("Saved Edit"));

    const saved = markDesignHistorySaved(edited);

    expect(isDesignHistoryDirty(saved)).toBe(false);
    expect(isDesignHistoryDirty(applyHistoryOperation(saved, rename("Later Edit")))).toBe(true);
  });

  test("uses the saved file contract so record key order does not create false dirty state", () => {
    const document = connectedDesign();
    document.interfaceDefinitions["source.output"].attributes = { zebra: "last", alpha: "first" };
    const saved = createDesignHistory(document, true);
    const reordered = structuredClone(document);
    reordered.interfaceDefinitions["source.output"].attributes = { alpha: "first", zebra: "last" };

    expect(isDesignHistoryDirty({
      ...saved,
      document: reordered,
      currentSnapshot: serializeDesignSnapshot(reordered),
    })).toBe(false);
  });

  test("replacement installs a new baseline and clears both history directions", () => {
    const initial = createDesignHistory(createBlankDesign("history", "History"), true);
    const edited = applyHistoryOperation(initial, rename("Edited"));
    const replacement = createBlankDesign("replacement", "Replacement");

    const replaced = replaceDesignHistory(replacement, true);

    expect(replaced.document).toEqual(replacement);
    expect(replaced.past).toEqual([]);
    expect(replaced.future).toEqual([]);
    expect(isDesignHistoryDirty(replaced)).toBe(false);
    expect(edited.document.title).toBe("Edited");
  });
});
