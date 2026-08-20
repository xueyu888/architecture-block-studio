import type { RouteJump, RoutePoint } from "./routeInterface";
import { routeSegments } from "./routingGeometry";
import type { PlannedRoute } from "./routingScene";

const DEFAULT_JUMP_RADIUS = 5;
const JUMP_ENDPOINT_GAP = 3;

interface JumpCandidate extends RouteJump {
  coordinate: number;
}

function alongSegment(point: RoutePoint, segment: ReturnType<typeof routeSegments>[number]): number {
  return segment.axis === "h" ? point.x : point.y;
}

function segmentRange(segment: ReturnType<typeof routeSegments>[number]): [number, number] {
  const start = alongSegment(segment.a, segment);
  const end = alongSegment(segment.b, segment);
  return start <= end ? [start, end] : [end, start];
}

function mergeNearbyJumps(candidates: readonly JumpCandidate[], segment: ReturnType<typeof routeSegments>[number]): RouteJump[] {
  const ordered = [...candidates].sort((left, right) => left.coordinate - right.coordinate);
  const groups: JumpCandidate[][] = [];
  ordered.forEach((candidate) => {
    const group = groups.at(-1);
    if (!group || candidate.coordinate - group.at(-1)!.coordinate > DEFAULT_JUMP_RADIUS * 2 + 2) {
      groups.push([candidate]);
    } else {
      group.push(candidate);
    }
  });
  const [segmentStart, segmentEnd] = segmentRange(segment);
  return groups.flatMap((group) => {
    const first = group[0].coordinate;
    const last = group.at(-1)!.coordinate;
    const radius = DEFAULT_JUMP_RADIUS + (last - first) / 2;
    const coordinate = (first + last) / 2;
    if (coordinate - radius < segmentStart + JUMP_ENDPOINT_GAP ||
      coordinate + radius > segmentEnd - JUMP_ENDPOINT_GAP) return [];
    return [{
      segmentIndex: group[0].segmentIndex,
      point: segment.axis === "h"
        ? { x: coordinate, y: segment.a.y }
        : { x: segment.a.x, y: coordinate },
      radius,
    }];
  });
}

/**
 * Derives deterministic presentation-only line bridges from committed routes.
 * Horizontal segments bridge over vertical segments, matching diagram-editor
 * convention while leaving the orthogonal routing facts untouched.
 */
export function planRouteJumps(routes: ReadonlyMap<string, PlannedRoute>): ReadonlyMap<string, readonly RouteJump[]> {
  const ordered = [...routes.values()].sort((left, right) => left.legId.localeCompare(right.legId));
  const candidates = new Map<string, JumpCandidate[]>();
  const owned = ordered.flatMap((route) => routeSegments(route.points).map((segment, segmentIndex) => ({
    route,
    segment,
    segmentIndex,
  })));
  const horizontals = owned.filter(({ segment }) => segment.axis === "h");
  const verticals = owned
    .filter(({ segment }) => segment.axis === "v")
    .sort((left, right) => left.segment.a.x - right.segment.a.x || left.route.legId.localeCompare(right.route.legId));
  const firstVerticalAtOrAfter = (x: number) => {
    let low = 0;
    let high = verticals.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (verticals[middle].segment.a.x < x) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  horizontals.forEach((horizontal) => {
    const [minX, maxX] = segmentRange(horizontal.segment);
    for (let index = firstVerticalAtOrAfter(minX); index < verticals.length; index += 1) {
      const vertical = verticals[index];
      const x = vertical.segment.a.x;
      if (x >= maxX) break;
      if (x <= minX || vertical.route.legId === horizontal.route.legId) continue;
      const [minY, maxY] = segmentRange(vertical.segment);
      const y = horizontal.segment.a.y;
      if (y <= minY || y >= maxY) continue;
      const point: RoutePoint = { x, y };
      candidates.set(horizontal.route.legId, [
        ...(candidates.get(horizontal.route.legId) ?? []),
        {
          segmentIndex: horizontal.segmentIndex,
          point,
          radius: DEFAULT_JUMP_RADIUS,
          coordinate: x,
        },
      ]);
    }
  });

  return new Map(ordered.map((route) => {
    const segments = routeSegments(route.points);
    const jumps = [...(candidates.get(route.legId) ?? [])]
      .reduce<Map<number, JumpCandidate[]>>((bySegment, jump) => {
        bySegment.set(jump.segmentIndex, [...(bySegment.get(jump.segmentIndex) ?? []), jump]);
        return bySegment;
      }, new Map());
    return [route.legId, [...jumps.entries()].flatMap(([segmentIndex, segmentJumps]) =>
      mergeNearbyJumps(segmentJumps, segments[segmentIndex])
    )] as const;
  }));
}

function sameRouteJumps(left: readonly RouteJump[] | undefined, right: readonly RouteJump[]): boolean {
  return Boolean(left && left.length === right.length && left.every((jump, index) => (
    jump.segmentIndex === right[index].segmentIndex &&
    jump.point.x === right[index].point.x &&
    jump.point.y === right[index].point.y &&
    jump.radius === right[index].radius
  )));
}

/** Reuses presentation bridge arrays for routes whose crossings did not change. */
export function reconcileRouteJumpReferences(
  previous: ReadonlyMap<string, readonly RouteJump[]>,
  next: ReadonlyMap<string, readonly RouteJump[]>,
): ReadonlyMap<string, readonly RouteJump[]> {
  let changed = previous.size !== next.size;
  const jumps = new Map([...next].map(([id, routeJumps]) => {
    const prior = previous.get(id);
    const resolved = sameRouteJumps(prior, routeJumps) ? prior! : routeJumps;
    if (resolved !== prior) changed = true;
    return [id, resolved] as const;
  }));
  return changed ? jumps : previous;
}
