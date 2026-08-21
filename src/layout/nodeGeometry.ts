import type { BlockNode, BlockPort, PortSide } from "../model";

export interface NodeDimensions {
  width: number;
  height: number;
}

export interface PortPlacement {
  side: PortSide;
  offset: number;
}

export interface PortPlacementPoint {
  x: number;
  y: number;
}

export interface NodeResizeRect extends NodeDimensions {
  x: number;
  y: number;
}

export interface NodeResizeDirection {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export interface NodeResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export const BLOCK_NODE_GEOMETRY = {
  defaultWidth: 242,
  defaultHeight: 144,
  minimumWidth: 180,
  minimumHeight: 112,
  maximumWidth: 32_768,
  maximumHeight: 32_768,
  headerHeight: 32,
  horizontalRailHeight: 24,
  ownerBandHeight: 18,
  minimumBodyHeight: 40,
  sidePortSlotHeight: 26,
  centerContentWidth: 64,
  horizontalRailPadding: 14,
  horizontalPortGap: 8,
  portLabelMinimumWidth: 38,
  portLabelMaximumWidth: 126,
  portLabelPadding: 10,
  asciiGlyphWidth: 4.8,
  wideGlyphWidth: 8,
  borderWidth: 1,
  expandedBorderWidth: 2,
  portHandleSize: 10,
  placementGrid: 32,
  placementGap: 24,
} as const;

/**
 * Insets of an expanded child Level inside its owning module.
 *
 * These values belong to layout geometry rather than CSS: committed layout
 * and disposable direct-manipulation previews must grow the same parent frame.
 */
export const BLOCK_CONTAINER_GEOMETRY = {
  horizontalPadding: 72,
  topPadding: 68,
  bottomPadding: 54,
} as const;

export function preserveNodeAspectRatio(
  original: NodeResizeRect,
  requested: NodeResizeRect,
  direction: NodeResizeDirection,
  limits: NodeResizeLimits,
): NodeResizeRect {
  if (direction.x === 0 && direction.y === 0) return requested;
  const widthScale = requested.width / original.width;
  const heightScale = requested.height / original.height;
  const requestedScale = direction.x === 0
    ? heightScale
    : direction.y === 0
      ? widthScale
      : Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
  const minimumScale = Math.max(limits.minWidth / original.width, limits.minHeight / original.height);
  const maximumScale = Math.min(limits.maxWidth / original.width, limits.maxHeight / original.height);
  const scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
  const width = Math.round(original.width * scale);
  const height = Math.round(original.height * scale);
  const x = direction.x < 0
    ? original.x + original.width - width
    : direction.x > 0
      ? original.x
      : original.x + (original.width - width) / 2;
  const y = direction.y < 0
    ? original.y + original.height - height
    : direction.y > 0
      ? original.y
      : original.y + (original.height - height) / 2;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * Returns the React Flow connection anchor relative to a node frame.
 *
 * The rail is absolutely positioned against the block's inner border box and
 * React Flow connects at the outside edge of the Handle. Keeping that rendered
 * geometry here prevents the scene router from inventing a slightly different
 * port coordinate and creating sub-pixel doglegs at endpoints.
 */
export function portAnchorOffset(
  dimensions: NodeDimensions,
  ports: readonly BlockPort[],
  port: BlockPort,
  expanded: boolean,
): { x: number; y: number } {
  if (!ports.some((candidate) => candidate.id === port.id)) {
    throw new Error(`Port ${port.id} is not present in the supplied node geometry.`);
  }
  const fraction = port.offset;
  const borderWidth = expanded
    ? BLOCK_NODE_GEOMETRY.expandedBorderWidth
    : BLOCK_NODE_GEOMETRY.borderWidth;
  const handleRadius = BLOCK_NODE_GEOMETRY.portHandleSize / 2;
  const horizontal = borderWidth + (dimensions.width - borderWidth * 2) * fraction;
  const vertical = borderWidth + (dimensions.height - borderWidth * 2) * fraction;
  if (port.side === "left") return { x: borderWidth - handleRadius, y: vertical };
  if (port.side === "right") return { x: dimensions.width - borderWidth + handleRadius, y: vertical };
  if (port.side === "top") return { x: horizontal, y: borderWidth - handleRadius };
  return { x: horizontal, y: dimensions.height - borderWidth + handleRadius };
}

function glyphWidth(character: string): number {
  return character.codePointAt(0)! <= 0x7f
    ? BLOCK_NODE_GEOMETRY.asciiGlyphWidth
    : BLOCK_NODE_GEOMETRY.wideGlyphWidth;
}

export function portLabelWidth(label: string): number {
  const textWidth = [...label].reduce((width, character) => width + glyphWidth(character), 0);
  return Math.max(
    BLOCK_NODE_GEOMETRY.portLabelMinimumWidth,
    Math.min(
      BLOCK_NODE_GEOMETRY.portLabelMaximumWidth,
      Math.ceil(textWidth + BLOCK_NODE_GEOMETRY.portLabelPadding),
    ),
  );
}

export function portsForSide(ports: readonly BlockPort[], side: PortSide): BlockPort[] {
  return ports
    .filter((port) => port.side === side)
    .sort((left, right) => left.offset - right.offset || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function portRailOffset(ports: readonly BlockPort[], index: number): number {
  return (ports[index]?.offset ?? 0.5) * 100;
}

function nearestFreeCoordinate(
  desired: number,
  minimum: number,
  maximum: number,
  radius: number,
  occupied: readonly { center: number; radius: number }[],
): number {
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const candidates = [
    clamp(desired),
    minimum,
    maximum,
    ...occupied.flatMap((interval) => [
      clamp(interval.center - interval.radius - radius),
      clamp(interval.center + interval.radius + radius),
    ]),
  ];
  const available = candidates.filter((candidate) => occupied.every(
    (interval) => Math.abs(candidate - interval.center) >= radius + interval.radius - 0.01,
  ));
  return (available.length > 0 ? available : candidates)
    .sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired) || left - right)[0];
}

/**
 * Resolves a pointer to one persistent port position on the module perimeter.
 * Side and offset are the only authored facts; visual labels, handles, layout,
 * and routes all derive from this result.
 */
export function resolvePortPlacement(
  dimensions: NodeDimensions,
  ports: readonly BlockPort[],
  portId: string,
  point: PortPlacementPoint,
  disableSnap = false,
): PortPlacement {
  const port = ports.find((candidate) => candidate.id === portId);
  if (!port) throw new Error(`Port ${portId} is not present in the supplied node geometry.`);
  const x = Math.max(0, Math.min(dimensions.width, point.x));
  const y = Math.max(0, Math.min(dimensions.height, point.y));
  const distances: readonly [PortSide, number][] = [
    ["left", x],
    ["right", dimensions.width - x],
    ["top", y],
    ["bottom", dimensions.height - y],
  ];
  const closestDistance = Math.min(...distances.map(([, distance]) => distance));
  const tiedSides = distances.filter(([, distance]) => Math.abs(distance - closestDistance) < 0.5);
  const side = (tiedSides.find(([candidate]) => candidate === port.side) ?? tiedSides[0])[0];
  const vertical = side === "left" || side === "right";
  const length = vertical ? dimensions.height : dimensions.width;
  const desiredCoordinate = vertical ? y : x;
  const ownRadius = vertical
    ? BLOCK_NODE_GEOMETRY.sidePortSlotHeight / 2
    : (portLabelWidth(port.label) + BLOCK_NODE_GEOMETRY.horizontalPortGap) / 2;
  const minimum = Math.min(length / 2, ownRadius + BLOCK_NODE_GEOMETRY.borderWidth);
  const maximum = Math.max(length / 2, length - ownRadius - BLOCK_NODE_GEOMETRY.borderWidth);
  const snappedCoordinate = disableSnap
    ? desiredCoordinate
    : [0.25, 0.5, 0.75]
        .map((fraction) => fraction * length)
        .find((coordinate) => Math.abs(coordinate - desiredCoordinate) <= 6) ?? desiredCoordinate;
  const occupied = ports
    .filter((candidate) => candidate.id !== portId && candidate.side === side)
    .map((candidate) => ({
      center: candidate.offset * length,
      radius: vertical
        ? BLOCK_NODE_GEOMETRY.sidePortSlotHeight / 2
        : (portLabelWidth(candidate.label) + BLOCK_NODE_GEOMETRY.horizontalPortGap) / 2,
    }));
  const coordinate = nearestFreeCoordinate(
    snappedCoordinate,
    minimum,
    maximum,
    ownRadius,
    occupied,
  );
  return { side, offset: Math.round((coordinate / length) * 10_000) / 10_000 };
}

function horizontalRailWidth(ports: readonly BlockPort[]): number {
  if (ports.length === 0) return 0;
  const sorted = [...ports].sort((left, right) => left.offset - right.offset);
  const radii = sorted.map((port) => portLabelWidth(port.label) / 2);
  const requirements = [
    ...sorted.map((port, index) =>
      (radii[index] + BLOCK_NODE_GEOMETRY.horizontalRailPadding) / port.offset
    ),
    ...sorted.map((port, index) =>
      (radii[index] + BLOCK_NODE_GEOMETRY.horizontalRailPadding) / (1 - port.offset)
    ),
    ...sorted.slice(1).map((port, index) =>
      (radii[index] + radii[index + 1] + BLOCK_NODE_GEOMETRY.horizontalPortGap) /
      (port.offset - sorted[index].offset)
    ),
  ];
  return Math.ceil(Math.max(...requirements));
}

function verticalRailHeight(ports: readonly BlockPort[]): number {
  if (ports.length === 0) return 0;
  const sorted = [...ports].sort((left, right) => left.offset - right.offset);
  const radius = BLOCK_NODE_GEOMETRY.sidePortSlotHeight / 2;
  const requirements = [
    ...sorted.map((port) => radius / port.offset),
    ...sorted.map((port) => radius / (1 - port.offset)),
    ...sorted.slice(1).map((port, index) =>
      (radius * 2) / (port.offset - sorted[index].offset)
    ),
  ];
  return Math.ceil(Math.max(...requirements));
}

function sideLabelWidth(ports: readonly BlockPort[]): number {
  return ports.reduce((width, port) => Math.max(width, portLabelWidth(port.label)), 0);
}

export function minimumNodeDimensions(node: BlockNode): NodeDimensions {
  const leftPorts = portsForSide(node.ports, "left");
  const rightPorts = portsForSide(node.ports, "right");
  const topPorts = portsForSide(node.ports, "top");
  const bottomPorts = portsForSide(node.ports, "bottom");
  const sidePortCount = Math.max(leftPorts.length, rightPorts.length);
  const topRailHeight = topPorts.length > 0 ? BLOCK_NODE_GEOMETRY.horizontalRailHeight : 0;
  const bottomRailHeight = bottomPorts.length > 0 ? BLOCK_NODE_GEOMETRY.horizontalRailHeight : 0;
  const contentWidth = Math.max(
    horizontalRailWidth(topPorts),
    horizontalRailWidth(bottomPorts),
    sideLabelWidth(leftPorts) + BLOCK_NODE_GEOMETRY.centerContentWidth + sideLabelWidth(rightPorts),
  );
  const contentHeight = topRailHeight
    + BLOCK_NODE_GEOMETRY.headerHeight
    + Math.max(BLOCK_NODE_GEOMETRY.minimumBodyHeight, sidePortCount * BLOCK_NODE_GEOMETRY.sidePortSlotHeight)
    + BLOCK_NODE_GEOMETRY.ownerBandHeight
    + bottomRailHeight;
  const sideRailHeight = Math.max(verticalRailHeight(leftPorts), verticalRailHeight(rightPorts));
  const sideLabelHeight = sidePortCount === 0
    ? 0
    : topRailHeight
      + BLOCK_NODE_GEOMETRY.headerHeight
      + 9
      + bottomRailHeight
      + BLOCK_NODE_GEOMETRY.ownerBandHeight
      + 9
      + Math.max(0, sidePortCount - 1) * 22;
  return {
    width: Math.max(BLOCK_NODE_GEOMETRY.minimumWidth, contentWidth),
    height: Math.max(BLOCK_NODE_GEOMETRY.minimumHeight, contentHeight, sideLabelHeight, sideRailHeight),
  };
}

export function baseNodeDimensions(node: BlockNode): NodeDimensions {
  const minimum = minimumNodeDimensions(node);
  return {
    width: Math.max(node.layout.width ?? BLOCK_NODE_GEOMETRY.defaultWidth, minimum.width),
    height: Math.max(node.layout.height ?? BLOCK_NODE_GEOMETRY.defaultHeight, minimum.height),
  };
}
