import { describe, expect, it } from "vitest";
import { LatestWorkerRequestQueue } from "../../src/components/latestWorkerRequestQueue";

describe("latest Worker request queue", () => {
  it("dispatches one request once while retaining its desired version", () => {
    const queue = new LatestWorkerRequestQueue<{ requestId: number; frame: string }>();
    queue.replace({ requestId: 1, frame: "first" });
    expect(queue.takeQueued()).toEqual({ requestId: 1, frame: "first" });
    expect(queue.takeQueued()).toBeUndefined();
    expect(queue.accepts(1)).toBe(true);
  });

  it("coalesces waiting work and rejects stale responses", () => {
    const queue = new LatestWorkerRequestQueue<{ requestId: number; frame: string }>();
    queue.replace({ requestId: 1, frame: "first" });
    expect(queue.takeQueued()?.requestId).toBe(1);
    queue.replace({ requestId: 2, frame: "second" });
    queue.replace({ requestId: 3, frame: "latest" });
    expect(queue.accepts(1)).toBe(false);
    expect(queue.takeQueued()).toEqual({ requestId: 3, frame: "latest" });
    expect(queue.takeQueued()).toBeUndefined();
    expect(queue.accepts(3)).toBe(true);
    queue.clear();
    expect(queue.accepts(3)).toBe(false);
  });
});
