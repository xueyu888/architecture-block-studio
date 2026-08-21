import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import electronUpdater from "electron-updater";
import { readDesignFile, writeDesignFile } from "./fileService.js";
import { DesktopUpdateService } from "./updateService.js";

interface Channels {
  openDesign: string;
  acceptOpenedDesign: string;
  saveDesign: string;
  clearFileBinding: string;
  dirtyState: string;
  saveBeforeClose: string;
  saveBeforeCloseComplete: string;
  updateState: string;
  getUpdateState: string;
  checkForUpdates: string;
  downloadUpdate: string;
  installUpdate: string;
}

interface WindowState {
  currentFilePath?: string;
  pendingOpen?: { token: string; filePath: string };
  documentDirty: boolean;
  inspectorDraftDirty: boolean;
  allowClose: boolean;
  closeSavePending: boolean;
}

interface SaveRequest {
  content: string;
  suggestedFileName: string;
  mode: "save" | "saveAs" | "export";
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const channels = JSON.parse(readFileSync(join(sourceDirectory, "desktop/ipcChannels.json"), "utf8")) as Channels;
const windowStates = new WeakMap<BrowserWindow, WindowState>();
const windows = new Set<BrowserWindow>();
const developmentUrl = process.env.ARCHITECTURE_BLOCK_STUDIO_DEV_URL;
let updateService: DesktopUpdateService;

function stateFor(window: BrowserWindow): WindowState {
  const state = windowStates.get(window);
  if (!state) throw new Error("Desktop window state is unavailable.");
  return state;
}

function isTrustedRendererUrl(value: string): boolean {
  const url = new URL(value);
  if (developmentUrl) return url.origin === new URL(developmentUrl).origin;
  return url.protocol === "app:" && url.hostname === "studio";
}

function windowForEvent(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.has(window)) throw new Error("Rejected IPC from an unknown desktop window.");
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || !isTrustedRendererUrl(senderUrl)) {
    throw new Error("Rejected IPC from an untrusted renderer origin.");
  }
  return window;
}

function safeSuggestedName(value: unknown): string {
  const candidate = typeof value === "string" ? basename(value.trim()) : "design.block-design.json";
  const cleaned = candidate.replace(/[\\/:*?"<>|]+/g, "-") || "design.block-design.json";
  return cleaned.toLocaleLowerCase().endsWith(".json") ? cleaned : `${cleaned}.block-design.json`;
}

async function chooseSavePath(window: BrowserWindow, suggestedFileName: string): Promise<string | undefined> {
  const result = await dialog.showSaveDialog(window, {
    title: "Save Block Design",
    defaultPath: suggestedFileName,
    filters: [{ name: "Block Design JSON", extensions: ["json"] }],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  return result.canceled ? undefined : result.filePath;
}

function showDesktopError(window: BrowserWindow, title: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  void dialog.showMessageBox(window, { type: "error", title, message: title, detail });
}

function installIpcHandlers(): void {
  ipcMain.handle(channels.openDesign, async (event) => {
    const window = windowForEvent(event);
    const result = await dialog.showOpenDialog(window, {
      title: "Open Block Design",
      properties: ["openFile"],
      filters: [{ name: "Block Design JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return { status: "canceled" };
    try {
      const filePath = result.filePaths[0];
      const token = randomUUID();
      const content = await readDesignFile(filePath);
      stateFor(window).pendingOpen = { token, filePath };
      return { status: "opened", token, fileName: basename(filePath), content };
    } catch (error) {
      showDesktopError(window, "Unable to open design", error);
      return { status: "canceled" };
    }
  });

  ipcMain.handle(channels.acceptOpenedDesign, (event, token: unknown) => {
    const state = stateFor(windowForEvent(event));
    if (typeof token !== "string" || state.pendingOpen?.token !== token) return false;
    state.currentFilePath = state.pendingOpen.filePath;
    state.pendingOpen = undefined;
    return true;
  });

  ipcMain.handle(channels.saveDesign, async (event, request: unknown) => {
    const window = windowForEvent(event);
    const state = stateFor(window);
    if (!request || typeof request !== "object") throw new Error("Invalid desktop save request.");
    const { content, suggestedFileName, mode } = request as SaveRequest;
    if (typeof content !== "string" || !["save", "saveAs", "export"].includes(mode)) {
      throw new Error("Invalid desktop save request.");
    }
    let filePath = mode === "save" ? state.currentFilePath : undefined;
    filePath ??= await chooseSavePath(window, safeSuggestedName(suggestedFileName));
    if (!filePath) return { status: "canceled" };
    try {
      await writeDesignFile(filePath, content);
      if (mode !== "export") state.currentFilePath = filePath;
      return { status: "saved", fileName: basename(filePath) };
    } catch (error) {
      showDesktopError(window, "Unable to save design", error);
      return { status: "canceled" };
    }
  });

  ipcMain.handle(channels.clearFileBinding, (event) => {
    const state = stateFor(windowForEvent(event));
    state.currentFilePath = undefined;
    state.pendingOpen = undefined;
  });

  ipcMain.on(channels.dirtyState, (event, value: unknown) => {
    const state = stateFor(windowForEvent(event));
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    state.documentDirty = candidate.documentDirty === true;
    state.inspectorDraftDirty = candidate.inspectorDraftDirty === true;
    BrowserWindow.fromWebContents(event.sender)?.setDocumentEdited(
      state.documentDirty || state.inspectorDraftDirty,
    );
  });

  ipcMain.on(channels.saveBeforeCloseComplete, (event, saved: unknown) => {
    const window = windowForEvent(event);
    const state = stateFor(window);
    if (!state.closeSavePending) return;
    state.closeSavePending = false;
    if (saved !== true) return;
    state.allowClose = true;
    window.close();
  });

  ipcMain.handle(channels.getUpdateState, (event) => {
    windowForEvent(event);
    return updateService.snapshot();
  });

  ipcMain.handle(channels.checkForUpdates, (event) => {
    windowForEvent(event);
    return updateService.check();
  });

  ipcMain.handle(channels.downloadUpdate, (event) => {
    windowForEvent(event);
    return updateService.download();
  });

  ipcMain.handle(channels.installUpdate, (event) => {
    windowForEvent(event);
    const hasUnsavedChanges = [...windows].some((window) => {
      const state = stateFor(window);
      return state.documentDirty || state.inspectorDraftDirty;
    });
    return updateService.install(hasUnsavedChanges, () => {
      windows.forEach((window) => { stateFor(window).allowClose = true; });
    });
  });
}

async function registerAppProtocol(): Promise<void> {
  const distRoot = resolve(sourceDirectory, "dist");
  protocol.handle("app", async (request) => {
    const requestUrl = new URL(request.url);
    const requestedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
    const normalizedPath = normalize(requestedPath);
    const filePath = resolve(distRoot, normalizedPath);
    const withinDist = filePath === distRoot || filePath.startsWith(`${distRoot}${sep}`);
    if (!withinDist || isAbsolute(normalizedPath) || relative(distRoot, filePath).startsWith("..")) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#f5f6f8",
    title: "Architecture Block Studio",
    webPreferences: {
      preload: join(sourceDirectory, "dist-desktop/desktop/preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  windows.add(window);
  windowStates.set(window, {
    documentDirty: false,
    inspectorDraftDirty: false,
    allowClose: false,
    closeSavePending: false,
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    window.webContents.send(channels.updateState, updateService.snapshot());
  });
  window.on("close", (event) => {
    const state = stateFor(window);
    if (state.allowClose || (!state.documentDirty && !state.inspectorDraftDirty)) return;
    event.preventDefault();
    if (state.closeSavePending) return;
    if (state.inspectorDraftDirty) {
      void dialog.showMessageBox(window, {
        type: "warning",
        title: "Unapplied Inspector changes",
        message: "Close without applying the current Inspector changes?",
        detail: "Inspector drafts are not part of the design until Apply is selected.",
        buttons: ["Cancel", "Close Without Saving"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 1) {
          state.allowClose = true;
          window.close();
        }
      });
      return;
    }
    void dialog.showMessageBox(window, {
      type: "question",
      title: "Unsaved design",
      message: "Save changes before closing?",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }).then(({ response }) => {
      if (response === 1) {
        state.allowClose = true;
        window.close();
      } else if (response === 0) {
        state.closeSavePending = true;
        window.webContents.send(channels.saveBeforeClose);
      }
    });
  });
  window.on("closed", () => windows.delete(window));
  void window.loadURL(developmentUrl ?? "app://studio/index.html");
  return window;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const { autoUpdater } = electronUpdater;
  updateService = new DesktopUpdateService(
    app.isPackaged && process.platform === "win32" ? autoUpdater : undefined,
    app.getVersion(),
  );
  updateService.subscribe((state) => {
    windows.forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send(channels.updateState, state);
    });
  });
  installIpcHandlers();
  if (!developmentUrl) await registerAppProtocol();
  createWindow();
  if (app.isPackaged && process.platform === "win32") {
    setTimeout(() => { void updateService.check(); }, 1_500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
