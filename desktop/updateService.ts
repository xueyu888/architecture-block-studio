import type {
  DesktopUpdateInstallResult,
  DesktopUpdateState,
} from "../src/io/desktopUpdateContract.js";

interface UpdateInfoLike {
  version: string;
}

interface UpdateProgressLike {
  percent: number;
  transferred: number;
  total: number;
}

export interface DesktopUpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  disableWebInstaller: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available" | "update-not-available" | "update-downloaded", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "download-progress", listener: (progress: UpdateProgressLike) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates: () => Promise<{ updateInfo: UpdateInfoLike } | null>;
  downloadUpdate: () => Promise<readonly string[]>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").trim().slice(0, 240) || "Update failed.";
}

export class DesktopUpdateService {
  private state: DesktopUpdateState;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private checkPromise?: Promise<DesktopUpdateState>;
  private downloadPromise?: Promise<DesktopUpdateState>;

  constructor(
    private readonly updater: DesktopUpdaterAdapter | undefined,
    currentVersion: string,
  ) {
    this.state = {
      status: updater ? "idle" : "unsupported",
      currentVersion,
    };
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.disableWebInstaller = true;
    updater.on("checking-for-update", () => this.publish({ status: "checking" }));
    updater.on("update-available", (info) => this.publish({
      status: "available",
      availableVersion: info.version,
    }));
    updater.on("update-not-available", () => this.publish({ status: "up-to-date" }));
    updater.on("download-progress", (progress) => this.publish({
      status: "downloading",
      progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10)),
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
    }));
    updater.on("update-downloaded", (info) => this.publish({
      status: "downloaded",
      availableVersion: info.version,
      progressPercent: 100,
    }));
    updater.on("error", (error) => this.publish({
      status: "error",
      errorMessage: safeErrorMessage(error),
    }));
  }

  snapshot(): DesktopUpdateState {
    return { ...this.state };
  }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  check(): Promise<DesktopUpdateState> {
    if (!this.updater || this.state.status === "downloading" || this.state.status === "downloaded" ||
      this.state.status === "installing") return Promise.resolve(this.snapshot());
    if (this.checkPromise) return this.checkPromise;
    this.publish({ status: "checking" });
    this.checkPromise = this.updater.checkForUpdates()
      .then((result) => {
        if (this.state.status !== "checking") return this.snapshot();
        if (result?.updateInfo.version && result.updateInfo.version !== this.state.currentVersion) {
          this.publish({ status: "available", availableVersion: result.updateInfo.version });
        } else {
          this.publish({ status: "up-to-date" });
        }
        return this.snapshot();
      })
      .catch((error) => {
        this.publish({ status: "error", errorMessage: safeErrorMessage(error) });
        return this.snapshot();
      })
      .finally(() => { this.checkPromise = undefined; });
    return this.checkPromise;
  }

  download(): Promise<DesktopUpdateState> {
    if (!this.updater || !["available", "error"].includes(this.state.status)) {
      return Promise.resolve(this.snapshot());
    }
    if (!this.state.availableVersion) return Promise.resolve(this.snapshot());
    if (this.downloadPromise) return this.downloadPromise;
    this.publish({ status: "downloading", progressPercent: 0 });
    this.downloadPromise = this.updater.downloadUpdate()
      .then(() => {
        if (this.state.status === "downloading") {
          this.publish({ status: "downloaded", progressPercent: 100 });
        }
        return this.snapshot();
      })
      .catch((error) => {
        this.publish({ status: "error", errorMessage: safeErrorMessage(error) });
        return this.snapshot();
      })
      .finally(() => { this.downloadPromise = undefined; });
    return this.downloadPromise;
  }

  install(hasUnsavedChanges: boolean, beforeInstall: () => void): DesktopUpdateInstallResult {
    if (!this.updater || this.state.status !== "downloaded") {
      return { status: "blocked", reason: "not-downloaded" };
    }
    if (hasUnsavedChanges) return { status: "blocked", reason: "unsaved-changes" };
    this.publish({ status: "installing" });
    beforeInstall();
    this.updater.quitAndInstall(false, true);
    return { status: "accepted" };
  }

  private publish(change: Omit<DesktopUpdateState, "currentVersion">): void {
    this.state = {
      currentVersion: this.state.currentVersion,
      availableVersion: change.availableVersion ?? this.state.availableVersion,
      ...change,
    };
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
