export type DesktopUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
}

export type DesktopUpdateInstallResult =
  | { status: "accepted" }
  | { status: "blocked"; reason: "unsaved-changes" | "not-downloaded" };
