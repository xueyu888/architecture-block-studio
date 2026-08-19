import { describe, expect, test } from "vitest";
import {
  CANVAS_VIEWPORT_AUTO_PAN_POLICY,
  calculateViewportAutoPanDelta,
  createViewportAutoPanController,
} from "../../src/components/viewportAutoPan";

const BOUNDS = { left: 100, top: 50, width: 400, height: 300 };

describe("viewport auto-pan", () => {
  test("maps the shared 40 px edge band to directional frame deltas", () => {
    expect(calculateViewportAutoPanDelta({ clientX: 300, clientY: 200 }, BOUNDS)).toEqual({ x: 0, y: 0 });
    expect(calculateViewportAutoPanDelta({ clientX: 100, clientY: 50 }, BOUNDS)).toEqual({ x: 12, y: 12 });
    expect(calculateViewportAutoPanDelta({ clientX: 500, clientY: 350 }, BOUNDS)).toEqual({ x: -12, y: -12 });
    expect(calculateViewportAutoPanDelta({ clientX: 120, clientY: 200 }, BOUNDS)).toEqual({ x: 6, y: 0 });
    expect(calculateViewportAutoPanDelta({ clientX: 480, clientY: 200 }, BOUNDS)).toEqual({ x: -6, y: 0 });
  });

  test("scales by elapsed time but caps delayed frames", () => {
    const atReference = calculateViewportAutoPanDelta(
      { clientX: 100, clientY: 200 },
      BOUNDS,
      CANVAS_VIEWPORT_AUTO_PAN_POLICY.referenceFrameMs,
    );
    const delayed = calculateViewportAutoPanDelta(
      { clientX: 100, clientY: 200 },
      BOUNDS,
      1000,
    );
    expect(atReference.x).toBe(12);
    expect(delayed.x).toBeCloseTo(23.04, 5);
  });

  test("rejects non-finite pointer or viewport geometry", () => {
    expect(() => calculateViewportAutoPanDelta(
      { clientX: Number.NaN, clientY: 0 },
      BOUNDS,
    )).toThrow(/finite pointer/);
    expect(() => calculateViewportAutoPanDelta(
      { clientX: 0, clientY: 0 },
      { ...BOUNDS, width: 0 },
    )).toThrow(/finite pointer/);
  });

  test("continues while edge pressure exists and stops when the pointer leaves", async () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const pans: Array<{ x: number; y: number }> = [];
    const repaints: Array<{ x: number; y: number }> = [];
    const controller = createViewportAutoPanController({
      bounds: () => BOUNDS,
      panBy: (delta) => {
        pans.push(delta);
        return true;
      },
      requestFrame: (callback) => {
        nextFrameId += 1;
        frames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelFrame: (handle) => { frames.delete(handle); },
    });
    const gesture = controller.start(
      { clientX: 495, clientY: 200 },
      (_pointer, delta) => repaints.push(delta),
    );
    expect(frames.size).toBe(1);

    const first = frames.entries().next().value as [number, FrameRequestCallback];
    frames.delete(first[0]);
    first[1](16.67);
    await Promise.resolve();
    expect(pans).toHaveLength(1);
    expect(pans[0].x).toBeLessThan(0);
    expect(repaints).toEqual(pans);
    expect(frames.size).toBe(1);

    gesture.update({ clientX: 300, clientY: 200 });
    expect(frames.size).toBe(0);
    gesture.stop();
    controller.dispose();
  });

  test("a stale gesture cannot stop the newer owner", async () => {
    let callback: FrameRequestCallback | undefined;
    const pans: Array<{ x: number; y: number }> = [];
    const controller = createViewportAutoPanController({
      bounds: () => BOUNDS,
      panBy: (delta) => {
        pans.push(delta);
        return true;
      },
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame: () => { callback = undefined; },
    });
    const first = controller.start({ clientX: 100, clientY: 200 });
    const second = controller.start({ clientX: 500, clientY: 200 });
    first.stop();
    expect(callback).toBeDefined();
    callback?.(16.67);
    await Promise.resolve();
    expect(pans).toHaveLength(1);
    expect(pans[0].x).toBeLessThan(0);
    second.stop();
    expect(callback).toBeUndefined();
  });

  test("keeps the pressure loop alive across a transient no-op pan", async () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const controller = createViewportAutoPanController({
      bounds: () => BOUNDS,
      panBy: () => false,
      requestFrame: (callback) => {
        nextFrameId += 1;
        frames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelFrame: (handle) => { frames.delete(handle); },
    });
    const gesture = controller.start({ clientX: 500, clientY: 200 });
    const first = frames.entries().next().value as [number, FrameRequestCallback];
    frames.delete(first[0]);
    first[1](16.67);
    await Promise.resolve();
    expect(frames.size).toBe(1);
    gesture.stop();
    expect(frames.size).toBe(0);
  });

  test("stops the active lease on pointer completion, cancellation, blur, or Escape", () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const safetyEvents = new EventTarget();
    const snapshots: Array<{ active: boolean; stopCount: number }> = [];
    const controller = createViewportAutoPanController({
      bounds: () => BOUNDS,
      panBy: () => true,
      requestFrame: (callback) => {
        nextFrameId += 1;
        frames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelFrame: (handle) => { frames.delete(handle); },
      safetyEventTarget: safetyEvents,
      report: ({ active, stopCount }) => snapshots.push({ active, stopCount }),
    });

    const dispatchEscape = () => {
      const event = new Event("keydown");
      Object.defineProperty(event, "key", { value: "Escape" });
      safetyEvents.dispatchEvent(event);
    };
    const dispatchOtherKey = () => {
      const event = new Event("keydown");
      Object.defineProperty(event, "key", { value: "Enter" });
      safetyEvents.dispatchEvent(event);
    };

    for (const stop of [
      () => safetyEvents.dispatchEvent(new Event("pointerup")),
      () => safetyEvents.dispatchEvent(new Event("pointercancel")),
      () => safetyEvents.dispatchEvent(new Event("blur")),
      dispatchEscape,
    ]) {
      controller.start({ clientX: 500, clientY: 200 });
      dispatchOtherKey();
      expect(frames.size).toBe(1);
      stop();
      expect(frames.size).toBe(0);
      expect(snapshots.at(-1)?.active).toBe(false);
    }
    expect(snapshots.at(-1)?.stopCount).toBe(4);
    controller.dispose();
  });
});
