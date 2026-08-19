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
  | "alignSelectionLeft"
  | "alignSelectionCenter"
  | "alignSelectionRight"
  | "alignSelectionTop"
  | "alignSelectionMiddle"
  | "alignSelectionBottom"
  | "distributeSelectionHorizontally"
  | "distributeSelectionVertically"
  | "addBlock"
  | "addPort"
  | "addConnection"
  | "addChildDesign"
  | "regenerateLayout"
  | "optimizeRouting"
  | "validateDesign"
  | "fitDesign"
  | "openCommandPalette"
  | "toggleSources"
  | "toggleProperties"
  | "toggleMessages"
  | "maximizeDiagram"
  | "resetWorkspace";

interface StudioCommandDefinition {
  id: StudioCommandId;
  label: string;
  toolbarTitle?: string;
  shortcut?: string;
  showInPalette?: false;
  icon: LucideIcon;
  execute: () => void;
}

export type StudioCommandAvailability =
  | { enabled: true; unavailableReason?: never }
  | { enabled: false; unavailableReason: string };

export type StudioCommand = StudioCommandDefinition & StudioCommandAvailability;

export type StudioCommands = Record<StudioCommandId, StudioCommand>;
