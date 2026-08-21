import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

async function canvasZoom(window: import("@playwright/test").Page): Promise<number> {
  return window.locator(".react-flow__viewport").evaluate((viewport) => {
    const transform = new DOMMatrix(window.getComputedStyle(viewport).transform);
    return transform.a;
  });
}

async function canvasTransform(window: import("@playwright/test").Page): Promise<string> {
  return window.locator(".react-flow__viewport").evaluate(
    (viewport) => window.getComputedStyle(viewport).transform,
  );
}

test("launches the isolated Windows desktop shell and renders the full workbench", async () => {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "ELECTRON_RUN_AS_NODE"),
  ) as Record<string, string>;
  const application = await electron.launch({ args: ["."], env: environment });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-block-studio-desktop-"));
  try {
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText("Architecture Block Studio").first()).toBeVisible();
    await expect(window.locator(".react-flow__node")).toHaveCount(7, { timeout: 30_000 });
    await expect(window.locator(".react-flow__edge")).toHaveCount(10, { timeout: 30_000 });
    await expect(window.locator(".bd-canvas-busy")).toHaveCount(0);
    await expect(window.locator(".bd-react-flow")).toHaveAttribute("data-committed-routing-status", "ready");
    await expect.poll(() => canvasZoom(window)).toBeLessThan(1);

    const isolation = await window.evaluate(() => ({
      bridgePlatform: window.architectureBlockStudioDesktop?.platform,
      hasNodeProcess: "process" in window,
      hasRequire: "require" in window,
      bridgeKeys: Object.keys(window.architectureBlockStudioDesktop ?? {}).sort(),
    }));
    expect(isolation).toEqual({
      bridgePlatform: "win32",
      hasNodeProcess: false,
      hasRequire: false,
      bridgeKeys: [
        "acceptOpenedDesign",
        "checkForUpdates",
        "clearFileBinding",
        "completeSaveBeforeClose",
        "downloadUpdate",
        "getUpdateState",
        "installUpdate",
        "onSaveBeforeClose",
        "onUpdateState",
        "openDesign",
        "platform",
        "saveDesign",
        "setDirty",
      ],
    });
    expect(await window.evaluate(
      () => window.architectureBlockStudioDesktop!.getUpdateState(),
    )).toEqual({ status: "unsupported", currentVersion: "0.3.0" });
    await expect(window.locator(".bd-desktop-update")).toHaveCount(0);

    const agentUi = window.locator('.react-flow__node[data-id="system::agent-ui"]');
    const screenshotDirectory = resolve("docs/screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    const commandPortLabel = agentUi.locator(".bd-port-label").filter({ hasText: "session.command" });
    const commandPort = agentUi.locator('.bd-port[data-port-id="session-command"]');
    const portBounds = await commandPortLabel.boundingBox();
    const agentBounds = await agentUi.boundingBox();
    expect(portBounds).not.toBeNull();
    expect(agentBounds).not.toBeNull();
    const routeGeometryBeforePortMove = await window.locator(".bd-interface-route").evaluateAll(
      (paths) => paths.map((path) => path.getAttribute("d")),
    );
    await window.mouse.move(portBounds!.x + portBounds!.width / 2, portBounds!.y + portBounds!.height / 2);
    await window.mouse.down();
    await window.mouse.move(agentBounds!.x + agentBounds!.width * 0.36, agentBounds!.y + 2, { steps: 12 });
    await expect(window.locator(".bd-react-flow")).toHaveAttribute("data-port-move-active", "true");
    await expect(window.locator(".bd-react-flow")).toHaveAttribute("data-routing-frame-gesture", "port-drag");
    await window.mouse.up();
    await expect(commandPort).toHaveClass(/bd-port-top/);
    await expect(window.locator(".bd-react-flow")).toHaveAttribute("data-committed-routing-status", "ready");
    await expect.poll(async () => window.locator(".bd-interface-route").evaluateAll(
      (paths) => paths.map((path) => path.getAttribute("d")),
    )).not.toEqual(routeGeometryBeforePortMove);
    const rustCore = window.locator('.react-flow__node[data-id="system::rust-agent-core"]');
    await agentUi.click({ force: true });
    await rustCore.click({ force: true, modifiers: ["Control"] });
    await window.keyboard.press("Control+Shift+H");
    await expect.poll(() => canvasZoom(window)).toBeGreaterThan(0.65);
    await window.waitForTimeout(350);
    const viewportAfterPortMove = await canvasTransform(window);
    await window.screenshot({
      path: resolve(screenshotDirectory, "windows-port-direct-placement.png"),
      animations: "disabled",
    });
    await window.keyboard.press("Control+Z");
    await expect(commandPort).toHaveClass(/bd-port-right/);
    await window.keyboard.press("Control+Shift+Z");
    await expect(commandPort).toHaveClass(/bd-port-top/);
    await window.keyboard.press("Control+Z");
    await expect(commandPort).toHaveClass(/bd-port-right/);
    expect(await canvasTransform(window)).toBe(viewportAfterPortMove);
    await expect(window.locator(".bd-statusbar")).toContainText("Saved");

    await agentUi.click({ force: true });
    await agentUi.focus();
    await window.keyboard.press("F2");
    const titleEditor = agentUi.getByRole("textbox", { name: "Rename Agent UI" });
    await expect(titleEditor).toBeFocused();
    await titleEditor.fill("Agent Desktop Workbench");
    await window.screenshot({
      path: resolve(screenshotDirectory, "windows-inline-title-editing.png"),
      animations: "disabled",
    });
    await window.keyboard.press("Enter");
    await expect(agentUi.locator(".bd-block-heading h3")).toHaveText("Agent Desktop Workbench");
    await expect(window.locator(".bd-statusbar")).toContainText("Unsaved");
    await expect.poll(() => canvasZoom(window)).toBeLessThan(1);
    await window.keyboard.press("Control+Z");
    await expect(agentUi.locator(".bd-block-heading h3")).toHaveText("Agent UI");
    await expect(window.locator(".bd-statusbar")).toContainText("Saved");
    await expect.poll(() => canvasZoom(window)).toBeLessThan(1);

    await agentUi.click({ force: true });
    await window.keyboard.press("Control+C");
    await expect.poll(() => canvasZoom(window)).toBeLessThan(1);
    const project = window.locator('.react-flow__node[data-id="system::project"]');
    const projectBounds = await project.boundingBox();
    expect(projectBounds).not.toBeNull();
    await window.mouse.click(
      projectBounds!.x + projectBounds!.width - 12,
      projectBounds!.y + Math.min(42, projectBounds!.height / 2),
      { button: "right" },
    );
    const moduleMenu = window.getByRole("menu", { name: "Module actions" });
    await expect(moduleMenu).toBeVisible();
    await moduleMenu.getByRole("menuitem", { name: "Paste Here", exact: true }).click();
    await expect(window.locator(".react-flow__node")).toHaveCount(8);
    await expect(window.locator('.react-flow__node[data-id="system::agent-ui-2"]')).toHaveClass(/selected/);
    await expect(window.locator(".bd-command-notice")).toContainText(
      "Pasted 1 module at the requested canvas position into System Overview",
    );
    await window.screenshot({
      path: resolve(screenshotDirectory, "windows-paste-here.png"),
      animations: "disabled",
    });
    await window.keyboard.press("Control+Z");
    await expect(window.locator(".react-flow__node")).toHaveCount(7);
    await expect(window.locator(".bd-statusbar")).toContainText("Saved");

    const addModuleTool = window
      .getByRole("toolbar", { name: "Architecture design tools" })
      .getByRole("button", { name: "添加模块", exact: true });
    await addModuleTool.dragTo(project);
    const addModuleDialog = window.getByRole("dialog", { name: /Add Module/ });
    await expect(addModuleDialog).toBeVisible();
    await addModuleDialog.getByLabel("Module title").fill("Desktop Review");
    await addModuleDialog.getByLabel("Module id").fill("desktop-review");
    await addModuleDialog.getByRole("button", { name: "Add Module", exact: true }).click();
    await expect(window.locator(".react-flow__node")).toHaveCount(8);
    await expect(window.locator('.react-flow__node[data-id="system::desktop-review"]')).toHaveClass(/selected/);
    await expect(window.locator(".bd-command-notice")).toContainText(
      "Added Desktop Review at the requested canvas position in System Overview",
    );
    await window.screenshot({
      path: resolve(screenshotDirectory, "windows-add-module-here.png"),
      animations: "disabled",
    });
    await window.keyboard.press("Control+Z");
    await expect(window.locator(".react-flow__node")).toHaveCount(7);
    await expect(window.locator(".bd-statusbar")).toContainText("Saved");
    await window.getByRole("button", { name: "Fit design" }).click({ force: true });
    await window.waitForTimeout(320);

    const inputPath = join(temporaryDirectory, "opened.block-design.json");
    const outputPath = join(temporaryDirectory, "saved-as.block-design.json");
    const inputContent = await readFile(resolve("public/examples/aio-agent-runtime.block-design.json"), "utf8");
    await writeFile(inputPath, inputContent, "utf8");
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, inputPath);
    const opened = await window.evaluate(() => window.architectureBlockStudioDesktop!.openDesign());
    expect(opened.status).toBe("opened");
    if (opened.status !== "opened") throw new Error("Expected the desktop file to open.");
    expect(opened.fileName).toBe("opened.block-design.json");
    expect(JSON.parse(opened.content).id).toBe("aio.agent-runtime.v1");
    expect(await window.evaluate(
      (token) => window.architectureBlockStudioDesktop!.acceptOpenedDesign(token),
      opened.token,
    )).toBe(true);

    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, outputPath);
    const saved = await window.evaluate(
      ({ content }) => window.architectureBlockStudioDesktop!.saveDesign({
        content,
        suggestedFileName: "saved-as.block-design.json",
        mode: "saveAs",
      }),
      { content: opened.content },
    );
    expect(saved).toEqual({ status: "saved", fileName: "saved-as.block-design.json" });
    expect(await readFile(outputPath, "utf8")).toBe(opened.content);

    await window.screenshot({
      path: resolve(screenshotDirectory, "windows-desktop-app.png"),
      animations: "disabled",
    });
  } finally {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await application.close().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
