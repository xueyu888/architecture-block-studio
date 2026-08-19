export type CanvasDetailLevel = "overview" | "full";

const FULL_DETAIL_MIN_ZOOM = 0.68;

export function canvasDetailLevel(zoom: number): CanvasDetailLevel {
  return zoom < FULL_DETAIL_MIN_ZOOM ? "overview" : "full";
}
