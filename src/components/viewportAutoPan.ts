export interface ViewportAutoPanPoint {
  clientX: number;
  clientY: number;
}

export interface ViewportAutoPanBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportAutoPanDelta {
  x: number;
  y: number;
}

export interface ViewportAutoPanPolicy {
  edgeThresholdPx: number;
  maximumFrameDistancePx: number;
  referenceFrameMs: number;
  maximumFrameMs: number;
}

export const CANVAS_VIEWPORT_AUTO_PAN_POLICY: Readonly<ViewportAutoPanPolicy> = Object.freeze({
  // React Flow and draw.io both use a 40 px activation band. Keeping that
  // threshold shared prevents direct gestures from changing feel by owner.
  edgeThresholdPx: 40,
  maximumFrameDistancePx: 12,
  referenceFrameMs: 1000 / 60,
  maximumFrameMs: 32,
});

function axisPressure(position: number, length: number, threshold: number): number {
  if (position < threshold) return Math.min(1, Math.max(0, (threshold - position) / threshold));
  if (position > length - threshold) {
    return -Math.min(1, Math.max(0, (position - (length - threshold)) / threshold));
  }
  return 0;
}

export function calculateViewportAutoPanDelta(
  pointer: ViewportAutoPanPoint,
  bounds: ViewportAutoPanBounds,
  elapsedMs = CANVAS_VIEWPORT_AUTO_PAN_POLICY.referenceFrameMs,
  policy: Readonly<ViewportAutoPanPolicy> = CANVAS_VIEWPORT_AUTO_PAN_POLICY,
): ViewportAutoPanDelta {
  if (
    !Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY) ||
    !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
    bounds.width <= 0 || bounds.height <= 0 ||
    !Number.isFinite(elapsedMs) || elapsedMs < 0
  ) {
    throw new Error("Viewport auto-pan requires finite pointer, bounds, and elapsed time values.");
  }
  const frameScale = Math.min(elapsedMs, policy.maximumFrameMs) / policy.referenceFrameMs;
  const horizontal = axisPressure(
    pointer.clientX - bounds.left,
    bounds.width,
    policy.edgeThresholdPx,
  );
  const vertical = axisPressure(
    pointer.clientY - bounds.top,
    bounds.height,
    policy.edgeThresholdPx,
  );
  return {
    x: horizontal * policy.maximumFrameDistancePx * frameScale,
    y: vertical * policy.maximumFrameDistancePx * frameScale,
  };
}

export interface ViewportAutoPanGesture {
  update: (pointer: ViewportAutoPanPoint) => void;
  stop: () => void;
}

export interface ViewportAutoPanController {
  start: (
    pointer: ViewportAutoPanPoint,
    onPan?: (pointer: ViewportAutoPanPoint, delta: ViewportAutoPanDelta) => void,
  ) => ViewportAutoPanGesture;
  dispose: () => void;
}

export interface ViewportAutoPanControllerDependencies {
  bounds: () => ViewportAutoPanBounds | undefined;
  panBy: (delta: ViewportAutoPanDelta) => boolean | Promise<boolean>;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  safetyEventTarget?: EventTarget;
  policy?: Readonly<ViewportAutoPanPolicy>;
  report?: (snapshot: ViewportAutoPanSnapshot) => void;
}

export interface ViewportAutoPanSnapshot {
  active: boolean;
  pressured: boolean;
  startCount: number;
  stopCount: number;
  frameCount: number;
  movedFrameCount: number;
}

/**
 * Owns one direct gesture at a time. The pointer expresses user intent; the
 * viewport transform remains owned by React Flow's panBy contract.
 */
export function createViewportAutoPanController({
  bounds,
  panBy,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window),
  safetyEventTarget = typeof window === "undefined" ? undefined : window,
  policy = CANVAS_VIEWPORT_AUTO_PAN_POLICY,
  report,
}: ViewportAutoPanControllerDependencies): ViewportAutoPanController {
  let disposed = false;
  let generation = 0;
  let frame: number | undefined;
  let lastFrameAt: number | undefined;
  let pointer: ViewportAutoPanPoint = { clientX: 0, clientY: 0 };
  let afterPan: ((point: ViewportAutoPanPoint, delta: ViewportAutoPanDelta) => void) | undefined;
  let releaseSafetyListeners = () => {};
  const snapshot: ViewportAutoPanSnapshot = {
    active: false,
    pressured: false,
    startCount: 0,
    stopCount: 0,
    frameCount: 0,
    movedFrameCount: 0,
  };

  const publish = () => report?.({ ...snapshot });

  const cancelScheduledFrame = () => {
    if (frame === undefined) return;
    cancelFrame(frame);
    frame = undefined;
  };

  const hasPressure = () => {
    const viewportBounds = bounds();
    if (!viewportBounds) return false;
    const delta = calculateViewportAutoPanDelta(
      pointer,
      viewportBounds,
      policy.referenceFrameMs,
      policy,
    );
    snapshot.pressured = delta.x !== 0 || delta.y !== 0;
    return snapshot.pressured;
  };

  const schedule = (owner: number) => {
    if (disposed || owner !== generation || frame !== undefined || !hasPressure()) return;
    frame = requestFrame((timestamp) => {
      frame = undefined;
      if (disposed || owner !== generation) return;
      const viewportBounds = bounds();
      if (!viewportBounds) return;
      const elapsedMs = lastFrameAt === undefined
        ? policy.referenceFrameMs
        : timestamp - lastFrameAt;
      lastFrameAt = timestamp;
      const delta = calculateViewportAutoPanDelta(pointer, viewportBounds, elapsedMs, policy);
      if (delta.x === 0 && delta.y === 0) return;
      snapshot.frameCount += 1;
      publish();
      const pointAtFrame = { ...pointer };
      void Promise.resolve(panBy(delta)).then((moved) => {
        if (disposed || owner !== generation) return;
        if (moved) {
          snapshot.movedFrameCount += 1;
          publish();
          afterPan?.(pointAtFrame, delta);
        }
        // Pointer pressure owns the loop. A transient constrained/no-op pan
        // result must not silently terminate a gesture that is still held at
        // the edge; explicit pointer movement or gesture end stops it.
        schedule(owner);
      });
    });
  };

  const stopOwner = (owner: number) => {
    if (owner !== generation) return;
    releaseSafetyListeners();
    generation += 1;
    afterPan = undefined;
    lastFrameAt = undefined;
    snapshot.active = false;
    snapshot.pressured = false;
    snapshot.stopCount += 1;
    cancelScheduledFrame();
    publish();
  };

  const installSafetyListeners = (owner: number) => {
    releaseSafetyListeners();
    if (!safetyEventTarget) return;
    const stop = () => stopOwner(owner);
    const stopOnEscape = (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") stop();
    };
    safetyEventTarget.addEventListener("blur", stop);
    safetyEventTarget.addEventListener("pointerup", stop);
    safetyEventTarget.addEventListener("pointercancel", stop);
    safetyEventTarget.addEventListener("keydown", stopOnEscape);
    releaseSafetyListeners = () => {
      safetyEventTarget.removeEventListener("blur", stop);
      safetyEventTarget.removeEventListener("pointerup", stop);
      safetyEventTarget.removeEventListener("pointercancel", stop);
      safetyEventTarget.removeEventListener("keydown", stopOnEscape);
      releaseSafetyListeners = () => {};
    };
  };

  return {
    start(initialPointer, onPan) {
      if (disposed) throw new Error("Cannot start a disposed viewport auto-pan controller.");
      releaseSafetyListeners();
      generation += 1;
      const owner = generation;
      cancelScheduledFrame();
      pointer = { ...initialPointer };
      afterPan = onPan;
      lastFrameAt = undefined;
      snapshot.active = true;
      snapshot.startCount += 1;
      installSafetyListeners(owner);
      hasPressure();
      publish();
      schedule(owner);
      return {
        update(nextPointer) {
          if (disposed || owner !== generation) return;
          pointer = { ...nextPointer };
          if (hasPressure()) schedule(owner);
          else {
            lastFrameAt = undefined;
            cancelScheduledFrame();
            publish();
          }
        },
        stop() {
          stopOwner(owner);
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      afterPan = undefined;
      releaseSafetyListeners();
      snapshot.active = false;
      snapshot.pressured = false;
      cancelScheduledFrame();
      publish();
    },
  };
}
