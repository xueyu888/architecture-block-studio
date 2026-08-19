import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import {
  applyHistoryOperation,
  createDesignHistory,
  isDesignHistoryDirty,
  undoDesignHistory,
} from "../../src/editor/designHistory";
import { serializeDesign, serializeDesignSnapshot } from "../../src/io/saveDesign";
import { performanceDesignDocument } from "../fixtures/performanceDesign";
import { createPerformanceSample, emitPerformanceSample } from "./performanceSample";

describe("stress design history baseline", () => {
  test("measures twenty snapshots for a 1000 module / 2000 connection design", { timeout: 120_000 }, async () => {
    const operationCount = 20;
    const document = performanceDesignDocument({ nodeCount: 1000, connectionCount: 2000 });
    const documentBytes = Buffer.byteLength(serializeDesign(document));
    const snapshotBytes = Buffer.byteLength(serializeDesignSnapshot(document));
    let state = createDesignHistory(document, true);
    expect(globalThis.gc, "history performance requires an exposed garbage collector").toBeTypeOf("function");
    globalThis.gc!();
    const memoryBefore = process.memoryUsage();

    const applyStarted = performance.now();
    for (let index = 1; index <= operationCount; index += 1) {
      state = applyHistoryOperation(state, {
        type: "document/update",
        values: { title: `Performance Stress Design ${index}`, summary: document.summary },
      });
    }
    const applyOperationsMs = Math.round(performance.now() - applyStarted);
    globalThis.gc!();
    const memoryAfter = process.memoryUsage();

    const retainedHistoryBytes = state.past
      .reduce((total, snapshot) => total + snapshot.byteLength, 0) +
      Buffer.byteLength(serializeDesignSnapshot(state.document));
    const dirtyStarted = performance.now();
    expect(isDesignHistoryDirty(state)).toBe(true);
    const dirtyComparisonMs = Math.round(performance.now() - dirtyStarted);

    const undoStarted = performance.now();
    for (let index = 0; index < operationCount; index += 1) state = undoDesignHistory(state)!;
    const undoOperationsMs = Math.round(performance.now() - undoStarted);
    expect(state.document.title).toBe(document.title);

    const metrics = {
      nodeCount: 1000,
      connectionCount: 2000,
      operationCount,
      documentBytes,
      snapshotBytes,
      retainedSnapshotCount: operationCount + 1,
      retainedHistoryBytes,
      heapDeltaBytes: Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed),
      arrayBufferDeltaBytes: Math.max(0, memoryAfter.arrayBuffers - memoryBefore.arrayBuffers),
      totalMeasuredDeltaBytes: Math.max(
        0,
        memoryAfter.heapUsed + memoryAfter.arrayBuffers - memoryBefore.heapUsed - memoryBefore.arrayBuffers,
      ),
      applyOperationsMs,
      averageApplyMs: Math.round(applyOperationsMs / operationCount),
      dirtyComparisonMs,
      undoOperationsMs,
      averageUndoMs: Math.round(undoOperationsMs / operationCount),
    };
    await emitPerformanceSample(createPerformanceSample({
      suite: "history-stress",
      scenario: "1000-modules-2000-connections-20-history-operations",
      metrics,
      environment: { garbageCollectionExposed: typeof globalThis.gc === "function" },
    }));
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(operationCount);
    expect(metrics.retainedHistoryBytes).toBeGreaterThan(snapshotBytes * operationCount);
  });
});
