export interface AlignmentRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignmentAnchor = "start" | "center" | "end";

export interface AlignmentLineGuide {
  kind: "line";
  axis: "x" | "y";
  coordinate: number;
  from: number;
  to: number;
  subjectAnchor: AlignmentAnchor;
  targetAnchor: AlignmentAnchor;
  targetId: string;
}

export interface AlignmentSizeGuide {
  kind: "size";
  axis: "width" | "height";
  subject: AlignmentRect;
  target: AlignmentRect;
  targetId: string;
}

export interface AlignmentDistanceGuide {
  kind: "distance";
  axis: "x" | "y";
  from: number;
  to: number;
  cross: number;
  distance: number;
  tickSize: number;
  startId: string;
  endId: string;
}

export type AlignmentGuide = AlignmentLineGuide | AlignmentSizeGuide | AlignmentDistanceGuide;

export interface AlignmentSnapResult {
  rect: AlignmentRect;
  guides: AlignmentGuide[];
}

export interface AlignmentGrid {
  x: number;
  y: number;
  originX?: number;
  originY?: number;
}

export const DESIGN_GRID_SIZE = { x: 16, y: 16 } as const;

export interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface AxisMatch {
  delta: number;
  subjectAnchor: AlignmentAnchor;
  targetAnchor: AlignmentAnchor;
  target: AlignmentRect;
}

interface AxisDistanceMatch {
  axis: "x" | "y";
  delta: number;
  distance: number;
  kind: "middle" | "after" | "before";
  chain: readonly [AlignmentRect, AlignmentRect, AlignmentRect];
}

const ANCHORS: readonly AlignmentAnchor[] = ["start", "center", "end"];

export function alignmentRectBounds(
  id: string,
  rects: readonly AlignmentRect[],
): AlignmentRect | undefined {
  if (rects.length === 0) return undefined;
  let left = rects[0].x;
  let top = rects[0].y;
  let right = rects[0].x + rects[0].width;
  let bottom = rects[0].y + rects[0].height;
  for (let index = 1; index < rects.length; index += 1) {
    const rect = rects[index];
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { id, x: left, y: top, width: right - left, height: bottom - top };
}

function axisCoordinate(rect: AlignmentRect, axis: "x" | "y", anchor: AlignmentAnchor): number {
  const start = axis === "x" ? rect.x : rect.y;
  const size = axis === "x" ? rect.width : rect.height;
  if (anchor === "start") return start;
  if (anchor === "center") return start + size / 2;
  return start + size;
}

function preferredMatch(left: AxisMatch, right: AxisMatch): AxisMatch {
  const distance = Math.abs(left.delta) - Math.abs(right.delta);
  if (Math.abs(distance) > 0.001) return distance < 0 ? left : right;
  const leftSameAnchor = left.subjectAnchor === left.targetAnchor;
  const rightSameAnchor = right.subjectAnchor === right.targetAnchor;
  if (leftSameAnchor !== rightSameAnchor) return leftSameAnchor ? left : right;
  return `${left.target.id}:${left.subjectAnchor}:${left.targetAnchor}`
    .localeCompare(`${right.target.id}:${right.subjectAnchor}:${right.targetAnchor}`) <= 0
    ? left
    : right;
}

function closestAxisMatch(
  subject: AlignmentRect,
  candidates: readonly AlignmentRect[],
  axis: "x" | "y",
  tolerance: number,
  subjectAnchors: readonly AlignmentAnchor[] = ANCHORS,
): AxisMatch | undefined {
  let best: AxisMatch | undefined;
  for (const target of candidates) {
    for (const subjectAnchor of subjectAnchors) {
      const subjectCoordinate = axisCoordinate(subject, axis, subjectAnchor);
      for (const targetAnchor of ANCHORS) {
        const delta = axisCoordinate(target, axis, targetAnchor) - subjectCoordinate;
        if (Math.abs(delta) > tolerance) continue;
        const match = { delta, subjectAnchor, targetAnchor, target };
        best = best ? preferredMatch(best, match) : match;
      }
    }
  }
  return best;
}

function lineGuide(
  rect: AlignmentRect,
  axis: "x" | "y",
  match: AxisMatch,
): AlignmentLineGuide {
  const targetStart = axis === "x" ? match.target.y : match.target.x;
  const targetEnd = targetStart + (axis === "x" ? match.target.height : match.target.width);
  const subjectStart = axis === "x" ? rect.y : rect.x;
  const subjectEnd = subjectStart + (axis === "x" ? rect.height : rect.width);
  return {
    kind: "line",
    axis,
    coordinate: axisCoordinate(rect, axis, match.subjectAnchor),
    from: Math.min(subjectStart, targetStart) - 12,
    to: Math.max(subjectEnd, targetEnd) + 12,
    subjectAnchor: match.subjectAnchor,
    targetAnchor: match.targetAnchor,
    targetId: match.target.id,
  };
}

function axisStart(rect: AlignmentRect, axis: "x" | "y"): number {
  return axis === "x" ? rect.x : rect.y;
}

function axisSize(rect: AlignmentRect, axis: "x" | "y"): number {
  return axis === "x" ? rect.width : rect.height;
}

function axisEnd(rect: AlignmentRect, axis: "x" | "y"): number {
  return axisStart(rect, axis) + axisSize(rect, axis);
}

function moveAxisStart(rect: AlignmentRect, axis: "x" | "y", start: number): AlignmentRect {
  return axis === "x" ? { ...rect, x: start } : { ...rect, y: start };
}

function overlapsCrossAxis(
  left: AlignmentRect,
  right: AlignmentRect,
  axis: "x" | "y",
): boolean {
  const crossAxis = axis === "x" ? "y" : "x";
  return axisStart(left, crossAxis) < axisEnd(right, crossAxis)
    && axisStart(right, crossAxis) < axisEnd(left, crossAxis);
}

function preferredDistanceMatch(
  left: AxisDistanceMatch,
  right: AxisDistanceMatch,
): AxisDistanceMatch {
  const deltaDifference = Math.abs(left.delta) - Math.abs(right.delta);
  if (Math.abs(deltaDifference) > 0.001) return deltaDifference < 0 ? left : right;
  const priority = { middle: 0, after: 1, before: 2 } as const;
  if (priority[left.kind] !== priority[right.kind]) {
    return priority[left.kind] < priority[right.kind] ? left : right;
  }
  const leftKey = left.chain.map((rect) => rect.id).join(":");
  const rightKey = right.chain.map((rect) => rect.id).join(":");
  return leftKey.localeCompare(rightKey) <= 0 ? left : right;
}

function closestDistanceMatch(
  subject: AlignmentRect,
  candidates: readonly AlignmentRect[],
  axis: "x" | "y",
  tolerance: number,
): AxisDistanceMatch | undefined {
  const distanceTolerance = tolerance / 2;
  const minimumDistance = tolerance * 2 / 3;
  const subjectStart = axisStart(subject, axis);
  const subjectEnd = axisEnd(subject, axis);
  const separated = candidates.filter((candidate) => overlapsCrossAxis(subject, candidate, axis));
  const before = separated
    .filter((candidate) => subjectStart - axisEnd(candidate, axis) > minimumDistance)
    .sort((left, right) =>
      axisEnd(right, axis) - axisEnd(left, axis)
      || axisStart(right, axis) - axisStart(left, axis)
      || left.id.localeCompare(right.id));
  const after = separated
    .filter((candidate) => axisStart(candidate, axis) - subjectEnd > minimumDistance)
    .sort((left, right) =>
      axisStart(left, axis) - axisStart(right, axis)
      || axisEnd(left, axis) - axisEnd(right, axis)
      || left.id.localeCompare(right.id));
  let best: AxisDistanceMatch | undefined;
  const consider = (
    targetStart: number,
    distance: number,
    kind: AxisDistanceMatch["kind"],
    chain: AxisDistanceMatch["chain"],
  ) => {
    if (distance <= minimumDistance) return;
    const match = { axis, delta: targetStart - subjectStart, distance, kind, chain };
    if (Math.abs(match.delta) > distanceTolerance) return;
    best = best ? preferredDistanceMatch(best, match) : match;
  };

  if (before[0] && after[0]) {
    const available = axisStart(after[0], axis)
      - axisEnd(before[0], axis)
      - axisSize(subject, axis);
    const distance = available / 2;
    const targetStart = axisEnd(before[0], axis) + distance;
    consider(targetStart, distance, "middle", [
      before[0],
      moveAxisStart(subject, axis, targetStart),
      after[0],
    ]);
  }
  if (before[0] && before[1]) {
    const distance = axisStart(before[0], axis) - axisEnd(before[1], axis);
    const targetStart = axisEnd(before[0], axis) + distance;
    consider(targetStart, distance, "after", [
      before[1],
      before[0],
      moveAxisStart(subject, axis, targetStart),
    ]);
  }
  if (after[0] && after[1]) {
    const distance = axisStart(after[1], axis) - axisEnd(after[0], axis);
    const targetStart = axisStart(after[0], axis) - axisSize(subject, axis) - distance;
    consider(targetStart, distance, "before", [
      moveAxisStart(subject, axis, targetStart),
      after[0],
      after[1],
    ]);
  }
  return best;
}

function distanceGuides(
  match: AxisDistanceMatch,
  finalSubject: AlignmentRect,
  tolerance: number,
): AlignmentDistanceGuide[] {
  const chain = match.chain.map((rect) => rect.id === finalSubject.id ? finalSubject : rect);
  const crossAxis = match.axis === "x" ? "y" : "x";
  const cross = Math.max(...chain.map((rect) => axisEnd(rect, crossAxis))) + tolerance * 2;
  const tickSize = tolerance;
  return chain.slice(0, -1).flatMap((startRect, index) => {
    const endRect = chain[index + 1];
    const gapStart = axisEnd(startRect, match.axis);
    const gapEnd = axisStart(endRect, match.axis);
    if (gapEnd <= gapStart) return [];
    const inset = Math.min(tolerance * 5 / 6, (gapEnd - gapStart) / 4);
    return [{
      kind: "distance" as const,
      axis: match.axis,
      from: gapStart + inset,
      to: gapEnd - inset,
      cross,
      distance: gapEnd - gapStart,
      tickSize,
      startId: startRect.id,
      endId: endRect.id,
    }];
  });
}

export function snapMovingRect(
  subject: AlignmentRect,
  candidates: readonly AlignmentRect[],
  tolerance: number,
  grid?: AlignmentGrid,
): AlignmentSnapResult {
  const xDistance = closestDistanceMatch(subject, candidates, "x", tolerance);
  const yDistance = closestDistanceMatch(subject, candidates, "y", tolerance);
  const distanceSubject = {
    ...subject,
    x: subject.x + (xDistance?.delta ?? 0),
    y: subject.y + (yDistance?.delta ?? 0),
  };
  const xMatch = xDistance ? undefined : closestAxisMatch(distanceSubject, candidates, "x", tolerance);
  const yMatch = yDistance ? undefined : closestAxisMatch(distanceSubject, candidates, "y", tolerance);
  const rect = {
    ...distanceSubject,
    x: xDistance
      ? distanceSubject.x
      : xMatch
        ? distanceSubject.x + xMatch.delta
        : snapGridCoordinate(distanceSubject.x, grid?.x, grid?.originX),
    y: yDistance
      ? distanceSubject.y
      : yMatch
        ? distanceSubject.y + yMatch.delta
        : snapGridCoordinate(distanceSubject.y, grid?.y, grid?.originY),
  };
  return {
    rect,
    guides: [
      ...(xDistance ? distanceGuides(xDistance, rect, tolerance) : []),
      ...(yDistance ? distanceGuides(yDistance, rect, tolerance) : []),
      ...(xMatch ? [lineGuide(rect, "x", xMatch)] : []),
      ...(yMatch ? [lineGuide(rect, "y", yMatch)] : []),
    ],
  };
}

function snapGridCoordinate(value: number, step?: number, origin = 0): number {
  if (!step || step <= 0) return value;
  return origin + Math.round((value - origin) / step) * step;
}

function changed(left: number, right: number): boolean {
  return Math.abs(left - right) > 0.5;
}

function resizeAnchors(startChanged: boolean, endChanged: boolean): readonly AlignmentAnchor[] {
  if (startChanged && endChanged) return ANCHORS;
  if (startChanged) return ["start", "center"];
  if (endChanged) return ["center", "end"];
  return [];
}

function applyResizeAxisMatch(
  rect: AlignmentRect,
  axis: "x" | "y",
  match: AxisMatch,
  startChanged: boolean,
  endChanged: boolean,
): AlignmentRect {
  const startKey = axis;
  const sizeKey = axis === "x" ? "width" : "height";
  let start = rect[startKey];
  let size = rect[sizeKey];
  if (match.subjectAnchor === "start") {
    start += match.delta;
    size -= match.delta;
  } else if (match.subjectAnchor === "end") {
    size += match.delta;
  } else if (startChanged && !endChanged) {
    start += match.delta * 2;
    size -= match.delta * 2;
  } else if (endChanged && !startChanged) {
    size += match.delta * 2;
  } else {
    start += match.delta;
  }
  return { ...rect, [startKey]: start, [sizeKey]: size };
}

function withinLimits(rect: AlignmentRect, limits: ResizeLimits): boolean {
  return rect.width >= limits.minWidth && rect.width <= limits.maxWidth
    && rect.height >= limits.minHeight && rect.height <= limits.maxHeight;
}

function sizeMatch(
  preview: AlignmentRect,
  candidates: readonly AlignmentRect[],
  axis: "width" | "height",
  tolerance: number,
): AlignmentRect | undefined {
  return candidates
    .filter((candidate) => Math.abs(candidate[axis] - preview[axis]) <= tolerance)
    .sort((left, right) =>
      Math.abs(left[axis] - preview[axis]) - Math.abs(right[axis] - preview[axis])
      || left.id.localeCompare(right.id),
    )[0];
}

export function snapResizingRect(
  original: AlignmentRect,
  preview: AlignmentRect,
  candidates: readonly AlignmentRect[],
  tolerance: number,
  limits: ResizeLimits,
  grid?: AlignmentGrid,
): AlignmentSnapResult {
  const originalRight = original.x + original.width;
  const originalBottom = original.y + original.height;
  const previewRight = preview.x + preview.width;
  const previewBottom = preview.y + preview.height;
  const leftChanged = changed(original.x, preview.x);
  const rightChanged = changed(originalRight, previewRight);
  const topChanged = changed(original.y, preview.y);
  const bottomChanged = changed(originalBottom, previewBottom);
  const xAnchors = resizeAnchors(leftChanged, rightChanged);
  const yAnchors = resizeAnchors(topChanged, bottomChanged);
  const xMatch = xAnchors.length > 0
    ? closestAxisMatch(preview, candidates, "x", tolerance, xAnchors)
    : undefined;
  const yMatch = yAnchors.length > 0
    ? closestAxisMatch(preview, candidates, "y", tolerance, yAnchors)
    : undefined;
  let rect = preview;
  const guides: AlignmentGuide[] = [];
  if (xMatch) {
    const snapped = applyResizeAxisMatch(rect, "x", xMatch, leftChanged, rightChanged);
    if (withinLimits(snapped, limits)) {
      rect = snapped;
      guides.push(lineGuide(rect, "x", xMatch));
    }
  }
  if (yMatch) {
    const snapped = applyResizeAxisMatch(rect, "y", yMatch, topChanged, bottomChanged);
    if (withinLimits(snapped, limits)) {
      rect = snapped;
      guides.push(lineGuide(rect, "y", yMatch));
    }
  }

  if (!xMatch && (leftChanged || rightChanged)) {
    const target = sizeMatch(preview, candidates, "width", tolerance);
    if (target) {
      const beforeSizeSnap = rect;
      const right = rect.x + rect.width;
      rect = leftChanged && !rightChanged
        ? { ...rect, x: right - target.width, width: target.width }
        : { ...rect, width: target.width };
      if (withinLimits(rect, limits)) {
        guides.push({ kind: "size", axis: "width", subject: rect, target, targetId: target.id });
      } else {
        rect = beforeSizeSnap;
      }
    }
  }
  if (!yMatch && (topChanged || bottomChanged)) {
    const target = sizeMatch(preview, candidates, "height", tolerance);
    if (target) {
      const beforeSizeSnap = rect;
      const bottom = rect.y + rect.height;
      rect = topChanged && !bottomChanged
        ? { ...rect, y: bottom - target.height, height: target.height }
        : { ...rect, height: target.height };
      if (withinLimits(rect, limits)) {
        guides.push({ kind: "size", axis: "height", subject: rect, target, targetId: target.id });
      } else {
        rect = beforeSizeSnap;
      }
    }
  }

  const hasXSnap = guides.some((guide) =>
    guide.kind === "line" ? guide.axis === "x" : guide.axis === "width");
  const hasYSnap = guides.some((guide) =>
    guide.kind === "line" ? guide.axis === "y" : guide.axis === "height");
  if (!hasXSnap && grid?.x && (leftChanged || rightChanged)) {
    const beforeGridSnap = rect;
    const right = rect.x + rect.width;
    if (leftChanged && !rightChanged) {
      const x = snapGridCoordinate(rect.x, grid.x, grid.originX);
      rect = { ...rect, x, width: right - x };
    } else {
      const snappedRight = snapGridCoordinate(right, grid.x, grid.originX);
      rect = { ...rect, width: snappedRight - rect.x };
    }
    if (!withinLimits(rect, limits)) rect = beforeGridSnap;
  }
  if (!hasYSnap && grid?.y && (topChanged || bottomChanged)) {
    const beforeGridSnap = rect;
    const bottom = rect.y + rect.height;
    if (topChanged && !bottomChanged) {
      const y = snapGridCoordinate(rect.y, grid.y, grid.originY);
      rect = { ...rect, y, height: bottom - y };
    } else {
      const snappedBottom = snapGridCoordinate(bottom, grid.y, grid.originY);
      rect = { ...rect, height: snappedBottom - rect.y };
    }
    if (!withinLimits(rect, limits)) rect = beforeGridSnap;
  }
  return { rect, guides };
}
