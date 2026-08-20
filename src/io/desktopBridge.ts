export type DesktopSaveMode = "save" | "saveAs" | "export";

export type DesktopOpenResult =
  | { status: "canceled" }
  | { status: "opened"; token: string; fileName: string; content: string };

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
}

declare global {
  interface Window {
    architectureBlockStudioDesktop?: ArchitectureBlockStudioDesktopBridge;
  }
}

export function getDesktopBridge(): ArchitectureBlockStudioDesktopBridge | undefined {
  return window.architectureBlockStudioDesktop;
}
