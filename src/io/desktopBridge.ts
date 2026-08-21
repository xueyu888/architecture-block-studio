import type {
  DesktopUpdateInstallResult,
  DesktopUpdateState,
} from "./desktopUpdateContract";

export type DesktopSaveMode = "save" | "saveAs" | "export";

export type DesktopOpenResult =
  | { status: "canceled" }
  | { status: "unavailable"; fileName: string }
  | { status: "opened"; token: string; fileName: string; content: string };

export interface RecentDesignSummary {
  id: string;
  fileName: string;
  folderPath: string;
  openedAt: string;
}

export type DesktopSaveResult =
  | { status: "canceled" }
  | { status: "saved"; fileName: string };

export interface DesktopDirtyState {
  documentDirty: boolean;
  inspectorDraftDirty: boolean;
}

export interface ArchitectureBlockStudioDesktopBridge {
  readonly platform: "win32";
  openDesign: () => Promise<DesktopOpenResult>;
  listRecentDesigns: () => Promise<RecentDesignSummary[]>;
  openRecentDesign: (id: string) => Promise<DesktopOpenResult>;
  acceptOpenedDesign: (token: string) => Promise<boolean>;
  saveDesign: (request: {
    content: string;
    suggestedFileName: string;
    mode: DesktopSaveMode;
  }) => Promise<DesktopSaveResult>;
  clearFileBinding: () => Promise<void>;
  setDirty: (state: DesktopDirtyState) => void;
  onSaveBeforeClose: (handler: () => void) => () => void;
  completeSaveBeforeClose: (saved: boolean) => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<DesktopUpdateInstallResult>;
  onUpdateState: (handler: (state: DesktopUpdateState) => void) => () => void;
}

export type { DesktopUpdateInstallResult, DesktopUpdateState };

declare global {
  interface Window {
    architectureBlockStudioDesktop?: ArchitectureBlockStudioDesktopBridge;
  }
}

export function getDesktopBridge(): ArchitectureBlockStudioDesktopBridge | undefined {
  return window.architectureBlockStudioDesktop;
}
