export interface VersionedWorkerRequest {
  requestId: number;
}

/**
 * Owns the two independent facts in a latest-only Worker channel:
 * the version the UI still wants and the one request waiting to be sent.
 */
export class LatestWorkerRequestQueue<T extends VersionedWorkerRequest> {
  private desiredRequest: T | undefined;
  private queuedRequest: T | undefined;

  replace(request: T): void {
    this.desiredRequest = request;
    this.queuedRequest = request;
  }

  takeQueued(): T | undefined {
    const request = this.queuedRequest;
    this.queuedRequest = undefined;
    return request;
  }

  accepts(requestId: number): boolean {
    return this.desiredRequest?.requestId === requestId;
  }

  clear(): void {
    this.desiredRequest = undefined;
    this.queuedRequest = undefined;
  }
}
