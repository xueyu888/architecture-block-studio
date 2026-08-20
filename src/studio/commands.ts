import type { LucideIcon } from "lucide-react";

export type StudioCommandId =
  | "newDesign"
  | "openDesign"
  | "save"
  | "saveAs"
  | "exportJson"
  | "undo"
  | "redo"
  | "selectAll"
  | "selectModulesInLevel"
  | "selectInterfacesInLevel"
  | "selectDirectInterfaces"
  | "selectIncomingInterfaces"
  | "selectOutgoingInterfaces"
  | "selectDirectNeighborhood"
  | "selectIncomingNeighborhood"
  | "selectOutgoingNeighborhood"
  | "clearSelection"
  | "copySelection"
  | "cutSelection"
  | "paste"
  | "pasteHere"
  | "duplicateSelection"
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
  | "reconnectConnection"
  | "addChildDesign"
  | "regenerateLayout"
  | "optimizeRouting"
  | "validateDesign"
  | "enterHierarchy"
  | "exitHierarchy"
  | "homeHierarchy"
  | "fitSelection"
  | "fitDesign"
  | "zoomIn"
  | "zoomOut"
  | "actualSize"
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
