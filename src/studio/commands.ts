import type { LucideIcon } from "lucide-react";

export type StudioCommandId =
  | "newDesign"
  | "openDesign"
  | "save"
  | "saveAs"
  | "exportJson"
  | "undo"
  | "redo"
  | "deleteSelection"
  | "addBlock"
  | "addPort"
  | "addConnection"
  | "addChildDesign"
  | "regenerateLayout"
  | "optimizeRouting"
  | "validateDesign"
  | "fitDesign"
  | "toggleSources"
  | "toggleProperties"
  | "toggleMessages"
  | "maximizeDiagram"
  | "resetWorkspace";

export interface StudioCommand {
  id: StudioCommandId;
  label: string;
  toolbarTitle?: string;
  shortcut?: string;
  icon: LucideIcon;
  enabled: boolean;
  execute: () => void;
}

export type StudioCommands = Record<StudioCommandId, StudioCommand>;
