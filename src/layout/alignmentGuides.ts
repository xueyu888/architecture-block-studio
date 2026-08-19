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

export type AlignmentGuide = AlignmentLineGuide | AlignmentSizeGuide;

export interface AlignmentSnapResult {
  rect: AlignmentRect;
  guides: AlignmentGuide[];
}

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

const ANCHORS: readonly AlignmentAnchor[] = ["start", "center", "end"];

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

export function snapMovingRect(
  subject: AlignmentRect,
  candidates: readonly AlignmentRect[],
  tolerance: number,
): AlignmentSnapResult {
  const xMatch = closestAxisMatch(subject, candidates, "x", tolerance);
  const yMatch = closestAxisMatch(subject, candidates, "y", tolerance);
  const rect = {
    ...subject,
    x: subject.x + (xMatch?.delta ?? 0),
    y: subject.y + (yMatch?.delta ?? 0),
  };
  return {
    rect,
    guides: [
      ...(xMatch ? [lineGuide(rect, "x", xMatch)] : []),
      ...(yMatch ? [lineGuide(rect, "y", yMatch)] : []),
    ],
  };
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
  return { rect, guides };
}
