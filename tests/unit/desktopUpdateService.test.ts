import { describe, expect, it, vi } from "vitest";
import {
  DesktopUpdateService,
  type DesktopUpdaterAdapter,
} from "../../desktop/updateService";

class FakeUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  disableWebInstaller = false;
  readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: "1.1.0" } }));
  downloadUpdate = vi.fn(async () => ["setup.exe"]);
  quitAndInstall = vi.fn();

  on(event: string, listener: (value?: unknown) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, value?: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

function updaterAdapter(fake: FakeUpdater): DesktopUpdaterAdapter {
  return fake as unknown as DesktopUpdaterAdapter;
}

describe("Windows desktop update state", () => {
  it("keeps development builds unsupported and free of network activity", async () => {
    const service = new DesktopUpdateService(undefined, "1.0.0");

    expect(service.snapshot()).toEqual({ status: "unsupported", currentVersion: "1.0.0" });
    expect(await service.check()).toEqual(service.snapshot());
    expect(await service.download()).toEqual(service.snapshot());
  });

  it("owns one check, download, progress, and restart-install lifecycle", async () => {
    const fake = new FakeUpdater();
    const service = new DesktopUpdateService(updaterAdapter(fake), "1.0.0");

    expect(fake).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      disableWebInstaller: true,
    });
    await service.check();
    expect(service.snapshot()).toMatchObject({ status: "available", availableVersion: "1.1.0" });

    fake.downloadUpdate.mockImplementationOnce(async () => {
      fake.emit("download-progress", { percent: 42.26, transferred: 420, total: 1_000 });
      fake.emit("update-downloaded", { version: "1.1.0" });
      return ["setup.exe"];
    });
    await service.download();
    expect(service.snapshot()).toMatchObject({
      status: "downloaded",
      availableVersion: "1.1.0",
      progressPercent: 100,
    });
    expect(service.install(true, vi.fn())).toEqual({ status: "blocked", reason: "unsaved-changes" });

    const beforeInstall = vi.fn();
    expect(service.install(false, beforeInstall)).toEqual({ status: "accepted" });
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(service.snapshot().status).toBe("installing");
  });

  it("deduplicates concurrent checks and exposes a sanitized recoverable error", async () => {
    const fake = new FakeUpdater();
    let resolveCheck!: (value: { updateInfo: { version: string } }) => void;
    fake.checkForUpdates.mockImplementationOnce(() => new Promise((resolve) => { resolveCheck = resolve; }));
    const service = new DesktopUpdateService(updaterAdapter(fake), "1.0.0");

    const first = service.check();
    const second = service.check();
    expect(fake.checkForUpdates).toHaveBeenCalledOnce();
    resolveCheck({ updateInfo: { version: "1.1.0" } });
    await Promise.all([first, second]);

    fake.emit("error", new Error("network\nfailed"));
    expect(service.snapshot()).toMatchObject({ status: "error", errorMessage: "network failed" });
  });
});
