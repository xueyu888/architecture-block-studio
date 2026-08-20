export const MODULE_CREATION_DRAG_TYPE = "application/x-architecture-block-studio-module";

export function containsModuleCreationDrag(types: Iterable<string>): boolean {
  return [...types].includes(MODULE_CREATION_DRAG_TYPE);
}
