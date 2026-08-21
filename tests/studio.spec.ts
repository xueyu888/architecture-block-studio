import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import axe, { type AxeResults } from "axe-core";
import { performanceDesignDocument } from "./fixtures/performanceDesign";
import { fiveLevelRoutingDesignDocument } from "./fixtures/fiveLevelRoutingDesign";
import { routingStressDesignDocument } from "./fixtures/routingStressDesign";
import { connectionPreviewDesignDocument } from "./fixtures/connectionPreviewDesign";
import { viewportAutoPanDesignDocument } from "./fixtures/viewportAutoPanDesign";
import { groupAlignmentDesignDocument } from "./fixtures/groupAlignmentDesign";
import {
  distanceGuideDesignDocument,
  groupDistanceGuideDesignDocument,
} from "./fixtures/distanceGuideDesign";
import { createPerformanceSample, emitPerformanceSample } from "./performance/performanceSample";
import {
  applyDesignOperation,
  createBlankDesign,
  createBlock,
  createDesignLevel,
} from "../src/editor";

const examplePath = fileURLToPath(
  new URL("../public/examples/aio-agent-runtime.block-design.json", import.meta.url),
);
const invalidPath = fileURLToPath(new URL("./fixtures/invalid.block-design.json", import.meta.url));
const legacyPath = fileURLToPath(new URL("./fixtures/legacy-v2.0.block-design.json", import.meta.url));
const browserProblems = new WeakMap<Page, string[]>();
const FIREFOX_VITE_INLINE_WORKER_WARNING = /^\[JavaScript Warning: "Attempting to create a Worker from an empty source\. This is probably unintentional\." \{file: "http:\/\/127\.0\.0\.1:\d+\/(?:\?[^\"]*)?" line: 0\}\]$/;
const canvasGuideSelector = ".bd-alignment-guide, .bd-size-guide, .bd-distance-guide";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
// Axe's color-contrast rule does not complete against this transformed SVG
// workbench within the normal test budget. It is replaced, not omitted, by
// textContrastIssues below using rendered computed colors and WCAG ratios.
const structuralWcagRules = axe.getRules(wcagTags)
  .map((rule) => rule.ruleId)
  .filter((ruleId) => ruleId !== "color-contrast");

async function accessibilityResults(
  page: Page,
  selector?: string,
  ruleIds = structuralWcagRules,
): Promise<AxeResults> {
  const installed = await page.evaluate(() => "axe" in window);
  if (!installed) await page.addScriptTag({ content: axe.source });
  return page.evaluate(async ({ contextSelector, selectedRuleIds }) => {
    const runtime = (window as unknown as {
      axe: {
        run: (context: unknown, options: unknown) => Promise<AxeResults>;
      };
    }).axe;
    const context = contextSelector ? document.querySelector(contextSelector) : document;
    if (!context) throw new Error(`Accessibility context ${contextSelector} does not exist.`);
    return runtime.run(context, { runOnly: { type: "rule", values: selectedRuleIds } });
  }, { contextSelector: selector, selectedRuleIds: ruleIds });
}

interface TextContrastIssue {
  target: string;
  text: string;
  ratio: number;
  required: number;
  foreground: string;
  background: string;
}

async function textContrastIssues(page: Page, selector: string): Promise<TextContrastIssue[]> {
  return page.locator(selector).evaluate((root) => {
    type Rgba = [number, number, number, number];
    const colorCache = new Map<string, Rgba>();
    const backgroundCache = new WeakMap<Element, Rgba>();

    const color = (value: string): Rgba => {
      const cached = colorCache.get(value);
      if (cached) return cached;
      const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
      const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
      const parsed: Rgba = rgb
        ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
        : srgb
          ? [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])]
          : value === "transparent"
            ? [0, 0, 0, 0]
            : (() => { throw new Error(`Unsupported computed color ${value}.`); })();
      colorCache.set(value, parsed);
      return parsed;
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const background = (element: Element): Rgba => {
      const cached = backgroundCache.get(element);
      if (cached) return cached;
      const behind = element.parentElement ? background(element.parentElement) : [255, 255, 255, 1] as Rgba;
      const style = getComputedStyle(element);
      const layer = color(style.backgroundColor);
      const resolved = over([layer[0], layer[1], layer[2], layer[3] * Number(style.opacity)], behind);
      backgroundCache.set(element, resolved);
      return resolved;
    };
    const luminance = (rgba: Rgba): number => {
      const channels = rgba.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const ratio = (foreground: Rgba, backdrop: Rgba): number => {
      const renderedForeground = over(foreground, backdrop);
      const lighter = Math.max(luminance(renderedForeground), luminance(backdrop));
      const darker = Math.min(luminance(renderedForeground), luminance(backdrop));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const label = (element: Element): string => {
      const identity = element.id
        ? `#${element.id}`
        : [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
      return `${element.tagName.toLocaleLowerCase()}${identity}`;
    };
    const candidates = new Set<HTMLElement>();
    const textNodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.textContent?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
    });
    let textNode = textNodes.nextNode();
    while (textNode) {
      if (textNode.parentElement) candidates.add(textNode.parentElement);
      textNode = textNodes.nextNode();
    }
    root.querySelectorAll<HTMLElement>("input, select, textarea").forEach((element) => candidates.add(element));

    return [...candidates].flatMap<TextContrastIssue>((element) => {
      const style = getComputedStyle(element);
      const directlyVisibleText = [...element.childNodes]
        .some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const controlText = element instanceof HTMLInputElement
        ? element.value || element.placeholder
        : element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
          ? element.value
          : "";
      const text = ([...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .join(" ") || controlText).trim();
      if ((!directlyVisibleText && !controlText) || !text || element.matches(":disabled")) return [];
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        element.closest('[aria-hidden="true"]') ||
        element.getClientRects().length === 0
      ) return [];

      const backdrop = background(element);
      const rawForeground = color(style.color);
      let effectiveOpacity = 1;
      let ancestor: Element | null = element;
      while (ancestor) {
        effectiveOpacity *= Number(getComputedStyle(ancestor).opacity);
        ancestor = ancestor.parentElement;
      }
      const foreground: Rgba = [
        rawForeground[0],
        rawForeground[1],
        rawForeground[2],
        rawForeground[3] * effectiveOpacity,
      ];
      const actual = ratio(foreground, backdrop);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      if (actual + 0.01 >= required) return [];
      const displayColor = (rgba: Rgba) => `rgb(${rgba.slice(0, 3).map((value) => Math.round(value)).join(", ")})`;
      return [{
        target: label(element),
        text: text.slice(0, 80),
        ratio: Number(actual.toFixed(2)),
        required,
        foreground: displayColor(foreground),
        background: displayColor(backdrop),
      }];
    });
  });
}

function flowNode(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

function diagramNode(page: Page, levelId: string, blockId: string): Locator {
  return page.locator(".react-flow__node").filter({
    has: page.locator(`.bd-block[data-level-id="${levelId}"][data-block-id="${blockId}"]`),
  });
}

function toolbarButton(page: Page, name: string): Locator {
  return page
    .getByRole("toolbar", { name: "Architecture design tools" })
    .getByRole("button", { name, exact: true });
}

async function runMenuCommand(
  page: Page,
  menuName: "Edit" | "Design" | "Arrange" | "View",
  commandName: string | RegExp,
): Promise<void> {
  await page.getByRole("button", { name: menuName, exact: true }).click();
  await page.getByRole("menu", { name: menuName })
    .getByRole("menuitem", { name: commandName, exact: typeof commandName === "string" })
    .click();
}

async function clickWithPointer(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function rightClickLocator(
  page: Page,
  locator: Locator,
  position?: { x: number; y: number },
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + (position?.x ?? box!.width - 12),
    box!.y + (position?.y ?? Math.min(42, box!.height / 2)),
    { button: "right" },
  );
}

async function altSelectIntersectingNode(page: Page, target: Locator): Promise<void> {
  const saveState = page.locator(".bd-statusbar span").nth(1);
  const saveStateBefore = await saveState.textContent();
  await page.evaluate(() => new Promise<void>((resolve) => {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) throw new Error("Canvas viewport is not mounted.");
    let lastTransform = viewport.style.transform;
    let lastChangeAt = performance.now();
    const sample = () => {
      const transform = viewport.style.transform;
      if (transform !== lastTransform) {
        lastTransform = transform;
        lastChangeAt = performance.now();
      }
      if (performance.now() - lastChangeAt >= 250) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  await expect(target).toBeVisible({ timeout: 30_000 });
  const before = await target.boundingBox();
  expect(before).not.toBeNull();
  const selectionStart = {
    x: before!.x + before!.width * 0.08,
    y: before!.y + before!.height * 0.34,
  };
  const selectionEnd = {
    x: before!.x + Math.min(44, Math.max(18, before!.width * 0.28)),
    y: before!.y + before!.height * 0.66,
  };

  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(target).not.toHaveClass(/selected/);
  await page.keyboard.down("Alt");
  await page.mouse.move(selectionStart.x, selectionStart.y);
  await page.mouse.down();
  await page.mouse.move(selectionEnd.x, selectionEnd.y, { steps: 6 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(target).toHaveClass(/selected/);
  const after = await target.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeCloseTo(before!.x, 4);
  expect(after!.y).toBeCloseTo(before!.y, 4);
  await expect(saveState).toHaveText(saveStateBefore ?? "");
}

async function altClickCanvasPoint(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.keyboard.down("Alt");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");
}

async function canvasViewportTransform(page: Page): Promise<string> {
  return page.locator(".react-flow__viewport").evaluate(
    (element: HTMLElement) => element.style.transform,
  );
}

async function canvasZoom(page: Page): Promise<number> {
  const transform = await canvasViewportTransform(page);
  const match = /scale\(([^)]+)\)/.exec(transform);
  if (!match) throw new Error(`Canvas viewport has no scale transform: ${transform}`);
  return Number(match[1]);
}

async function canvasTransform(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const transform = await canvasViewportTransform(page);
  const match = /translate\(([^p]+)px, ([^p]+)px\) scale\(([^)]+)\)/.exec(transform);
  if (!match) throw new Error(`Unexpected canvas viewport transform: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

interface CanvasNavigationTiming {
  selectionCommitMs: number;
  targetMountMs: number;
  targetSelectedMs: number;
  viewportMotionStartMs: number;
  viewportMotionDurationMs: number;
  viewportTransformChanges: number;
  viewportMaxTransformGapMs: number;
  viewportSettledMs: number;
}

async function beginCanvasNavigationTrace(
  page: Page,
  targetFlowNodeId: string,
  expectedInspectorTitle: string,
): Promise<void> {
  await page.evaluate(({ targetId, inspectorTitle }) => {
    interface NavigationTrace {
      startedAt: number;
      targetId: string;
      inspectorTitle: string;
      initialTransform: string;
      lastTransform: string;
      lastTransformChangeAt: number;
      selectionCommittedAt?: number;
      targetMountedAt?: number;
      targetSelectedAt?: number;
      viewportMotionStartedAt?: number;
      viewportTransformChanges: number;
      viewportMaxTransformGapMs: number;
      animationFrame: number;
    }
    const traceWindow = window as typeof window & { __blockDesignNavigationTrace?: NavigationTrace };
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) throw new Error("Canvas viewport is not mounted.");
    if (traceWindow.__blockDesignNavigationTrace) {
      cancelAnimationFrame(traceWindow.__blockDesignNavigationTrace.animationFrame);
    }
    const startedAt = performance.now();
    const initialTransform = viewport.style.transform;
    const trace: NavigationTrace = {
      startedAt,
      targetId,
      inspectorTitle,
      initialTransform,
      lastTransform: initialTransform,
      lastTransformChangeAt: startedAt,
      viewportTransformChanges: 0,
      viewportMaxTransformGapMs: 0,
      animationFrame: 0,
    };
    traceWindow.__blockDesignNavigationTrace = trace;
    const sample = () => {
      const now = performance.now();
      const currentTransform = viewport.style.transform;
      if (currentTransform !== trace.lastTransform) {
        if (trace.viewportMotionStartedAt !== undefined) {
          trace.viewportMaxTransformGapMs = Math.max(
            trace.viewportMaxTransformGapMs,
            now - trace.lastTransformChangeAt,
          );
        }
        if (trace.viewportMotionStartedAt === undefined && currentTransform !== trace.initialTransform) {
          trace.viewportMotionStartedAt = now;
        }
        trace.viewportTransformChanges += 1;
        trace.lastTransform = currentTransform;
        trace.lastTransformChangeAt = now;
      }
      if (
        trace.selectionCommittedAt === undefined &&
        document.querySelector(".bd-inspector-title h2")?.textContent === trace.inspectorTitle
      ) {
        trace.selectionCommittedAt = now;
      }
      const target = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
        .find((node) => node.dataset.id === trace.targetId);
      if (target && trace.targetMountedAt === undefined) trace.targetMountedAt = now;
      if (target?.classList.contains("selected") && trace.targetSelectedAt === undefined) {
        trace.targetSelectedAt = now;
      }
      trace.animationFrame = requestAnimationFrame(sample);
    };
    trace.animationFrame = requestAnimationFrame(sample);
  }, { targetId: targetFlowNodeId, inspectorTitle: expectedInspectorTitle });
}

async function finishCanvasNavigationTrace(page: Page): Promise<CanvasNavigationTiming> {
  await page.waitForFunction(() => {
    const trace = (window as typeof window & {
      __blockDesignNavigationTrace?: {
        selectionCommittedAt?: number;
        targetMountedAt?: number;
        targetSelectedAt?: number;
        viewportMotionStartedAt?: number;
        lastTransformChangeAt: number;
      };
    }).__blockDesignNavigationTrace;
    return Boolean(
      trace?.selectionCommittedAt !== undefined &&
      trace.targetMountedAt !== undefined &&
      trace.targetSelectedAt !== undefined &&
      trace.viewportMotionStartedAt !== undefined &&
      performance.now() - trace.lastTransformChangeAt >= 400
    );
  }, undefined, { polling: "raf", timeout: 10_000 });
  return page.evaluate(() => {
    interface NavigationTrace {
      startedAt: number;
      lastTransformChangeAt: number;
      selectionCommittedAt: number;
      targetMountedAt: number;
      targetSelectedAt: number;
      viewportMotionStartedAt: number;
      viewportTransformChanges: number;
      viewportMaxTransformGapMs: number;
      animationFrame: number;
    }
    const traceWindow = window as typeof window & { __blockDesignNavigationTrace?: NavigationTrace };
    const trace = traceWindow.__blockDesignNavigationTrace;
    if (!trace) throw new Error("Canvas navigation trace was not started.");
    cancelAnimationFrame(trace.animationFrame);
    delete traceWindow.__blockDesignNavigationTrace;
    const sinceStart = (value: number) => Math.round(value - trace.startedAt);
    return {
      selectionCommitMs: sinceStart(trace.selectionCommittedAt),
      targetMountMs: sinceStart(trace.targetMountedAt),
      targetSelectedMs: sinceStart(trace.targetSelectedAt),
      viewportMotionStartMs: sinceStart(trace.viewportMotionStartedAt),
      viewportMotionDurationMs: Math.round(
        trace.lastTransformChangeAt - trace.viewportMotionStartedAt,
      ),
      viewportTransformChanges: trace.viewportTransformChanges,
      viewportMaxTransformGapMs: Math.round(trace.viewportMaxTransformGapMs),
      viewportSettledMs: sinceStart(Math.max(
        trace.lastTransformChangeAt,
        trace.selectionCommittedAt,
        trace.targetMountedAt,
        trace.targetSelectedAt,
      )),
    };
  });
}

async function tabTo(page: Page, target: Locator, limit = 160, direction: "forward" | "backward" = "forward"): Promise<void> {
  const focusTrail: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(direction === "forward" ? "Tab" : "Shift+Tab");
    focusTrail.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return "none";
      return active.getAttribute("aria-label") ?? active.getAttribute("title") ?? active.textContent?.trim().slice(0, 60) ?? active.tagName;
    }));
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label") ?? await target.getAttribute("title") ?? "target"}. Focus trail: ${focusTrail.join(" -> ")}`);
}

async function routeNodeCollisions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((element) => ({
      id: element.dataset.id ?? "unknown",
      rect: element.getBoundingClientRect(),
    }));
    return [...document.querySelectorAll<SVGPathElement>(".bd-interface-route")].flatMap((path) => {
      const route = path.closest<SVGGElement>("[data-source-node-id]");
      const sourceId = route?.dataset.sourceNodeId;
      const targetId = route?.dataset.targetNodeId;
      const matrix = path.getScreenCTM();
      if (!matrix) return [];
      const routeGeometry = path.closest<SVGGElement>("[data-route-points]");
      const points = JSON.parse(routeGeometry?.dataset.routePoints ?? "[]")
        .map((point: { x: number; y: number }) => new DOMPoint(point.x, point.y).matrixTransform(matrix));
      const hit = points.slice(1).some((right, index) => {
        const left = points[index];
        return nodes.some(({ id, rect }) => {
          if (id === sourceId || id === targetId) return false;
          const insideHorizontal = Math.abs(left.y - right.y) < 0.5 &&
            left.y > rect.top + 2 && left.y < rect.bottom - 2 &&
            Math.max(left.x, right.x) > rect.left + 2 && Math.min(left.x, right.x) < rect.right - 2;
          const insideVertical = Math.abs(left.x - right.x) < 0.5 &&
            left.x > rect.left + 2 && left.x < rect.right - 2 &&
            Math.max(left.y, right.y) > rect.top + 2 && Math.min(left.y, right.y) < rect.bottom - 2;
          return insideHorizontal || insideVertical;
        });
      });
      return hit ? [path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown"] : [];
    });
  });
}

async function waitForLayout(page: Page): Promise<void> {
  await expect(page.locator(".bd-document-title span")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".react-flow__edge")).not.toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(350);
}

async function waitForEditorIdle(page: Page): Promise<void> {
  await waitForCertifiedEditorFrame(page);
  await page.waitForTimeout(250);
}

async function waitForCertifiedEditorFrame(page: Page): Promise<void> {
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  const canvas = page.locator(".bd-react-flow");
  if (await canvas.count()) {
    await expect(canvas).toHaveAttribute("data-committed-routing-status", "ready", { timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-routing-frame-phase", "idle", { timeout: 30_000 });
  }
}

interface ChromiumHeapUsage {
  jsHeapUsedBytes: number;
  embedderHeapUsedBytes: number;
  backingStorageBytes: number;
  totalMeasuredBytes: number;
}

async function chromiumHeapUsage(page: Page): Promise<ChromiumHeapUsage> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
    const result = await session.send("Runtime.getHeapUsage");
    const jsHeapUsedBytes = Math.round(result.usedSize);
    const embedderHeapUsedBytes = Math.round(result.embedderHeapUsedSize);
    const backingStorageBytes = Math.round(result.backingStorageSize);
    return {
      jsHeapUsedBytes,
      embedderHeapUsedBytes,
      backingStorageBytes,
      totalMeasuredBytes: jsHeapUsedBytes + embedderHeapUsedBytes + backingStorageBytes,
    };
  } finally {
    await session.detach();
  }
}

async function captureStudioScreenshot(page: Page, path: string): Promise<void> {
  await page.screenshot({
    path,
    animations: "disabled",
    timeout: 30_000,
  });
}

async function addModule(page: Page, values: { title: string; id: string; owner?: string }): Promise<void> {
  await toolbarButton(page, "Add Module...").click({ force: true });
  const dialog = page.getByRole("dialog", { name: /Add Module/ });
  await dialog.getByLabel("Module title").fill(values.title);
  await dialog.getByLabel("Module id").fill(values.id);
  if (values.owner) await dialog.getByLabel("Owner").fill(values.owner);
  await dialog.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);
}

async function clearModuleInsertionPoints(page: Page, count: number): Promise<Array<{
  client: { x: number; y: number };
  designPoint: { x: number; y: number };
  expectedOrigin: { x: number; y: number };
}>> {
  return page.evaluate((requestedCount) => {
    const canvas = document.querySelector<HTMLElement>(".bd-react-flow");
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!canvas || !viewport) throw new Error("Canvas geometry is unavailable.");
    const canvasBounds = canvas.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    const zoom = matrix.a;
    const width = 242;
    const height = 144;
    const gap = 24 * zoom;
    const occupied = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .map((node) => node.getBoundingClientRect());
    const obstructions = [...document.querySelectorAll<HTMLElement>([
      ".react-flow__controls",
      ".react-flow__minimap",
      ".bd-canvas-detail-panel",
      ".bd-routing-diagnostic",
      ".bd-canvas-pan-mode",
    ].join(", "))]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect());
    const result: Array<{
      client: { x: number; y: number };
      designPoint: { x: number; y: number };
      expectedOrigin: { x: number; y: number };
    }> = [];
    for (let y = canvasBounds.bottom - 84; y >= canvasBounds.top + 84; y -= 28) {
      for (let x = canvasBounds.right - 92; x >= canvasBounds.left + 92; x -= 28) {
        const designPoint = {
          x: (x - canvasBounds.left - matrix.e) / zoom,
          y: (y - canvasBounds.top - matrix.f) / zoom,
        };
        const expectedOrigin = {
          x: Math.round((designPoint.x - width / 2) / 32) * 32,
          y: Math.round((designPoint.y - height / 2) / 32) * 32,
        };
        const rendered = {
          left: canvasBounds.left + matrix.e + expectedOrigin.x * zoom,
          top: canvasBounds.top + matrix.f + expectedOrigin.y * zoom,
          right: canvasBounds.left + matrix.e + (expectedOrigin.x + width) * zoom,
          bottom: canvasBounds.top + matrix.f + (expectedOrigin.y + height) * zoom,
        };
        const collides = occupied.some((rect) =>
          rendered.left < rect.right + gap && rendered.right + gap > rect.left &&
          rendered.top < rect.bottom + gap && rendered.bottom + gap > rect.top);
        const clipped = rendered.left < canvasBounds.left + 12 || rendered.right > canvasBounds.right - 12 ||
          rendered.top < canvasBounds.top + 12 || rendered.bottom > canvasBounds.bottom - 12;
        const obstructed = obstructions.some((rect) =>
          rendered.left < rect.right + 16 && rendered.right + 16 > rect.left &&
          rendered.top < rect.bottom + 16 && rendered.bottom + 16 > rect.top);
        const overlapsCandidate = result.some((candidate) => {
          const other = candidate.expectedOrigin;
          return expectedOrigin.x < other.x + width + 24 && expectedOrigin.x + width + 24 > other.x &&
            expectedOrigin.y < other.y + height + 24 && expectedOrigin.y + height + 24 > other.y;
        });
        const blockedAtPointer = document.elementsFromPoint(x, y).some((element) =>
          Boolean(element.closest(
            ".react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .bd-canvas-detail-panel",
          )));
        if (!collides && !clipped && !obstructed && !overlapsCandidate && !blockedAtPointer) {
          result.push({ client: { x, y }, designPoint, expectedOrigin });
          if (result.length === requestedCount) return result;
        }
      }
    }
    throw new Error(`Only ${result.length} clear module insertion points were found.`);
  }, count);
}

async function addPort(page: Page, values: {
  label: string;
  id: string;
  direction: "input" | "output" | "bidirectional";
  side: "left" | "right" | "top" | "bottom";
  dataType?: string;
}): Promise<void> {
  await toolbarButton(page, "Add Port...").click({ force: true });
  const dialog = page.getByRole("dialog", { name: /Add Port/ });
  await dialog.getByLabel("Port label").fill(values.label);
  await dialog.getByLabel("Port id").fill(values.id);
  await dialog.getByLabel("Direction").selectOption(values.direction);
  await dialog.getByLabel("Side").selectOption(values.side);
  if (values.dataType) await dialog.getByLabel("Data type").fill(values.dataType);
  await dialog.getByRole("button", { name: "Add Port", exact: true }).click({ force: true });
  await waitForEditorIdle(page);
}

async function dragConnection(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function beginToolbarModuleDrag(
  page: Page,
  target: { x: number; y: number },
): Promise<void> {
  const toolBounds = await toolbarButton(page, "Add Module...").boundingBox();
  expect(toolBounds).not.toBeNull();
  await page.mouse.move(
    toolBounds!.x + toolBounds!.width / 2,
    toolBounds!.y + toolBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  // Chromium can coalesce the final native dragover at the end of a stepped
  // move. A one-pixel continuation makes the terminal target observable in
  // both supported test browsers without changing the intended Level hit.
  await page.mouse.move(target.x + 1, target.y);
}

async function dragSelectionResizeHandle(
  page: Page,
  handle: Locator,
  delta: { x: number; y: number },
  modifiers: { alt?: boolean; shift?: boolean } = {},
  whileHeld?: () => Promise<void>,
): Promise<{ pointerReleaseMs: number; committedReadyMs: number }> {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  if (modifiers.alt) await page.keyboard.down("Alt");
  if (modifiers.shift) await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  expect(await page.evaluate(({ x, y }) => Boolean(
    document.elementFromPoint(x, y)?.closest(".bd-selection-resize-handle"),
  ), start)).toBe(true);
  await page.mouse.down();
  await expect(page.locator(".react-flow")).toHaveAttribute("data-selection-resize-active", "true");
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 12 });
  await whileHeld?.();
  const releaseStartedAt = performance.now();
  await page.mouse.up();
  const pointerReleaseMs = performance.now() - releaseStartedAt;
  if (modifiers.shift) await page.keyboard.up("Shift");
  if (modifiers.alt) await page.keyboard.up("Alt");
  await waitForCertifiedEditorFrame(page);
  const committedReadyMs = performance.now() - releaseStartedAt;
  await page.waitForTimeout(250);
  return {
    pointerReleaseMs,
    committedReadyMs,
  };
}

async function expandHierarchy(page: Page, title: string): Promise<void> {
  const expandedBefore = Number.parseInt(await page.locator(".bd-level-chip").innerText(), 10);
  const sources = page.getByRole("region", { name: "Sources", exact: true });
  await sources.getByRole("button", { name: `Expand ${title}`, exact: true }).click({ force: true });
  await expect(page.locator(".bd-level-chip")).toHaveText(`${expandedBefore + 1} expanded`);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(sources.getByRole("button", { name: `Collapse ${title}`, exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).not.toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(350);
}

async function openDesignDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "File", exact: true }).click({ force: true });
  await page.getByRole("menuitem", { name: "Open Design...", exact: true }).click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function transformOf(node: Locator): Promise<string> {
  return node.evaluate((element) => (element as HTMLElement).style.transform);
}

async function reachableEdgePoint(edge: Locator): Promise<{ x: number; y: number }> {
  const point = await edge.evaluate((group) => {
    const interaction = group.querySelector<SVGPathElement>(".react-flow__edge-interaction");
    const matrix = interaction?.getScreenCTM();
    if (!interaction || !matrix) return null;
    const length = interaction.getTotalLength();
    for (let index = 1; index < 30; index += 1) {
      const pathPoint = interaction.getPointAtLength(length * (index / 30));
      const screenPoint = new DOMPoint(pathPoint.x, pathPoint.y).matrixTransform(matrix);
      if (document.elementFromPoint(screenPoint.x, screenPoint.y)?.closest(".react-flow__edge") === group) {
        return { x: screenPoint.x, y: screenPoint.y };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  return point!;
}

async function clickReachableEdgePoint(page: Page, edge: Locator): Promise<void> {
  const point = await reachableEdgePoint(edge);
  await page.mouse.click(point!.x, point!.y);
}

async function geometryIssues(page: Page) {
  return page.evaluate(() => {
    const allNodeRects = new Map(
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((element) => [
        element.dataset.id ?? "unknown",
        element.getBoundingClientRect(),
      ] as const),
    );
    const nodeRects = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .filter((element) => element.querySelector(".bd-block")?.getAttribute("data-expanded") !== "true")
      .map((element) => ({
        id: element.dataset.id ?? "unknown",
        rect: element.getBoundingClientRect(),
      }));
    const collisions: string[] = [];

    const paths = [...document.querySelectorAll<SVGPathElement>(".bd-interface-route")];
    const microSegments = paths.flatMap((path) => {
      const route = path.closest<SVGGElement>("[data-route-points]");
      const points = JSON.parse(route?.dataset.routePoints ?? "[]") as Array<{ x: number; y: number }>;
      return points.slice(1).flatMap((point, index) => {
        const previous = points[index];
        const length = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
        return length > 0 && length < 1
          ? [`${path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown"}:${length}`]
          : [];
      });
    });
    paths.forEach((path) => {
      const route = path.closest<SVGGElement>("[data-source-node-id]");
      const sourceId = route?.dataset.sourceNodeId;
      const targetId = route?.dataset.targetNodeId;
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM();
      if (!matrix || length <= 0) return;
      for (let index = 3; index < 57; index += 1) {
        const point = path.getPointAtLength(length * (index / 60));
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        const hit = nodeRects.find(({ id, rect }) =>
          id !== sourceId &&
          id !== targetId &&
          screenPoint.x > rect.left + 3 &&
          screenPoint.x < rect.right - 3 &&
          screenPoint.y > rect.top + 3 &&
          screenPoint.y < rect.bottom - 3,
        );
        if (!hit) continue;
        collisions.push(
          `${path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown"} -> ${hit.id}`,
        );
        break;
      }
    });

    const labelOverlaps: string[] = [];
    document.querySelectorAll<SVGTextElement>(".react-flow__edge-text").forEach((label) => {
      const route = label.closest<SVGGElement>("[data-source-node-id]");
      const sourceId = route?.dataset.sourceNodeId;
      const targetId = route?.dataset.targetNodeId;
      const rect = label.getBoundingClientRect();
      const hit = nodeRects.find(({ id, rect: nodeRect }) =>
        id !== sourceId &&
        id !== targetId &&
        rect.left < nodeRect.right &&
        rect.right > nodeRect.left &&
        rect.top < nodeRect.bottom &&
        rect.bottom > nodeRect.top,
      );
      if (hit) labelOverlaps.push(`${label.textContent ?? "unknown"} -> ${hit.id}`);
    });

    const rootNodes = [...document.querySelectorAll<HTMLElement>('.bd-block[data-hierarchy-depth="0"]')]
      .map((block) => ({
        id: block.dataset.blockId ?? "unknown",
        rect: block.closest<HTMLElement>(".react-flow__node")!.getBoundingClientRect(),
      }));
    const siblingOverlaps: string[] = [];
    rootNodes.forEach((left, leftIndex) => {
      rootNodes.slice(leftIndex + 1).forEach((right) => {
        const overlap =
          left.rect.left < right.rect.right - 1 &&
          left.rect.right > right.rect.left + 1 &&
          left.rect.top < right.rect.bottom - 1 &&
          left.rect.bottom > right.rect.top + 1;
        if (overlap) siblingOverlaps.push(`${left.id} <-> ${right.id}`);
      });
    });

    const boundaryEscapes: string[] = [];
    paths.forEach((path) => {
      const route = path.closest<SVGGElement>('[data-boundary-continuation="true"]');
      const boundaryNodeId = route?.dataset.boundaryNodeId;
      if (!route || !boundaryNodeId) return;
      const boundary = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(boundaryNodeId)}"]`)
        ?.getBoundingClientRect();
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      if (!boundary || !matrix || length <= 0) return;
      for (let distance = 0; distance <= length; distance += 4) {
        const point = path.getPointAtLength(distance);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        if (
          screenPoint.x >= boundary.left - 8 &&
          screenPoint.x <= boundary.right + 8 &&
          screenPoint.y >= boundary.top - 8 &&
          screenPoint.y <= boundary.bottom + 8
        ) continue;
        boundaryEscapes.push(route.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown");
        break;
      }
    });

    const endpointIntrusions: string[] = [];
    paths.forEach((path) => {
      const route = path.closest<SVGGElement>('[data-boundary-continuation="false"]');
      if (!route) return;
      const source = allNodeRects.get(route.dataset.sourceNodeId ?? "");
      const target = allNodeRects.get(route.dataset.targetNodeId ?? "");
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      if (!source || !target || !matrix || length < 16) return;
      const enters = [6, 12, 18, 24].some((distance) => {
        if (distance >= length / 2) return false;
        return [path.getPointAtLength(distance), path.getPointAtLength(length - distance)].some((point) => {
          const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return [source, target].some((rect) =>
            screenPoint.x > rect.left + 2 &&
            screenPoint.x < rect.right - 2 &&
            screenPoint.y > rect.top + 2 &&
            screenPoint.y < rect.bottom - 2,
          );
        });
      });
      if (enters) endpointIntrusions.push(route.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown");
    });

    const routeSamples = paths.map((path) => {
      const length = path.getTotalLength();
      const samples: Array<{ x: number; y: number; axis: "h" | "v" }> = [];
      if (length > 12) {
        for (let distance = 6; distance < length - 6; distance += 4) {
          const before = path.getPointAtLength(Math.max(0, distance - 1));
          const point = path.getPointAtLength(distance);
          const after = path.getPointAtLength(Math.min(length, distance + 1));
          samples.push({
            x: point.x,
            y: point.y,
            axis: Math.abs(after.x - before.x) >= Math.abs(after.y - before.y) ? "h" : "v",
          });
        }
      }
      return {
        id: path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown",
        connectionId: path.closest<SVGGElement>("[data-connection-id]")?.dataset.connectionId ?? "unknown",
        samples,
      };
    });
    const sharedRoutes: string[] = [];
    routeSamples.forEach((left, leftIndex) => {
      routeSamples.slice(leftIndex + 1).forEach((right) => {
        if (left.connectionId === right.connectionId) return;
        let matched = 0;
        for (const leftPoint of left.samples) {
          const sharesLane = right.samples.some((rightPoint) =>
            leftPoint.axis === rightPoint.axis &&
            Math.abs(leftPoint.x - rightPoint.x) < 2.5 &&
            Math.abs(leftPoint.y - rightPoint.y) < 2.5,
          );
          matched = sharesLane ? matched + 1 : 0;
          if (matched < 4) continue;
          sharedRoutes.push(`${left.id} <-> ${right.id}`);
          break;
        }
      });
    });

    return {
      collisions,
      labelOverlaps,
      siblingOverlaps,
      boundaryEscapes,
      endpointIntrusions,
      microSegments,
      sharedRoutes,
    };
  });
}

async function connectionPreviewIssues(page: Page) {
  return page.locator(".bd-connection-preview").evaluate((preview) => {
    const group = preview as SVGGElement;
    const path = group.querySelector<SVGPathElement>(".bd-connection-preview-path");
    const points = JSON.parse(group.dataset.previewPoints ?? "[]") as Array<{ x: number; y: number }>;
    const sourceId = group.dataset.previewSourceNodeId;
    const targetId = group.dataset.previewTargetNodeId;
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .filter((node) => node.dataset.id !== sourceId && node.dataset.id !== targetId)
      .filter((node) => node.querySelector('.bd-block[data-expanded="true"]') === null)
      .map((node) => ({ id: node.dataset.id ?? "unknown", rect: node.getBoundingClientRect() }));
    const collisions: string[] = [];
    const matrix = path?.getScreenCTM();
    const length = path?.getTotalLength() ?? 0;
    if (!path || !matrix || length <= 0) return {
      collisions: ["preview geometry unavailable"],
      nonOrthogonalSegments: [],
      zeroLengthSegments: [],
    };
    for (let distance = 2; distance < length - 2; distance += 2) {
      const point = path.getPointAtLength(distance);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const hit = nodes.find(({ rect }) =>
        screenPoint.x > rect.left + 2 && screenPoint.x < rect.right - 2 &&
        screenPoint.y > rect.top + 2 && screenPoint.y < rect.bottom - 2,
      );
      if (hit && !collisions.includes(hit.id)) collisions.push(hit.id);
    }
    const segments = points.slice(1).map((point, index) => ({ previous: points[index], point, index }));
    return {
      collisions,
      nonOrthogonalSegments: segments
        .filter(({ previous, point }) => previous.x !== point.x && previous.y !== point.y)
        .map(({ index }) => index),
      zeroLengthSegments: segments
        .filter(({ previous, point }) => previous.x === point.x && previous.y === point.y)
        .map(({ index }) => index),
    };
  });
}

async function exhaustiveRouteAudit(page: Page) {
  return page.evaluate(() => {
    interface Point { x: number; y: number }
    interface Jump { segmentIndex: number; point: Point; radius: number }
    interface Segment { a: Point; b: Point; axis: "h" | "v"; index: number }
    interface RouteAudit {
      id: string;
      points: Point[];
      jumps: Jump[];
      segments: Segment[];
    }
    const range = (left: number, right: number): [number, number] =>
      left <= right ? [left, right] : [right, left];
    const overlapLength = (left: Segment, right: Segment) => {
      if (left.axis !== right.axis) return 0;
      if (left.axis === "h") {
        if (left.a.y !== right.a.y) return 0;
        const [leftStart, leftEnd] = range(left.a.x, left.b.x);
        const [rightStart, rightEnd] = range(right.a.x, right.b.x);
        return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
      }
      if (left.a.x !== right.a.x) return 0;
      const [leftStart, leftEnd] = range(left.a.y, left.b.y);
      const [rightStart, rightEnd] = range(right.a.y, right.b.y);
      return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
    };
    const crossing = (left: Segment, right: Segment): Point | undefined => {
      if (left.axis === right.axis) return undefined;
      const horizontal = left.axis === "h" ? left : right;
      const vertical = left.axis === "v" ? left : right;
      const [minX, maxX] = range(horizontal.a.x, horizontal.b.x);
      const [minY, maxY] = range(vertical.a.y, vertical.b.y);
      return vertical.a.x > minX && vertical.a.x < maxX && horizontal.a.y > minY && horizontal.a.y < maxY
        ? { x: vertical.a.x, y: horizontal.a.y }
        : undefined;
    };
    const projectedOverlap = (left: Segment, right: Segment) => {
      if (left.axis !== right.axis) return 0;
      const [leftStart, leftEnd] = left.axis === "h"
        ? range(left.a.x, left.b.x)
        : range(left.a.y, left.b.y);
      const [rightStart, rightEnd] = right.axis === "h"
        ? range(right.a.x, right.b.x)
        : range(right.a.y, right.b.y);
      return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
    };
    const samePoint = (left: Point, right: Point) => left.x === right.x && left.y === right.y;
    const sharedTerminalStubCoversOverlap = (
      leftRoute: RouteAudit,
      leftSegment: Segment,
      rightRoute: RouteAudit,
      rightSegment: Segment,
    ) => {
      const terminalStubs = (route: RouteAudit) => [
        { endpoint: route.points[0], segment: route.segments[0] },
        { endpoint: route.points.at(-1)!, segment: route.segments.at(-1)! },
      ];
      return terminalStubs(leftRoute).some((leftStub) => terminalStubs(rightRoute).some((rightStub) => {
        if (!samePoint(leftStub.endpoint, rightStub.endpoint) ||
          leftStub.segment.axis !== leftSegment.axis || rightStub.segment.axis !== rightSegment.axis) return false;
        const [leftStart, leftEnd] = leftSegment.axis === "h"
          ? range(leftSegment.a.x, leftSegment.b.x)
          : range(leftSegment.a.y, leftSegment.b.y);
        const [rightStart, rightEnd] = rightSegment.axis === "h"
          ? range(rightSegment.a.x, rightSegment.b.x)
          : range(rightSegment.a.y, rightSegment.b.y);
        const overlapStart = Math.max(leftStart, rightStart);
        const overlapEnd = Math.min(leftEnd, rightEnd);
        const [leftStubStart, leftStubEnd] = leftStub.segment.axis === "h"
          ? range(leftStub.segment.a.x, leftStub.segment.b.x)
          : range(leftStub.segment.a.y, leftStub.segment.b.y);
        const [rightStubStart, rightStubEnd] = rightStub.segment.axis === "h"
          ? range(rightStub.segment.a.x, rightStub.segment.b.x)
          : range(rightStub.segment.a.y, rightStub.segment.b.y);
        return overlapEnd > overlapStart &&
          overlapStart >= leftStubStart && overlapEnd <= leftStubEnd &&
          overlapStart >= rightStubStart && overlapEnd <= rightStubEnd;
      }));
    };
    const perRouteIssues: string[] = [];
    const routes = [...document.querySelectorAll<SVGGElement>("[data-route-points]")].map<RouteAudit>((group) => {
      const id = group.closest(".react-flow__edge")?.getAttribute("data-id") ?? "unknown";
      const points = JSON.parse(group.dataset.routePoints ?? "[]") as Point[];
      const jumps = JSON.parse(group.dataset.routeJumps ?? "[]") as Jump[];
      const segments = points.slice(1).flatMap<Segment>((point, index) => {
        const previous = points[index];
        if (![previous.x, previous.y, point.x, point.y].every(Number.isFinite)) {
          perRouteIssues.push(`${id}: non-finite coordinate`);
          return [];
        }
        if (previous.x === point.x && previous.y === point.y) {
          perRouteIssues.push(`${id}: zero-length segment ${index}`);
          return [];
        }
        const axis = previous.y === point.y ? "h" : previous.x === point.x ? "v" : undefined;
        if (!axis) {
          perRouteIssues.push(`${id}: diagonal segment ${index}`);
          return [];
        }
        const length = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
        if (length < 1) perRouteIssues.push(`${id}: micro segment ${index} (${length})`);
        return [{ a: previous, b: point, axis, index }];
      });
      if (points.length < 2 || segments.length !== points.length - 1) {
        perRouteIssues.push(`${id}: incomplete polyline`);
      }
      segments.slice(1).forEach((segment, index) => {
        const previous = segments[index];
        if (previous.axis !== segment.axis) return;
        const previousDelta = previous.axis === "h" ? previous.b.x - previous.a.x : previous.b.y - previous.a.y;
        const currentDelta = segment.axis === "h" ? segment.b.x - segment.a.x : segment.b.y - segment.a.y;
        if (Math.sign(previousDelta) !== Math.sign(currentDelta)) perRouteIssues.push(`${id}: reversal ${index}`);
      });
      segments.forEach((left, leftIndex) => segments.slice(leftIndex + 2).forEach((right) => {
        if (overlapLength(left, right) > 0 || crossing(left, right)) {
          perRouteIssues.push(`${id}: self intersection ${left.index}/${right.index}`);
        }
      }));
      if (Number(group.dataset.routeJumpCount) !== jumps.length) {
        perRouteIssues.push(`${id}: jump count mismatch`);
      }
      return { id, points, jumps, segments };
    });
    const duplicateRouteIds = routes
      .map((route) => route.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    const parallelConflicts: string[] = [];
    const unbridgedCrossings: string[] = [];
    const coveredJumps = new Set<string>();
    let auditedPairCount = 0;
    routes.forEach((left, leftIndex) => routes.slice(leftIndex + 1).forEach((right) => {
      auditedPairCount += 1;
      left.segments.forEach((leftSegment) => right.segments.forEach((rightSegment) => {
        if (leftSegment.axis === rightSegment.axis && projectedOverlap(leftSegment, rightSegment) > 0) {
          const perpendicularGap = leftSegment.axis === "h"
            ? Math.abs(leftSegment.a.y - rightSegment.a.y)
            : Math.abs(leftSegment.a.x - rightSegment.a.x);
          const exactOverlap = perpendicularGap === 0 && overlapLength(leftSegment, rightSegment) > 0;
          if (perpendicularGap < 8 && !(exactOverlap && sharedTerminalStubCoversOverlap(
            left,
            leftSegment,
            right,
            rightSegment,
          ))) {
            parallelConflicts.push(`${left.id} <-> ${right.id} (${perpendicularGap}px)`);
          }
        }
        const point = crossing(leftSegment, rightSegment);
        if (!point) return;
        const horizontalRoute = leftSegment.axis === "h" ? left : right;
        const horizontalSegment = leftSegment.axis === "h" ? leftSegment : rightSegment;
        const jumpIndex = horizontalRoute.jumps.findIndex((jump) =>
          jump.segmentIndex === horizontalSegment.index &&
          Math.abs(jump.point.y - point.y) < 0.01 &&
          Math.abs(jump.point.x - point.x) <= jump.radius
        );
        if (jumpIndex < 0) {
          unbridgedCrossings.push(`${left.id} <-> ${right.id} @ ${point.x},${point.y}`);
        } else {
          coveredJumps.add(`${horizontalRoute.id}:${jumpIndex}`);
        }
      }));
    }));
    const orphanJumps = routes.flatMap((route) => route.jumps.flatMap((_, index) =>
      coveredJumps.has(`${route.id}:${index}`) ? [] : [`${route.id}:${index}`]
    ));
    return {
      routeIds: routes.map((route) => route.id).sort(),
      auditedRouteCount: routes.length,
      auditedPairCount,
      expectedPairCount: routes.length * (routes.length - 1) / 2,
      duplicateRouteIds,
      perRouteIssues,
      parallelConflicts: [...new Set(parallelConflicts)],
      unbridgedCrossings,
      orphanJumps,
      renderedJumpCount: routes.reduce((count, route) => count + route.jumps.length, 0),
    };
  });
}

test.beforeEach(async ({ browserName, page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      if (browserName === "firefox" && message.type() === "warning" &&
        FIREFOX_VITE_INLINE_WORKER_WARNING.test(message.text())) return;
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto("/");
  await waitForLayout(page);
});

test.afterEach(async ({ page }) => {
  expect(browserProblems.get(page) ?? []).toEqual([]);
});

test("loads the bundled v2 design without DRC or viewport failures", async ({ page }) => {
  await expect(page.locator(".bd-document-title span")).toHaveText("AIO Agent Runtime");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await expect(page.locator(".bd-statusbar")).toContainText("BlockDesignDocument 2.2");
  const canvas = page.locator(".bd-react-flow");
  const agentUi = flowNode(page, "system::agent-ui");
  await expect(canvas).toHaveAttribute("data-detail-level", "overview");
  await expect(agentUi.locator(".bd-block-heading h3")).toBeVisible();
  await expect(agentUi.locator(".bd-port-label span").first()).toBeVisible();
  await expect(agentUi.locator(".bd-block-heading span")).toBeHidden();
  await expect(agentUi.locator(".bd-port-label small").first()).toBeHidden();
  if (process.env.CAPTURE_WORKBENCH_REFRESH === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/professional-workbench.png");
  }

  await page.locator(".react-flow__controls-zoomin").click({ force: true });
  await expect(canvas).toHaveAttribute("data-detail-level", "full");
  await expect(agentUi.locator(".bd-block-heading span")).toBeVisible();
  await expect(agentUi.locator(".bd-port-label small").first()).toBeHidden();
  await page.waitForTimeout(350);
  await agentUi.locator(".bd-port-label").first().hover();
  await expect(agentUi.locator(".bd-port-label small").first()).toBeVisible();
  await agentUi.locator(".bd-block-header").hover();
  await expect(agentUi.locator(".bd-port-label small").first()).toBeHidden();
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const overflow = await page.evaluate(() => [
    document.body.scrollWidth - window.innerWidth,
    document.body.scrollHeight - window.innerHeight,
  ]);
  expect(overflow).toEqual([0, 0]);
});

test("renames a module directly on the canvas as one recoverable document edit", async ({ page, browserName }) => {
  const node = flowNode(page, "system::agent-ui");
  const inspector = page.getByRole("region", { name: "Properties" });
  await node.click({ force: true });
  await node.focus();

  await page.keyboard.press("F2");
  let titleEditor = node.getByRole("textbox", { name: "Rename Agent UI" });
  await expect(titleEditor).toBeFocused();
  await expect(titleEditor).toHaveValue("Agent UI");
  await titleEditor.fill("Cancelled canvas title");
  await page.keyboard.press("Escape");
  await expect(titleEditor).toHaveCount(0);
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent UI");
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  await node.focus();
  await page.keyboard.press("F2");
  titleEditor = node.getByRole("textbox", { name: "Rename Agent UI" });
  await titleEditor.fill("Agent Workbench");
  if (process.env.CAPTURE_INLINE_TITLE_EDITING === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/inline-title-editing.png");
  }
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(titleEditor).toHaveCount(0);
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent Workbench");
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Agent Workbench");
  await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue("Agent Workbench");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText("Renamed module to Agent Workbench.");
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved");

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent UI");
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Agent UI");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent Workbench");

  await node.locator(".bd-block-heading h3").dblclick({ force: true });
  titleEditor = node.getByRole("textbox", { name: "Rename Agent Workbench" });
  await expect(titleEditor).toBeFocused();
  await titleEditor.fill("   ");
  await page.keyboard.press("Enter");
  await expect(titleEditor).toBeVisible();
  await expect(titleEditor).toHaveJSProperty("validationMessage", "Module title is required.");
  await page.keyboard.press("Escape");
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent Workbench");

  await inspector.getByLabel("Title", { exact: true }).fill("Inspector draft");
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toBeVisible();
  await node.focus();
  await page.keyboard.press("F2");
  titleEditor = node.getByRole("textbox", { name: "Rename Agent Workbench" });
  await titleEditor.fill("Rejected canvas title");
  await page.keyboard.press("Enter");
  await expect(titleEditor).toBeFocused();
  await expect(page.locator(".bd-command-error")).toContainText(
    "Apply or discard the current Inspector changes before renaming a module.",
  );
  await page.keyboard.press("Escape");
  await expect(node.locator(".bd-block-heading h3")).toHaveText("Agent Workbench");
  await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue("Inspector draft");
});

test("keeps the compact desktop workbench operable without panel or route obstruction", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await toolbarButton(page, "Fit Design").click({ force: true });

  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const handle = edge.locator(".bd-route-handle").first();
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(handleBox!.width).toBeGreaterThanOrEqual(23);
  expect(handleBox!.height).toBeGreaterThanOrEqual(23);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  await runMenuCommand(page, "View", "Toggle Messages");
  await expect(page.locator(".bd-messages")).toBeVisible();
  const overviewMapToggle = page.getByRole("button", { name: "Show overview map", exact: true });
  await expect(overviewMapToggle).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toBeHidden();
  await overviewMapToggle.click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing compact workbench element ${selector}.`);
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflow: {
        width: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight - window.innerHeight,
      },
      canvas: box(".react-flow"),
      inspector: box(".bd-inspector-pane"),
      inspectorActions: box(".bd-inspector-actions"),
      messages: box(".bd-messages"),
      minimap: box(".react-flow__minimap"),
      statusbar: box(".bd-statusbar"),
      edgeLabelCount: document.querySelectorAll(".react-flow__edge-text").length,
    };
  });

  expect(geometry.overflow).toEqual({ width: 0, height: 0 });
  expect(geometry.canvas.width).toBeGreaterThanOrEqual(560);
  expect(geometry.canvas.height).toBeGreaterThanOrEqual(320);
  expect(geometry.inspector.width).toBeGreaterThanOrEqual(300);
  expect(geometry.messages.height).toBeGreaterThanOrEqual(120);
  expect(geometry.canvas.right).toBeLessThanOrEqual(geometry.inspector.left + 0.5);
  expect(geometry.canvas.bottom).toBeLessThanOrEqual(geometry.messages.top + 0.5);
  expect(geometry.minimap.right).toBeLessThanOrEqual(geometry.canvas.right);
  expect(geometry.minimap.bottom).toBeLessThanOrEqual(geometry.canvas.bottom);
  expect(geometry.inspectorActions.bottom).toBeLessThanOrEqual(geometry.statusbar.top);
  expect(geometry.statusbar.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.edgeLabelCount).toBe(0);
  await page.getByRole("button", { name: "Hide overview map", exact: true }).click();
  await expect(page.locator(".react-flow__minimap")).toBeHidden();

  if (process.env.CAPTURE_COMPACT_WORKBENCH === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/compact-workbench.png");
  }
});

test("reveals one unobtrusive tooltip path for toolbar and canvas controls", async ({ page }) => {
  const tooltip = page.getByRole("tooltip");
  const save = toolbarButton(page, "Save");

  await expect(page.locator(".bd-toolbar button[title], .bd-canvas-controls button[title]")).toHaveCount(0);
  await save.hover();
  await expect(tooltip).toHaveCount(0);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Save");
  await expect(tooltip).toContainText("Ctrl/⌘ S");

  const toolbarGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.bd-toolbar button[aria-label="Save"]');
    const popup = document.querySelector<HTMLElement>('[role="tooltip"]');
    if (!target || !popup) throw new Error("Toolbar tooltip geometry is unavailable.");
    const targetBox = target.getBoundingClientRect();
    const popupBox = popup.getBoundingClientRect();
    const overlap = !(
      popupBox.right <= targetBox.left ||
      popupBox.left >= targetBox.right ||
      popupBox.bottom <= targetBox.top ||
      popupBox.top >= targetBox.bottom
    );
    return {
      overlap,
      insideViewport: popupBox.left >= 0 && popupBox.top >= 0 &&
        popupBox.right <= window.innerWidth && popupBox.bottom <= window.innerHeight,
    };
  });
  expect(toolbarGeometry).toEqual({ overlap: false, insideViewport: true });

  await save.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(save).toBeFocused();
  await page.locator(".bd-react-flow").click({ position: { x: 100, y: 100 } });

  const unavailablePort = page
    .getByRole("toolbar", { name: "Architecture design tools" })
    .getByRole("button", { name: /^Add Port... — Select a module first\.$/ });
  await unavailablePort.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Add Port...");
  await expect(tooltip).toContainText("Select a module first.");
  expect((await accessibilityResults(page, '[role="tooltip"]')).violations).toEqual([]);
  expect(await textContrastIssues(page, '[role="tooltip"]')).toEqual([]);
  if (process.env.CAPTURE_TOOLTIP_PROOF === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/command-tooltip.png");
  }

  const zoomBeforeControl = await canvasViewportTransform(page);
  await page.locator(".react-flow__controls-zoomin").click();
  await expect.poll(() => canvasViewportTransform(page)).not.toBe(zoomBeforeControl);
  await page.mouse.move(700, 420);
  await page.waitForTimeout(30);
  const interruptedControlViewport = await canvasViewportTransform(page);
  await page.waitForTimeout(80);
  expect(await canvasViewportTransform(page)).toBe(interruptedControlViewport);
  const fit = page.locator(".react-flow__controls-fitview");
  await fit.focus();
  await expect(tooltip).toHaveText("Fit design");
  const canvasGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(".react-flow__controls-fitview");
    const popup = document.querySelector<HTMLElement>('[role="tooltip"]');
    if (!target || !popup) throw new Error("Canvas tooltip geometry is unavailable.");
    const targetBox = target.getBoundingClientRect();
    const popupBox = popup.getBoundingClientRect();
    return {
      clearsControl: popupBox.left >= targetBox.right,
      insideViewport: popupBox.left >= 0 && popupBox.top >= 0 &&
        popupBox.right <= window.innerWidth && popupBox.bottom <= window.innerHeight,
    };
  });
  expect(canvasGeometry).toEqual({ clearsControl: true, insideViewport: true });
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await save.focus();
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate((element) => ({
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationSeconds: Number.parseFloat(getComputedStyle(element).animationDuration),
  }))).toEqual({ reduced: true, animationSeconds: 0.00001 });
});

test("keeps only direct-workflow commands in the persistent toolbar", async ({ page }) => {
  const toolbar = page.getByRole("toolbar", { name: "Architecture design tools" });
  await expect(toolbar.locator(".bd-toolbar-group").getByRole("button")).toHaveCount(12);
  await expect(toolbar.getByRole("navigation", { name: "Diagram view hierarchy" }).getByRole("button"))
    .toHaveCount(1);
  await expect(toolbar.getByRole("group", { name: "File" }).getByRole("button")).toHaveCount(3);
  await expect(toolbar.getByRole("group", { name: "History and selection" }).getByRole("button")).toHaveCount(3);
  await expect(toolbar.getByRole("group", { name: "Create" }).getByRole("button")).toHaveCount(4);
  await expect(toolbar.getByRole("group", { name: "Canvas and review" }).getByRole("button")).toHaveCount(2);

  for (const title of ["Regenerate Layout", "Optimize Routing", "Sources", "Messages", "Properties", "Maximize Diagram"]) {
    await expect(toolbar.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Design", exact: true }).click();
  const designMenu = page.getByRole("menu", { name: "Design" });
  await expect(designMenu.getByRole("menuitem", { name: "Regenerate Layout", exact: true })).toBeVisible();
  await expect(designMenu.getByRole("menuitem", { name: "Optimize Routing", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "View", exact: true }).click();
  const viewMenu = page.getByRole("menu", { name: "View" });
  for (const label of ["Toggle Sources", "Toggle Messages", "Toggle Properties", "Maximize Diagram"]) {
    await expect(viewMenu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  for (const label of [
    /^Regenerate Layout/,
    /^Optimize Routing/,
    /^Toggle Sources/,
    /^Toggle Messages/,
    /^Toggle Properties/,
    /^Maximize Diagram/,
  ]) {
    await expect(palette.getByRole("option", { name: label })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  const wide = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>(".bd-toolbar-group button")];
    const breadcrumb = document.querySelector<HTMLElement>(".bd-breadcrumbs");
    if (!buttons.length || !breadcrumb) throw new Error("Toolbar geometry is unavailable.");
    const first = buttons[0].getBoundingClientRect();
    const last = buttons.at(-1)!.getBoundingClientRect();
    const trail = breadcrumb.getBoundingClientRect();
    return {
      commandWidth: last.right - first.left,
      breadcrumbWidth: trail.width,
      overflow: [
        document.documentElement.scrollWidth - window.innerWidth,
        document.documentElement.scrollHeight - window.innerHeight,
      ],
    };
  });
  expect(wide.commandWidth).toBeLessThan(430);
  expect(wide.breadcrumbWidth).toBeGreaterThan(1100);
  expect(wide.overflow).toEqual([0, 0]);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(toolbar).toBeVisible();
  expect(await page.locator(".bd-breadcrumbs").evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(730);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  if (process.env.CAPTURE_FOCUSED_TOOLBAR === "1") {
    await page.locator(".bd-react-flow").click({ position: { x: 40, y: 40 } });
    await captureStudioScreenshot(page, "docs/screenshots/focused-toolbar.png");
  }
});

test("searches and runs the unified command palette without losing workflow focus", async ({ page }) => {
  const save = toolbarButton(page, "Save");
  await save.focus();
  await page.keyboard.press("ControlOrMeta+K");

  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();
  await expect(palette.getByRole("option")).toHaveCount(51);
  await expect(palette.getByRole("option", { name: /^Command Palette/ })).toHaveCount(0);

  await search.fill("Add Port...");
  const unavailablePort = palette.getByRole("option", { name: /^Add Port/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailablePort).toHaveAttribute("aria-disabled", "true");
  await expect(unavailablePort).toContainText("Select a module first.");
  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();
  await clickWithPointer(page, unavailablePort);
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();

  await search.fill("reconnect interface");
  const unavailableReconnect = palette.getByRole("option", { name: /^Reconnect Interface/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableReconnect).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableReconnect).toContainText("Select one interface first.");
  await clickWithPointer(page, unavailableReconnect);
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();

  await search.fill("direct interfaces");
  const unavailableDirectInterfaces = palette.getByRole("option", { name: /^Select Direct Interfaces/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableDirectInterfaces).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableDirectInterfaces).toContainText("Select one or more modules first.");

  await search.fill("direct neighborhood");
  const unavailableNeighborhood = palette.getByRole("option", { name: /^Select Direct Neighborhood/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableNeighborhood).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableNeighborhood).toContainText("Select one or more modules first.");

  await search.fill("incoming interfaces");
  const unavailableIncoming = palette.getByRole("option", { name: /^Select Incoming Interfaces/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableIncoming).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableIncoming).toContainText("Select one or more modules first.");

  await search.fill("outgoing neighborhood");
  const unavailableOutgoingNeighborhood = palette.getByRole("option", { name: /^Select Outgoing Neighborhood/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableOutgoingNeighborhood).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableOutgoingNeighborhood).toContainText("Select one or more modules first.");

  await search.fill("cut");
  const unavailableCut = palette.getByRole("option", { name: /^Cut/ });
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(unavailableCut).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableCut).toContainText("Select one or more modules first.");

  await search.fill("no such architecture action");
  await expect(palette.getByText("No matching commands", { exact: true })).toBeVisible();
  await expect(palette.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();

  await search.fill("add");
  await expect(palette.getByRole("option")).toHaveCount(3);
  const addModuleOption = palette.getByRole("option", { name: /^Add Module/ });
  const addInterfaceOption = palette.getByRole("option", { name: /^Add Interface/ });
  await expect(addModuleOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(addInterfaceOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(addModuleOption).toHaveAttribute("aria-selected", "true");

  expect((await accessibilityResults(page, ".bd-command-palette")).violations).toEqual([]);
  expect(await textContrastIssues(page, ".bd-command-palette")).toEqual([]);
  expect(await palette.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      insideViewport: bounds.left >= 0 && bounds.top >= 0 &&
        bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight,
      overflow: [
        document.documentElement.scrollWidth - window.innerWidth,
        document.documentElement.scrollHeight - window.innerHeight,
      ],
    };
  })).toEqual({ insideViewport: true, overflow: [0, 0] });
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  if (process.env.CAPTURE_COMMAND_PALETTE === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/command-palette.png");
  }

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(save).toBeFocused();

  await page.keyboard.press("ControlOrMeta+K");
  await search.fill("add module");
  await page.keyboard.press("Enter");
  const moduleDialog = page.getByRole("dialog", { name: /Add Module/ });
  await expect(moduleDialog.getByLabel("Module title")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+K");
  await expect(palette).toHaveCount(0);
  await expect(moduleDialog.getByLabel("Module title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(save).toBeFocused();

  await page.keyboard.press("ControlOrMeta+K");
  await search.fill("validate");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByLabel("Filter design issues")).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("ControlOrMeta+K");
  await expect(search).toBeFocused();
  expect(await palette.evaluate((element) => ({
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationSeconds: Number.parseFloat(getComputedStyle(element).animationDuration),
  }))).toEqual({ reduced: true, animationSeconds: 0.00001 });
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Filter design issues")).toBeFocused();

  const viewTrigger = page.getByRole("button", { name: "View", exact: true });
  await viewTrigger.click();
  const paletteMenuItem = page.getByRole("menuitem", { name: /^Command Palette/ });
  await expect(paletteMenuItem).toContainText("Ctrl/⌘ K");
  await paletteMenuItem.click();
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(viewTrigger).toBeFocused();
});

test("routes and persists a new interface inside an existing complex design", async ({ page }) => {
  await addModule(page, { title: "Review Gateway", id: "review-gateway", owner: "Architecture Review" });
  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Purpose", { exact: true }).fill("Expose reviewed session commands to an external checker.");
  await inspector.getByLabel("Boundary", { exact: true }).fill("Consumes commands without owning session state or dispatch.");
  await inspector.getByLabel("Failure behavior", { exact: true }).fill("Rejects invalid commands without changing the source session.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await addPort(page, {
    label: "review.command",
    id: "review-command",
    direction: "input",
    side: "left",
    dataType: "JSON-RPC",
  });

  const source = flowNode(page, "system::agent-ui")
    .locator('.bd-port-handle-outer[data-handleid="session-command"]');
  const target = flowNode(page, "system::review-gateway")
    .locator('.bd-port-handle-outer[data-handleid="review-command"]');
  await dragConnection(page, source, target);
  const connectionDialog = page.getByRole("dialog", { name: "Create Typed Interface" });
  await expect(connectionDialog).toBeVisible();
  await connectionDialog.getByLabel("Interface title").fill("Reviewed Session Command RPC");
  await connectionDialog.getByLabel("Connection id").fill("ui-to-review-gateway");
  await connectionDialog.getByLabel("Interface id").fill("review.session.command");
  await connectionDialog.getByLabel("Interface type").selectOption("rpc");
  await connectionDialog.getByLabel("Owner").fill("Architecture Review");
  await connectionDialog.getByRole("button", { name: "Create Connection", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await inspector.getByLabel("Purpose", { exact: true }).fill("Carry a reviewed session command to the checker.");
  await inspector.getByLabel("Boundary", { exact: true }).fill("Does not grant dispatch authority or mutate session state.");
  await inspector.getByLabel("Failure behavior", { exact: true }).fill("Reports validation failure to the caller without retrying.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await toolbarButton(page, "Fit Design").click({ force: true });
  await page.waitForTimeout(400);

  await expect(page.locator(".react-flow__node")).toHaveCount(8);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await expect(flowNode(page, "system::review-gateway").locator(".bd-port-label span"))
    .toHaveText("review.command");
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });

  const edge = page.locator('.react-flow__edge[data-id="system::ui-to-review-gateway"]');
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await clickReachableEdgePoint(page, edge);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Reviewed Session Command RPC");
  const handle = edge.locator(".bd-route-handle").first();
  await handle.focus();
  const moveKey = await handle.getAttribute("data-route-axis") === "h"
    ? "ArrowDown"
    : "ArrowRight";
  await page.keyboard.press(moveKey);
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(page.locator(".bd-command-error")).toHaveCount(0);

  if (process.env.CAPTURE_INCREMENTAL_ROUTING === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/incremental-routing.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedConnection = saved.levels
    .find((level: { id: string }) => level.id === "system")
    .connections.find((connection: { id: string }) => connection.id === "ui-to-review-gateway");
  expect(savedConnection.routing.waypoints.length).toBeGreaterThan(0);
  expect(savedConnection.routing.waypoints.slice(1).every(
    (point: { x: number; y: number }, index: number) => {
      const previous = savedConnection.routing.waypoints[index];
      return point.x === previous.x || point.y === previous.y;
    },
  )).toBe(true);

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
});

test("meets automated WCAG rules in the default workbench and open dialog", async ({ page }) => {
  const documentStructure = await accessibilityResults(page, undefined, [
    "document-title",
    "html-has-lang",
    "html-lang-valid",
    "meta-viewport",
  ]);
  expect(documentStructure.violations).toEqual([]);

  const workbenchScopes = [
    ".bd-app-header",
    ".bd-menubar",
    ".bd-toolbar",
    ".bd-statusbar",
    '[aria-label="Sources"]',
    '[aria-label="Properties"]',
    ".react-flow__nodes",
    ".react-flow__edges",
    ".react-flow__controls",
    ".react-flow__minimap",
    ".bd-canvas-caption",
  ];
  for (const selector of workbenchScopes) {
    const workbench = await accessibilityResults(page, selector);
    expect(workbench.violations, selector).toEqual([]);
  }
  expect(await textContrastIssues(page, ".bd-studio")).toEqual([]);
  await runMenuCommand(page, "View", "Toggle Messages");
  await expect(page.locator(".bd-messages")).toBeVisible();
  const messages = await accessibilityResults(page, ".bd-messages");
  expect(messages.violations, ".bd-messages").toEqual([]);

  await openDesignDialog(page);
  const dialog = await accessibilityResults(page, '[role="dialog"]');
  expect(dialog.violations).toEqual([]);
  expect(await textContrastIssues(page, '[role="dialog"]')).toEqual([]);
});

test("navigates application menus with a desktop keyboard model", async ({ page }) => {
  const fileTrigger = page.getByRole("button", { name: "File", exact: true });
  await fileTrigger.focus();
  await page.keyboard.press("Enter");

  const fileMenu = page.getByRole("menu", { name: "File" });
  await expect(fileMenu).toBeVisible();
  await expect(fileMenu.getByRole("menuitem", { name: /^New Design/ })).toBeFocused();

  await page.keyboard.press("End");
  await expect(fileMenu.getByRole("menuitem", { name: /^Export JSON/ })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  const editMenu = page.getByRole("menu", { name: "Edit" });
  await expect(editMenu).toBeVisible();
  await expect(editMenu.getByRole("menuitem", { name: /^Undo/ })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  const designMenu = page.getByRole("menu", { name: "Design" });
  await expect(designMenu).toBeVisible();
  await expect(designMenu.getByRole("menuitem", { name: /^Add Module/ })).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(designMenu.getByRole("menuitem", { name: /^Add Port/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(designMenu.getByRole("menuitem", { name: /^Add Interface/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(designMenu.getByRole("menuitem", { name: /^Reconnect Interface/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(designMenu.getByRole("menuitem", { name: /^Create Child Design/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(designMenu.getByRole("menuitem", { name: /^Regenerate Layout/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(designMenu.getByRole("menuitem", { name: /^Add Module/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Design", exact: true })).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();

  await fileTrigger.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  const newDesignDialog = page.getByRole("dialog", { name: "New Design" });
  await expect(newDesignDialog).toBeVisible();
  await expect(newDesignDialog.getByLabel("Design title")).toBeFocused();
});

test("reaches available and unavailable design commands by typing menu initials", async ({ page }) => {
  const fileTrigger = page.getByRole("button", { name: "File", exact: true });
  const designTrigger = page.getByRole("button", { name: "Design", exact: true });

  await fileTrigger.focus();
  await page.keyboard.press("d");
  await expect(designTrigger).toBeFocused();
  await page.keyboard.press("Enter");

  const designMenu = page.getByRole("menu", { name: "Design" });
  const addModule = designMenu.getByRole("menuitem", { name: /^Add Module/ });
  const addPort = designMenu.getByRole("menuitem", { name: /^Add Port/ });
  const addInterface = designMenu.getByRole("menuitem", { name: /^Add Interface/ });
  const addChild = designMenu.getByRole("menuitem", { name: /^Create Child Design/ });
  await expect(addModule).toBeFocused();

  await page.keyboard.press("a");
  await expect(addPort).toBeFocused();
  await expect(addPort).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(addPort).toBeFocused();
  await expect(designMenu).toBeVisible();
  await page.keyboard.press("a");
  await expect(addInterface).toBeFocused();
  await page.keyboard.press("a");
  await expect(addModule).toBeFocused();
  await page.keyboard.press("c");
  await expect(addChild).toBeFocused();
  await expect(addChild).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Space");
  await expect(addChild).toBeFocused();
  await expect(designMenu).toBeVisible();
  await page.keyboard.press("a");
  await expect(addModule).toBeFocused();
  await page.keyboard.press("Enter");

  const moduleDialog = page.getByRole("dialog", { name: /Add Module/ });
  await expect(moduleDialog.getByLabel("Module title")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard Module");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Architecture Team");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(designTrigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(addModule).toBeFocused();
  await page.keyboard.press("a");
  await expect(addPort).toBeFocused();
  await page.keyboard.press("a");
  await expect(addInterface).toBeFocused();
  await page.keyboard.press("a");
  await expect(addModule).toBeFocused();
  await page.keyboard.press("c");
  await expect(addChild).toBeFocused();
  if (process.env.CAPTURE_MENU_TYPEAHEAD === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/menu-typeahead.png");
  }
  await page.keyboard.press("Enter");

  const childDialog = page.getByRole("dialog", { name: /Create Child Design/ });
  await expect(childDialog).toBeVisible();
  await expect(childDialog.getByLabel("Child design title")).toBeFocused();
});

test("explains why context-dependent design commands are unavailable", async ({ page }) => {
  await page.getByRole("button", { name: "New Design...", exact: true }).click();
  await page.getByRole("dialog", { name: "New Design" }).getByRole("button", { name: "Create", exact: true }).click();
  const emptyState = page.getByRole("region", { name: "Start with a module" });
  await expect(emptyState).toBeVisible();

  const designTrigger = page.getByRole("button", { name: "Design", exact: true });
  const designMenu = page.getByRole("menu", { name: "Design" });
  const addModule = designMenu.getByRole("menuitem", { name: /^Add Module/ });
  const addPort = designMenu.getByRole("menuitem", { name: /^Add Port/ });
  const addInterface = designMenu.getByRole("menuitem", { name: /^Add Interface/ });
  const addChild = designMenu.getByRole("menuitem", { name: /^Create Child Design/ });

  await designTrigger.click();
  await expect(addModule).not.toHaveAttribute("aria-disabled", "true");
  await expect(addPort).toHaveAttribute("aria-disabled", "true");
  await expect(addPort.locator("small")).toHaveText("Select a module first.");
  await expect(addInterface).toHaveAttribute("aria-disabled", "true");
  await expect(addInterface.locator("small")).toHaveText("Add compatible output/input ports to this level first.");
  await expect(addChild).toHaveAttribute("aria-disabled", "true");
  await expect(addChild.locator("small")).toHaveText("Select a module first.");
  await addModule.focus();
  await page.keyboard.press("ArrowDown");
  await expect(addPort).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(addPort).toBeFocused();
  await expect(designMenu).toBeVisible();
  await page.keyboard.press("Space");
  await expect(addPort).toBeFocused();
  await expect(designMenu).toBeVisible();
  const addPortBox = await addPort.boundingBox();
  expect(addPortBox).not.toBeNull();
  await page.mouse.click(addPortBox!.x + addPortBox!.width / 2, addPortBox!.y + addPortBox!.height / 2);
  await expect(addPort).toBeFocused();
  await expect(designMenu).toBeVisible();
  expect((await accessibilityResults(page, '[role="menu"]')).violations).toEqual([]);
  expect(await textContrastIssues(page, '[role="menu"]')).toEqual([]);
  if (process.env.CAPTURE_DISABLED_MENU_FOCUS === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/disabled-menu-focus.png");
  }
  if (process.env.CAPTURE_COMMAND_GUIDANCE === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/disabled-command-guidance.png");
  }
  await page.keyboard.press("Escape");

  const addPortTool = page.getByRole("button", { name: /^Add Port.../ });
  const addInterfaceTool = page.getByRole("button", { name: /^Add Interface.../ });
  const addChildTool = page.getByRole("button", { name: /^Create Child Design.../ });
  await expect(addPortTool).toHaveAttribute("aria-label", "Add Port... — Select a module first.");
  await expect(addInterfaceTool).toHaveAttribute("aria-label", "Add Interface... — Add compatible output/input ports to this level first.");

  await emptyState.getByRole("button", { name: "Add first module" }).click();
  await page.getByRole("dialog", { name: /Add Module/ }).getByRole("button", { name: "Add Module", exact: true }).click();
  await waitForEditorIdle(page);
  await designTrigger.click();
  await expect(addPort).not.toHaveAttribute("aria-disabled", "true");
  await expect(addPort.locator("small")).toHaveCount(0);
  await expect(addInterface).toHaveAttribute("aria-disabled", "true");
  await expect(addInterface.locator("small")).toHaveText("Add compatible output/input ports to this level first.");
  await expect(addChild).not.toHaveAttribute("aria-disabled", "true");

  await addChild.click();
  const childDialog = page.getByRole("dialog", { name: /Create Child Design/ });
  await childDialog.getByRole("button", { name: "Create Child Design", exact: true }).click();
  await waitForEditorIdle(page);
  await page.getByRole("region", { name: "Sources" }).getByRole("button", { name: "New Module", exact: true }).click();
  await designTrigger.click();
  await expect(addChild).toHaveAttribute("aria-disabled", "true");
  await expect(addChild.locator("small")).toHaveText("Use this module's hierarchy control to open its child design.");
  await page.keyboard.press("Escape");
  await expect(addChildTool).toHaveAttribute(
    "aria-label",
    "Create Child Design... — Use this module's hierarchy control to open its child design.",
  );
});

test("guides a new user from an empty design to the first module", async ({ page }) => {
  await toolbarButton(page, "New Design...").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Review Workbench");
  await newDialog.getByLabel("Design id").fill("review-workbench");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });

  const emptyState = page.getByRole("region", { name: "Start with a module" });
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("Module");
  await expect(emptyState).toContainText("Port");
  await expect(emptyState).toContainText("Interface");

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await search.fill("modules in level");
  const modulesCommand = palette.getByRole("option", { name: /^Select Modules in Level/ });
  await expect(modulesCommand).toHaveAttribute("aria-disabled", "true");
  await expect(modulesCommand).toContainText("The current design level has no modules to select.");
  await search.fill("interfaces in level");
  const interfacesCommand = palette.getByRole("option", { name: /^Select Interfaces in Level/ });
  await expect(interfacesCommand).toHaveAttribute("aria-disabled", "true");
  await expect(interfacesCommand).toContainText("The current design level has no interfaces to select.");
  await page.keyboard.press("Escape");

  await emptyState.getByRole("button", { name: "Add first module" }).click({ force: true });

  const moduleDialog = page.getByRole("dialog", { name: /Add Module/ });
  await moduleDialog.getByLabel("Module title").fill("Public API");
  await moduleDialog.getByLabel("Module id").fill("api");
  await moduleDialog.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await expect(flowNode(page, "system::api")).toBeVisible();
  await expect(emptyState).toHaveCount(0);
});

test("keeps suggested identifiers linked until the user customizes them", async ({ page }) => {
  await toolbarButton(page, "New Design...").click({ force: true });
  const newDesign = page.getByRole("dialog", { name: "New Design" });
  await newDesign.getByLabel("Design title").fill("Checkout Platform");
  await expect(newDesign.getByLabel("Design id")).toHaveValue("checkout-platform");
  await newDesign.getByLabel("Design id").fill("checkout-system");
  await newDesign.getByLabel("Design title").fill("Checkout Platform v2");
  await expect(newDesign.getByLabel("Design id")).toHaveValue("checkout-system");
  await newDesign.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "Add Module...").click({ force: true });
  const firstModule = page.getByRole("dialog", { name: /Add Module/ });
  await firstModule.getByLabel("Module title").fill("Payment Worker");
  await expect(firstModule.getByLabel("Module id")).toHaveValue("payment-worker");
  await firstModule.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "Add Module...").click({ force: true });
  const secondModule = page.getByRole("dialog", { name: /Add Module/ });
  await secondModule.getByLabel("Module title").fill("Payment Worker");
  await expect(secondModule.getByLabel("Module id")).toHaveValue("payment-worker-2");
  if (process.env.CAPTURE_LINKED_IDS === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/linked-id-suggestion.png");
  }
  await secondModule.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "Add Port...").click({ force: true });
  const firstPort = page.getByRole("dialog", { name: /Add Port/ });
  await firstPort.getByLabel("Port label").fill("Session Events");
  await expect(firstPort.getByLabel("Port id")).toHaveValue("session-events");
  await firstPort.getByLabel("Required connection").uncheck({ force: true });
  await firstPort.getByRole("button", { name: "Add Port", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "Add Port...").click({ force: true });
  const secondPort = page.getByRole("dialog", { name: /Add Port/ });
  await secondPort.getByLabel("Port label").fill("Session Events");
  await expect(secondPort.getByLabel("Port id")).toHaveValue("session-events-2");
  await secondPort.getByLabel("Required connection").uncheck({ force: true });
  await secondPort.getByRole("button", { name: "Add Port", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await flowNode(page, "system::payment-worker").click({ force: true });
  await toolbarButton(page, "Create Child Design...").click({ force: true });
  const childDesign = page.getByRole("dialog", { name: /Create Child Design/ });
  await childDesign.getByLabel("Child design title").fill("Payment Worker Runtime");
  await expect(childDesign.getByLabel("Child level id")).toHaveValue("payment-worker-runtime");
  await childDesign.getByRole("button", { name: "Create Child Design", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const systemLevel = saved.levels.find((level: { id: string }) => level.id === "system");
  const secondWorker = systemLevel.nodes.find((node: { id: string }) => node.id === "payment-worker-2");
  expect(saved.id).toBe("checkout-system");
  expect(systemLevel.nodes.map((node: { id: string }) => node.id)).toEqual([
    "payment-worker",
    "payment-worker-2",
  ]);
  expect(secondWorker.ports.map((port: { id: string }) => port.id)).toEqual([
    "session-events",
    "session-events-2",
  ]);
  expect(saved.levels.some((level: { id: string }) => level.id === "payment-worker-runtime")).toBe(true);
  await expect(page.locator(".bd-command-error")).toHaveCount(0);
});

test("protects unapplied Inspector changes across review navigation and save", async ({ page }) => {
  const inspector = page.getByRole("region", { name: "Properties" });
  const agentUi = page.locator(".bd-tree-select").filter({ hasText: "Agent UI" });
  const project = page.locator(".bd-tree-select").filter({ hasText: "Project" });
  const viewportBeforeReveal = await canvasViewportTransform(page);
  await agentUi.click({ force: true });
  await expect(flowNode(page, "system::agent-ui")).toHaveClass(/selected/);
  await page.waitForTimeout(400);
  expect(await canvasViewportTransform(page)).toBe(viewportBeforeReveal);
  await inspector.getByLabel("Title").fill("Agent UI draft");
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toBeVisible();
  await expect(page.locator(".bd-statusbar")).toContainText("Unapplied Inspector changes");

  const flowAgentUi = flowNode(page, "system::agent-ui");
  const positionBeforeRejectedDrag = await transformOf(flowAgentUi);
  const flowAgentUiBox = await flowAgentUi.boundingBox();
  expect(flowAgentUiBox).not.toBeNull();
  const dragStart = { x: flowAgentUiBox!.x + Math.min(100, flowAgentUiBox!.width / 2), y: flowAgentUiBox!.y + 15 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 80, dragStart.y + 48, { steps: 8 });
  await expect.poll(() => transformOf(flowAgentUi)).not.toBe(positionBeforeRejectedDrag);
  await page.mouse.up();
  await expect.poll(() => transformOf(flowAgentUi)).toBe(positionBeforeRejectedDrag);
  await expect(page.locator(".bd-command-error")).toContainText("before moving a module");
  await expect(inspector.getByLabel("Title")).toHaveValue("Agent UI draft");
  if (process.env.CAPTURE_REJECTED_DRAG === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/rejected-module-drag.png");
  }

  const inspectorTabs = inspector.getByRole("tablist", { name: "Inspector views" });
  await inspectorTabs.getByRole("tab", { name: "JSON", exact: true }).click({ force: true });
  await inspectorTabs.getByRole("tab", { name: "Properties", exact: true }).click({ force: true });
  await expect(inspector.getByLabel("Title")).toHaveValue("Agent UI draft");

  const cancelDialogPromise = page.waitForEvent("dialog");
  const cancelledNavigation = project.click({ force: true });
  const cancelDialog = await cancelDialogPromise;
  expect(cancelDialog.message()).toContain("Discard unapplied Inspector changes");
  await cancelDialog.dismiss();
  await cancelledNavigation;
  await expect(inspector.getByLabel("Title")).toHaveValue("Agent UI draft");

  const modifierDialogPromise = page.waitForEvent("dialog");
  const rejectedModifierSelection = flowNode(page, "system::project").click({
    force: true,
    modifiers: ["Shift"],
  });
  const modifierDialog = await modifierDialogPromise;
  await modifierDialog.dismiss();
  await rejectedModifierSelection;
  await expect(flowAgentUi).toHaveClass(/selected/);
  await expect(flowNode(page, "system::project")).not.toHaveClass(/selected/);
  await expect(inspector.getByLabel("Title")).toHaveValue("Agent UI draft");

  const acceptDialogPromise = page.waitForEvent("dialog");
  const acceptedNavigation = project.click({ force: true });
  const acceptDialog = await acceptDialogPromise;
  await acceptDialog.accept();
  await acceptedNavigation;
  await expect(inspector.getByLabel("Title")).toHaveValue("Project");

  await inspector.getByLabel("Title").fill("Project draft");
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toBeVisible();
  await toolbarButton(page, "Save").click({ force: true });
  await expect(page.locator(".bd-command-error")).toContainText("before saving");
  await expect(inspector.getByLabel("Title")).toHaveValue("Project draft");

  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toHaveCount(0);
  await expect(inspector.getByLabel("Title")).toHaveValue("Project draft");
});

test("keeps keyboard focus inside dialogs and restores the invoking command", async ({ page }) => {
  const newButton = toolbarButton(page, "New Design...");
  await newButton.focus();
  await newButton.click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  const title = newDialog.getByLabel("Design title");
  const create = newDialog.getByRole("button", { name: "Create", exact: true });
  await expect(title).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(create).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(newDialog).toHaveCount(0);
  await expect(newButton).toBeFocused();

  const openButton = toolbarButton(page, "Open Design...");
  await openButton.focus();
  await openButton.click({ force: true });
  const openDialog = page.getByRole("dialog", { name: "Open Design" });
  await expect(openDialog.getByRole("button", { name: "Choose JSON file" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openDialog).toHaveCount(0);
  await expect(openButton).toBeFocused();
});

test("filters design issues and cross-probes the reviewed module", async ({ page }) => {
  await toolbarButton(page, "New Design...").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Review Workbench");
  await newDialog.getByLabel("Design id").fill("review-workbench");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await addModule(page, { title: "Public API", id: "api" });

  const viewTrigger = page.getByRole("button", { name: "View", exact: true });
  await viewTrigger.focus();
  await page.keyboard.press("Enter");
  const viewMenu = page.getByRole("menu", { name: "View" });
  await expect(viewMenu.getByRole("menuitem", { name: /^Enter Module/ })).toBeFocused();
  await expect(viewMenu.getByRole("menuitem", { name: /^Enter Module/ }))
    .toContainText("Select a module with a child design first.");
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowDown");
  await expect(viewMenu.getByRole("menuitem", { name: /^Toggle Messages/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const messages = page.locator(".bd-messages");
  const rows = messages.locator(".bd-message-row");
  const filter = messages.getByLabel("Filter design issues");
  await expect(filter).toBeFocused();

  const all = messages.getByRole("button", { name: /All 3/ });
  const errors = messages.getByRole("button", { name: /Errors 0/ });
  const warnings = messages.getByRole("button", { name: /Warnings 3/ });
  const info = messages.getByRole("button", { name: /Info 0/ });
  await page.keyboard.press("Tab");
  await expect(all).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(errors).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(warnings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(3);

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(filter).toBeFocused();
  await page.keyboard.type("define the boundary");
  await expect(rows).toHaveCount(1);
  const boundaryIssue = rows.first();
  await expect(boundaryIssue).toContainText("BD-CONTRACT-BOUNDARY-MISSING");
  await expect(boundaryIssue.locator(".bd-message-remediation")).toHaveText(
    "Next: Define the boundary in the block api contract.",
  );

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(info).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(boundaryIssue).toBeFocused();
  if (process.env.CAPTURE_DRC_REMEDIATION === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/drc-remediation.png");
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Public API");
  await expect(boundaryIssue).toBeFocused();

  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Shift+Tab");
  await expect(filter).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("not-present");
  await expect(messages.getByText("No matching design issues", { exact: true })).toBeVisible();
});

test("keeps the authoring chrome stable and handles direct commands", async ({ page }) => {
  const positions = await toolbarButton(page, "New Design...").evaluate(async (button) => {
    const samples: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      const rect = button.getBoundingClientRect();
      samples.push(`${rect.x}:${rect.y}:${rect.width}:${rect.height}`);
    }
    return samples;
  });
  expect(new Set(positions).size).toBe(1);
  await toolbarButton(page, "New Design...").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("dialog", { name: "New Design" })).toBeVisible();
  await page.getByRole("dialog", { name: "New Design" }).getByRole("button", { name: "Cancel" }).evaluate((button: HTMLButtonElement) => button.click());
});

test("keeps the viewport and canvas mounted while applying property edits", async ({ page }) => {
  await flowNode(page, "system::agent-ui").click({ force: true });
  const canvas = page.locator(".bd-react-flow");
  await canvas.evaluate((element) => { element.setAttribute("data-mount-proof", "preserved"); });
  const viewportBefore = await canvasViewportTransform(page);
  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Summary").fill("User-facing agent workbench.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);

  await expect(canvas).toHaveAttribute("data-mount-proof", "preserved");
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  await expect(inspector.locator("details", { hasText: "Contract source" })).not.toHaveAttribute("open", "");
  expect(await inspector.getByRole("button", { name: "Apply Changes" }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  })).toBe(true);
});

test("renders one semantic target arrow per connection and neutral port affordances", async ({ page, browserName }) => {
  const actualRoutes = page.locator('[data-boundary-continuation="false"]');
  await expect(actualRoutes).toHaveCount(10);
  for (let index = 0; index < await actualRoutes.count(); index += 1) {
    const path = actualRoutes.nth(index).locator(".bd-interface-route");
    await expect(path).toHaveAttribute("marker-end", /url\(.+arrowclosed.+\)/);
    await expect(path).not.toHaveAttribute("marker-start", /.+/);
  }

  const projectLifecycle = page.locator(
    '.react-flow__edge[data-id="system::project-core-lifecycle"] [data-connection-id="project-core-lifecycle"]',
  );
  const projectDirection = await projectLifecycle.evaluate((route) => {
    const path = route.querySelector<SVGPathElement>(".bd-interface-route");
    const points = JSON.parse(route.getAttribute("data-route-points") ?? "[]") as Array<{ x: number; y: number }>;
    const previous = points.at(-2);
    const target = points.at(-1);
    return {
      sourceNodeId: route.getAttribute("data-source-node-id"),
      targetNodeId: route.getAttribute("data-target-node-id"),
      markerEnd: path?.getAttribute("marker-end"),
      orthogonalTargetApproach: Boolean(previous && target && previous.x === target.x && previous.y > target.y),
    };
  });
  expect(projectDirection).toEqual({
    sourceNodeId: "system::project",
    targetNodeId: "system::rust-agent-core",
    markerEnd: expect.stringMatching(/url\(.+arrowclosed.+\)/),
    orthogonalTargetApproach: true,
  });
  await expect(page.locator("marker.react-flow__arrowhead").first())
    .toHaveAttribute("markerUnits", "userSpaceOnUse");
  await expect(page.locator("marker.react-flow__arrowhead").first())
    .toHaveAttribute("markerWidth", "44");

  const portPresentation = await flowNode(page, "system::project")
    .locator('.bd-port-handle-outer[data-nodeid="system::project"]')
    .first()
    .evaluate((handle) => {
      const style = getComputedStyle(handle);
      return {
        clipPath: style.clipPath,
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
      };
    });
  expect(portPresentation).toEqual({
    clipPath: "none",
    borderRadius: "50%",
    backgroundColor: "rgb(255, 255, 255)",
  });

  await page.getByRole("tab", { name: "Interfaces", exact: true }).click({ force: true });
  const filter = page.getByLabel("Filter interfaces");
  await filter.fill("Project Lifecycle RPC");
  const result = page.locator(".bd-interface-browser-row");
  await expect(result).toHaveCount(1);
  await result.click({ force: true });
  const selectedProjectRoute = page.locator(
    '.react-flow__edge[data-id="system::project-core-lifecycle"] .bd-interface-route',
  );
  await expect(selectedProjectRoute).toBeVisible();
  expect(await selectedProjectRoute.evaluate((path) => getComputedStyle(path).stroke))
    .toBe("rgb(155, 100, 27)");

  if (process.env.CAPTURE_CONNECTION_DIRECTION === "1" && browserName === "chromium") {
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/connection-direction.png");
    await page.setViewportSize({ width: 1280, height: 720 });
    await result.click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/connection-direction-compact.png");
    await page.setViewportSize({ width: 1680, height: 1050 });
  }
  await page.getByRole("tab", { name: "Hierarchy", exact: true }).click({ force: true });

  await expandHierarchy(page, "Rust Agent Core");
  const continuationRoutes = page.locator('[data-boundary-continuation="true"]');
  await expect(continuationRoutes).not.toHaveCount(0);
  for (let index = 0; index < await continuationRoutes.count(); index += 1) {
    await expect(continuationRoutes.nth(index).locator(".bd-interface-route"))
      .not.toHaveAttribute("marker-end", /.+/);
  }
  const expandedActualRoutes = page.locator('[data-boundary-continuation="false"]');
  for (let index = 0; index < await expandedActualRoutes.count(); index += 1) {
    await expect(expandedActualRoutes.nth(index).locator(".bd-interface-route"))
      .toHaveAttribute("marker-end", /url\(.+arrowclosed.+\)/);
  }
});

test("reserves collision-free four-side port label rails", async ({ page, browserName }) => {
  const railGeometry = await page.evaluate(() => {
    const failures: string[] = [];
    document.querySelectorAll<HTMLElement>(".bd-block:not(.is-expanded)").forEach((block) => {
      const blockId = block.dataset.blockId ?? "unknown";
      const blockRect = block.getBoundingClientRect();
      const headerRect = block.querySelector<HTMLElement>(".bd-block-header")?.getBoundingClientRect();
      const ownerRect = block.querySelector<HTMLElement>(".bd-block-owner")?.getBoundingClientRect();
      const labels = [...block.querySelectorAll<HTMLElement>(".bd-port-label")].map((label) => ({
        label,
        rect: label.getBoundingClientRect(),
        side: label.closest<HTMLElement>("[data-port-side]")?.dataset.portSide ?? "unknown",
      }));
      labels.forEach(({ label, rect, side }) => {
        if (
          rect.left < blockRect.left - 1 || rect.right > blockRect.right + 1 ||
          rect.top < blockRect.top - 1 || rect.bottom > blockRect.bottom + 1
        ) failures.push(`${blockId}:${label.innerText}:outside`);
        if (side === "top" && headerRect && rect.bottom > headerRect.top + 1) {
          failures.push(`${blockId}:${label.innerText}:header`);
        }
        if (side === "bottom" && ownerRect && rect.top < ownerRect.bottom - 1) {
          failures.push(`${blockId}:${label.innerText}:owner`);
        }
      });
      labels.forEach((left, index) => labels.slice(index + 1).forEach((right) => {
        const overlap = left.rect.left < right.rect.right - 1
          && left.rect.right > right.rect.left + 1
          && left.rect.top < right.rect.bottom - 1
          && left.rect.bottom > right.rect.top + 1;
        if (overlap) failures.push(`${blockId}:${left.label.innerText}<->${right.label.innerText}`);
      }));
    });
    return failures;
  });
  expect(railGeometry).toEqual([]);

  const project = flowNode(page, "system::project");
  const core = flowNode(page, "system::rust-agent-core");
  await expect(project.locator('.bd-port-rail-top .bd-port-label span')).toHaveText("session.lifecycle");
  await expect(core.locator('.bd-port-rail-bottom .bd-port-label span')).toHaveCount(2);
  await expect(page.locator(".bd-port-label small").first()).toBeHidden();

  await page.locator(".react-flow__controls-zoomin").click({ force: true });
  await expect(page.locator(".bd-react-flow")).toHaveAttribute("data-detail-level", "full");
  await page.waitForTimeout(350);
  const projectLabel = project.locator('.bd-port-rail-top .bd-port-label');
  await projectLabel.hover();
  await expect(projectLabel.locator("small")).toHaveText("Integration RPC");
  await expect(projectLabel.locator("small")).toBeVisible();
  await project.locator(".bd-block-header").hover();
  await expect(projectLabel.locator("small")).toBeHidden();

  if (process.env.CAPTURE_PORT_RAILS === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/port-label-rails.png");
    await page.locator(".bd-tree-select").filter({ hasText: "Project" }).click({ force: true });
    await page.waitForTimeout(450);
    await captureStudioScreenshot(page, "docs/screenshots/port-label-rails-detail.png");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Fit design", exact: true }).click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/port-label-rails-compact.png");
  }
});

test("expands Core inline and preserves the parent context and boundary continuity", async ({ page }) => {
  await expandHierarchy(page, "Rust Agent Core");

  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await expect(page.locator(".react-flow__edge")).toHaveCount(34);
  await expect(page.locator(".bd-statusbar")).toContainText("26 diagram interfaces");
  await expect(flowNode(page, "system::agent-ui")).toBeVisible();
  await expect(flowNode(page, "system::rust-agent-core").locator(".bd-block.is-expanded")).toBeVisible();
  await expect(flowNode(page, "system/rust-agent-core:core::session-api")).toBeVisible();

  const containment = await page.evaluate(() => {
    const parent = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="system::rust-agent-core"]',
    )!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(
      '.react-flow__node[data-id^="system/rust-agent-core:core::"]',
    )].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom;
    });
  });
  expect(containment).toBe(true);

  const outerEdge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  const continuation = page.locator(
    '.react-flow__edge[data-id="system::rust-agent-core::binding::ui-session-command"]',
  );
  await expect(outerEdge).toBeVisible();
  await expect(continuation).toBeVisible();
  await clickReachableEdgePoint(page, continuation);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(2);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
});

test("keeps a mixed-level selection reviewable after hierarchy expansion", async ({ page }) => {
  await expandHierarchy(page, "Rust Agent Core");
  const parent = flowNode(page, "system::rust-agent-core");
  const child = flowNode(page, "system/rust-agent-core:core::session-api");
  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="rust-agent-core"]',
  ).click({ force: true });
  await child.click({ force: true, modifiers: ["Shift"] });

  const inspector = page.getByRole("region", { name: "Properties" });
  await expect(parent).toHaveClass(/selected/);
  await expect(child).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["2", "0", "2"]);
  await expect(page.locator(".bd-tree-row.is-selected")).toHaveCount(2);
});

test("shows and cross-probes all 40 declared interfaces", async ({ page }) => {
  await page.getByRole("tab", { name: "Interfaces", exact: true }).click({ force: true });
  const rows = page.locator(".bd-interface-browser-row");
  await expect(rows).toHaveCount(40);

  for (let index = 0; index < 40; index += 1) {
    await rows.nth(index).evaluate((element) => element.scrollIntoView({ block: "nearest" }));
    await rows.nth(index).click({ force: true });
    await waitForLayout(page);
    await expect(rows.nth(index)).toHaveClass(/is-selected/);
    await expect(page.locator(".bd-inspector-title h2")).not.toBeEmpty();
    await expect(page.locator(".react-flow__edge.selected")).not.toHaveCount(0);
  }

  await page.getByRole("tab", { name: "JSON", exact: true }).click({ force: true });
  await expect(page.locator(".bd-raw-json pre")).toContainText('"connection"');
  await expect(page.locator(".bd-raw-json pre")).toContainText('"interface"');
});

test("summarizes a module's direct interfaces and opens the selected contract", async ({ page }) => {
  await flowNode(page, "system::agent-ui").click({ force: true });
  const inspector = page.getByRole("region", { name: "Properties" });
  const summary = inspector.locator(".bd-related-interfaces");

  await expect(summary).toContainText("Connected interfaces 2");
  await expect(summary.getByRole("region", { name: "Incoming interfaces" }).getByRole("button")).toHaveCount(1);
  await expect(summary.getByRole("region", { name: "Outgoing interfaces" }).getByRole("button")).toHaveCount(1);
  await expect(summary.getByRole("button", { name: "Open Session Command RPC interface" })).toContainText("session.command");

  const sessionCommand = summary.getByRole("button", { name: "Open Session Command RPC interface" });
  const sessionCommandBox = await sessionCommand.boundingBox();
  expect(sessionCommandBox).not.toBeNull();
  await page.mouse.click(
    sessionCommandBox!.x + sessionCommandBox!.width / 2,
    sessionCommandBox!.y + sessionCommandBox!.height / 2,
  );
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
  await expect(page.locator('.react-flow__edge[data-id="system::ui-session-command"]')).toHaveClass(/selected/);

  await page.locator(".bd-tree-select").filter({ hasText: "Project" }).click({ force: true });
  await expect(inspector.locator(".bd-related-interfaces")).toContainText("Connected interfaces 1");
});

test("creates a typed interface with the keyboard instead of dragging ports", async ({ page }) => {
  const addInterface = toolbarButton(page, "Add Interface...");
  await addInterface.focus();
  await page.keyboard.press("Enter");

  const endpointDialog = page.getByRole("dialog", { name: "Connect Ports" });
  await expect(endpointDialog).toBeVisible();
  await expect(endpointDialog.getByLabel("Source port")).toBeFocused();
  await expect(endpointDialog.getByLabel("Source port")).toContainText("Agent UI.session.command");
  await page.keyboard.press("Tab");
  await expect(endpointDialog.getByLabel("Target port")).toBeFocused();
  await expect(endpointDialog.getByLabel("Target port")).toHaveValue('["rust-agent-core","session-command"]');
  await page.keyboard.press("Tab");
  await expect(endpointDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(endpointDialog.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Enter");

  const contractDialog = page.getByRole("dialog", { name: "Create Typed Interface" });
  await expect(contractDialog.getByLabel("Interface title")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard Session Command");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("keyboard-session-command");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("keyboard.session.command");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Architecture Review");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);

  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Keyboard Session Command");
  await expect(page.locator('.react-flow__edge[data-id="system::keyboard-session-command"]')).toHaveClass(/selected/);
  await expect(addInterface).toBeFocused();

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
});

test("completes a design and save journey without switching from the keyboard", async ({ page }) => {
  test.setTimeout(90_000);
  const fileMenu = page.getByRole("button", { name: "File", exact: true });
  const designMenu = page.getByRole("button", { name: "Design", exact: true });
  const replaceFocusedText = async (value: string) => {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(value);
  };
  const openDesignCommand = async (name: RegExp, arrowDownCount: number) => {
    await expect(designMenu).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Design" });
    await expect(menu.getByRole("menuitem", { name: /^Add Module/ })).toBeFocused();
    for (let index = 0; index < arrowDownCount; index += 1) await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name })).toBeFocused();
    await page.keyboard.press("Enter");
  };
  const createModuleWithKeyboard = async (title: string, id: string, owner: string) => {
    await openDesignCommand(/^Add Module/, 0);
    const dialog = page.getByRole("dialog", { name: /Add Module/ });
    await expect(dialog.getByLabel("Module title")).toBeFocused();
    await replaceFocusedText(title);
    await page.keyboard.press("Tab");
    await replaceFocusedText(id);
    await page.keyboard.press("Tab");
    await page.keyboard.type(owner);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await waitForEditorIdle(page);
    await expect(designMenu).toBeFocused();
  };
  const createPortWithKeyboard = async ({
    label,
    id,
    output,
  }: {
    label: string;
    id: string;
    output: boolean;
  }) => {
    await openDesignCommand(/^Add Port/, 1);
    const dialog = page.getByRole("dialog", { name: /Add Port/ });
    await expect(dialog.getByLabel("Port label")).toBeFocused();
    await replaceFocusedText(label);
    await page.keyboard.press("Tab");
    await replaceFocusedText(id);
    await page.keyboard.press("Tab");
    if (output) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    if (output) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.type("ReviewPayload");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await waitForEditorIdle(page);
    await expect(designMenu).toBeFocused();
  };

  await fileMenu.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await expect(newDialog.getByLabel("Design title")).toBeFocused();
  await replaceFocusedText("Keyboard Review Design");
  await page.keyboard.press("Tab");
  await replaceFocusedText("keyboard-review-design");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(fileMenu).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(designMenu).toBeFocused();
  await createModuleWithKeyboard("Review Source", "source", "Architecture Team");
  await createPortWithKeyboard({ label: "events", id: "events", output: true });
  await createModuleWithKeyboard("Review Target", "target", "Runtime Team");
  await createPortWithKeyboard({ label: "events", id: "events", output: false });

  await openDesignCommand(/^Add Interface/, 2);
  const endpoints = page.getByRole("dialog", { name: "Connect Ports" });
  await expect(endpoints.getByLabel("Source port")).toBeFocused();
  await expect(endpoints.getByLabel("Source port")).toHaveValue('["source","events"]');
  await page.keyboard.press("Tab");
  await expect(endpoints.getByLabel("Target port")).toHaveValue('["target","events"]');
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  const contract = page.getByRole("dialog", { name: "Create Typed Interface" });
  await expect(contract.getByLabel("Interface title")).toBeFocused();
  await replaceFocusedText("Review Event");
  await page.keyboard.press("Tab");
  await replaceFocusedText("review-event");
  await page.keyboard.press("Tab");
  await replaceFocusedText("review.event");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Architecture Team");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Review Event");
  await expect(designMenu).toBeFocused();

  const inspector = page.getByRole("region", { name: "Properties" });
  await tabTo(page, inspector.getByLabel("Purpose", { exact: true }));
  await page.keyboard.type("Carry a reviewed event between declared module boundaries.");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Contains no hidden shared state or implementation ownership.");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Reject an invalid payload without partial delivery.");
  const apply = inspector.getByRole("button", { name: "Apply Changes" });
  await tabTo(page, apply);
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(apply).toBeFocused();
  if (process.env.CAPTURE_FIREFOX_FOCUS === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/firefox-apply-focus.png");
  }

  await tabTo(page, toolbarButton(page, "Validate Design"), 160, "backward");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Messages" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.levels[0].nodes).toHaveLength(2);
  expect(saved.levels[0].connections).toHaveLength(1);
  expect(saved.interfaceDefinitions["review.event"].purpose).toContain("reviewed event");
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("keeps routes outside blocks with both hierarchy containers expanded", async ({ page }) => {
  if (process.env.CAPTURE_ROUTING_PROOF === "1") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/aio-routing-validation.png");
  }
  await expandHierarchy(page, "Rust Agent Core");
  await expandHierarchy(page, "Tool System");
  await expect(page.locator(".react-flow__node")).toHaveCount(32);
  await expect(page.locator(".react-flow__edge")).toHaveCount(54);
  await expect(page.locator(".bd-statusbar")).toContainText("40 diagram interfaces");
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);

  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const routeAudit = await exhaustiveRouteAudit(page);
  expect(routeAudit).toMatchObject({
    auditedRouteCount: 54,
    auditedPairCount: 1431,
    expectedPairCount: 1431,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  expect(routeAudit.routeIds).toHaveLength(54);
  expect(routeAudit.renderedJumpCount).toBeGreaterThan(0);
  if (process.env.CAPTURE_SCENE_ROUTING === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/scene-routing-double-expanded.png");
    for (const [title, path] of [
      ["Rust Agent Core", "docs/screenshots/scene-routing-core-detail.png"],
      ["Tool System", "docs/screenshots/scene-routing-tool-detail.png"],
    ] as const) {
      await page.getByRole("button", { name: title, exact: true }).click({ force: true });
      await page.waitForTimeout(400);
      for (let step = 0; step < 4; step += 1) {
        await page.locator(".react-flow__controls-zoomin").click();
        await page.waitForTimeout(250);
      }
      await captureStudioScreenshot(page, path);
    }
  }
});

test("audits every route in a 100-connection hub with a deliberately skewed degree distribution", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const document = routingStressDesignDocument();
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "routing-skew-stress.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Routing Skew Stress", { timeout: 30_000 });
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator(".react-flow__node")).toHaveCount(101, { timeout: 60_000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(100, { timeout: 60_000 });
  await expect(page.locator('.bd-react-flow[data-routing-status="Feasible"]')).toHaveCount(1);

  const assertCompleteAudit = async () => {
    const audit = await exhaustiveRouteAudit(page);
    expect(audit).toMatchObject({
      auditedRouteCount: 100,
      auditedPairCount: 4950,
      expectedPairCount: 4950,
      duplicateRouteIds: [],
      perRouteIssues: [],
      parallelConflicts: [],
      unbridgedCrossings: [],
      orphanJumps: [],
    });
    expect(audit.routeIds).toHaveLength(100);
  };
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await page.waitForTimeout(300);
  await rightClickLocator(page, flowNode(page, "system::hub"));
  await expect(page.getByRole("menu", { name: "Module actions" })).toBeVisible();
  await expect(page.locator(".bd-react-flow")).toHaveAttribute("data-context-gesture-outcome", "menu");
  await assertCompleteAudit();
  await page.keyboard.press("Escape");

  const firstSparseLeafButton = page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="satellite-left-00"]',
  );
  const secondSparseLeafButton = page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="satellite-left-01"]',
  );
  await firstSparseLeafButton.click({ force: true });
  await secondSparseLeafButton.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const sparseGroupResizer = page.locator(".bd-selection-resizer");
  await expect(sparseGroupResizer).toBeVisible();
  await page.waitForTimeout(400);
  const sparseLeafBefore = await Promise.all([
    flowNode(page, "system::satellite-left-00").boundingBox(),
    flowNode(page, "system::satellite-left-01").boundingBox(),
  ]);
  expect(sparseLeafBefore.every(Boolean)).toBe(true);
  await dragSelectionResizeHandle(
    page,
    sparseGroupResizer.locator(".bd-selection-resize-handle.middle.right"),
    { x: 24, y: 0 },
    { alt: true },
    async () => {
      const canvas = page.locator(".bd-react-flow");
      await expect(canvas).toHaveAttribute("data-routing-frame-gesture", "selection-resize");
      await expect(canvas).toHaveAttribute("data-routing-frame-phase", "active");
      await expect(canvas).toHaveAttribute("data-routing-frame-mode", "incremental");
      expect(Number(await canvas.getAttribute("data-routing-frame-affected"))).toBe(2);
      const neighborhood = Number(await canvas.getAttribute("data-routing-frame-neighborhood"));
      expect(neighborhood).toBeGreaterThanOrEqual(2);
      expect(neighborhood).toBeLessThan(100);
      await assertCompleteAudit();
      if (process.env.CAPTURE_LIVE_ROUTING === "1" && browserName === "chromium") {
        await captureStudioScreenshot(page, "docs/screenshots/routing-stress-live-preview.png");
      }
    },
  );
  const sparseLeafAfter = await Promise.all([
    flowNode(page, "system::satellite-left-00").boundingBox(),
    flowNode(page, "system::satellite-left-01").boundingBox(),
  ]);
  expect(sparseLeafAfter[0]!.width).toBeGreaterThan(sparseLeafBefore[0]!.width + 12);
  expect(sparseLeafAfter[1]!.width).toBeGreaterThan(sparseLeafBefore[1]!.width + 12);
  expect(sparseLeafAfter[0]!.height).toBeCloseTo(sparseLeafBefore[0]!.height, 0);
  expect(sparseLeafAfter[1]!.height).toBeCloseTo(sparseLeafBefore[1]!.height, 0);
  await assertCompleteAudit();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await assertCompleteAudit();

  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="satellite-left-00"]',
  ).click({ force: true });
  await page.waitForTimeout(300);
  const leafNeighborhoodViewport = await canvasViewportTransform(page);
  await runMenuCommand(page, "Edit", /^Select Direct Neighborhood/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("3 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["2", "1", "1"]);
  await expect(flowNode(page, "system::satellite-left-00")).toHaveClass(/selected/);
  await expect(flowNode(page, "system::hub")).toHaveClass(/selected/);
  expect(await canvasViewportTransform(page)).toBe(leafNeighborhoodViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await page.waitForTimeout(300);
  const hubNeighborhoodViewport = await canvasViewportTransform(page);
  await runMenuCommand(page, "Edit", /^Select Direct Neighborhood/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("201 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["101", "100", "1"]);
  expect(await canvasViewportTransform(page)).toBe(hubNeighborhoodViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await page.waitForTimeout(300);
  const directionalViewport = await canvasViewportTransform(page);
  await runMenuCommand(page, "Edit", /^Select Incoming Interfaces/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(50);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["1", "50", "1"]);
  expect(await canvasViewportTransform(page)).toBe(directionalViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await runMenuCommand(page, "Edit", /^Select Outgoing Interfaces/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(50);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["1", "50", "1"]);
  expect(await canvasViewportTransform(page)).toBe(directionalViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await runMenuCommand(page, "Edit", /^Select Incoming Neighborhood/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(51);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(50);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["51", "50", "1"]);
  expect(await canvasViewportTransform(page)).toBe(directionalViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await runMenuCommand(page, "Edit", /^Select Outgoing Neighborhood/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(51);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(50);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["51", "50", "1"]);
  expect(await canvasViewportTransform(page)).toBe(directionalViewport);
  await assertCompleteAudit();

  await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
  await page.waitForTimeout(300);
  const selectionViewportBefore = await canvasViewportTransform(page);
  await runMenuCommand(page, "Edit", /^Select Direct Interfaces/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(100);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("101 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["1", "100", "1"]);
  expect(await canvasViewportTransform(page)).toBe(selectionViewportBefore);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
  await assertCompleteAudit();

  await runMenuCommand(page, "Edit", /^Select Interfaces in Level/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(100);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("100 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["0", "100", "1"]);
  expect(await canvasViewportTransform(page)).toBe(selectionViewportBefore);
  await assertCompleteAudit();

  await runMenuCommand(page, "Edit", /^Select Modules in Level/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(101);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("101 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["101", "0", "1"]);
  expect(await canvasViewportTransform(page)).toBe(selectionViewportBefore);
  await page.keyboard.press("ControlOrMeta+Shift+A");

  const stressSource = flowNode(page, "system::satellite-left-00")
    .locator('.bd-port-handle-outer[data-handleid="link"]');
  const stressTarget = flowNode(page, "system::hub")
    .locator('.bd-port-handle-outer[data-handleid="left-01"]');
  const stressSourceBox = await stressSource.boundingBox();
  const stressTargetBox = await stressTarget.boundingBox();
  expect(stressSourceBox).not.toBeNull();
  expect(stressTargetBox).not.toBeNull();
  await page.mouse.move(
    stressSourceBox!.x + stressSourceBox!.width / 2,
    stressSourceBox!.y + stressSourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    stressTargetBox!.x + stressTargetBox!.width / 2,
    stressTargetBox!.y + stressTargetBox!.height / 2,
    { steps: 12 },
  );
  const stressPanel = page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]');
  await expect(stressPanel).toHaveAttribute("data-connection-status", "valid");
  await expect(stressPanel).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(stressPanel).toHaveAttribute("data-preview-obstacle-count", "101");
  await expect(stressPanel).toHaveAttribute("data-preview-registered-obstacle-count", "101");
  expect(Number(await stressPanel.getAttribute("data-preview-request-count"))).toBeGreaterThanOrEqual(
    Number(await stressPanel.getAttribute("data-preview-solve-count")),
  );
  expect(Number(await stressPanel.getAttribute("data-preview-peak-duration-ms"))).toBeLessThan(80);
  expect(await connectionPreviewIssues(page)).toEqual({
    collisions: [],
    nonOrthogonalSegments: [],
    zeroLengthSegments: [],
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(100);
  await assertCompleteAudit();

  await runMenuCommand(page, "Design", "Optimize Routing");
  await waitForEditorIdle(page);
  await assertCompleteAudit();

  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="satellite-left-00"]',
  ).click({ force: true });
  await page.keyboard.press("ControlOrMeta+X");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(100);
  await expect(page.locator(".react-flow__edge")).toHaveCount(99);
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 99,
    auditedPairCount: 4851,
    expectedPairCount: 4851,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(101);
  await expect(page.locator(".react-flow__edge")).toHaveCount(100);
  await assertCompleteAudit();

  if (process.env.CAPTURE_ROUTING_STRESS === "1" && browserName === "chromium") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/routing-stress-overview.png");
    await page.locator('.bd-tree-select[data-level-id="system"][data-node-id="hub"]').click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/routing-stress-hub-detail.png");
  }

  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="satellite-left-00"]',
  ).click({ force: true });
  const satellite = flowNode(page, "system::satellite-left-00");
  await altSelectIntersectingNode(page, satellite);
  const satellitePort = await satellite.locator(".bd-port-handle-outer").boundingBox();
  expect(satellitePort).not.toBeNull();
  const satellitePortPoint = {
    x: satellitePort!.x + satellitePort!.width / 2,
    y: satellitePort!.y + satellitePort!.height / 2,
  };
  await altClickCanvasPoint(page, satellitePortPoint);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Stress Flow");
  await altClickCanvasPoint(page, satellitePortPoint);
  await expect(satellite).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Satellite left 00");
});

test("expands five hierarchy layers and audits every visible route and pair", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const document = fiveLevelRoutingDesignDocument();
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "five-level-routing-stress.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Five-Level Routing Stress", { timeout: 30_000 });
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    await expandHierarchy(page, `Layer ${levelNumber} Boundary`);
  }

  await expect(page.locator(".bd-level-chip")).toHaveText("5 expanded");
  await expect(page.locator(".react-flow__node")).toHaveCount(17, { timeout: 60_000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(20, { timeout: 60_000 });
  await expect(page.locator('.bd-react-flow[data-routing-status="Feasible"]')).toHaveCount(1);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const audit = await exhaustiveRouteAudit(page);
  expect(audit).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  expect(audit.routeIds).toHaveLength(20);

  await rightClickLocator(page, diagramNode(page, "level-5", "target-00"));
  await expect(page.getByRole("menu", { name: "Module actions" })).toBeVisible();
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => { throw new DOMException("Denied by test host", "NotAllowedError"); },
      },
    });
  });
  const levelFiveSource = diagramNode(page, "level-5", "target-00");
  const levelFiveAnchor = diagramNode(page, "level-5", "target-01");
  await levelFiveSource.click({ force: true });
  await page.keyboard.press("ControlOrMeta+C");
  await rightClickLocator(page, levelFiveAnchor);
  const nestedContextMenu = page.getByRole("menu", { name: "Module actions" });
  await expect(nestedContextMenu.getByRole("menuitem", { name: "Paste Here", exact: true }))
    .not.toHaveAttribute("aria-disabled", "true");
  await nestedContextMenu.getByRole("menuitem", { name: "Paste Here", exact: true }).click();
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await expect(diagramNode(page, "level-5", "target-00-2")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Pasted 1 module at the requested canvas position into Layer 5",
  );
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  const nestedDownloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const nestedSavedPath = await (await nestedDownloadPromise).path();
  expect(nestedSavedPath).not.toBeNull();
  const nestedSaved = JSON.parse(await readFile(nestedSavedPath!, "utf8"));
  const savedLevelFive = nestedSaved.levels.find((level: { id: string }) => level.id === "level-5");
  const pastedLevelFiveNode = savedLevelFive.nodes.find((node: { id: string }) => node.id === "target-00-2");
  const anchorLevelFiveNode = savedLevelFive.nodes.find((node: { id: string }) => node.id === "target-01");
  expect(pastedLevelFiveNode).toBeDefined();
  expect(pastedLevelFiveNode.layout.position).not.toEqual(anchorLevelFiveNode.layout.position);
  if (process.env.CAPTURE_PASTE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/paste-here-level-five.png");
  }
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(17);
  await expect(diagramNode(page, "level-5", "target-00-2")).toHaveCount(0);

  const nestedDropTarget = diagramNode(page, "level-5", "target-00");
  const nestedTargetBounds = await nestedDropTarget.boundingBox();
  expect(nestedTargetBounds).not.toBeNull();
  await beginToolbarModuleDrag(page, {
    x: nestedTargetBounds!.x + nestedTargetBounds!.width / 2,
    y: nestedTargetBounds!.y + nestedTargetBounds!.height / 2,
  });
  const levelFiveDropTarget = page.locator(
    '[data-module-drop-target="true"][data-level-id="level-5"]',
  );
  await expect(levelFiveDropTarget).toBeVisible();
  await expect(levelFiveDropTarget).toHaveAttribute("data-level-title", "Layer 5");
  await expect(page.locator(
    '[data-module-drop-preview="true"][data-level-id="level-5"]',
  )).toBeVisible();
  const levelFivePreview = page.locator(
    '[data-module-drop-preview="true"][data-level-id="level-5"]',
  );
  const expectedNestedPosition = {
    x: Number(await levelFivePreview.getAttribute("data-design-x")),
    y: Number(await levelFivePreview.getAttribute("data-design-y")),
  };
  expect(Number.isFinite(expectedNestedPosition.x)).toBe(true);
  expect(Number.isFinite(expectedNestedPosition.y)).toBe(true);
  if (process.env.CAPTURE_ADD_MODULE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/add-module-inline-drop-target.png");
  }
  await page.mouse.up();
  const nestedAddDialog = page.getByRole("dialog", { name: /Add Module/ });
  await nestedAddDialog.getByLabel("Module title").fill("Nested Review");
  await nestedAddDialog.getByLabel("Module id").fill("nested-review");
  await nestedAddDialog.getByRole("button", { name: "Add Module", exact: true }).click();
  await waitForEditorIdle(page);
  await expect(diagramNode(page, "level-5", "nested-review")).toHaveClass(/selected/);
  const nestedAddDownload = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const nestedAddSavedPath = await (await nestedAddDownload).path();
  expect(nestedAddSavedPath).not.toBeNull();
  const nestedAddSaved = JSON.parse(await readFile(nestedAddSavedPath!, "utf8"));
  const nestedAddLevel = nestedAddSaved.levels.find((level: { id: string }) => level.id === "level-5");
  expect(nestedAddLevel.nodes.find((node: { id: string }) => node.id === "nested-review").layout)
    .toEqual({ position: expectedNestedPosition, pinned: true });

  await expect(page.locator(".bd-canvas-caption strong")).toHaveText("Five-Level Routing System");
  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await expect(page.locator(".react-flow__edge")).toHaveCount(20);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_ADD_MODULE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/add-module-here-level-five.png");
  }
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(17);
  await expect(diagramNode(page, "level-5", "nested-review")).toHaveCount(0);

  await page.locator(
    '.bd-tree-select[data-level-id="level-5"][data-node-id="target-00"]',
  ).click({ force: true });
  await page.locator(
    '.bd-tree-select[data-level-id="level-5"][data-node-id="target-01"]',
  ).click({ force: true, modifiers: ["ControlOrMeta"] });
  const nestedGroupResizer = page.locator(".bd-selection-resizer");
  await expect(nestedGroupResizer).toBeVisible();
  await page.waitForTimeout(400);
  const nestedTargets = [
    diagramNode(page, "level-5", "target-00"),
    diagramNode(page, "level-5", "target-01"),
  ];
  const nestedBefore = await Promise.all(nestedTargets.map((node) => node.boundingBox()));
  expect(nestedBefore.every(Boolean)).toBe(true);
  await dragSelectionResizeHandle(
    page,
    nestedGroupResizer.locator(".bd-selection-resize-handle.middle.right"),
    { x: 20, y: 0 },
    { alt: true },
  );
  const nestedAfter = await Promise.all(nestedTargets.map((node) => node.boundingBox()));
  expect(nestedAfter.every(Boolean)).toBe(true);
  nestedAfter.forEach((box, index) => {
    expect(box!.width).toBeGreaterThan(nestedBefore[index]!.width + 10);
    expect(box!.height).toBeCloseTo(nestedBefore[index]!.height, 0);
  });
  const nestedResizeDownload = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const nestedResizeSavedPath = await (await nestedResizeDownload).path();
  expect(nestedResizeSavedPath).not.toBeNull();
  const nestedResizeSaved = JSON.parse(await readFile(nestedResizeSavedPath!, "utf8"));
  const resizedSavedLevelFive = nestedResizeSaved.levels.find((level: { id: string }) => level.id === "level-5");
  const authoredLevelFive = document.levels.find((level) => level.id === "level-5")!;
  for (const nodeId of ["target-00", "target-01"]) {
    const authored = authoredLevelFive.nodes.find((node) => node.id === nodeId)!;
    const saved = resizedSavedLevelFive.nodes.find((node: { id: string }) => node.id === nodeId);
    expect(saved.layout.position).toEqual(authored.layout.position);
  }
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_LEVEL_COORDINATE === "1" && browserName === "chromium") {
    await page.keyboard.press("ControlOrMeta+Shift+H");
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/five-level-coordinate-resize.png");
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(nestedGroupResizer).toBeVisible();
  await page.locator(
    '.bd-tree-select[data-level-id="level-4"][data-node-id="layer-5"]',
  ).click({ force: true });
  await page.locator(
    '.bd-tree-select[data-level-id="level-3"][data-node-id="layer-4"]',
  ).click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(nestedGroupResizer).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await page.waitForTimeout(400);

  const nestedPreviewSource = diagramNode(page, "level-4", "relay-4-00")
    .locator('.bd-port-handle-outer[data-handleid="out"]');
  const nestedPreviewTarget = diagramNode(page, "level-4", "layer-5")
    .locator('.bd-port-handle-outer[data-handleid="flow-01"]');
  const nestedPreviewSourceBox = await nestedPreviewSource.boundingBox();
  const nestedPreviewTargetBox = await nestedPreviewTarget.boundingBox();
  expect(nestedPreviewSourceBox).not.toBeNull();
  expect(nestedPreviewTargetBox).not.toBeNull();
  await page.mouse.move(
    nestedPreviewSourceBox!.x + nestedPreviewSourceBox!.width / 2,
    nestedPreviewSourceBox!.y + nestedPreviewSourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    nestedPreviewTargetBox!.x + nestedPreviewTargetBox!.width / 2,
    nestedPreviewTargetBox!.y + nestedPreviewTargetBox!.height / 2,
    { steps: 10 },
  );
  const nestedPreviewPanel = page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]');
  await expect(nestedPreviewPanel).toHaveAttribute("data-connection-status", "valid");
  await expect(nestedPreviewPanel).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(nestedPreviewPanel).toHaveAttribute("data-preview-obstacle-count", "17");
  await expect(nestedPreviewPanel).toHaveAttribute("data-preview-registered-obstacle-count", "17");
  expect(await connectionPreviewIssues(page)).toEqual({
    collisions: [],
    nonOrthogonalSegments: [],
    zeroLengthSegments: [],
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(20);
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  if (process.env.CAPTURE_ROUTING_FIVE_LEVEL === "1" && browserName === "chromium") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/routing-five-level-overview.png");
    await page.locator('.bd-tree-select[data-level-id="level-2"][data-node-id="layer-3"]').click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/routing-five-level-detail.png");
  }

  const sources = page.getByRole("region", { name: "Sources" });
  await sources.getByRole("tab", { name: "Interfaces" }).click({ force: true });
  await sources.getByLabel("Filter interfaces").fill("layer-5-flow-00");
  const nestedInterface = sources.getByRole("list", { name: "Matching interfaces" }).getByRole("button");
  await expect(nestedInterface).toHaveCount(1);
  await nestedInterface.click({ force: true });
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "relay-4-00.out → layer-5.flow-00",
  );
  await page.keyboard.press("ControlOrMeta+K");
  const nestedPalette = page.getByRole("dialog", { name: "Command Palette" });
  await nestedPalette.getByRole("combobox", { name: "Search commands" }).fill("Reconnect Interface");
  await page.keyboard.press("Enter");
  const nestedDialog = page.getByRole("dialog", { name: "Reconnect Interface" });
  await expect(nestedDialog.getByLabel("Source port")).toHaveValue('["relay-4-00","out"]');
  const nestedTarget = nestedDialog.getByLabel("Target port");
  await expect(nestedTarget).toHaveValue('["layer-5","flow-00"]');
  await page.keyboard.press("Tab");
  await expect(nestedTarget).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(nestedTarget).toHaveValue('["layer-5","flow-01"]');
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "relay-4-00.out → layer-5.flow-01",
  );
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "relay-4-00.out → layer-5.flow-00",
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(20, { timeout: 60_000 });
  const auditAfterNestedUndo = await exhaustiveRouteAudit(page);
  expect(auditAfterNestedUndo).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await sources.getByRole("tab", { name: "Hierarchy" }).click({ force: true });

  await page.locator(
    '.bd-tree-select[data-level-id="level-5"][data-node-id="target-00"]',
  ).click({ force: true });
  const deepestTarget = diagramNode(page, "level-5", "target-00");
  await altSelectIntersectingNode(page, deepestTarget);
  const deepestTargetBounds = await deepestTarget.boundingBox();
  expect(deepestTargetBounds).not.toBeNull();
  await altClickCanvasPoint(page, {
    x: deepestTargetBounds!.x + deepestTargetBounds!.width / 2,
    y: deepestTargetBounds!.y + deepestTargetBounds!.height / 2,
  });
  await expect(deepestTarget).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Target 00");
  await deepestTarget.focus();
  await page.keyboard.down("Alt");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Alt");
  const layerFiveBoundary = diagramNode(page, "level-4", "layer-5");
  await expect(layerFiveBoundary).toHaveClass(/selected/);
  await expect(layerFiveBoundary).toBeFocused();
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Layer 5 Boundary");
  await page.keyboard.down("Alt");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Alt");
  const layerFourBoundary = diagramNode(page, "level-3", "layer-4");
  await expect(layerFourBoundary).toHaveClass(/selected/);
  await expect(layerFourBoundary).toBeFocused();
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Layer 4 Boundary");
});

test("live-routes every affected line while one deepest module grows all five parent frames", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const document = fiveLevelRoutingDesignDocument();
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "five-level-live-routing.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Five-Level Routing Stress");
  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    await expandHierarchy(page, `Layer ${levelNumber} Boundary`);
  }
  await page.locator(
    '.bd-tree-select[data-level-id="level-5"][data-node-id="target-01"]',
  ).click({ force: true });
  await page.waitForTimeout(500);

  const canvas = page.locator(".bd-react-flow");
  const target = diagramNode(page, "level-5", "target-01");
  const owners = [
    diagramNode(page, "system", "layer-1"),
    diagramNode(page, "level-1", "layer-2"),
    diagramNode(page, "level-2", "layer-3"),
    diagramNode(page, "level-3", "layer-4"),
    diagramNode(page, "level-4", "layer-5"),
  ];
  const routePoints = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll<SVGGElement>("[data-route-points]")].map((group) => [
      group.closest<SVGGElement>(".react-flow__edge")?.dataset.id ?? "unknown",
      JSON.parse(group.dataset.routePoints ?? "[]"),
    ]),
  ));
  const ownerBoundsBefore = await Promise.all(owners.map((owner) => owner.boundingBox()));
  expect(ownerBoundsBefore.every(Boolean)).toBe(true);
  const routesBefore = await routePoints();
  const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("style");
  const targetHeader = target.locator(".bd-block-header");
  const targetHeaderBounds = await targetHeader.boundingBox();
  expect(targetHeaderBounds).not.toBeNull();
  const zoom = await canvasZoom(page);
  const start = {
    x: targetHeaderBounds!.x + targetHeaderBounds!.width / 2,
    y: targetHeaderBounds!.y + targetHeaderBounds!.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 240 * zoom, start.y + 180 * zoom, { steps: 12 });
  await expect(canvas).toHaveAttribute("data-routing-frame-gesture", "node-drag");
  await expect(canvas).toHaveAttribute("data-routing-frame-phase", "active");
  await expect(canvas).toHaveAttribute("data-routing-frame-mode", "exact");
  expect(Number(await canvas.getAttribute("data-routing-frame-affected"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-routing-frame-neighborhood"))).toBe(20);
  await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", viewportBefore ?? "");

  const ownerBoundsPreview = await Promise.all(owners.map((owner) => owner.boundingBox()));
  ownerBoundsPreview.forEach((bounds, index) => {
    expect(bounds, `owner ${index + 1}`).not.toBeNull();
    expect(bounds!.width, `owner ${index + 1} width`).toBeGreaterThan(ownerBoundsBefore[index]!.width + 20);
    expect(bounds!.height, `owner ${index + 1} height`).toBeGreaterThan(ownerBoundsBefore[index]!.height + 10);
    expect(bounds!.x, `owner ${index + 1} x`).toBeCloseTo(ownerBoundsBefore[index]!.x, 0);
    expect(bounds!.y, `owner ${index + 1} y`).toBeCloseTo(ownerBoundsBefore[index]!.y, 0);
  });
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  const routesPreview = await routePoints();
  const changedRouteIds = Object.keys(routesPreview).filter((id) =>
    JSON.stringify(routesPreview[id]) !== JSON.stringify(routesBefore[id]));
  expect(changedRouteIds.length).toBeGreaterThan(0);
  if (process.env.CAPTURE_LIVE_ROUTING === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/five-level-live-routing-growth.png");
  }

  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect(canvas).toHaveAttribute("data-routing-frame-phase", "idle");
  await expect(canvas).toHaveAttribute("data-routing-frame-mode", "committed");
  await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", viewportBefore ?? "");
  const routesCommitted = await routePoints();
  changedRouteIds.forEach((id) => expect(routesCommitted[id], `${id} preview/commit`).toEqual(routesPreview[id]));
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedTarget = saved.levels.find((level: { id: string }) => level.id === "level-5")
    .nodes.find((node: { id: string }) => node.id === "target-01");
  expect(savedTarget.layout.position.x).toBeGreaterThan(100);
  expect(savedTarget.layout.position.y).toBeGreaterThan(270);
  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    const levelId = levelNumber === 1 ? "system" : `level-${levelNumber - 1}`;
    const owner = saved.levels.find((level: { id: string }) => level.id === levelId)
      .nodes.find((node: { id: string }) => node.id === `layer-${levelNumber}`);
    expect(owner.layout).toEqual(document.levels.find((level) => level.id === levelId)!
      .nodes.find((node) => node.id === `layer-${levelNumber}`)!.layout);
  }
});

test("keeps toolbar drop preview, JSON, and rendered geometry identical at every expanded depth", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const document = fiveLevelRoutingDesignDocument();
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "five-level-drop-contract.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Five-Level Routing Stress", {
    timeout: 30_000,
  });
  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    await expandHierarchy(page, `Layer ${levelNumber} Boundary`);
  }

  const placements: Array<{ levelId: string; nodeId: string; x: number; y: number }> = [];
  for (let levelNumber = 1; levelNumber <= 5; levelNumber += 1) {
    const levelId = `level-${levelNumber}`;
    const anchorId = levelNumber === 5 ? "target-00" : `relay-${levelNumber}-00`;
    const anchor = diagramNode(page, levelId, anchorId);
    const anchorBounds = await anchor.boundingBox();
    expect(anchorBounds, `${levelId} anchor`).not.toBeNull();
    await beginToolbarModuleDrag(page, {
      x: anchorBounds!.x + anchorBounds!.width / 2,
      y: anchorBounds!.y + anchorBounds!.height / 2,
    });

    const target = page.locator(
      `[data-module-drop-target="true"][data-level-id="${levelId}"]`,
    );
    const preview = page.locator(
      `[data-module-drop-preview="true"][data-level-id="${levelId}"]`,
    );
    await expect(target).toBeVisible();
    await expect(preview).toBeVisible();
    const position = {
      x: Number(await preview.getAttribute("data-design-x")),
      y: Number(await preview.getAttribute("data-design-y")),
    };
    expect(Number.isFinite(position.x), `${levelId} preview x`).toBe(true);
    expect(Number.isFinite(position.y), `${levelId} preview y`).toBe(true);
    const previewBounds = await preview.boundingBox();
    expect(previewBounds, `${levelId} preview bounds`).not.toBeNull();
    const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("style");

    await page.mouse.up();
    const nodeId = `depth-${levelNumber}-review`;
    const dialog = page.getByRole("dialog", { name: /Add Module/ });
    await dialog.getByLabel("Module title").fill(`Depth ${levelNumber} Review`);
    await dialog.getByLabel("Module id").fill(nodeId);
    await dialog.getByRole("button", { name: "Add Module", exact: true }).click();
    await waitForEditorIdle(page);

    const rendered = diagramNode(page, levelId, nodeId);
    await expect(rendered).toHaveCount(1);
    const block = rendered.locator(".bd-block");
    await expect(block).toHaveAttribute("data-design-x", String(position.x));
    await expect(block).toHaveAttribute("data-design-y", String(position.y));
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute(
      "style",
      viewportBefore ?? "",
    );
    const renderedBounds = await rendered.boundingBox();
    expect(renderedBounds, `${levelId} rendered bounds`).not.toBeNull();
    expect(renderedBounds!.x, `${levelId} rendered x`).toBeCloseTo(previewBounds!.x, 0);
    expect(renderedBounds!.y, `${levelId} rendered y`).toBeCloseTo(previewBounds!.y, 0);
    expect(renderedBounds!.width, `${levelId} rendered width`).toBeCloseTo(previewBounds!.width, 0);
    expect(renderedBounds!.height, `${levelId} rendered height`).toBeCloseTo(previewBounds!.height, 0);
    placements.push({ levelId, nodeId, ...position });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  placements.forEach(({ levelId, nodeId, x, y }) => {
    const level = saved.levels.find((candidate: { id: string }) => candidate.id === levelId);
    const node = level.nodes.find((candidate: { id: string }) => candidate.id === nodeId);
    expect(node.layout, `${levelId}/${nodeId} JSON`).toEqual({
      position: { x, y },
      pinned: true,
    });
  });
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 20,
    auditedPairCount: 190,
    expectedPairCount: 190,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_ADD_MODULE_HERE === "1" && browserName === "chromium") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/add-module-five-depth-contract.png");
    await page.locator(
      '.bd-tree-select[data-level-id="level-2"][data-node-id="layer-3"]',
    ).click({ force: true });
    await page.keyboard.press("ControlOrMeta+Shift+End");
    await expect(page.locator(".bd-canvas-caption strong")).toHaveText("Layer 3");
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/add-module-five-depth-detail.png");
    await page.getByRole("navigation", { name: "Diagram view hierarchy" })
      .getByRole("button", { name: "Five-Level Routing System", exact: true })
      .click();
    await expect(page.locator(".bd-canvas-caption strong")).toHaveText("Five-Level Routing System");
    await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  }

  for (const placement of [...placements].reverse()) {
    await page.keyboard.press("ControlOrMeta+Z");
    await waitForEditorIdle(page);
    await expect(diagramNode(page, placement.levelId, placement.nodeId)).toHaveCount(0);
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(17);
});

test("loads the repository-derived five-depth module architecture and reviews every dependency", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.goto("/?design=/examples/architecture-block-studio.block-design.json");
  await expect(page.locator(".bd-document-title span")).toHaveText(
    "Architecture Block Studio — Source Architecture",
    { timeout: 30_000 },
  );
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });

  for (const title of [
    "Architecture Block Studio",
    "React Desktop Renderer",
    "Module Architecture",
    "Verified Source Graph",
  ]) {
    const expandedBefore = Number.parseInt(await page.locator(".bd-level-chip").innerText(), 10);
    const sources = page.getByRole("region", { name: "Sources", exact: true });
    await sources.getByRole("button", { name: `Expand ${title}`, exact: true }).click({ force: true });
    await expect(page.locator(".bd-level-chip")).toHaveText(`${expandedBefore + 1} expanded`);
    await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
    await expect(sources.getByRole("button", { name: `Collapse ${title}`, exact: true })).toBeVisible();
    await page.waitForTimeout(350);
  }

  await expect(page.locator(".bd-level-chip")).toHaveText("4 expanded");
  await expect(page.locator(".react-flow__node")).toHaveCount(16, { timeout: 60_000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(29, { timeout: 60_000 });
  await expect(page.locator('.bd-react-flow[data-routing-status="Feasible"]')).toHaveCount(1);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  await expect(page.locator(".bd-statusbar")).toContainText("16 diagram blocks");
  await expect(page.locator(".bd-statusbar")).toContainText("29 diagram interfaces");

  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const overviewAudit = await exhaustiveRouteAudit(page);
  expect(overviewAudit).toMatchObject({
    auditedRouteCount: 29,
    auditedPairCount: 406,
    expectedPairCount: 406,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  expect(overviewAudit.routeIds).toHaveLength(29);

  if (process.env.CAPTURE_SELF_ARCHITECTURE === "1" && browserName === "chromium") {
    await runMenuCommand(page, "View", "Maximize Diagram");
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/source-architecture-overview.png");
    await runMenuCommand(page, "View", "Restore Diagram");
    await page.waitForTimeout(350);
  }

  await page.locator(
    '.bd-tree-select[data-level-id="runtime-modules"][data-node-id="studio"]',
  ).click({ force: true });
  await page.waitForTimeout(500);
  const studioNode = diagramNode(page, "runtime-modules", "studio");
  await expect(studioNode).toHaveClass(/selected/);
  await rightClickLocator(page, studioNode);
  const moduleMenu = page.getByRole("menu", { name: "Module actions" });
  await expect(moduleMenu).toBeVisible();
  await moduleMenu.getByRole("menuitem", { name: /^Select Direct Neighborhood/ }).click();
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("17 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["9", "8", "1"]);
  await rightClickLocator(page, studioNode);
  const selectionMenu = page.getByRole("menu", { name: "Selected diagram objects actions" });
  await selectionMenu.getByRole("menuitem", { name: /^Fit Selection/ }).click();
  await page.waitForTimeout(500);
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 29,
    auditedPairCount: 406,
    expectedPairCount: 406,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  if (process.env.CAPTURE_SELF_ARCHITECTURE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/source-architecture-review.png");
  }

  await page.locator(
    '.bd-tree-select[data-level-id="runtime-modules"][data-node-id="studio"]',
  ).click({ force: true });
  await studioNode.focus();
  await expect(studioNode).toBeFocused();
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong"))
    .toHaveText("286 × 305");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong"))
    .toHaveText("302 × 305");
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong"))
    .toHaveText("286 × 305");

  const sourceEdge = page.locator(
    '.react-flow__edge[data-id$="::import-studio-to-model"]',
  );
  const sources = page.getByRole("region", { name: "Sources" });
  await sources.getByRole("tab", { name: "Interfaces" }).click({ force: true });
  await sources.getByLabel("Filter interfaces").fill("import-studio-to-model");
  const sourceInterface = sources
    .getByRole("list", { name: "Matching interfaces" })
    .getByRole("button");
  await expect(sourceInterface).toHaveCount(1);
  await sourceInterface.click({ force: true });
  await page.waitForTimeout(500);
  await expect(sourceEdge).toHaveClass(/selected/);
  const sourceEdgePoint = await reachableEdgePoint(sourceEdge);
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await page.mouse.click(sourceEdgePoint.x, sourceEdgePoint.y);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText(
    "Studio Orchestrator → Model Contract · 2 import declarations",
  );
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "studio.depends-model → model.used-by-studio",
  );
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);

  if (process.env.CAPTURE_SELF_ARCHITECTURE === "1" && browserName === "chromium") {
    await page.keyboard.press("ControlOrMeta+Shift+H");
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/source-architecture-interface-review.png");
  }

  const finalAudit = await exhaustiveRouteAudit(page);
  expect(finalAudit).toMatchObject({
    auditedRouteCount: 29,
    auditedPairCount: 406,
    expectedPairCount: 406,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.levels).toHaveLength(5);
  expect(saved.levels.find((level: { id: string }) => level.id === "runtime-modules").nodes)
    .toHaveLength(12);
  expect(saved.levels.flatMap((level: { connections: unknown[] }) => level.connections))
    .toHaveLength(29);
});

test("enters and exits five hierarchy view roots without changing the design", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const original = JSON.parse(await readFile(fileURLToPath(new URL(
    "../public/examples/architecture-block-studio.block-design.json",
    import.meta.url,
  )), "utf8"));
  await page.goto("/?design=/examples/architecture-block-studio.block-design.json");
  await expect(page.locator(".bd-document-title span")).toHaveText(
    "Architecture Block Studio — Source Architecture",
    { timeout: 30_000 },
  );
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  const browserHistoryLength = await page.evaluate(() => history.length);
  const breadcrumbs = page.getByRole("navigation", { name: "Diagram view hierarchy" });
  const caption = page.locator(".bd-canvas-caption strong");

  const enterSelectedModule = async (
    flowId: string,
    expectedLevelTitle: string,
    expectedDepth: number,
  ) => {
    await flowNode(page, flowId).click({ force: true });
    await page.keyboard.press("ControlOrMeta+Shift+End");
    await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
    await expect(caption).toHaveText(expectedLevelTitle);
    await expect(breadcrumbs.getByRole("button")).toHaveCount(expectedDepth);
    await expect(breadcrumbs.getByRole("button", { name: expectedLevelTitle, exact: true }))
      .toHaveAttribute("aria-current", "page");
  };

  await expect(caption).toHaveText("Product Boundary");
  await enterSelectedModule(
    "product-boundary::architecture-block-studio",
    "Windows Desktop Runtime",
    2,
  );
  await enterSelectedModule(
    "windows-desktop-runtime::desktop-renderer",
    "Workbench Composition",
    3,
  );
  await enterSelectedModule(
    "workbench-composition::module-architecture",
    "Verified Source Architecture",
    4,
  );
  await enterSelectedModule(
    "source-architecture::verified-source-graph",
    "Runtime Source Modules",
    5,
  );

  await expect(page.locator(".react-flow__node")).toHaveCount(12, { timeout: 30_000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(29, { timeout: 30_000 });
  await expect(page.locator(".bd-statusbar")).toContainText("View root: Runtime Source Modules");
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 29,
    auditedPairCount: 406,
    expectedPairCount: 406,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  if (process.env.CAPTURE_HIERARCHY_FOCUS === "1" && browserName === "chromium") {
    await runMenuCommand(page, "View", "Maximize Diagram");
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(500);
    await captureStudioScreenshot(page, "docs/screenshots/hierarchy-focused-source-architecture.png");
    await runMenuCommand(page, "View", "Restore Diagram");
    await page.waitForTimeout(350);
  }

  await page.locator(".bd-react-flow").click({ position: { x: 30, y: 30 } });
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Runtime Source Modules");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(caption).toHaveText("Verified Source Architecture");
  await expect(flowNode(page, "source-architecture::verified-source-graph")).toHaveClass(/selected/);
  await page.keyboard.press("ControlOrMeta+Shift+End");
  await expect(caption).toHaveText("Runtime Source Modules");

  await breadcrumbs.getByRole("button", { name: "Product Boundary", exact: true }).click();
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(caption).toHaveText("Product Boundary");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  const sources = page.getByRole("region", { name: "Sources" });
  await sources.getByRole("tab", { name: "Interfaces" }).click({ force: true });
  await sources.getByLabel("Filter interfaces").fill("import-studio-to-model");
  await sources.getByRole("list", { name: "Matching interfaces" }).getByRole("button").click();
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(caption).toHaveText("Product Boundary");
  await expect(page.locator('.react-flow__edge[data-id$="::import-studio-to-model"]'))
    .toHaveClass(/selected/);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  expect(JSON.parse(await readFile(savedPath!, "utf8"))).toEqual(original);
  expect(await page.evaluate(() => history.length)).toBe(browserHistoryLength);

  await page.keyboard.press("Shift+Home");
  await expect(caption).toHaveText("Product Boundary");
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await sources.getByRole("tab", { name: "Hierarchy" }).click({ force: true });
  await page.locator(
    '.bd-tree-select[data-level-id="product-boundary"][data-node-id="architecture-block-studio"]',
  ).click({ force: true });
  const purpose = page.locator(
    ".bd-inspector-form:visible .bd-contract-fieldset:visible textarea",
  ).nth(1);
  await expect(purpose).toBeVisible();
  await purpose.fill(`${await purpose.inputValue()} draft`);
  await expect(page.locator(".bd-document-title span")).toContainText("*");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("ControlOrMeta+Shift+End");
  await expect(caption).toHaveText("Product Boundary");
  await expect(flowNode(page, "product-boundary::architecture-block-studio")).toHaveClass(/selected/);
  await expect(purpose).toHaveValue(/ draft$/);
});

test("resizes, collapses, maximizes, floats and resets dock panels", async ({ page }) => {
  const sources = page.getByRole("region", { name: "Sources" });
  const initialSources = await sources.boundingBox();
  expect(initialSources).not.toBeNull();

  const leftSash = await page.locator(".dv-sash").evaluateAll((elements, boundary) => {
    const sash = elements
      .map((element) => element.getBoundingClientRect())
      .find((rect) => Math.abs(rect.x - boundary) < 12);
    return sash ? { x: sash.x, y: sash.y, width: sash.width, height: sash.height } : null;
  }, initialSources!.x + initialSources!.width);
  expect(leftSash).not.toBeNull();
  await page.mouse.move(leftSash!.x + leftSash!.width / 2, leftSash!.y + leftSash!.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftSash!.x + 82, leftSash!.y + leftSash!.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await sources.boundingBox())!.width).toBeGreaterThan(initialSources!.width + 50);

  await runMenuCommand(page, "View", "Toggle Sources");
  expect((await sources.boundingBox())!.width).toBeLessThan(60);
  await runMenuCommand(page, "View", "Toggle Sources");
  expect((await sources.boundingBox())!.width).toBeGreaterThan(250);

  const diagramBefore = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  await runMenuCommand(page, "View", "Maximize Diagram");
  const diagramMaximized = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  expect(diagramMaximized!.width).toBeGreaterThan(diagramBefore!.width + 300);
  await runMenuCommand(page, "View", "Restore Diagram");

  await page.getByRole("button", { name: "Float Properties" }).click({ force: true });
  await expect(
    page.locator(".dv-floating-overlay-host").getByRole("region", { name: "Properties" }),
  ).toBeVisible();
  await expect(
    page.locator(".dv-floating-overlay-host").getByRole("button", { name: "Float Properties" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "View", exact: true }).click({ force: true });
  await page.getByRole("menuitem", { name: "Reset Workspace", exact: true }).click({ force: true });
  await expect(
    page.locator(".dv-floating-overlay-host").getByRole("region", { name: "Properties" }),
  ).toHaveCount(0);
  expect((await sources.boundingBox())!.width).toBeCloseTo(250, -1);
});

test("switches all five interface languages without changing the design document", async ({ page }) => {
  const language = page.locator(".bd-language-selector select");
  const cases = [
    { id: "zh-CN", menu: "文件", dock: "来源", saved: "已保存", htmlLang: "zh-CN" },
    { id: "fr", menu: "Fichier", dock: "Sources", saved: "Enregistré", htmlLang: "fr" },
    { id: "ja", menu: "ファイル", dock: "ソース", saved: "保存済み", htmlLang: "ja" },
    { id: "ko", menu: "파일", dock: "소스", saved: "저장됨", htmlLang: "ko" },
    { id: "en", menu: "File", dock: "Sources", saved: "Saved", htmlLang: "en" },
  ];

  for (const item of cases) {
    await language.selectOption(item.id);
    await expect(page.getByRole("button", { name: item.menu, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: item.dock, exact: true })).toBeVisible();
    await expect(page.locator(".bd-statusbar")).toContainText(item.saved);
    await expect(page.locator("html")).toHaveAttribute("lang", item.htmlLang);
    await expect(page.locator(".bd-document-title span")).not.toContainText("*");
  }

  await language.selectOption("ko");
  await page.reload();
  await waitForEditorIdle(page);
  await expect(page.getByRole("combobox", { name: "언어" })).toHaveValue("ko");
  await expect(page.getByRole("button", { name: "파일", exact: true })).toBeVisible();
  await expect(page.locator(".bd-document-title span")).not.toContainText("*");
});

test("hides sidebars from their headers and restores them from the collapsed rails", async ({ page }) => {
  const sources = page.getByRole("region", { name: "Sources" });
  const properties = page.getByRole("region", { name: "Properties" });
  expect((await sources.boundingBox())!.width).toBeGreaterThan(180);
  expect((await properties.boundingBox())!.width).toBeGreaterThan(250);

  await page.getByRole("button", { name: "Hide left sidebar", exact: true }).click();
  await expect.poll(async () => (await sources.boundingBox())?.width ?? 0).toBeLessThan(60);
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect.poll(async () => (await sources.boundingBox())?.width ?? 0).toBeGreaterThan(180);

  await page.getByRole("button", { name: "Hide right sidebar", exact: true }).click();
  await expect.poll(async () => (await properties.boundingBox())?.width ?? 0).toBeLessThan(60);
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect.poll(async () => (await properties.boundingBox())?.width ?? 0).toBeGreaterThan(250);
});

test("keeps a fixed-size mouse target for moving ports at overview zoom", async ({ page }) => {
  const agentUi = flowNode(page, "system::agent-ui");
  const port = agentUi.locator('.bd-port[data-port-id="session-command"]');
  const grip = port.getByRole("button", { name: "Move port session.command", exact: true });

  for (let index = 0; index < 3; index += 1) {
    await page.locator(".react-flow__controls-zoomout").click({ force: true });
  }
  const gripBounds = await grip.boundingBox();
  const nodeBounds = await agentUi.boundingBox();
  expect(gripBounds).not.toBeNull();
  expect(nodeBounds).not.toBeNull();
  expect(gripBounds!.width).toBeGreaterThanOrEqual(20);
  expect(gripBounds!.height).toBeGreaterThanOrEqual(20);

  await page.mouse.move(gripBounds!.x + gripBounds!.width / 2, gripBounds!.y + gripBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBounds!.x + nodeBounds!.width * 0.4, nodeBounds!.y + 2, { steps: 8 });
  await expect(page.locator(".bd-react-flow")).toHaveAttribute("data-port-move-active", "true");
  await expect(page.locator(".bd-react-flow")).toHaveAttribute("data-routing-frame-gesture", "port-drag");
  await page.mouse.up();
  await expect(port).toHaveClass(/bd-port-top/);
  await expect(page.locator(".bd-document-title span")).toContainText("*");

  await page.keyboard.press("ControlOrMeta+Z");
  await expect(port).toHaveClass(/bd-port-right/);
});

test("optimizes routes without moving blocks and regenerates placement separately", async ({ page }) => {
  const project = flowNode(page, "system::project");
  const before = await transformOf(project);

  await runMenuCommand(page, "Design", "Optimize Routing");
  expect(await transformOf(project)).toBe(before);

  await runMenuCommand(page, "Design", "Regenerate Layout");
  await expect.poll(() => transformOf(project), { timeout: 30_000 }).not.toBe(before);
  await waitForLayout(page);
});

test("loads designs from URL and local JSON files", async ({ page }) => {
  const designUrl = "/examples/aio-agent-runtime.block-design.json";
  await page.goto(`/?design=${encodeURIComponent(designUrl)}`);
  await waitForLayout(page);
  await expect(page.locator(".bd-document-title small")).toHaveText(designUrl);

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(examplePath);
  await expect(page.locator(".bd-document-title small")).toHaveText(
    "aio-agent-runtime.block-design.json",
  );

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(legacyPath);
  await expect(page.locator(".bd-document-title span")).toHaveText("Legacy v2 Design");
  await expect(page.locator(".bd-statusbar")).toContainText("BlockDesignDocument 2.2");
  await waitForLayout(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("loads and operates a deterministic large or stress design", async ({ browserName, page }, testInfo) => {
  const stress = process.env.STRESS_DESIGN === "1";
  const reducedMotion = process.env.PERFORMANCE_REDUCED_MOTION === "1";
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  const nodeCount = stress ? 1000 : 200;
  const connectionCount = stress ? 2000 : 400;
  test.setTimeout(stress ? 180_000 : 90_000);
  const document = performanceDesignDocument({ nodeCount, connectionCount });
  const metrics: Record<string, number> = {};
  metrics.inputJsonBytes = Buffer.byteLength(JSON.stringify(document));
  metrics.nodeCount = nodeCount;
  metrics.connectionCount = connectionCount;
  await openDesignDialog(page);
  const loadStarted = performance.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${document.id}.block-design.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText(document.title, {
    timeout: stress ? 120_000 : 30_000,
  });
  const productTitle = await page.locator(".bd-brand strong").boundingBox();
  expect(productTitle).not.toBeNull();
  expect(productTitle!.width).toBeGreaterThan(140);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: stress ? 120_000 : 30_000 });
  await expect(page.locator(".bd-statusbar")).toContainText(`${nodeCount} diagram blocks`);
  await expect(page.locator(".bd-statusbar")).toContainText(`${connectionCount} diagram interfaces`);
  await expect(page.locator(".react-flow__minimap-node")).toHaveCount(nodeCount);
  const defaultHierarchy = page.getByRole("list", { name: "Design hierarchy" });
  await expect(defaultHierarchy).toHaveAttribute("data-total-results", String(nodeCount + 2));
  await expect(defaultHierarchy).toHaveAttribute("data-rendered-results", "40");
  metrics.initialHierarchyRowCount = 40;
  const renderedNodes = page.locator(".react-flow__node");
  const renderedEdges = page.locator(".react-flow__edge");
  if (stress) {
    await expect.poll(() => renderedNodes.count(), { timeout: 120_000 }).toBeGreaterThan(0);
    await expect.poll(() => renderedEdges.count(), { timeout: 120_000 }).toBeGreaterThan(0);
    metrics.initialRenderedNodeCount = await renderedNodes.count();
    metrics.initialRenderedEdgeCount = await renderedEdges.count();
    expect(metrics.initialRenderedNodeCount).toBeLessThan(nodeCount);
    expect(metrics.initialRenderedEdgeCount).toBeLessThan(connectionCount);
  } else {
    await expect(renderedNodes).toHaveCount(nodeCount, { timeout: 30_000 });
    await expect(renderedEdges).toHaveCount(connectionCount, { timeout: 30_000 });
  }
  await expect(page.locator(".bd-interface-route")).toHaveCount(await renderedEdges.count());
  await expect(page.locator(".bd-interface-underlay")).toHaveCount(0);
  if (!stress) expect(await routeNodeCollisions(page)).toEqual([]);
  metrics.loadToInteractiveMs = Math.round(performance.now() - loadStarted);

  const typedSelectionViewport = await canvasViewportTransform(page);
  const selectInterfacesStarted = performance.now();
  await runMenuCommand(page, "Edit", /^Select Interfaces in Level/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText(`${connectionCount} objects selected`);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["0", String(connectionCount), "1"]);
  metrics.selectAllInterfacesMs = Math.round(performance.now() - selectInterfacesStarted);
  const selectModulesStarted = performance.now();
  await runMenuCommand(page, "Edit", /^Select Modules in Level/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText(`${nodeCount} objects selected`);
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText([String(nodeCount), "0", "1"]);
  metrics.selectAllModulesMs = Math.round(performance.now() - selectModulesStarted);
  expect(await canvasViewportTransform(page)).toBe(typedSelectionViewport);
  await page.keyboard.press("ControlOrMeta+Shift+A");

  await defaultHierarchy.evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  await expect(defaultHierarchy).toHaveAttribute("data-rendered-results", "80");
  await defaultHierarchy.evaluate((list) => list.scrollTo({ top: 0 }));

  if (stress) {
    const inspector = page.getByRole("region", { name: "Properties" });
    const title = inspector.getByLabel("Title", { exact: true });
    const apply = inspector.getByRole("button", { name: "Apply Changes" });
    const heapBeforeHistory = await chromiumHeapUsage(page);
    const historyStarted = performance.now();
    for (let index = 1; index <= 10; index += 1) {
      await title.fill(`Performance Stress Design Revision ${index}`);
      await apply.click({ force: true });
      await expect(page.locator(".bd-inspector-title h2")).toContainText(`Revision ${index}`);
      await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 120_000 });
    }
    metrics.tenHistoryEditsMs = Math.round(performance.now() - historyStarted);
    const heapAfterHistory = await chromiumHeapUsage(page);
    metrics.historyHeapDeltaBytes = Math.max(
      0,
      heapAfterHistory.totalMeasuredBytes - heapBeforeHistory.totalMeasuredBytes,
    );
    const undoStarted = performance.now();
    await toolbarButton(page, "Undo").click({ force: true });
    await expect(page.locator(".bd-inspector-title h2")).toContainText("Revision 9");
    metrics.historyUndoMs = Math.round(performance.now() - undoStarted);
    const redoStarted = performance.now();
    await toolbarButton(page, "Redo").click({ force: true });
    await expect(page.locator(".bd-inspector-title h2")).toContainText("Revision 10");
    metrics.historyRedoMs = Math.round(performance.now() - redoStarted);
  }

  const moduleButton = page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="module-000"]',
  );
  await beginCanvasNavigationTrace(page, "system::module-000", "Module 000");
  await clickWithPointer(page, moduleButton);
  const selectionTiming = await finishCanvasNavigationTrace(page);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 000");
  const selectedFlowNode = flowNode(page, "system::module-000");
  await expect(selectedFlowNode).toBeVisible({ timeout: 30_000 });
  await expect(selectedFlowNode).toHaveClass(/selected/);
  await expect(selectedFlowNode.locator(".bd-port-handle-outer")).toHaveCount(2);
  await expect(selectedFlowNode.locator(".bd-port-label")).toHaveCount(2);
  await expect.poll(async () => (await selectedFlowNode.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  metrics.selectModuleMs = selectionTiming.viewportSettledMs;
  metrics.selectModuleSelectionCommitMs = selectionTiming.selectionCommitMs;
  metrics.selectModuleTargetMountMs = selectionTiming.targetMountMs;
  metrics.selectModuleTargetSelectedMs = selectionTiming.targetSelectedMs;
  metrics.selectModuleViewportMotionStartMs = selectionTiming.viewportMotionStartMs;
  metrics.selectModuleViewportMotionDurationMs = selectionTiming.viewportMotionDurationMs;
  metrics.selectModuleViewportTransformChanges = selectionTiming.viewportTransformChanges;
  metrics.selectModuleViewportMaxTransformGapMs = selectionTiming.viewportMaxTransformGapMs;
  const contextMenuStarted = performance.now();
  await rightClickLocator(page, selectedFlowNode);
  const performanceContextMenu = page.getByRole("menu", { name: "Module actions" });
  await expect(performanceContextMenu).toBeVisible();
  await expect(performanceContextMenu.getByRole("menuitem", { name: /^Duplicate/ })).toBeVisible();
  metrics.openModuleContextMenuMs = Math.round(performance.now() - contextMenuStarted);
  await page.keyboard.press("Escape");
  await expect(performanceContextMenu).toHaveCount(0);
  await expect(selectedFlowNode).toHaveClass(/selected/);
  const directNeighborhoodViewport = await canvasViewportTransform(page);
  const directNeighborhoodStarted = performance.now();
  await runMenuCommand(page, "Edit", /^Select Direct Neighborhood/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("7 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["4", "3", "1"]);
  metrics.selectDirectNeighborhoodMs = Math.round(performance.now() - directNeighborhoodStarted);
  expect(await canvasViewportTransform(page)).toBe(directNeighborhoodViewport);
  await clickWithPointer(page, moduleButton);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 000");
  const outgoingNeighborhoodStarted = performance.now();
  await runMenuCommand(page, "Edit", /^Select Outgoing Neighborhood/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("7 objects selected");
  await expect(page.locator(".bd-multi-metrics dd")).toHaveText(["4", "3", "1"]);
  metrics.selectOutgoingNeighborhoodMs = Math.round(performance.now() - outgoingNeighborhoodStarted);
  expect(await canvasViewportTransform(page)).toBe(directNeighborhoodViewport);
  await clickWithPointer(page, moduleButton);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 000");
  const multiSelectionStarted = performance.now();
  const secondModuleButton = page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="module-001"]',
  );
  await secondModuleButton.click({ force: true, modifiers: ["Shift"] });
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  await expect(flowNode(page, "system::module-000")).toHaveClass(/selected/, { timeout: 30_000 });
  const secondSelectedFlowNode = flowNode(page, "system::module-001");
  await expect(secondSelectedFlowNode).toHaveClass(/selected/, { timeout: 30_000 });
  await expect(page.locator(".bd-node-resize-handle")).toHaveCount(0);
  metrics.multiSelectTwoModulesMs = Math.round(performance.now() - multiSelectionStarted);
  const performanceGroupResizer = page.locator(".bd-selection-resizer");
  await expect(performanceGroupResizer).toBeVisible();
  await page.waitForTimeout(400);
  const performanceResizeBefore = await Promise.all([
    selectedFlowNode.boundingBox(),
    secondSelectedFlowNode.boundingBox(),
  ]);
  expect(performanceResizeBefore.every(Boolean)).toBe(true);
  const performanceRouteAuditBefore = stress ? undefined : await exhaustiveRouteAudit(page);
  let performanceLiveResizeAuditMs = 0;
  const performanceGroupResizeStarted = performance.now();
  const performanceResizeTiming = await dragSelectionResizeHandle(
    page,
    performanceGroupResizer.locator(".bd-selection-resize-handle.middle.right"),
    { x: 18, y: 0 },
    { alt: true },
    async () => {
      const canvas = page.locator(".bd-react-flow");
      await expect(canvas).toHaveAttribute("data-routing-frame-mode", "incremental");
      const affected = Number(await canvas.getAttribute("data-routing-frame-affected"));
      const neighborhood = Number(await canvas.getAttribute("data-routing-frame-neighborhood"));
      expect(affected).toBeGreaterThan(0);
      expect(neighborhood).toBeGreaterThanOrEqual(affected);
      expect(neighborhood).toBeLessThan(connectionCount);
      metrics.liveResizeAffectedRoutes = affected;
      metrics.liveResizeNeighborhoodRoutes = neighborhood;
      metrics.liveResizeWorkerDurationMs = Number(
        await canvas.getAttribute("data-routing-frame-duration-ms"),
      );
      expect(metrics.liveResizeWorkerDurationMs).toBeLessThan(500);
      if (!stress) {
        const auditStarted = performance.now();
        const previewAudit = await exhaustiveRouteAudit(page);
        expect(previewAudit).toMatchObject({
          auditedRouteCount: connectionCount,
          auditedPairCount: connectionCount * (connectionCount - 1) / 2,
          expectedPairCount: connectionCount * (connectionCount - 1) / 2,
          perRouteIssues: [],
          unbridgedCrossings: [],
          orphanJumps: [],
        });
        expect(previewAudit.parallelConflicts.length)
          .toBeLessThanOrEqual(performanceRouteAuditBefore!.parallelConflicts.length);
        performanceLiveResizeAuditMs = performance.now() - auditStarted;
      } else {
        await expect(page.locator(".bd-interface-route")).toHaveCount(await renderedEdges.count());
        expect(await routeNodeCollisions(page)).toEqual([]);
      }
    },
  );
  metrics.groupResizeTwoModulesMs = Math.round(
    performance.now() - performanceGroupResizeStarted - performanceLiveResizeAuditMs,
  );
  metrics.groupResizePointerReleaseMs = Math.round(performanceResizeTiming.pointerReleaseMs);
  metrics.groupResizeCommittedReadyMs = Math.round(performanceResizeTiming.committedReadyMs);
  const committedCanvas = page.locator(".bd-react-flow");
  await expect(committedCanvas).toHaveAttribute("data-committed-routing-mode", "rebased");
  metrics.committedResizeAffectedRoutes = Number(
    await committedCanvas.getAttribute("data-committed-routing-affected"),
  );
  metrics.committedResizeNeighborhoodRoutes = Number(
    await committedCanvas.getAttribute("data-committed-routing-neighborhood"),
  );
  metrics.committedResizeWorkerDurationMs = Number(
    await committedCanvas.getAttribute("data-committed-routing-duration-ms"),
  );
  metrics.committedResizeTransportedRoutes = Number(
    await committedCanvas.getAttribute("data-committed-routing-route-upserts"),
  );
  metrics.committedResizeTransportedRouteJumps = Number(
    await committedCanvas.getAttribute("data-committed-routing-jump-upserts"),
  );
  metrics.committedResizeProjectedNodeChanges = Number(
    await committedCanvas.getAttribute("data-projected-node-changes"),
  );
  metrics.committedResizeProjectedEdgeChanges = Number(
    await committedCanvas.getAttribute("data-projected-edge-changes"),
  );
  expect(metrics.committedResizeAffectedRoutes).toBeGreaterThan(0);
  expect(metrics.committedResizeNeighborhoodRoutes).toBeGreaterThanOrEqual(
    metrics.committedResizeAffectedRoutes,
  );
  expect(metrics.committedResizeNeighborhoodRoutes).toBeLessThan(connectionCount);
  expect(metrics.committedResizeWorkerDurationMs).toBeLessThan(1_000);
  expect(metrics.committedResizeTransportedRoutes)
    .toBeLessThanOrEqual(metrics.committedResizeNeighborhoodRoutes);
  expect(metrics.committedResizeTransportedRouteJumps).toBeLessThan(connectionCount);
  expect(metrics.committedResizeProjectedNodeChanges).toBeLessThanOrEqual(2);
  expect(metrics.committedResizeProjectedEdgeChanges).toBeLessThan(connectionCount);
  metrics.liveResizeFullAuditMs = Math.round(performanceLiveResizeAuditMs);
  const performanceResizeAfter = await Promise.all([
    selectedFlowNode.boundingBox(),
    secondSelectedFlowNode.boundingBox(),
  ]);
  expect(performanceResizeAfter[0]!.width).toBeGreaterThan(performanceResizeBefore[0]!.width + 8);
  expect(performanceResizeAfter[1]!.width).toBeGreaterThan(performanceResizeBefore[1]!.width + 8);
  expect(performanceResizeAfter[0]!.height).toBeCloseTo(performanceResizeBefore[0]!.height, 0);
  expect(performanceResizeAfter[1]!.height).toBeCloseTo(performanceResizeBefore[1]!.height, 0);
  const performanceGroupUndoStarted = performance.now();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  metrics.groupResizeUndoMs = Math.round(performance.now() - performanceGroupUndoStarted);
  await secondModuleButton.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 000");
  await altSelectIntersectingNode(page, selectedFlowNode);
  const selectedBoxForHitCycle = await selectedFlowNode.boundingBox();
  expect(selectedBoxForHitCycle).not.toBeNull();
  const hitCycleStarted = performance.now();
  await altClickCanvasPoint(page, {
    x: selectedBoxForHitCycle!.x + selectedBoxForHitCycle!.width / 2,
    y: selectedBoxForHitCycle!.y + selectedBoxForHitCycle!.height / 2,
  });
  await expect(selectedFlowNode).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  metrics.altClickHitCycleMs = Math.round(performance.now() - hitCycleStarted);
  const keyboardTraversalStarted = performance.now();
  await selectedFlowNode.focus();
  await page.keyboard.press("Tab");
  await expect(flowNode(page, "system::module-001")).toHaveClass(/selected/);
  await expect(flowNode(page, "system::module-001")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(selectedFlowNode).toHaveClass(/selected/);
  await expect(selectedFlowNode).toBeFocused();
  metrics.keyboardTraversalRoundTripMs = Math.round(performance.now() - keyboardTraversalStarted);
  if (stress) {
    const selectedBox = await selectedFlowNode.boundingBox();
    expect(selectedBox).not.toBeNull();
    const guideDragStarted = performance.now();
    const guideDragStart = {
      x: selectedBox!.x + selectedBox!.width / 2,
      y: selectedBox!.y + selectedBox!.height * 0.62,
    };
    await page.mouse.move(guideDragStart.x, guideDragStart.y);
    await page.mouse.down();
    await page.mouse.move(guideDragStart.x + 18, guideDragStart.y, { steps: 6 });
    await expect(page.locator(".bd-alignment-guide, .bd-distance-guide")).not.toHaveCount(0);
    await page.mouse.up();
    await waitForEditorIdle(page);
    metrics.viewportGuideDragMs = Math.round(performance.now() - guideDragStarted);
    await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
    await expect(selectedFlowNode).toBeVisible({ timeout: 30_000 });

    const viewportBeforeCanvasSelection = await canvasViewportTransform(page);
    await clickWithPointer(page, selectedFlowNode);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    })));
    expect(await canvasViewportTransform(page)).toBe(viewportBeforeCanvasSelection);
    const miniMapNodes = page.locator(".react-flow__minimap-node");
    await beginCanvasNavigationTrace(page, "system::module-999", "Module 999");
    await miniMapNodes.last().dispatchEvent("click");
    const minimapOutboundTiming = await finishCanvasNavigationTrace(page);
    await expect(flowNode(page, "system::module-999")).toBeVisible({ timeout: 30_000 });
    await expect(flowNode(page, "system::module-999")).toHaveClass(/selected/);
    await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 999");
    await expect(selectedFlowNode).toHaveCount(0);
    await beginCanvasNavigationTrace(page, "system::module-000", "Module 000");
    await miniMapNodes.first().dispatchEvent("click");
    const minimapReturnTiming = await finishCanvasNavigationTrace(page);
    await expect(selectedFlowNode).toBeVisible({ timeout: 30_000 });
    await expect(selectedFlowNode).toHaveClass(/selected/);
    await expect(selectedFlowNode.locator(".bd-port-handle-outer")).toHaveCount(2);
    await expect(selectedFlowNode.locator(".bd-port-label")).toHaveCount(2);
    metrics.minimapPanToSelectedMs = minimapReturnTiming.viewportSettledMs;
    metrics.minimapOutboundSettledMs = minimapOutboundTiming.viewportSettledMs;
    metrics.minimapSelectionCommitMs = minimapReturnTiming.selectionCommitMs;
    metrics.minimapTargetMountMs = minimapReturnTiming.targetMountMs;
    metrics.minimapTargetSelectedMs = minimapReturnTiming.targetSelectedMs;
    metrics.minimapViewportMotionStartMs = minimapReturnTiming.viewportMotionStartMs;
    metrics.minimapViewportMotionDurationMs = minimapReturnTiming.viewportMotionDurationMs;
    metrics.minimapViewportTransformChanges = minimapReturnTiming.viewportTransformChanges;
    metrics.minimapViewportMaxTransformGapMs = minimapReturnTiming.viewportMaxTransformGapMs;
  }

  const hierarchySearchStarted = performance.now();
  const hierarchyFilter = page.getByLabel("Filter modules");
  const hierarchyResults = page.locator(".bd-hierarchy-search-row");
  const hierarchyResultList = page.getByRole("list", { name: "Matching modules" });
  await clickWithPointer(page, hierarchyFilter);
  await page.keyboard.type("Team 7");
  await expect(hierarchyResultList).toHaveAttribute("data-total-results", String(nodeCount / 10));
  await expect(hierarchyResults).toHaveCount(Math.min(nodeCount / 10, 40));
  await page.keyboard.press("Control+A");
  await page.keyboard.type(stress ? "Performance Stress Design Revision 10" : document.levels[0].title);
  await expect(hierarchyResultList).toHaveAttribute("data-total-results", String(nodeCount));
  await expect(hierarchyResultList).toHaveAttribute(
    "data-rendered-results",
    String(Math.min(nodeCount, 40)),
  );
  if (process.env.CAPTURE_PERFORMANCE_PROOF === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/hierarchy-search.png");
  }
  await hierarchyResultList.evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  await expect(hierarchyResultList).toHaveAttribute(
    "data-rendered-results",
    String(Math.min(nodeCount, 80)),
  );
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Module 042");
  await expect(hierarchyResults).toHaveCount(1);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("module-137");
  await expect(hierarchyResults).toHaveCount(1);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 137");
  await expect.poll(async () => (await flowNode(page, "system::module-137").boundingBox())?.width ?? 0)
    .toBeGreaterThan(100);
  metrics.searchAndSelectModuleMs = Math.round(performance.now() - hierarchySearchStarted);
  await hierarchyFilter.fill("");
  await expect(defaultHierarchy).toHaveAttribute("data-rendered-results", "40");
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Module 137");

  const interfacesTab = page.getByRole("tab", { name: "Interfaces", exact: true });
  await clickWithPointer(page, interfacesTab);
  const filterStarted = performance.now();
  const interfaceFilter = page.getByLabel("Filter interfaces");
  await clickWithPointer(page, interfaceFilter);
  await page.keyboard.type("perf.interface.0000");
  const interfaceResult = page.locator(".bd-interface-browser-row");
  await expect(interfaceResult).toHaveCount(1);
  metrics.filterInterfaceMs = Math.round(performance.now() - filterStarted);
  const revealInterfaceStarted = performance.now();
  await clickWithPointer(page, interfaceResult);
  const revealedEdge = page.locator('.react-flow__edge[data-id="system::connection-0000"]');
  const revealedRoute = revealedEdge.locator(".bd-interface-route");
  await expect(revealedRoute).toHaveCount(1);
  await expect(revealedEdge).toHaveClass(/selected/);
  await expect(flowNode(page, "system::module-000")).toBeVisible();
  await expect(flowNode(page, "system::module-010")).toBeVisible();
  await expect.poll(() => revealedRoute.evaluate((path) => {
    const matrix = (path as SVGPathElement).getScreenCTM();
    const canvas = path.closest(".react-flow")?.getBoundingClientRect();
    const route = path.closest<SVGGElement>("[data-route-points]");
    const points = JSON.parse(route?.dataset.routePoints ?? "[]") as Array<{ x: number; y: number }>;
    if (!matrix || !canvas || points.length < 2) return false;
    return points.every((routePoint) => {
      const point = new DOMPoint(routePoint.x, routePoint.y).matrixTransform(matrix);
      return point.x >= canvas.left && point.x <= canvas.right && point.y >= canvas.top && point.y <= canvas.bottom;
    });
  })).toBe(true);
  metrics.revealInterfaceMs = Math.round(performance.now() - revealInterfaceStarted);

  const visibleEdgeCountBeforePreview = await renderedEdges.count();
  await flowNode(page, "system::module-000").click({ position: { x: 120, y: 72 }, force: true });
  const largePreviewSource = flowNode(page, "system::module-000")
    .locator('.bd-port-handle-outer[data-handleid="out"]');
  const largePreviewTarget = flowNode(page, "system::module-010")
    .locator('.bd-port-handle-outer[data-handleid="in"]');
  const largePreviewSourceBox = await largePreviewSource.boundingBox();
  const largePreviewTargetBox = await largePreviewTarget.boundingBox();
  expect(largePreviewSourceBox).not.toBeNull();
  expect(largePreviewTargetBox).not.toBeNull();
  await page.mouse.move(
    largePreviewSourceBox!.x + largePreviewSourceBox!.width / 2,
    largePreviewSourceBox!.y + largePreviewSourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    largePreviewTargetBox!.x + largePreviewTargetBox!.width / 2,
    largePreviewTargetBox!.y + largePreviewTargetBox!.height / 2,
    { steps: 10 },
  );
  const largePreviewPanel = page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]');
  await expect(largePreviewPanel).toHaveAttribute("data-connection-status", "valid");
  await expect(largePreviewPanel).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(largePreviewPanel).toHaveAttribute("data-preview-obstacle-count", String(nodeCount));
  metrics.connectionPreviewPeakMs = Number(
    await largePreviewPanel.getAttribute("data-preview-peak-duration-ms"),
  );
  metrics.connectionPreviewLatestMs = Number(
    await largePreviewPanel.getAttribute("data-preview-duration-ms"),
  );
  metrics.connectionPreviewSolveCount = Number(
    await largePreviewPanel.getAttribute("data-preview-solve-count"),
  );
  metrics.connectionPreviewRequestCount = Number(
    await largePreviewPanel.getAttribute("data-preview-request-count"),
  );
  metrics.connectionPreviewCacheHitCount = Number(
    await largePreviewPanel.getAttribute("data-preview-cache-hit-count"),
  );
  metrics.connectionPreviewRegisteredObstacleCount = Number(
    await largePreviewPanel.getAttribute("data-preview-registered-obstacle-count"),
  );
  expect(metrics.connectionPreviewPeakMs).toBeLessThan(80);
  expect(metrics.connectionPreviewRegisteredObstacleCount).toBe(nodeCount);
  expect(metrics.connectionPreviewRequestCount).toBeGreaterThanOrEqual(metrics.connectionPreviewSolveCount);
  expect(await connectionPreviewIssues(page)).toEqual({
    collisions: [],
    nonOrthogonalSegments: [],
    zeroLengthSegments: [],
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(renderedEdges).toHaveCount(visibleEdgeCountBeforePreview);

  const cutSourceId = "module-000";
  const cutConnectionCount = document.levels[0].connections.filter((connection) => (
    connection.source.nodeId === cutSourceId || connection.target.nodeId === cutSourceId
  )).length;
  await flowNode(page, `system::${cutSourceId}`).click({ force: true });
  const cutStarted = performance.now();
  await page.keyboard.press("ControlOrMeta+X");
  await expect(page.locator(".bd-statusbar")).toContainText(`${nodeCount - 1} diagram blocks`);
  await expect(page.locator(".bd-statusbar")).toContainText(
    `${connectionCount - cutConnectionCount} diagram interfaces`,
  );
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(page.locator(".bd-statusbar")).toContainText(`${nodeCount} diagram blocks`);
  await expect(page.locator(".bd-statusbar")).toContainText(`${connectionCount} diagram interfaces`);
  metrics.cutSingleModuleUndoMs = Math.round(performance.now() - cutStarted);

  const saveStarted = performance.now();
  const downloadPromise = page.waitForEvent("download");
  await clickWithPointer(page, toolbarButton(page, "Save"));
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.levels[0].nodes).toHaveLength(nodeCount);
  expect(saved.levels[0].connections).toHaveLength(connectionCount);
  metrics.saveAndVerifyMs = Math.round(performance.now() - saveStarted);
  const heapAfterInteractions = await chromiumHeapUsage(page);
  metrics.jsHeapAfterInteractionsBytes = heapAfterInteractions.jsHeapUsedBytes;
  metrics.backingStorageAfterInteractionsBytes = heapAfterInteractions.backingStorageBytes;
  metrics.totalMeasuredAfterInteractionsBytes = heapAfterInteractions.totalMeasuredBytes;

  const viewport = page.viewportSize();
  const sample = createPerformanceSample({
    suite: stress ? "browser-stress" : "browser-large",
    scenario: `${nodeCount}-modules-${connectionCount}-connections`,
    metrics,
    environment: {
      browserName,
      browserVersion: page.context().browser()?.version() ?? "unknown",
      viewport: viewport ? `${viewport.width}x${viewport.height}` : "unknown",
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
    },
  });
  await testInfo.attach(`${stress ? "stress" : "large"}-design-performance-sample.json`, {
    body: Buffer.from(`${JSON.stringify(sample, null, 2)}\n`),
    contentType: "application/json",
  });
  await emitPerformanceSample(sample);
});

test("drags, persists, resets, and restores a manual orthogonal route", async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const handle = edge.locator(".bd-route-handle").first();
  await expect(handle).toBeVisible();
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  const routeBefore = await edge.locator(".bd-interface-route").getAttribute("d");
  let handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(handleBox!.width).toBeGreaterThanOrEqual(23);
  expect(handleBox!.height).toBeGreaterThanOrEqual(23);
  await page.locator(".react-flow__controls-zoomin").click({ force: true });
  const zoomedHandleBox = await handle.boundingBox();
  expect(zoomedHandleBox).not.toBeNull();
  expect(Math.abs(zoomedHandleBox!.width - handleBox!.width)).toBeLessThan(0.5);
  expect(Math.abs(zoomedHandleBox!.height - handleBox!.height)).toBeLessThan(0.5);
  handleBox = zoomedHandleBox;
  const pointerId = 41;
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  await handle.dispatchEvent("pointerdown", {
    pointerId,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  await page.evaluate(({ pointerId: id, x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: id,
      buttons: 1,
      clientX: x + 80,
      clientY: y,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: id,
      button: 0,
      clientX: x + 80,
      clientY: y,
    }));
  }, { pointerId, ...start });
  await waitForEditorIdle(page);

  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  const routeAfter = await edge.locator(".bd-interface-route").getAttribute("d");
  expect(routeAfter).not.toBe(routeBefore);
  const inspector = page.getByRole("region", { name: "Properties" });
  await expect(inspector.getByRole("region", { name: "Connection routing" })).toContainText("Manual");
  if (process.env.CAPTURE_MANUAL_ROUTING === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/manual-routing.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await toolbarButton(page, "Save").click({ force: true });
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.schemaVersion).toBe("2.2");
  expect(saved.levels[0].connections.find((connection: { id: string }) => connection.id === "ui-session-command").routing.waypoints.length).toBeGreaterThanOrEqual(2);

  await inspector.getByRole("button", { name: "Reset to automatic routing" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await toolbarButton(page, "Undo").click({ force: true });
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
});

test("selects and edits an orthogonal route entirely from the keyboard", async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await tabTo(page, edge);
  await expect(edge).toBeFocused();
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toContainText("Session Command");

  const handle = edge.locator(".bd-route-handle").first();
  await expect(handle).toBeVisible();
  expect((await accessibilityResults(page, ".bd-route-handle-object")).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(handle).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(edge).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(handle).toBeFocused();
  const routeBefore = await edge.locator(".bd-interface-route").getAttribute("d");
  const valueBefore = Number(await handle.getAttribute("aria-valuenow"));
  const moveKey = await handle.getAttribute("data-route-axis") === "h"
    ? "ArrowDown"
    : "ArrowRight";
  await page.keyboard.press(moveKey);
  await waitForEditorIdle(page);

  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(handle).toBeFocused();
  expect(await edge.locator(".bd-interface-route").getAttribute("d")).not.toBe(routeBefore);
  expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(valueBefore + 8);
  if (process.env.CAPTURE_MANUAL_ROUTING === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/manual-routing.png");
  }

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  const resetRouting = page.getByRole("region", { name: "Properties" })
    .getByRole("button", { name: "Reset to automatic routing" });
  await tabTo(page, resetRouting);
  await expect(resetRouting).toBeFocused();
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.levels[0].connections.find(
    (connection: { id: string }) => connection.id === "ui-session-command",
  ).routing.waypoints.length).toBeGreaterThanOrEqual(2);

  await edge.focus();
  await page.keyboard.press("Escape");
  await expect(edge).not.toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("System Overview");
});

test("exposes draggable real bends after a virtual segment becomes manual", async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const segment = edge.locator(".bd-route-segment-handle").first();
  await segment.focus();
  await page.keyboard.press(await segment.getAttribute("data-route-axis") === "h" ? "ArrowDown" : "ArrowRight");
  await waitForEditorIdle(page);

  const bends = edge.locator(".bd-route-bend-handle");
  expect(await bends.count()).toBeGreaterThanOrEqual(2);
  const bendIndex = Math.min(1, (await bends.count()) - 1);
  const bend = bends.nth(bendIndex);
  const routeBefore = await edge.locator(".bd-interface-route").getAttribute("d");
  const box = await bend.boundingBox();
  expect(box).not.toBeNull();
  const pointerId = 52;
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await bend.dispatchEvent("pointerdown", {
    pointerId,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  await page.evaluate(({ pointerId: id, x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: id,
      buttons: 1,
      clientX: x + 48,
      clientY: y + 32,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: id,
      button: 0,
      clientX: x + 48,
      clientY: y + 32,
    }));
  }, { pointerId, ...start });
  await waitForEditorIdle(page);

  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  expect(await edge.locator(".bd-interface-route").getAttribute("d")).not.toBe(routeBefore);
  const movedBend = edge.locator(".bd-route-bend-handle").nth(bendIndex);
  await movedBend.focus();
  await page.keyboard.press("ArrowRight");
  await waitForEditorIdle(page);
  await expect(movedBend).toBeFocused();
  expect((await accessibilityResults(page, ".bd-route-handle-object")).violations).toEqual([]);
  const bendCountBeforeDelete = await edge.locator(".bd-route-bend-handle").count();
  await page.keyboard.press("Delete");
  await waitForEditorIdle(page);
  expect(await edge.locator(".bd-route-bend-handle").count()).toBeLessThan(bendCountBeforeDelete);
});

test("routes a live pointer connection through the full obstacle scene and commits the same geometry", async ({ page, browserName }) => {
  const document = connectionPreviewDesignDocument();
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "scene-aware-connection-preview.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Scene-Aware Connection Preview");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(500);
  if (process.env.CAPTURE_SCENE_CONNECTION_PREVIEW === "1" && browserName === "chromium") {
    await page.locator(".react-flow__controls-zoomin").click();
    await page.locator(".react-flow__controls-zoomin").click();
    await page.waitForTimeout(300);
  }
  const source = flowNode(page, "system::source")
    .locator('.bd-port-handle-outer[data-handleid="command"]');
  const target = flowNode(page, "system::target")
    .locator('.bd-port-handle-outer[data-handleid="command"]');
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.move(targetBox!.x + targetBox!.width / 2 + 1, targetBox!.y + targetBox!.height / 2);
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
  const panel = page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]');
  const preview = page.locator('.bd-connection-preview[data-connection-status="valid"]');
  await expect(panel).toHaveAttribute("data-connection-status", "valid");
  await expect(panel).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(panel).toHaveAttribute("data-preview-obstacle-count", "3");
  await expect(panel).toHaveAttribute("data-preview-registered-obstacle-count", "3");
  expect(Number(await panel.getAttribute("data-preview-request-count"))).toBeGreaterThan(
    Number(await panel.getAttribute("data-preview-solve-count")),
  );
  expect(Number(await panel.getAttribute("data-preview-cache-hit-count"))).toBeGreaterThan(0);
  await expect(preview).toHaveAttribute("data-preview-routing-status", "routed");
  expect(Number(await preview.getAttribute("data-preview-point-count"))).toBeGreaterThanOrEqual(5);
  expect(await connectionPreviewIssues(page)).toEqual({
    collisions: [],
    nonOrthogonalSegments: [],
    zeroLengthSegments: [],
  });
  const previewPoints = JSON.parse(await preview.getAttribute("data-preview-points") ?? "[]");
  if (process.env.CAPTURE_SCENE_CONNECTION_PREVIEW === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/scene-connection-preview.png");
  }

  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Create Typed Interface" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Interface title").fill("Reviewed Command");
  await dialog.getByLabel("Connection id").fill("source-to-target");
  await dialog.getByLabel("Interface id").fill("preview.command");
  await dialog.getByLabel("Interface type").selectOption("rpc");
  await dialog.getByLabel("Owner").fill("Architecture Team");
  await dialog.getByRole("button", { name: "Create Connection", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  const edge = page.locator('.react-flow__edge[data-id="system::source-to-target"]');
  await expect(edge).toBeVisible();
  const committedPoints = JSON.parse(
    await edge.locator("[data-route-points]").getAttribute("data-route-points") ?? "[]",
  );
  expect(committedPoints).toEqual(previewPoints);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 1,
    auditedPairCount: 0,
    expectedPairCount: 0,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
});

test("previews, cancels, rejects, preserves, and commits pointer connections consistently", async ({ page, browserName }) => {
  const source = flowNode(page, "system::agent-ui")
    .locator('.bd-port-handle-outer[data-handleid="session-command"]');
  const sourcePort = source.locator("xpath=..");
  const originalTarget = flowNode(page, "system::rust-agent-core")
    .locator('.bd-port-handle-outer[data-handleid="session-command"]');
  const replacementTarget = flowNode(page, "system::rust-agent-core")
    .locator('.bd-port-handle-outer[data-handleid="knowledge-lifecycle"]');
  const incompatibleTarget = flowNode(page, "system::rust-agent-core")
    .locator('.bd-port-handle-outer[data-handleid="session-notification"]');
  const replacementPort = replacementTarget.locator("xpath=..");
  const incompatiblePort = incompatibleTarget.locator("xpath=..");
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + 64, sourceBox!.y + 42, { steps: 4 });
  const createPanel = page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]');
  await expect(createPanel).toBeVisible();
  await expect(createPanel).toContainText("CONNECT PORTS");
  await expect(createPanel).toContainText("compatible ports");
  await expect(page.locator(".bd-react-flow")).toHaveAttribute("data-connection-gesture", "create");
  await expect(sourcePort).toHaveAttribute("data-connection-role", "origin");
  await expect(replacementPort).toHaveAttribute("data-connection-role", "candidate");
  await expect(incompatiblePort).toHaveAttribute("data-connection-role", "incompatible");
  const floatingPreview = page.locator('.bd-connection-preview[data-connection-status="searching"]');
  await expect(floatingPreview).toBeVisible();
  await expect(floatingPreview).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(createPanel).toHaveAttribute("data-preview-routing-status", "routed");
  expect(Number(await createPanel.getAttribute("data-preview-obstacle-count"))).toBeGreaterThan(1);
  expect(await createPanel.getAttribute("data-preview-registered-obstacle-count")).toBe(
    await createPanel.getAttribute("data-preview-obstacle-count"),
  );
  const floatingPath = await floatingPreview.locator(".bd-connection-preview-path").getAttribute("d");
  expect(floatingPath).toMatch(/^M .* L /);
  expect(floatingPath).not.toMatch(/[CQ]/);
  await page.keyboard.press("Escape");
  await expect(createPanel).toHaveCount(0);
  await expect(page.locator(".bd-connection-feedback")).toContainText("Connection canceled");
  await expect(page.locator(".bd-react-flow")).not.toHaveAttribute("data-connection-gesture");
  await expect(replacementPort).not.toHaveAttribute("data-connection-role");
  await page.mouse.up();

  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const segment = edge.locator(".bd-route-segment-handle").first();
  await segment.focus();
  await page.keyboard.press(await segment.getAttribute("data-route-axis") === "h" ? "ArrowDown" : "ArrowRight");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await edge.focus();
  await page.keyboard.press("ControlOrMeta+Shift+H");
  await page.waitForTimeout(400);
  const fitNotice = page.locator(".bd-command-notice");
  if (await fitNotice.isVisible()) {
    await fitNotice.getByRole("button", { name: "Dismiss" }).click({ force: true });
  }

  const updater = edge.locator(".react-flow__edgeupdater-target");
  const updaterBox = await updater.boundingBox();
  const replacementBox = await replacementTarget.boundingBox();
  expect(updaterBox).not.toBeNull();
  expect(replacementBox).not.toBeNull();
  await page.mouse.move(updaterBox!.x + updaterBox!.width / 2, updaterBox!.y + updaterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    replacementBox!.x + replacementBox!.width / 2,
    replacementBox!.y + replacementBox!.height / 2,
    { steps: 8 },
  );
  const reconnectPanel = page.locator('.bd-connection-gesture-panel[data-connection-mode="reconnect"]');
  await expect(reconnectPanel).toHaveAttribute("data-connection-status", "valid");
  await expect(reconnectPanel).toContainText("Ready to reconnect");
  await expect(replacementTarget).toHaveClass(/valid/);
  const attachedPreview = page.locator('.bd-connection-preview[data-connection-status="valid"]');
  await expect(attachedPreview).toBeVisible();
  await expect(attachedPreview).toHaveAttribute("data-preview-routing-status", "routed");
  await expect(reconnectPanel).toHaveAttribute("data-preview-routing-status", "routed");
  expect(await reconnectPanel.getAttribute("data-preview-registered-obstacle-count")).toBe(
    await reconnectPanel.getAttribute("data-preview-obstacle-count"),
  );
  const attachedPath = await attachedPreview.locator(".bd-connection-preview-path").getAttribute("d");
  expect(attachedPath).toMatch(/^M .* L /);
  expect(attachedPath).not.toMatch(/[CQ]/);
  expect(await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(
      '.bd-connection-preview[data-connection-status="valid"] .bd-connection-preview-path',
    );
    const target = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="system::rust-agent-core"]',
    );
    const matrix = path?.getScreenCTM();
    if (!path || !target || !matrix) return ["preview geometry unavailable"];
    const rect = target.getBoundingClientRect();
    const length = path.getTotalLength();
    return Array.from({ length: 99 }, (_, index) => path.getPointAtLength(length * ((index + 1) / 100)))
      .map((point) => new DOMPoint(point.x, point.y).matrixTransform(matrix))
      .flatMap((point) => point.x > rect.left + 3 && point.x < rect.right - 3 &&
        point.y > rect.top + 3 && point.y < rect.bottom - 3
        ? [`${Math.round(point.x)},${Math.round(point.y)}`]
        : []);
  })).toEqual([]);
  expect((await accessibilityResults(page, ".bd-connection-gesture-panel")).violations).toEqual([]);
  expect(await textContrastIssues(page, ".bd-connection-gesture-panel")).toEqual([]);
  if (process.env.CAPTURE_POINTER_CONNECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/pointer-connection-feedback.png");
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".bd-connection-feedback")).toContainText("Reconnect canceled");
  await page.mouse.up();
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.session-command",
  );

  const originalBox = await originalTarget.boundingBox();
  expect(originalBox).not.toBeNull();
  const unchangedUpdaterBox = await updater.boundingBox();
  expect(unchangedUpdaterBox).not.toBeNull();
  await page.mouse.move(
    unchangedUpdaterBox!.x + unchangedUpdaterBox!.width / 2,
    unchangedUpdaterBox!.y + unchangedUpdaterBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(originalBox!.x + originalBox!.width / 2, originalBox!.y + originalBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".bd-connection-feedback")).toContainText("Endpoint unchanged");
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  const invalidUpdaterBox = await updater.boundingBox();
  const incompatibleBox = await incompatibleTarget.boundingBox();
  expect(invalidUpdaterBox).not.toBeNull();
  expect(incompatibleBox).not.toBeNull();
  await page.mouse.move(invalidUpdaterBox!.x + invalidUpdaterBox!.width / 2, invalidUpdaterBox!.y + invalidUpdaterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    incompatibleBox!.x + incompatibleBox!.width / 2,
    incompatibleBox!.y + incompatibleBox!.height / 2,
    { steps: 8 },
  );
  await expect(reconnectPanel).toHaveAttribute("data-connection-status", "invalid");
  await expect(reconnectPanel).toContainText("not compatible");
  await expect(page.locator('.bd-connection-preview[data-connection-status="invalid"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".bd-connection-feedback")).toContainText("Ports are not compatible");
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  const validUpdaterBox = await updater.boundingBox();
  const validReplacementBox = await replacementTarget.boundingBox();
  expect(validUpdaterBox).not.toBeNull();
  expect(validReplacementBox).not.toBeNull();
  await page.mouse.move(validUpdaterBox!.x + validUpdaterBox!.width / 2, validUpdaterBox!.y + validUpdaterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    validReplacementBox!.x + validReplacementBox!.width / 2,
    validReplacementBox!.y + validReplacementBox!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-connection-feedback")).toContainText("Interface reconnected");
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.knowledge-lifecycle",
  );
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.session-command",
  );
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
});

test("reconnects a selected edge endpoint and discards stale manual geometry", async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const segment = edge.locator(".bd-route-segment-handle").first();
  await segment.focus();
  await page.keyboard.press(await segment.getAttribute("data-route-axis") === "h" ? "ArrowDown" : "ArrowRight");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  const updater = edge.locator(".react-flow__edgeupdater-target");
  const destination = page.locator(
    '.react-flow__node[data-id="system::rust-agent-core"] .bd-port-handle-outer.target[data-handleid="knowledge-lifecycle"]',
  );
  const updaterBox = await updater.boundingBox();
  const destinationBox = await destination.boundingBox();
  expect(updaterBox).not.toBeNull();
  expect(destinationBox).not.toBeNull();
  await page.mouse.move(updaterBox!.x + updaterBox!.width / 2, updaterBox!.y + updaterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + destinationBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await waitForEditorIdle(page);

  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await toolbarButton(page, "Save").click({ force: true });
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const connection = saved.levels[0].connections.find(
    (candidate: { id: string }) => candidate.id === "ui-session-command",
  );
  expect(connection.source).toEqual({ nodeId: "agent-ui", portId: "session-command" });
  expect(connection.target).toEqual({ nodeId: "rust-agent-core", portId: "knowledge-lifecycle" });
  expect(connection.routing).toBeUndefined();
});

test("reconnects an interface entirely by keyboard with undo, redo, focus, and saved JSON", async ({ page, browserName }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const segment = edge.locator(".bd-route-segment-handle").first();
  await segment.focus();
  await page.keyboard.press(await segment.getAttribute("data-route-axis") === "h" ? "ArrowDown" : "ArrowRight");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await page.keyboard.type("Reconnect Interface");
  const reconnectOption = palette.getByRole("option", { name: /^Reconnect Interface/ });
  await expect(reconnectOption).not.toHaveAttribute("aria-disabled");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Reconnect Interface" });
  const source = dialog.getByLabel("Source port");
  const target = dialog.getByLabel("Target port");
  const reconnect = dialog.getByRole("button", { name: "Reconnect", exact: true });
  await expect(source).toBeFocused();
  await expect(source).toHaveValue('["agent-ui","session-command"]');
  await expect(target).toHaveValue('["rust-agent-core","session-command"]');
  await expect(reconnect).toBeDisabled();
  await expect(dialog).toContainText("clears the old manual route");

  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(target).toHaveValue('["rust-agent-core","knowledge-lifecycle"]');
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reconnect).toBeFocused();
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);

  const inspector = page.getByRole("region", { name: "Properties" });
  const reconnectEndpoints = inspector.getByRole("button", { name: "Reconnect endpoints..." });
  await expect(reconnectEndpoints).toBeFocused();
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.knowledge-lifecycle",
  );

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.session-command",
  );
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.knowledge-lifecycle",
  );
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const reconnectAudit = await exhaustiveRouteAudit(page);
  expect(reconnectAudit).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  if (process.env.CAPTURE_KEYBOARD_RECONNECT === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/keyboard-reconnect.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedConnection = saved.levels[0].connections.find(
    (candidate: { id: string }) => candidate.id === "ui-session-command",
  );
  expect(savedConnection.source).toEqual({ nodeId: "agent-ui", portId: "session-command" });
  expect(savedConnection.target).toEqual({ nodeId: "rust-agent-core", portId: "knowledge-lifecycle" });
  expect(savedConnection.routing).toBeUndefined();

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await reconnectEndpoints.focus();
  await page.keyboard.press("Enter");
  const sourceDialog = page.getByRole("dialog", { name: "Reconnect Interface" });
  const replacementSource = sourceDialog.getByLabel("Source port");
  await expect(replacementSource).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(replacementSource).toHaveValue('["rust-agent-core","session-notification"]');
  await page.keyboard.press("Tab");
  await expect(sourceDialog.getByLabel("Target port")).toHaveValue('["rust-agent-core","session-command"]');
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "rust-agent-core.session-notification → rust-agent-core.session-command",
  );
  const sourceReconnectAudit = await exhaustiveRouteAudit(page);
  expect(sourceReconnectAudit).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.session-command",
  );
});

test("keeps the dense port edge editor visible, separated, and label free", async ({ page, browserName }) => {
  await toolbarButton(page, "Fit Design").click({ force: true });
  await page.waitForTimeout(350);
  const edge = page.locator('.react-flow__edge[data-id="system::core-tool-invoke"]');
  await clickReachableEdgePoint(page, edge);

  await expect(edge.locator(".bd-route-segment-handle")).not.toHaveCount(0);
  await expect(edge.locator(".react-flow__edgeupdater")).toHaveCount(2);
  await expect(edge.locator(".bd-route-bend-handle")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  const endpointHitTargets = await edge.locator(".react-flow__edgeupdater").evaluateAll((updaters) =>
    updaters.map((updater) => {
      const bounds = updater.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
      };
    }),
  );
  expect(endpointHitTargets).toHaveLength(2);
  expect(endpointHitTargets.every((endpoint) =>
    endpoint.width >= 11 && endpoint.width <= 14 &&
    endpoint.height >= 11 && endpoint.height <= 14
  )).toBe(true);
  const endpointPresentation = await edge.locator(".bd-route-endpoint-grip").evaluateAll((grips) =>
    grips.map((grip) => {
      const style = getComputedStyle(grip);
      return { fill: style.fill, stroke: style.stroke };
    }),
  );
  expect(endpointPresentation).toEqual([
    { fill: "rgb(37, 99, 217)", stroke: "rgb(255, 253, 248)" },
    { fill: "rgb(37, 99, 217)", stroke: "rgb(255, 253, 248)" },
  ]);

  if (process.env.CAPTURE_ROUTE_EDITOR === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/edge-editor.png");
    const clip = await page.evaluate(() => {
      const core = document.querySelector<HTMLElement>('.react-flow__node[data-id="system::rust-agent-core"]')
        ?.getBoundingClientRect();
      const tool = document.querySelector<HTMLElement>('.react-flow__node[data-id="system::tool-system"]')
        ?.getBoundingClientRect();
      if (!core || !tool) throw new Error("Dense edge editor nodes are missing.");
      const padding = 44;
      const x = Math.max(0, Math.min(core.left, tool.left) - padding);
      const y = Math.max(0, Math.min(core.top, tool.top) - padding);
      return {
        x,
        y,
        width: Math.min(window.innerWidth - x, Math.max(core.right, tool.right) - x + padding),
        height: Math.min(window.innerHeight - y, Math.max(core.bottom, tool.bottom) - y + padding),
      };
    });
    await page.screenshot({
      path: "docs/screenshots/edge-editor-detail.png",
      animations: "disabled",
      clip,
      timeout: 30_000,
    });
    const manualEdge = page.locator('.react-flow__edge[data-id="system::core-tool-catalog"]');
    await clickReachableEdgePoint(page, manualEdge);
    const segment = manualEdge.locator(".bd-route-segment-handle").first();
    const segmentBox = await segment.boundingBox();
    if (!segmentBox) throw new Error("Selected route segment handle is missing.");
    const pointerId = 63;
    const start = {
      x: segmentBox.x + segmentBox.width / 2,
      y: segmentBox.y + segmentBox.height / 2,
    };
    const axis = await segment.getAttribute("data-route-axis");
    const end = axis === "h"
      ? { x: start.x, y: start.y - 24 }
      : { x: start.x + 24, y: start.y };
    await segment.dispatchEvent("pointerdown", {
      pointerId,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
    });
    await page.evaluate(({ pointerId: id, end: destination }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: id,
        buttons: 1,
        clientX: destination.x,
        clientY: destination.y,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: id,
        button: 0,
        clientX: destination.x,
        clientY: destination.y,
      }));
    }, { pointerId, end });
    await waitForEditorIdle(page);
    await expect(manualEdge.locator(".bd-route-bend-handle")).not.toHaveCount(0);
    await page.screenshot({
      path: "docs/screenshots/edge-editor-manual-detail.png",
      animations: "disabled",
      clip,
      timeout: 30_000,
    });
  }
});

test("moves a selected module through the document with the keyboard", async ({ page }) => {
  const node = flowNode(page, "system::agent-ui");
  await tabTo(page, node);
  await expect(node).toBeFocused();
  await expect(node).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Agent UI");

  await page.keyboard.press("ArrowRight");
  await waitForEditorIdle(page);
  await expect(node).toBeFocused();
  await expect(page.locator(".bd-canvas-announcement")).toHaveText(
    "Moved Agent UI right. Position x 76, y 270.",
  );
  await page.keyboard.press("ArrowDown");
  await waitForEditorIdle(page);
  await expect(node).toBeFocused();
  await expect(page.locator(".bd-canvas-announcement")).toHaveText(
    "Moved Agent UI down. Position x 76, y 286.",
  );
  if (process.env.CAPTURE_KEYBOARD_MOVE === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/keyboard-module-move.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "agent-ui",
  );
  expect(savedNode.layout).toMatchObject({
    pinned: true,
    position: { x: 76, y: 286 },
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  const undoPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const undoPath = await (await undoPromise).path();
  const undone = JSON.parse(await readFile(undoPath!, "utf8"));
  expect(undone.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "agent-ui",
  ).layout.position).toEqual({ x: 76, y: 270 });

  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  const redoPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const redoPath = await (await redoPromise).path();
  const redone = JSON.parse(await readFile(redoPath!, "utf8"));
  expect(redone.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "agent-ui",
  ).layout.position).toEqual({ x: 76, y: 286 });
});

test("aligns a pointer-moved module and lets Alt bypass guides for one gesture", async ({ page, browserName }) => {
  const node = flowNode(page, "system::project");
  await node.click({ force: true });
  const viewportBeforeMove = await canvasViewportTransform(page);

  const dragBy = async (deltaX: number, disableSnap = false) => {
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.62 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (disableSnap) await page.keyboard.down("Alt");
    await page.mouse.move(start.x + deltaX, start.y, { steps: 10 });
    await page.waitForTimeout(120);
  };

  await dragBy(32);
  const centerGuide = page.locator('.bd-alignment-guide-y[data-target-id="system::knowledge"]');
  await expect(centerGuide).toBeVisible();
  await expect(centerGuide).toHaveAttribute("data-subject-anchor", "center");
  const alignedProject = await node.boundingBox();
  const alignedKnowledge = await flowNode(page, "system::knowledge").boundingBox();
  expect(alignedProject).not.toBeNull();
  expect(alignedKnowledge).not.toBeNull();
  expect(Math.abs(
    alignedProject!.y + alignedProject!.height / 2
    - alignedKnowledge!.y - alignedKnowledge!.height / 2,
  )).toBeLessThan(1);
  if (process.env.CAPTURE_ALIGNMENT_GUIDES === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/alignment-guides.png");
  }
  await page.mouse.up();
  await waitForEditorIdle(page);
  expect(await canvasViewportTransform(page)).toBe(viewportBeforeMove);
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);

  let downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  let savedPath = await (await downloadPromise).path();
  let saved = JSON.parse(await readFile(savedPath!, "utf8"));
  let savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "project",
  );
  expect(savedNode.layout.position.x).toBeGreaterThan(370);
  expect(savedNode.layout.position.x % 16).toBe(0);
  expect(savedNode.layout.position.y).toBe(650);

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await dragBy(32, true);
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await waitForEditorIdle(page);

  downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  savedPath = await (await downloadPromise).path();
  saved = JSON.parse(await readFile(savedPath!, "utf8"));
  savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "project",
  );
  expect(savedNode.layout.position.y).toBe(650);
  expect(savedNode.layout.position.x).toBeGreaterThan(370);
  expect(savedNode.layout.position.x % 16).not.toBe(0);
});

test("snaps a moved module into equal neighboring gaps and persists one atomic move", async ({ page, browserName }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "distance-guide-proof.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(distanceGuideDesignDocument())),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Equal Distance Guide Proof");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(350);

  const left = flowNode(page, "system::left");
  const subject = flowNode(page, "system::subject");
  const right = flowNode(page, "system::right");
  const localPosition = (node: Locator) => node.evaluate((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform);
    if (!match) throw new Error(`Unexpected node transform ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
  const beginDragTo = async (targetX: number, disableSnap = false) => {
    const box = await subject.boundingBox();
    expect(box).not.toBeNull();
    const original = await localPosition(subject);
    const start = { x: box!.x + box!.width * 0.54, y: box!.y + 18 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (disableSnap) await page.keyboard.down("Alt");
    await page.mouse.move(start.x + 12, start.y);
    const zoom = await canvasZoom(page);
    const nearTargetOffset = disableSnap ? 0 : 2;
    await page.mouse.move(
      start.x + 12 + (targetX - original.x) * zoom + nearTargetOffset,
      start.y,
      { steps: 10 },
    );
    await page.waitForTimeout(120);
  };
  const endDrag = async (disableSnap = false) => {
    await page.mouse.up();
    if (disableSnap) await page.keyboard.up("Alt");
    await waitForEditorIdle(page);
  };

  await beginDragTo(500);
  const horizontalDistanceGuides = page.locator(".bd-distance-guide-x");
  await expect(horizontalDistanceGuides).toHaveCount(2);
  await expect(page.locator('.bd-distance-guide-x[data-start-id="system::left"][data-end-id="system::subject"]'))
    .toHaveCount(1);
  await expect(page.locator('.bd-distance-guide-x[data-start-id="system::subject"][data-end-id="system::right"]'))
    .toHaveCount(1);
  await expect(horizontalDistanceGuides.first()).toHaveAttribute("data-distance", "244");
  await expect(horizontalDistanceGuides.last()).toHaveAttribute("data-distance", "244");
  await expect(page.locator(".bd-alignment-guide-x")).toHaveCount(0);
  expect(await localPosition(subject)).toEqual({ x: 500, y: 240 });
  const [leftBox, subjectBox, rightBox] = await Promise.all([
    left.boundingBox(),
    subject.boundingBox(),
    right.boundingBox(),
  ]);
  expect(leftBox && subjectBox && rightBox).not.toBeNull();
  expect(Math.abs(
    subjectBox!.x - leftBox!.x - leftBox!.width
    - (rightBox!.x - subjectBox!.x - subjectBox!.width),
  )).toBeLessThan(1);
  if (process.env.CAPTURE_DISTANCE_GUIDES === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/equal-distance-guides.png");
  }
  await endDrag();
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
  expect(await routeNodeCollisions(page)).toEqual([]);

  let downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  let savedPath = await (await downloadPromise).path();
  let saved = JSON.parse(await readFile(savedPath!, "utf8"));
  let savedNode = saved.levels[0].nodes.find((candidate: { id: string }) => candidate.id === "subject");
  expect(savedNode.layout.position).toEqual({ x: 500, y: 240 });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  expect(await localPosition(subject)).toEqual({ x: 320, y: 240 });

  await beginDragTo(504, true);
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
  await endDrag(true);
  const bypassedPosition = await localPosition(subject);
  expect(Math.abs(bypassedPosition.x - 504)).toBeLessThan(2);
  expect(bypassedPosition.x % 16).not.toBe(0);
  downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  savedPath = await (await downloadPromise).path();
  saved = JSON.parse(await readFile(savedPath!, "utf8"));
  savedNode = saved.levels[0].nodes.find((candidate: { id: string }) => candidate.id === "subject");
  expect(Math.abs(savedNode.layout.position.x - 504)).toBeLessThan(2);
  expect(savedNode.layout.position.x % 16).not.toBe(0);
});

test("snaps a differently sized selected group by one equal-distance boundary", async ({ page, browserName }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "group-distance-guide-proof.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(groupDistanceGuideDesignDocument())),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Group Equal Distance Guide Proof");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(350);

  const left = flowNode(page, "system::left");
  const groupA = flowNode(page, "system::group-a");
  const groupB = flowNode(page, "system::group-b");
  const right = flowNode(page, "system::right");
  const groupIds = ["system::group-a", "system::group-b"];
  const localPositions = () => page.locator(
    groupIds.map((id) => `.react-flow__node[data-id="${id}"]`).join(", "),
  ).evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform);
    if (!match) throw new Error(`Unexpected node transform ${transform}`);
    return [element.getAttribute("data-id"), { x: Number(match[1]), y: Number(match[2]) }];
  })) as Record<string, { x: number; y: number }>);
  const selectGroup = async () => {
    await groupA.click({ force: true });
    await groupB.click({ force: true, modifiers: ["Shift"] });
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  };
  const beginGroupDragTo = async (grabbed: Locator, targetGroupX: number, disableSnap = false) => {
    await selectGroup();
    const box = await grabbed.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + Math.min(72, box!.width * 0.38), y: box!.y + 18 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (disableSnap) await page.keyboard.down("Alt");
    await page.mouse.move(start.x + 12, start.y);
    const zoom = await canvasZoom(page);
    const nearTargetOffset = disableSnap ? 0 : 2;
    await page.mouse.move(
      start.x + 12 + (targetGroupX - 320) * zoom + nearTargetOffset,
      start.y,
      { steps: 10 },
    );
    await page.waitForTimeout(120);
  };
  const endGroupDrag = async (disableSnap = false) => {
    await page.mouse.up();
    if (disableSnap) await page.keyboard.up("Alt");
    await waitForEditorIdle(page);
  };
  const expectedSelectionId = "selection:system::group-a|system::group-b";
  const baseline = await localPositions();

  await beginGroupDragTo(groupA, 544);
  const horizontalDistanceGuides = page.locator(".bd-distance-guide-x");
  await expect(horizontalDistanceGuides).toHaveCount(2);
  await expect(page.locator(
    `.bd-distance-guide-x[data-start-id="system::left"][data-end-id="${expectedSelectionId}"]`,
  )).toHaveCount(1);
  await expect(page.locator(
    `.bd-distance-guide-x[data-start-id="${expectedSelectionId}"][data-end-id="system::right"]`,
  )).toHaveCount(1);
  await expect(horizontalDistanceGuides.first()).toHaveAttribute("data-distance", "288");
  await expect(horizontalDistanceGuides.last()).toHaveAttribute("data-distance", "288");
  await expect(page.locator(".bd-alignment-guide-x")).toHaveCount(0);
  const snapped = await localPositions();
  expect(snapped["system::group-a"]).toEqual({ x: 544, y: 160 });
  expect(snapped["system::group-b"]).toEqual({ x: 576, y: 400 });
  const [leftBox, groupABox, groupBBox, rightBox] = await Promise.all([
    left.boundingBox(), groupA.boundingBox(), groupB.boundingBox(), right.boundingBox(),
  ]);
  expect(leftBox && groupABox && groupBBox && rightBox).not.toBeNull();
  const groupLeft = Math.min(groupABox!.x, groupBBox!.x);
  const groupRight = Math.max(
    groupABox!.x + groupABox!.width,
    groupBBox!.x + groupBBox!.width,
  );
  expect(Math.abs(
    groupLeft - leftBox!.x - leftBox!.width
    - (rightBox!.x - groupRight),
  )).toBeLessThan(1);
  if (process.env.CAPTURE_DISTANCE_GUIDES === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/equal-distance-group.png");
  }
  await endGroupDrag();
  expect(await routeNodeCollisions(page)).toEqual([]);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(Object.fromEntries(saved.levels[0].nodes
    .filter((candidate: { id: string }) => ["group-a", "group-b"].includes(candidate.id))
    .map((candidate: { id: string; layout: { position: { x: number; y: number } } }) => [
      candidate.id,
      candidate.layout.position,
    ]))).toEqual({
    "group-a": { x: 544, y: 160 },
    "group-b": { x: 576, y: 400 },
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  expect(await localPositions()).toEqual(baseline);
  await beginGroupDragTo(groupB, 544);
  await expect(horizontalDistanceGuides).toHaveCount(2);
  expect(await localPositions()).toEqual(snapped);
  await endGroupDrag();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  expect(await localPositions()).toEqual(baseline);

  await beginGroupDragTo(groupA, 548, true);
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
  await endGroupDrag(true);
  const bypassed = await localPositions();
  expect(Math.abs(bypassed["system::group-a"].x - 548)).toBeLessThan(2);
  expect(bypassed["system::group-a"].x % 16).not.toBe(0);
  expect(bypassed["system::group-b"].x - bypassed["system::group-a"].x).toBe(32);
});

test("snaps a selected group by its full boundary regardless of the grabbed member", async ({ page, browserName }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "group-alignment-proof.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(groupAlignmentDesignDocument())),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Group Alignment Proof");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(350);

  const groupA = flowNode(page, "system::group-a");
  const groupB = flowNode(page, "system::group-b");
  const targetNode = flowNode(page, "system::target");
  const groupIds = ["system::group-a", "system::group-b"];
  const localPositions = () => page.locator(
    groupIds.map((id) => `.react-flow__node[data-id="${id}"]`).join(", "),
  ).evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform);
    if (!match) throw new Error(`Unexpected node transform ${transform}`);
    return [element.getAttribute("data-id"), { x: Number(match[1]), y: Number(match[2]) }];
  })) as Record<string, { x: number; y: number }>);
  const selectGroup = async () => {
    await groupA.click({ force: true });
    await groupB.click({ force: true, modifiers: ["Shift"] });
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  };
  const beginGroupDrag = async (
    grabbed: typeof groupA,
    mode: "snap" | "bypass" | "clone" = "snap",
  ) => {
    await selectGroup();
    const box = await grabbed.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + Math.min(72, box!.width * 0.38), y: box!.y + 18 };
    await page.mouse.move(start.x, start.y);
    if (mode === "clone") await page.keyboard.down("Control");
    await page.mouse.down();
    if (mode === "bypass") await page.keyboard.down("Alt");
    const activatedPointerX = start.x + 12;
    await page.mouse.move(activatedPointerX, start.y);
    // Pointerdown first freezes any in-flight Fit navigation. Measure the
    // canonical viewport only after drag activation so the test does not turn
    // an asynchronous animation sample into a geometry fact.
    const groupABox = await groupA.boundingBox();
    const groupBBox = await groupB.boundingBox();
    const targetBox = await targetNode.boundingBox();
    expect(groupABox && groupBBox && targetBox).not.toBeNull();
    const zoom = await canvasZoom(page);
    const groupRight = Math.max(
      groupABox!.x + groupABox!.width,
      groupBBox!.x + groupBBox!.width,
    );
    const screenDelta = targetBox!.x - groupRight - 4 * zoom;
    await page.mouse.move(activatedPointerX + screenDelta, start.y);
    await page.waitForTimeout(120);
  };
  const endGroupDrag = async (mode: "snap" | "bypass" | "clone" = "snap") => {
    await page.mouse.up();
    if (mode === "bypass") await page.keyboard.up("Alt");
    if (mode === "clone") await page.keyboard.up("Control");
    await waitForEditorIdle(page);
  };
  const guide = page.locator('.bd-alignment-guide-x[data-target-id="system::target"]');
  const baseline = await localPositions();

  await beginGroupDrag(groupA);
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute("data-subject-anchor", "end");
  await expect(guide).toHaveAttribute("data-target-anchor", "start");
  expect(await guide.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left))).toBe(1124);
  const fromCompact = await localPositions();
  expect(fromCompact["system::group-a"]).toEqual({ x: 612, y: 64 });
  expect(fromCompact["system::group-b"]).toEqual({ x: 868, y: 288 });
  if (process.env.CAPTURE_GROUP_ALIGNMENT === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/group-boundary-alignment.png");
  }
  await endGroupDrag();
  expect(await routeNodeCollisions(page)).toEqual([]);
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  expect(await localPositions()).toEqual(baseline);

  await beginGroupDrag(groupB);
  await expect(guide).toBeVisible();
  expect(await localPositions()).toEqual(fromCompact);
  await endGroupDrag();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  expect(await localPositions()).toEqual(baseline);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  expect(await localPositions()).toEqual(fromCompact);
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);

  await beginGroupDrag(groupA, "bypass");
  await expect(guide).toHaveCount(0);
  await endGroupDrag("bypass");
  const bypassed = await localPositions();
  expect(bypassed["system::group-a"]).toEqual({ x: 608, y: 64 });
  expect(bypassed["system::group-b"]).toEqual({ x: 864, y: 288 });
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);

  await beginGroupDrag(groupB, "clone");
  await expect(guide).toBeVisible();
  await endGroupDrag("clone");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await expect(page.locator(".bd-command-notice")).toContainText("Cloned 2 modules at the dragged position.");
  expect(await routeNodeCollisions(page)).toEqual([]);
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("resizes a differently sized module selection as one atomic group", async ({ page, browserName }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "group-resize-proof.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(groupAlignmentDesignDocument())),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Group Alignment Proof");
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(350);

  const compact = flowNode(page, "system::group-a");
  const expanded = flowNode(page, "system::group-b");
  await compact.click({ force: true });
  await expanded.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const resizer = page.locator(".bd-selection-resizer");
  await expect(resizer).toBeVisible();
  await expect(resizer.locator(".bd-selection-resize-handle")).toHaveCount(8);
  await expect(page.locator(".bd-node-resize-handle")).toHaveCount(0);

  const before = await Promise.all([resizer.boundingBox(), compact.boundingBox(), expanded.boundingBox()]);
  expect(before.every(Boolean)).toBe(true);
  const originalRatio = before[0]!.width / before[0]!.height;
  const corner = resizer.locator(".bd-selection-resize-handle.bottom.right");
  const cornerBox = await corner.boundingBox();
  expect(cornerBox).not.toBeNull();
  const start = {
    x: cornerBox!.x + cornerBox!.width / 2,
    y: cornerBox!.y + cornerBox!.height / 2,
  };
  expect(await page.evaluate(({ x, y }) => Boolean(
    document.elementFromPoint(x, y)?.closest(".bd-selection-resize-handle.bottom.right"),
  ), start)).toBe(true);
  await dragSelectionResizeHandle(page, corner, { x: 160, y: 56 }, { shift: true });
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);

  const enlarged = await Promise.all([resizer.boundingBox(), compact.boundingBox(), expanded.boundingBox()]);
  expect(enlarged.every(Boolean)).toBe(true);
  expect(enlarged[0]!.width).toBeGreaterThan(before[0]!.width + 120);
  expect(enlarged[0]!.width / enlarged[0]!.height).toBeCloseTo(originalRatio, 2);
  expect(enlarged[1]!.width).toBeGreaterThan(before[1]!.width);
  expect(enlarged[1]!.height).toBeGreaterThan(before[1]!.height);
  expect(enlarged[2]!.width).toBeGreaterThan(before[2]!.width);
  expect(enlarged[2]!.height).toBeGreaterThan(before[2]!.height);
  expect(await routeNodeCollisions(page)).toEqual([]);
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 2,
    auditedPairCount: 1,
    expectedPairCount: 1,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  const restored = await Promise.all([resizer.boundingBox(), compact.boundingBox(), expanded.boundingBox()]);
  expect(restored.every(Boolean)).toBe(true);
  restored.forEach((box, index) => {
    expect(box!.x).toBeCloseTo(before[index]!.x, 0);
    expect(box!.y).toBeCloseTo(before[index]!.y, 0);
    expect(box!.width).toBeCloseTo(before[index]!.width, 0);
    expect(box!.height).toBeCloseTo(before[index]!.height, 0);
  });
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  const redone = await Promise.all([compact.boundingBox(), expanded.boundingBox()]);
  expect(redone[0]!.width).toBeCloseTo(enlarged[1]!.width, 0);
  expect(redone[1]!.width).toBeCloseTo(enlarged[2]!.width, 0);
  if (process.env.CAPTURE_GROUP_RESIZE === "1" && browserName === "chromium") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(450);
    await captureStudioScreenshot(page, "docs/screenshots/group-resize.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedLevel = saved.levels.find((level: { id: string }) => level.id === "system");
  const savedNodes = Object.fromEntries(savedLevel.nodes
    .filter((node: { id: string }) => ["group-a", "group-b"].includes(node.id))
    .map((node: { id: string; layout: unknown }) => [node.id, node.layout]));
  expect(savedNodes).toMatchObject({
    "group-a": { pinned: true },
    "group-b": { pinned: true },
  });
  const savedCompact = savedLevel.nodes.find((node: { id: string }) => node.id === "group-a");
  const savedExpanded = savedLevel.nodes.find((node: { id: string }) => node.id === "group-b");
  expect(savedCompact.layout.width).toBeGreaterThan(192);
  expect(savedExpanded.layout.width).toBeGreaterThan(256);

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(page.locator(".bd-document-title span")).toHaveText("Group Alignment Proof");
  await waitForEditorIdle(page);
  expect(await flowNode(page, "system::group-a").evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.width),
  )).toBe(savedCompact.layout.width);
  expect(await flowNode(page, "system::group-b").evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.width),
  )).toBe(savedExpanded.layout.width);
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 2,
    auditedPairCount: 1,
    expectedPairCount: 1,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
});

test("aligns and distributes same-level modules as atomic arrangement commands", async ({ page, browserName }) => {
  const ids = ["agent-ui", "rust-agent-core", "tool-system"];
  const nodes = ids.map((id) => flowNode(page, `system::${id}`));
  await nodes[0].click({ force: true });
  await nodes[1].click({ force: true, modifiers: ["ControlOrMeta"] });
  await nodes[2].click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("3 objects selected");
  await page.waitForTimeout(350);

  const before = await Promise.all(nodes.map((node) => node.boundingBox()));
  expect(before.every(Boolean)).toBe(true);
  const viewportBefore = await canvasViewportTransform(page);
  if (process.env.CAPTURE_ARRANGEMENT === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/arrangement-before.png");
  }

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await search.fill("align top");
  const alignTop = palette.getByRole("option", { name: /^Align Top/ });
  await expect(alignTop).toHaveAttribute("aria-selected", "true");
  await expect(alignTop).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);

  const aligned = await Promise.all(nodes.map((node) => node.boundingBox()));
  expect(aligned.every(Boolean)).toBe(true);
  expect(Math.max(...aligned.map((box) => box!.y)) - Math.min(...aligned.map((box) => box!.y)))
    .toBeLessThan(1);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  if (process.env.CAPTURE_ARRANGEMENT === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/arrangement-after.png");
  }

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect.poll(async () => {
    const restored = await Promise.all(nodes.map((node) => node.boundingBox()));
    return restored.map((box) => box && [Math.round(box.x), Math.round(box.y)]);
  }).toEqual(before.map((box) => [Math.round(box!.x), Math.round(box!.y)]));
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);

  const distributedIds = ["project", "knowledge", "plugin", "platform-provider"];
  const distributedNodes = distributedIds.map((id) => flowNode(page, `system::${id}`));
  await distributedNodes[0].click({ force: true });
  for (const node of distributedNodes.slice(1)) {
    await node.click({ force: true, modifiers: ["ControlOrMeta"] });
  }
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("4 objects selected");
  await runMenuCommand(page, "Arrange", "Distribute Horizontally");
  await waitForEditorIdle(page);

  const distributed = await Promise.all(distributedNodes.map((node) => node.boundingBox()));
  expect(distributed.every(Boolean)).toBe(true);
  const centers = distributed.map((box) => box!.x + box!.width / 2).sort((left, right) => left - right);
  expect(Math.abs((centers[1] - centers[0]) - (centers[2] - centers[1]))).toBeLessThan(1);
  expect(Math.abs((centers[2] - centers[1]) - (centers[3] - centers[2]))).toBeLessThan(1);
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedLevel = saved.levels.find((level: { id: string }) => level.id === "system");
  for (const id of [...ids, ...distributedIds]) {
    const savedNode = savedLevel.nodes.find((node: { id: string }) => node.id === id);
    expect(savedNode.layout.pinned).toBe(true);
    expect(Number.isInteger(savedNode.layout.position.x)).toBe(true);
    expect(Number.isInteger(savedNode.layout.position.y)).toBe(true);
  }
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
});

test("explains arrangement eligibility at selection and hierarchy boundaries", async ({ page }) => {
  const agent = flowNode(page, "system::agent-ui");
  const core = flowNode(page, "system::rust-agent-core");
  await agent.click({ force: true });
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  let arrangeMenu = page.getByRole("menu", { name: "Arrange" });
  let alignLeft = arrangeMenu.getByRole("menuitem", { name: /^Align Left/ });
  await expect(alignLeft).toHaveAttribute("aria-disabled", "true");
  await expect(alignLeft).toContainText("Select at least two modules first.");
  await page.keyboard.press("Escape");

  await core.click({ force: true, modifiers: ["ControlOrMeta"] });
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  arrangeMenu = page.getByRole("menu", { name: "Arrange" });
  alignLeft = arrangeMenu.getByRole("menuitem", { name: /^Align Left/ });
  const distribute = arrangeMenu.getByRole("menuitem", { name: /^Distribute Horizontally/ });
  await expect(alignLeft).not.toHaveAttribute("aria-disabled", "true");
  await expect(distribute).toHaveAttribute("aria-disabled", "true");
  await expect(distribute).toContainText("Select at least three modules to distribute.");
  await page.keyboard.press("Escape");

  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await page.keyboard.down("Shift");
  await clickReachableEdgePoint(page, edge);
  await page.keyboard.up("Shift");
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("3 objects selected");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  arrangeMenu = page.getByRole("menu", { name: "Arrange" });
  alignLeft = arrangeMenu.getByRole("menuitem", { name: /^Align Left/ });
  await expect(alignLeft).toHaveAttribute("aria-disabled", "true");
  await expect(alignLeft).toContainText("Select modules only; interfaces cannot be arranged.");
  await page.keyboard.press("Escape");

  await expandHierarchy(page, "Rust Agent Core");
  const child = flowNode(page, "system/rust-agent-core:core::session-api");
  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="rust-agent-core"]',
  ).click({ force: true });
  await child.click({ force: true, modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  arrangeMenu = page.getByRole("menu", { name: "Arrange" });
  alignLeft = arrangeMenu.getByRole("menuitem", { name: /^Align Left/ });
  await expect(alignLeft).toHaveAttribute("aria-disabled", "true");
  await expect(alignLeft).toContainText("Select modules from the same design level.");
  await page.keyboard.press("Escape");

  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="agent-ui"]',
  ).click({ force: true });
  await page.locator(
    '.bd-tree-select[data-level-id="system"][data-node-id="rust-agent-core"]',
  ).click({ force: true, modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  arrangeMenu = page.getByRole("menu", { name: "Arrange" });
  alignLeft = arrangeMenu.getByRole("menuitem", { name: /^Align Left/ });
  await expect(alignLeft).toHaveAttribute("aria-disabled", "true");
  await expect(alignLeft).toContainText("Collapse expanded hierarchy and use authored placement");
});

test("copies, pastes, and duplicates a connected hierarchy as atomic collision-free subgraphs", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const agentUi = flowNode(page, "system::agent-ui");
  const agentCore = flowNode(page, "system::rust-agent-core");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => { throw new DOMException("Denied by test host", "NotAllowedError"); },
      },
    });
  });
  await agentUi.click({ force: true });
  await agentCore.click({ force: true, modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editMenu = page.getByRole("menu", { name: "Edit" });
  const copy = editMenu.getByRole("menuitem", { name: /^Copy/ });
  await expect(copy).not.toHaveAttribute("aria-disabled", "true");
  await expect(editMenu.getByRole("menuitem", { name: /^Paste/ })).toBeVisible();
  await expect(editMenu.getByRole("menuitem", { name: /^Duplicate/ })).toBeVisible();
  await expect(editMenu.getByRole("menuitem", { name: /^Cut/ })).toBeVisible();
  await copy.click();
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Copied 2 modules and 2 internal interfaces inside this workspace. System clipboard access is unavailable.",
  );

  await page.keyboard.press("ControlOrMeta+V");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);
  await expect(flowNode(page, "system::agent-ui-2")).toHaveClass(/selected/);
  await expect(flowNode(page, "system::rust-agent-core-2")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText("Pasted 2 modules into System Overview");
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  const pastedAudit = await exhaustiveRouteAudit(page);
  expect(pastedAudit).toMatchObject({
    auditedRouteCount: 12,
    auditedPairCount: 66,
    expectedPairCount: 66,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_FRAGMENT_PROOF === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/copy-paste-subgraph.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const system = saved.levels.find((level: { id: string }) => level.id === "system");
  expect(system.nodes).toHaveLength(9);
  expect(system.connections).toHaveLength(12);
  expect(saved.levels.find((level: { id: string }) => level.id === "core-2")).toBeDefined();
  expect(system.nodes.find((node: { id: string }) => node.id === "rust-agent-core-2").hierarchy.childLevelId)
    .toBe("core-2");

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);

  await flowNode(page, "system::agent-ui-2").click({ force: true });
  await flowNode(page, "system::rust-agent-core-2").click({ force: true, modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await search.fill("duplicate");
  const duplicate = palette.getByRole("option", { name: /^Duplicate/ });
  await expect(duplicate).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await expect(page.locator(".react-flow__edge")).toHaveCount(14);
  await expect(flowNode(page, "system::agent-ui-3")).toHaveClass(/selected/);
  await expect(flowNode(page, "system::rust-agent-core-3")).toHaveClass(/selected/);
  expect(await routeNodeCollisions(page)).toEqual([]);
});

test("cuts a complete hierarchy once and pastes it into another design from the internal clipboard", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => { throw new DOMException("Denied by test host", "NotAllowedError"); },
      },
    });
  });
  await flowNode(page, "system::agent-ui").click({ force: true });
  await flowNode(page, "system::rust-agent-core").click({ force: true, modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+X");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Cut 2 modules and 2 internal interfaces inside this workspace. System clipboard access is unavailable.",
  );
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 2,
    auditedPairCount: 1,
    expectedPairCount: 1,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  await openDesignDialog(page);
  page.once("dialog", async (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles(legacyPath);
  await expect(page.locator(".bd-document-title span")).toHaveText("Legacy v2 Design");
  await waitForLayout(page);
  await page.keyboard.press("ControlOrMeta+V");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await expect(page.locator(".bd-command-notice")).toContainText("Pasted 2 modules into System");
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 3,
    auditedPairCount: 3,
    expectedPairCount: 3,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_CUT_PROOF === "1" && browserName === "chromium") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/cut-paste-subgraph.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.schemaVersion).toBe("2.2");
  expect(saved.levels.find((level: { id: string }) => level.id === "system").nodes).toHaveLength(4);
  expect(saved.levels.find((level: { id: string }) => level.id === "system").connections).toHaveLength(3);
  expect(saved.levels.find((level: { id: string }) => level.id === "core")).toBeDefined();

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await waitForLayout(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
});

test("clones a selected connected hierarchy at the Ctrl-drag target as one atomic edit", async ({ page, browserName }) => {
  const agent = flowNode(page, "system::agent-ui");
  const core = flowNode(page, "system::rust-agent-core");
  await agent.click({ force: true });
  await core.click({ force: true, modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const originalAgent = await agent.boundingBox();
  expect(originalAgent).not.toBeNull();
  const start = {
    x: originalAgent!.x + originalAgent!.width / 2,
    y: originalAgent!.y + originalAgent!.height * 0.62,
  };

  await page.keyboard.down("Control");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 420, { steps: 14 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await waitForEditorIdle(page);

  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);
  const clonedAgent = flowNode(page, "system::agent-ui-2");
  const clonedCore = flowNode(page, "system::rust-agent-core-2");
  await expect(clonedAgent).toHaveClass(/selected/);
  await expect(clonedCore).toHaveClass(/selected/);
  const inspector = page.getByRole("region", { name: "Properties" });
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["2", "0", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText("Cloned 2 modules at the dragged position.");
  expect(await routeNodeCollisions(page)).toEqual([]);
  if (process.env.CAPTURE_CTRL_DRAG_CLONE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/ctrl-drag-clone.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const system = saved.levels.find((level: { id: string }) => level.id === "system");
  expect(system.nodes).toHaveLength(9);
  expect(system.connections).toHaveLength(12);
  expect(saved.levels.find((level: { id: string }) => level.id === "core-2")).toBeDefined();
  expect(system.nodes.find((node: { id: string }) => node.id === "rust-agent-core-2").hierarchy.childLevelId)
    .toBe("core-2");

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await expect(agent).toBeVisible();
  await expect(core).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);
  await expect(clonedAgent).toBeVisible();
  await expect(clonedCore).toBeVisible();
});

test("box-selects, toggles, and moves modules as one professional selection", async ({ page, browserName }) => {
  const project = flowNode(page, "system::project");
  const knowledge = flowNode(page, "system::knowledge");
  const inspector = page.getByRole("region", { name: "Properties" });
  await project.click({ force: true });
  await knowledge.click({ force: true, modifiers: ["Shift"] });

  await expect(project).toHaveClass(/selected/);
  await expect(knowledge).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["2", "0", "1"]);
  await expect(page.locator(".bd-tree-row.is-selected")).toHaveCount(2);
  await expect(page.locator(".bd-node-resize-handle")).toHaveCount(0);
  await expect(toolbarButton(page, "Delete Selection")).toBeEnabled();

  const projectBefore = await project.boundingBox();
  const knowledgeBefore = await knowledge.boundingBox();
  expect(projectBefore).not.toBeNull();
  expect(knowledgeBefore).not.toBeNull();
  const viewportBefore = await canvasViewportTransform(page);
  const dragStart = {
    x: projectBefore!.x + projectBefore!.width / 2,
    y: projectBefore!.y + projectBefore!.height * 0.62,
  };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 48, dragStart.y + 32, { steps: 10 });
  await page.mouse.up();
  await waitForEditorIdle(page);
  const projectMoved = await project.boundingBox();
  const knowledgeMoved = await knowledge.boundingBox();
  expect(projectMoved).not.toBeNull();
  expect(knowledgeMoved).not.toBeNull();
  expect(projectMoved!.x - projectBefore!.x).toBeCloseTo(knowledgeMoved!.x - knowledgeBefore!.x, 0);
  expect(projectMoved!.y - projectBefore!.y).toBeCloseTo(knowledgeMoved!.y - knowledgeBefore!.y, 0);
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect.poll(async () => {
    const [projectBox, knowledgeBox] = await Promise.all([project.boundingBox(), knowledge.boundingBox()]);
    return projectBox && knowledgeBox
      ? [Math.round(projectBox.x), Math.round(projectBox.y), Math.round(knowledgeBox.x), Math.round(knowledgeBox.y)]
      : null;
  }).toEqual([
    Math.round(projectBefore!.x),
    Math.round(projectBefore!.y),
    Math.round(knowledgeBefore!.x),
    Math.round(knowledgeBefore!.y),
  ]);

  await project.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(project).not.toHaveClass(/selected/);
  await expect(knowledge).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Knowledge");

  await knowledge.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("System Overview");

  const [projectBox, knowledgeBox] = await Promise.all([project.boundingBox(), knowledge.boundingBox()]);
  expect(projectBox).not.toBeNull();
  expect(knowledgeBox).not.toBeNull();
  const start = {
    x: Math.min(projectBox!.x, knowledgeBox!.x) - 12,
    y: Math.min(projectBox!.y, knowledgeBox!.y) - 12,
  };
  const end = {
    x: Math.max(projectBox!.x + projectBox!.width, knowledgeBox!.x + knowledgeBox!.width) + 12,
    y: Math.max(projectBox!.y + projectBox!.height, knowledgeBox!.y + knowledgeBox!.height) + 12,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  if (process.env.CAPTURE_MULTI_SELECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/box-multi-selection.png");
  }
  await page.mouse.up();
  await expect(project).toHaveClass(/selected/);
  await expect(knowledge).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText(/objects selected/);
  if (process.env.CAPTURE_MULTI_SELECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/multi-selection.png");
  }

  await page.locator(".bd-tree-level-row").filter({ hasText: "System Overview" }).click({ force: true });
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  const edgeRoute = edge.locator(".bd-interface-route");
  const [edgeBox, sourceBox, targetBox] = await Promise.all([
    edgeRoute.boundingBox(),
    flowNode(page, "system::agent-ui").boundingBox(),
    flowNode(page, "system::rust-agent-core").boundingBox(),
  ]);
  expect(edgeBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const edgeSelectionStart = {
    x: edgeBox!.x - 8,
    y: Math.min(sourceBox!.y, targetBox!.y) - 10,
  };
  await page.mouse.move(edgeSelectionStart.x, edgeSelectionStart.y);
  await page.mouse.down();
  await page.mouse.move(edgeBox!.x + edgeBox!.width + 8, edgeBox!.y + edgeBox!.height + 10, { steps: 8 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.mouse.up();
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
});

test("forces an intersecting module and route selection box with Alt", async ({ page, browserName }) => {
  const project = flowNode(page, "system::project");
  const knowledge = flowNode(page, "system::knowledge");
  const inspector = page.getByRole("region", { name: "Properties" });
  const [projectBounds, knowledgeBounds] = await Promise.all([project.boundingBox(), knowledge.boundingBox()]);
  expect(projectBounds).not.toBeNull();
  expect(knowledgeBounds).not.toBeNull();

  const projectPartialStart = {
    x: projectBounds!.x - 12,
    y: projectBounds!.y + projectBounds!.height * 0.3,
  };
  const projectPartialEnd = {
    x: projectBounds!.x + 28,
    y: projectBounds!.y + projectBounds!.height * 0.7,
  };
  await page.mouse.move(projectPartialStart.x, projectPartialStart.y);
  await page.mouse.down();
  await page.mouse.move(projectPartialEnd.x, projectPartialEnd.y, { steps: 6 });
  await page.mouse.up();
  await expect(project).not.toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("System Overview");

  await page.keyboard.down("Alt");
  await page.mouse.move(
    projectBounds!.x + projectBounds!.width / 2,
    projectBounds!.y + projectBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    knowledgeBounds!.x + knowledgeBounds!.width / 2,
    knowledgeBounds!.y + knowledgeBounds!.height / 2 + 24,
    { steps: 8 },
  );
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(project).toHaveClass(/selected/);
  await expect(knowledge).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  const [projectAfterForcedBox, knowledgeAfterForcedBox] = await Promise.all([
    project.boundingBox(),
    knowledge.boundingBox(),
  ]);
  expect(projectAfterForcedBox).not.toBeNull();
  expect(knowledgeAfterForcedBox).not.toBeNull();
  expect(projectAfterForcedBox!.x).toBeCloseTo(projectBounds!.x, 4);
  expect(projectAfterForcedBox!.y).toBeCloseTo(projectBounds!.y, 4);
  expect(knowledgeAfterForcedBox!.x).toBeCloseTo(knowledgeBounds!.x, 4);
  expect(knowledgeAfterForcedBox!.y).toBeCloseTo(knowledgeBounds!.y, 4);
  if (process.env.CAPTURE_INTERSECTING_SELECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/intersecting-selection.png");
  }

  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.mouse.move(projectPartialStart.x, projectPartialStart.y);
  await page.mouse.down();
  await page.mouse.move(projectPartialEnd.x, projectPartialEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await expect(project).not.toHaveClass(/selected/);
  await expect(knowledge).toHaveClass(/selected/);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Knowledge");

  await page.keyboard.press("ControlOrMeta+Shift+A");
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  const segment = await edge.locator("[data-route-points]").evaluate((group) => {
    const points = JSON.parse((group as SVGGElement).dataset.routePoints ?? "[]") as Array<{ x: number; y: number }>;
    const matrix = (group as SVGGElement).getScreenCTM();
    if (!matrix || points.length < 2) return undefined;
    const candidates = points.slice(1).map((point, index) => ({
      start: points[index],
      end: point,
      length: Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y),
    })).sort((left, right) => right.length - left.length);
    const longest = candidates[0];
    const midpoint = new DOMPoint(
      (longest.start.x + longest.end.x) / 2,
      (longest.start.y + longest.end.y) / 2,
    ).matrixTransform(matrix);
    return { x: midpoint.x, y: midpoint.y };
  });
  expect(segment).toBeDefined();
  const routeBox = {
    start: { x: segment!.x - 14, y: segment!.y - 10 },
    end: { x: segment!.x + 14, y: segment!.y + 10 },
  };
  await page.mouse.move(routeBox.start.x, routeBox.start.y);
  await page.mouse.down();
  await page.mouse.move(routeBox.end.x, routeBox.end.y, { steps: 5 });
  await page.mouse.up();
  await expect(edge).not.toHaveClass(/selected/);

  await page.keyboard.down("Alt");
  await page.mouse.move(routeBox.start.x, routeBox.start.y);
  await page.mouse.down();
  await page.mouse.move(routeBox.end.x, routeBox.end.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
});

test("cycles through overlapping diagram objects with Alt-click without storing a second cursor", async ({ page, browserName }) => {
  const document = JSON.parse(await readFile(examplePath, "utf8"));
  const system = document.levels.find((level: { id: string }) => level.id === "system");
  const projectDocumentNode = system.nodes.find((node: { id: string }) => node.id === "project");
  const knowledgeDocumentNode = system.nodes.find((node: { id: string }) => node.id === "knowledge");
  const overlapBack = {
    ...projectDocumentNode,
    id: "overlap-back",
    title: "Overlap Back",
    owner: "Selection Test",
    summary: "Lower object in a deliberate visual overlap",
    ports: [],
    layout: {
      ...projectDocumentNode.layout,
      position: { x: 470, y: 850 },
    },
  };
  const overlapFront = {
    ...knowledgeDocumentNode,
    id: "overlap-front",
    title: "Overlap Front",
    owner: "Selection Test",
    summary: "Upper object in a deliberate visual overlap",
    ports: [],
    layout: {
      ...knowledgeDocumentNode.layout,
      position: { x: 518, y: 882 },
    },
  };
  system.nodes.push(overlapBack, overlapFront);

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "overlapping-selection.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("AIO Agent Runtime");
  await waitForLayout(page);
  const back = flowNode(page, "system::overlap-back");
  const front = flowNode(page, "system::overlap-front");
  const [backBounds, frontBounds] = await Promise.all([
    back.boundingBox(),
    front.boundingBox(),
  ]);
  expect(backBounds).not.toBeNull();
  expect(frontBounds).not.toBeNull();
  const overlapLeft = Math.max(backBounds!.x, frontBounds!.x);
  const overlapRight = Math.min(backBounds!.x + backBounds!.width, frontBounds!.x + frontBounds!.width);
  const overlapTop = Math.max(backBounds!.y, frontBounds!.y);
  const overlapBottom = Math.min(backBounds!.y + backBounds!.height, frontBounds!.y + frontBounds!.height);
  expect(overlapRight - overlapLeft).toBeGreaterThan(backBounds!.width * 0.5);
  expect(overlapBottom - overlapTop).toBeGreaterThan(backBounds!.height * 0.5);
  const overlapPoint = {
    x: (overlapLeft + overlapRight) / 2,
    y: (overlapTop + overlapBottom) / 2,
  };

  await page.keyboard.press("ControlOrMeta+Shift+A");
  await altClickCanvasPoint(page, overlapPoint);
  await expect(front).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Overlap Front");

  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Title", { exact: true }).fill("Overlap Front draft");
  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedCycle = altClickCanvasPoint(page, overlapPoint);
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedCycle;
  await expect(front).toHaveClass(/selected/);
  await expect(back).not.toHaveClass(/selected/);
  await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue("Overlap Front draft");
  await inspector.getByLabel("Title", { exact: true }).fill("Overlap Front");

  await altClickCanvasPoint(page, overlapPoint);
  await expect(back).toHaveClass(/selected/);
  await expect(front).not.toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Overlap Back");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText(
    "Selected object 2 of 2 under the pointer.",
  );
  if (process.env.CAPTURE_ALT_CLICK_CYCLE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/alt-click-cycle.png");
  }

  await altClickCanvasPoint(page, overlapPoint);
  await expect(front).toHaveClass(/selected/);
  await expect(back).not.toHaveClass(/selected/);
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.mouse.click(overlapPoint.x, overlapPoint.y);
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("System Overview");
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("traverses diagram objects and preserves native form focus with Canvas Tab shortcuts", async ({ page, browserName }) => {
  const canvas = page.getByRole("application", { name: "Architecture diagram canvas" });
  const agent = flowNode(page, "system::agent-ui");
  const core = flowNode(page, "system::rust-agent-core");
  const lastEdge = page.locator('.react-flow__edge[data-id="system::platform-tool-registration"]');
  const inspector = page.getByRole("region", { name: "Properties" });

  await canvas.focus();
  await expect(canvas).toBeFocused();
  await expect(canvas).toHaveAttribute("tabindex", "0");
  expect(await canvas.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.keyboard.press("Tab");
  await expect(agent).toHaveClass(/selected/);
  await expect(agent).toBeFocused();
  await expect(agent).toHaveAttribute("tabindex", "-1");
  expect(await agent.locator(".bd-block").evaluate((element) => getComputedStyle(element).boxShadow))
    .toContain("37, 99, 217");
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Agent UI");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText("Selected diagram object 1 of 17.");

  await page.keyboard.press("Tab");
  await expect(core).toHaveClass(/selected/);
  await expect(core).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(agent).toHaveClass(/selected/);
  await expect(agent).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("System Overview");
  await canvas.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(lastEdge).toHaveClass(/selected/);
  await expect(lastEdge).toBeFocused();
  await expect(lastEdge).toHaveAttribute("tabindex", "-1");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText("Selected diagram object 17 of 17.");
  const routeHandle = lastEdge.locator(".bd-route-handle").first();
  await page.keyboard.press("Enter");
  await expect(routeHandle).toBeFocused();
  await expect(routeHandle).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Escape");
  await expect(lastEdge).toBeFocused();
  const focusedRouteColors = await lastEdge.evaluate((element) => ({
    route: getComputedStyle(element.querySelector(".bd-interface-route")!).stroke,
    halo: getComputedStyle(element.querySelector(".bd-interface-underlay")!).stroke,
  }));
  expect(focusedRouteColors.route).not.toBe(focusedRouteColors.halo);
  expect(focusedRouteColors.halo).toContain("37, 99, 217");
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("Platform Registration");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText("Returned focus to the selected diagram object.");
  if (process.env.CAPTURE_KEYBOARD_TRAVERSAL === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/keyboard-selection-traversal.png");
  }

  const multiHandleEdge = page.locator('.react-flow__edge[data-id="system::core-ui-notification"]');
  await multiHandleEdge.focus();
  await page.keyboard.press("Enter");
  await expect(multiHandleEdge).toHaveClass(/selected/);
  const routeHandles = multiHandleEdge.locator(".bd-route-handle");
  expect(await routeHandles.count()).toBeGreaterThan(1);
  await page.keyboard.press("Enter");
  await expect(routeHandles.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(routeHandles.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(routeHandles.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(multiHandleEdge).toBeFocused();

  await flowNode(page, "system::project").click({ force: true, modifiers: ["Shift"] });
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("2 objects selected");
  await page.keyboard.press("Tab");
  await expect(agent).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(agent).toBeFocused();

  const title = inspector.getByLabel("Title", { exact: true });
  await title.focus();
  await page.keyboard.press("Tab");
  await expect(inspector.getByLabel("Owner", { exact: true })).toBeFocused();
  await expect(agent).toHaveClass(/selected/);

  await title.fill("Agent UI draft");
  await agent.focus();
  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedTraversal = page.keyboard.press("Tab");
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedTraversal;
  await expect(agent).toHaveClass(/selected/);
  await expect(core).not.toHaveClass(/selected/);
  await expect(agent).toBeFocused();
  await expect(title).toHaveValue("Agent UI draft");

  await title.fill("Agent UI");
  await agent.focus();
  await page.keyboard.press("Tab");
  await expect(core).toHaveClass(/selected/);
  await expect(core).toBeFocused();
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("selects and clears every object in the current level with standard edit commands", async ({ page, browserName }) => {
  const viewportBefore = await canvasViewportTransform(page);

  await page.keyboard.press("ControlOrMeta+A");
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("17 objects selected");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(10);
  await expect(page.locator(".bd-command-notice")).toContainText("Selected 17 diagram objects in System Overview.");
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  if (process.env.CAPTURE_SELECT_ALL === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/select-all-level.png");
  }

  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("System Overview");
  await expect(page.locator(".bd-command-notice")).toContainText("Selection cleared.");
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);

  const core = flowNode(page, "system::rust-agent-core");
  await core.click({ force: true });
  const title = page.getByLabel("Title", { exact: true });
  await title.focus();
  await page.keyboard.press("ControlOrMeta+A");
  expect(await title.evaluate((input) => ({
    start: (input as HTMLInputElement).selectionStart,
    end: (input as HTMLInputElement).selectionEnd,
    length: (input as HTMLInputElement).value.length,
  }))).toEqual({ start: 0, end: 15, length: 15 });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);

  await title.blur();
  await runMenuCommand(page, "Edit", /^Select All in Level/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("17 objects selected");
  await runMenuCommand(page, "Edit", /^Clear Selection/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("System Overview");
});

test("selects every module or every interface in the current level without design side effects", async ({ page, browserName }) => {
  const inspector = page.getByRole("region", { name: "Properties" });
  const core = flowNode(page, "system::rust-agent-core");
  await core.click({ force: true });
  const viewportBefore = await canvasViewportTransform(page);
  const title = inspector.getByLabel("Title", { exact: true });
  await title.fill("Rust Agent Core draft");

  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedSelection = runMenuCommand(page, "Edit", /^Select Modules in Level/);
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedSelection;
  await expect(core).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(title).toHaveValue("Rust Agent Core draft");

  await title.fill("Rust Agent Core");
  await title.blur();
  await runMenuCommand(page, "Edit", /^Select Modules in Level/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("7 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["7", "0", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText("Selected 7 modules in System Overview.");
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);

  await runMenuCommand(page, "Edit", /^Select Modules in Level/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("interfaces in level");
  const interfacesCommand = palette.getByRole("option", { name: /^Select Interfaces in Level/ });
  await expect(interfacesCommand).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(10);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("10 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["0", "10", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText("Selected 10 interfaces in System Overview.");
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
  await expect(
    page.getByRole("toolbar", { name: "Architecture design tools" })
      .getByRole("button", { name: /^Undo/ }),
  ).toBeDisabled();

  const audit = await exhaustiveRouteAudit(page);
  expect(audit).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await runMenuCommand(page, "View", /^Fit Selection/);
  await page.waitForTimeout(400);
  if (process.env.CAPTURE_TYPED_SELECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/select-interfaces-in-level.png");
  }
});

test("expands selected modules to every direct interface without changing the design", async ({ page, browserName }) => {
  const core = flowNode(page, "system::rust-agent-core");
  const inspector = page.getByRole("region", { name: "Properties" });
  await core.click({ force: true });
  const viewportBefore = await canvasViewportTransform(page);
  const title = inspector.getByLabel("Title", { exact: true });
  await title.fill("Rust Agent Core draft");

  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedExpansion = runMenuCommand(page, "Edit", /^Select Direct Interfaces/);
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedExpansion;
  await expect(core).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(title).toHaveValue("Rust Agent Core draft");

  await title.fill("Rust Agent Core");
  await title.blur();
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("direct interfaces");
  const command = palette.getByRole("option", { name: /^Select Direct Interfaces/ });
  await expect(command).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");

  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(8);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("9 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["1", "8", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added 8 direct interfaces for 1 selected module.",
  );
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
  await expect(
    page.getByRole("toolbar", { name: "Architecture design tools" })
      .getByRole("button", { name: /^Undo/ }),
  ).toBeDisabled();
  for (const connectionId of [
    "ui-session-command",
    "core-ui-notification",
    "project-core-lifecycle",
    "knowledge-core-lifecycle",
    "core-tool-catalog",
    "tool-core-snapshot",
    "core-tool-invoke",
    "tool-core-outcome",
  ]) {
    await expect(page.locator(`.react-flow__edge[data-id="system::${connectionId}"]`)).toHaveClass(/selected/);
  }
  await expect(page.locator('.react-flow__edge[data-id="system::plugin-tool-registration"]')).not.toHaveClass(/selected/);
  await expect(page.locator('.react-flow__edge[data-id="system::platform-tool-registration"]')).not.toHaveClass(/selected/);
  expect(await routeNodeCollisions(page)).toEqual([]);

  await page.keyboard.press("ControlOrMeta+K");
  const disabledPalette = page.getByRole("dialog", { name: "Command Palette" });
  await disabledPalette.getByRole("combobox", { name: "Search commands" }).fill("direct interfaces");
  const disabledCommand = disabledPalette.getByRole("option", { name: /^Select Direct Interfaces/ });
  await expect(disabledCommand).toHaveAttribute("aria-disabled", "true");
  await expect(disabledCommand).toContainText("All direct interfaces are already selected.");
  await page.keyboard.press("Escape");

  await runMenuCommand(page, "View", /^Fit Selection/);
  await page.waitForTimeout(400);
  if (process.env.CAPTURE_DIRECT_INTERFACES === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/select-direct-interfaces.png");
  }
});

test("selects and explicitly focuses a complete direct module neighborhood", async ({ page, browserName }) => {
  const core = flowNode(page, "system::rust-agent-core");
  const inspector = page.getByRole("region", { name: "Properties" });
  await core.click({ force: true });
  const viewportBefore = await canvasViewportTransform(page);
  const title = inspector.getByLabel("Title", { exact: true });
  await title.fill("Rust Agent Core draft");

  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedExpansion = runMenuCommand(page, "Edit", /^Select Direct Neighborhood/);
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedExpansion;
  await expect(core).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(title).toHaveValue("Rust Agent Core draft");

  await title.fill("Rust Agent Core");
  await title.blur();
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("direct neighborhood");
  const command = palette.getByRole("option", { name: /^Select Direct Neighborhood/ });
  await expect(command).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");

  await expect(page.locator(".react-flow__node.selected")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(8);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("13 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["5", "8", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added 4 neighboring modules and 8 direct interfaces for 1 selected module.",
  );
  expect(await canvasViewportTransform(page)).toBe(viewportBefore);
  for (const nodeId of ["rust-agent-core", "agent-ui", "tool-system", "project", "knowledge"]) {
    await expect(flowNode(page, `system::${nodeId}`)).toHaveClass(/selected/);
  }
  for (const nodeId of ["plugin", "platform-provider"]) {
    await expect(flowNode(page, `system::${nodeId}`)).not.toHaveClass(/selected/);
  }
  for (const connectionId of [
    "ui-session-command",
    "core-ui-notification",
    "project-core-lifecycle",
    "knowledge-core-lifecycle",
    "core-tool-catalog",
    "tool-core-snapshot",
    "core-tool-invoke",
    "tool-core-outcome",
  ]) {
    await expect(page.locator(`.react-flow__edge[data-id="system::${connectionId}"]`)).toHaveClass(/selected/);
  }
  await expect(page.locator('.react-flow__edge[data-id="system::plugin-tool-registration"]')).not.toHaveClass(/selected/);
  await expect(page.locator('.react-flow__edge[data-id="system::platform-tool-registration"]')).not.toHaveClass(/selected/);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
  await expect(
    page.getByRole("toolbar", { name: "Architecture design tools" })
      .getByRole("button", { name: /^Undo/ }),
  ).toBeDisabled();

  const audit = await exhaustiveRouteAudit(page);
  expect(audit).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  await runMenuCommand(page, "View", /^Fit Selection/);
  await page.waitForTimeout(400);
  const focusedNeighborhoodViewport = await canvasViewportTransform(page);
  expect(focusedNeighborhoodViewport).not.toBe(viewportBefore);
  if (process.env.CAPTURE_DIRECT_NEIGHBORHOOD === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/select-direct-neighborhood.png");
  }

  await runMenuCommand(page, "Edit", /^Select Direct Neighborhood/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(10);
  await expect(inspector.locator(".bd-inspector-title h2")).toHaveText("17 objects selected");
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["7", "10", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added 2 neighboring modules and 2 direct interfaces for 5 selected modules.",
  );
  expect(await canvasViewportTransform(page)).toBe(focusedNeighborhoodViewport);

  await page.keyboard.press("ControlOrMeta+K");
  const disabledPalette = page.getByRole("dialog", { name: "Command Palette" });
  await disabledPalette.getByRole("combobox", { name: "Search commands" }).fill("direct neighborhood");
  const disabledCommand = disabledPalette.getByRole("option", { name: /^Select Direct Neighborhood/ });
  await expect(disabledCommand).toHaveAttribute("aria-disabled", "true");
  await expect(disabledCommand).toContainText("The complete direct neighborhood is already selected.");
  await page.keyboard.press("Escape");
});

test("selects incoming and outgoing dependency directions without guessing from geometry", async ({ page, browserName }) => {
  const core = flowNode(page, "system::rust-agent-core");
  const inspector = page.getByRole("region", { name: "Properties" });
  await core.click({ force: true });
  const initialViewport = await canvasViewportTransform(page);
  const title = inspector.getByLabel("Title", { exact: true });
  await title.fill("Rust Agent Core draft");

  const discardDialogPromise = page.waitForEvent("dialog");
  const rejectedSelection = runMenuCommand(page, "Edit", /^Select Incoming Interfaces/);
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.message()).toContain("Discard unapplied Inspector changes");
  await discardDialog.dismiss();
  await rejectedSelection;
  await expect(core).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(title).toHaveValue("Rust Agent Core draft");

  await title.fill("Rust Agent Core");
  await title.blur();
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("incoming interfaces");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(5);
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["1", "5", "1"]);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added 5 incoming interfaces for 1 selected module.",
  );
  for (const connectionId of [
    "ui-session-command",
    "project-core-lifecycle",
    "knowledge-core-lifecycle",
    "tool-core-snapshot",
    "tool-core-outcome",
  ]) {
    await expect(page.locator(`.react-flow__edge[data-id="system::${connectionId}"]`)).toHaveClass(/selected/);
  }
  for (const connectionId of ["core-ui-notification", "core-tool-catalog", "core-tool-invoke"]) {
    await expect(page.locator(`.react-flow__edge[data-id="system::${connectionId}"]`)).not.toHaveClass(/selected/);
  }
  expect(await canvasViewportTransform(page)).toBe(initialViewport);

  await page.keyboard.press("ControlOrMeta+K");
  const disabledPalette = page.getByRole("dialog", { name: "Command Palette" });
  await disabledPalette.getByRole("combobox", { name: "Search commands" }).fill("incoming interfaces");
  const disabledIncoming = disabledPalette.getByRole("option", { name: /^Select Incoming Interfaces/ });
  await expect(disabledIncoming).toHaveAttribute("aria-disabled", "true");
  await expect(disabledIncoming).toContainText("All incoming interfaces are already selected.");
  await page.keyboard.press("Escape");

  await core.click({ force: true });
  await runMenuCommand(page, "Edit", /^Select Outgoing Interfaces/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(3);
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["1", "3", "1"]);
  for (const connectionId of ["core-ui-notification", "core-tool-catalog", "core-tool-invoke"]) {
    await expect(page.locator(`.react-flow__edge[data-id="system::${connectionId}"]`)).toHaveClass(/selected/);
  }
  expect(await canvasViewportTransform(page)).toBe(initialViewport);

  await core.click({ force: true });
  await runMenuCommand(page, "Edit", /^Select Incoming Neighborhood/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(5);
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["5", "5", "1"]);
  for (const nodeId of ["rust-agent-core", "agent-ui", "project", "knowledge", "tool-system"]) {
    await expect(flowNode(page, `system::${nodeId}`)).toHaveClass(/selected/);
  }
  expect(await canvasViewportTransform(page)).toBe(initialViewport);
  await runMenuCommand(page, "View", /^Fit Selection/);
  await page.waitForTimeout(400);
  if (process.env.CAPTURE_DIRECTIONAL_NEIGHBORHOOD === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/select-incoming-neighborhood.png");
  }

  await core.click({ force: true });
  const outgoingViewport = await canvasViewportTransform(page);
  await runMenuCommand(page, "Edit", /^Select Outgoing Neighborhood/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(3);
  await expect(inspector.locator(".bd-multi-metrics dd")).toHaveText(["3", "3", "1"]);
  for (const nodeId of ["rust-agent-core", "agent-ui", "tool-system"]) {
    await expect(flowNode(page, `system::${nodeId}`)).toHaveClass(/selected/);
  }
  expect(await canvasViewportTransform(page)).toBe(outgoingViewport);

  await flowNode(page, "system::project").click({ force: true });
  await page.keyboard.press("ControlOrMeta+K");
  const noIncomingPalette = page.getByRole("dialog", { name: "Command Palette" });
  await noIncomingPalette.getByRole("combobox", { name: "Search commands" }).fill("incoming neighborhood");
  const noIncoming = noIncomingPalette.getByRole("option", { name: /^Select Incoming Neighborhood/ });
  await expect(noIncoming).toHaveAttribute("aria-disabled", "true");
  await expect(noIncoming).toContainText("The selected modules have no incoming interfaces.");
  await page.keyboard.press("Escape");

  const audit = await exhaustiveRouteAudit(page);
  expect(audit).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    duplicateRouteIds: [],
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
  await expect(
    page.getByRole("toolbar", { name: "Architecture design tools" })
      .getByRole("button", { name: /^Undo/ }),
  ).toBeDisabled();
});

test("deletes a mixed module and interface selection as one atomic cascade", async ({ page, browserName }) => {
  const agent = flowNode(page, "system::agent-ui");
  const core = flowNode(page, "system::rust-agent-core");
  const selectedEdge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, selectedEdge);
  await agent.click({ force: true, modifiers: ["ControlOrMeta"] });
  await core.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("3 objects selected");
  await expect(page.getByText("Delete removes once", { exact: false })).toBeVisible();

  let dialogPromise = page.waitForEvent("dialog");
  let deletion = page.keyboard.press("Delete");
  let dialog = await dialogPromise;
  expect(dialog.message()).toContain("Delete 3 selected diagram objects?");
  expect(dialog.message()).toContain("exclusively owned child designs");
  await dialog.dismiss();
  await deletion;
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("3 objects selected");

  dialogPromise = page.waitForEvent("dialog");
  deletion = page.keyboard.press("Delete");
  dialog = await dialogPromise;
  await dialog.accept();
  await deletion;
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("System Overview");
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
  expect(await routeNodeCollisions(page)).toEqual([]);
  if (process.env.CAPTURE_BATCH_DELETE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/batch-delete-after.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.levels.map((level: { id: string }) => level.id)).toEqual(["system", "tool"]);
  expect(saved.levels[0].nodes.map((node: { id: string }) => node.id)).toEqual([
    "tool-system",
    "project",
    "knowledge",
    "plugin",
    "platform-provider",
  ]);
  expect(saved.levels[0].connections.map((connection: { id: string }) => connection.id)).toEqual([
    "plugin-tool-registration",
    "platform-tool-registration",
  ]);
  const referencedInterfaceIds = [...new Set(saved.levels.flatMap(
    (level: { connections: Array<{ interfaceId: string }> }) =>
      level.connections.map((connection) => connection.interfaceId),
  ))].sort();
  expect(Object.keys(saved.interfaceDefinitions).sort()).toEqual(referencedInterfaceIds);
  expect(saved.interfaceDefinitions["session.command"]).toBeUndefined();
  expect(saved.interfaceDefinitions["core.command.dispatch"]).toBeUndefined();
  expect(saved.interfaceDefinitions["tool.registration"]).toBeDefined();

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  expect(await routeNodeCollisions(page)).toEqual([]);
});

test("fits a selected interface and its endpoint modules for focused route review", async ({ page, browserName }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
  const viewportBefore = await canvasViewportTransform(page);

  await page.keyboard.press("ControlOrMeta+Shift+H");
  await expect.poll(() => canvasViewportTransform(page)).not.toBe(viewportBefore);
  await page.waitForTimeout(350);
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText("Fitting 1 selected diagram object.");

  const canvas = await page.locator(".bd-react-flow").boundingBox();
  const agent = await flowNode(page, "system::agent-ui").boundingBox();
  const core = await flowNode(page, "system::rust-agent-core").boundingBox();
  const route = await edge.locator(".bd-interface-route").boundingBox();
  expect(canvas && agent && core && route).not.toBeNull();
  for (const box of [agent!, core!, route!]) {
    expect(box.x).toBeGreaterThanOrEqual(canvas!.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(canvas!.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  }
  expect(route!.width).toBeGreaterThan(120);
  if (process.env.CAPTURE_FIT_SELECTION === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/fit-selection.png");
  }

  await page.keyboard.press("ControlOrMeta+Shift+A");
  await page.getByRole("button", { name: "View", exact: true }).click();
  const fitSelection = page.getByRole("menu", { name: "View" }).getByRole("menuitem", { name: /^Fit Selection/ });
  await expect(fitSelection).toHaveAttribute("aria-disabled", "true");
  await expect(fitSelection).toContainText("Select a module or interface first.");
  await page.keyboard.press("Escape");
});

test("keeps toolbar, menu, and keyboard viewport zoom on one non-persistent command path", async ({ page, browserName }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  await expect(edge).toHaveClass(/selected/);
  const initialZoom = await canvasZoom(page);

  await page.keyboard.press("ControlOrMeta+Minus");
  await expect.poll(() => canvasZoom(page)).toBeLessThan(initialZoom);
  await page.keyboard.press("ControlOrMeta+Equal");
  await expect.poll(() => canvasZoom(page)).toBeGreaterThan(initialZoom - 0.01);
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  await runMenuCommand(page, "View", /^Actual Size \(100%\)/);
  await expect.poll(() => canvasZoom(page)).toBeCloseTo(1, 3);
  const readout = page.getByRole("button", { name: /^Actual size, current zoom/ });
  await expect(readout).toHaveAccessibleName("Actual size, current zoom 100%");

  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(() => canvasZoom(page)).toBeLessThan(1);
  await readout.click();
  await expect.poll(() => canvasZoom(page)).toBeCloseTo(1, 3);
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  const viewportBeforeFocusedActualSize = await canvasViewportTransform(page);
  await page.keyboard.press("ControlOrMeta+Shift+H");
  await expect.poll(() => canvasViewportTransform(page)).not.toBe(viewportBeforeFocusedActualSize);
  await page.waitForTimeout(350);
  await readout.click();
  await expect.poll(() => canvasZoom(page)).toBeCloseTo(1, 3);

  if (process.env.CAPTURE_VIEWPORT_ZOOM === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/viewport-zoom-controls.png");
  }
});

test("keeps selection, Space pan, button pan, wheel pan, and modifier zoom orthogonal", async ({ page, browserName }) => {
  const pane = page.locator(".react-flow__pane");
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(canvas).not.toBeNull();
  const start = { x: canvas!.x + canvas!.width * 0.5, y: canvas!.y + canvas!.height * 0.87 };
  const drag = async (button: "left" | "middle" | "right", dx: number, dy: number) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
    await page.mouse.up({ button });
  };

  const initial = await canvasTransform(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(start.x + 70, start.y - 40, { steps: 6 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.mouse.up({ button: "left" });
  expect(await canvasTransform(page)).toEqual(initial);

  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const routeBefore = await edge.locator(".bd-interface-route").getAttribute("d");
  await expect(edge).toHaveClass(/selected/);

  await page.keyboard.down("Space");
  await expect(page.locator(".bd-canvas-pan-mode")).toContainText("PAN MODE");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(start.x + 90, start.y - 55, { steps: 6 });
  await expect(pane).toHaveCSS("cursor", "grabbing");
  expect(await textContrastIssues(page, ".bd-canvas-pan-mode")).toEqual([]);
  if (process.env.CAPTURE_PAN_MODE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/pan-mode.png");
  }
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Space");
  await expect(page.locator(".bd-canvas-pan-mode")).toHaveCount(0);
  const afterSpace = await canvasTransform(page);
  expect(afterSpace.x).toBeCloseTo(initial.x + 90, 1);
  expect(afterSpace.y).toBeCloseTo(initial.y - 55, 1);
  expect(afterSpace.zoom).toBeCloseTo(initial.zoom, 5);

  for (const button of ["middle", "right"] as const) {
    const before = await canvasTransform(page);
    await drag(button, 35, 25);
    const after = await canvasTransform(page);
    expect(after.x).toBeCloseTo(before.x + 35, 1);
    expect(after.y).toBeCloseTo(before.y + 25, 1);
    expect(after.zoom).toBeCloseTo(before.zoom, 5);
  }

  await page.mouse.move(start.x, start.y);
  const beforeWheel = await canvasTransform(page);
  await page.mouse.wheel(0, 180);
  const afterWheel = await canvasTransform(page);
  expect(afterWheel.x).toBeCloseTo(beforeWheel.x, 1);
  expect(afterWheel.y).toBeLessThan(beforeWheel.y);
  expect(afterWheel.zoom).toBeCloseTo(beforeWheel.zoom, 5);

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -180);
  await page.keyboard.up("Control");
  await expect.poll(() => canvasZoom(page)).toBeGreaterThan(afterWheel.zoom);
  await expect(edge).toHaveClass(/selected/);
  expect(await edge.locator(".bd-interface-route").getAttribute("d")).toBe(routeBefore);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  const moduleFilter = page.getByLabel("Filter modules");
  await moduleFilter.focus();
  await page.keyboard.down("Space");
  await expect(page.locator(".bd-canvas-pan-mode")).toHaveCount(0);
  await page.keyboard.up("Space");
  await moduleFilter.fill("");
});

test("pastes a copied module at the requested empty-canvas design point", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => { throw new DOMException("Denied by test host", "NotAllowedError"); },
      },
    });
  });
  const source = flowNode(page, "system::agent-ui");
  await source.click({ force: true });
  await page.keyboard.press("ControlOrMeta+C");
  await expect(page.locator(".bd-command-notice")).toContainText("Copied 1 module inside this workspace");

  const requested = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".bd-react-flow");
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    const sourceNode = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="system::agent-ui"]',
    );
    if (!canvas || !viewport || !sourceNode) throw new Error("Canvas geometry is unavailable.");
    const canvasBounds = canvas.getBoundingClientRect();
    const sourceBounds = sourceNode.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    const zoom = matrix.a;
    const occupied = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .map((node) => node.getBoundingClientRect());
    const gap = 24 * zoom;
    for (let y = canvasBounds.bottom - 72; y >= canvasBounds.top + 72; y -= 28) {
      for (let x = canvasBounds.right - 80; x >= canvasBounds.left + 80; x -= 28) {
        const design = {
          x: Math.round(((x - canvasBounds.left - matrix.e) / zoom) / 32) * 32,
          y: Math.round(((y - canvasBounds.top - matrix.f) / zoom) / 32) * 32,
        };
        const rendered = {
          left: canvasBounds.left + matrix.e + design.x * zoom,
          top: canvasBounds.top + matrix.f + design.y * zoom,
          right: canvasBounds.left + matrix.e + design.x * zoom + sourceBounds.width,
          bottom: canvasBounds.top + matrix.f + design.y * zoom + sourceBounds.height,
        };
        const collides = occupied.some((rect) =>
          rendered.left < rect.right + gap && rendered.right + gap > rect.left &&
          rendered.top < rect.bottom + gap && rendered.bottom + gap > rect.top);
        const blockedAtPointer = document.elementsFromPoint(x, y).some((element) =>
          Boolean(element.closest(
            ".react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .bd-canvas-detail-panel",
          )));
        if (!collides && !blockedAtPointer) return { client: { x, y }, design };
      }
    }
    throw new Error("No clear visible Paste Here point was found.");
  });

  const canvas = page.locator(".bd-react-flow");
  await canvas.focus();
  await page.keyboard.press("Shift+F10");
  const keyboardCanvasMenu = page.getByRole("menu", { name: "Canvas actions" });
  await expect(keyboardCanvasMenu).toBeVisible();
  await expect(keyboardCanvasMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(keyboardCanvasMenu).toHaveCount(0);
  await expect(canvas).toBeFocused();

  await page.mouse.click(requested.client.x, requested.client.y, { button: "right" });
  const canvasMenu = page.getByRole("menu", { name: "Canvas actions" });
  await expect(canvasMenu).toBeVisible();
  await expect(canvasMenu.getByRole("menuitem")).toHaveCount(4);
  await expect(canvasMenu.getByRole("menuitem", { name: "Paste Here", exact: true }))
    .not.toHaveAttribute("aria-disabled", "true");
  expect(await textContrastIssues(page, ".bd-context-menu")).toEqual([]);
  await canvasMenu.getByRole("menuitem", { name: "Paste Here", exact: true }).click();
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::agent-ui-2")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Pasted 1 module at the requested canvas position into System Overview",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const system = saved.levels.find((level: { id: string }) => level.id === "system");
  expect(system.nodes.find((node: { id: string }) => node.id === "agent-ui-2").layout.position)
    .toEqual(requested.design);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });
  if (process.env.CAPTURE_PASTE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/paste-here.png");
  }

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::agent-ui-2")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
});

test("creates one module at a canvas point from context menu or toolbar drag", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const canvas = page.locator(".bd-react-flow");
  const [contextPoint] = await clearModuleInsertionPoints(page, 1);
  const viewportBeforeContextInsert = await canvasViewportTransform(page);

  await page.mouse.click(contextPoint.client.x, contextPoint.client.y, { button: "right" });
  const canvasMenu = page.getByRole("menu", { name: "Canvas actions" });
  await expect(canvasMenu).toBeVisible();
  await expect(canvasMenu.getByRole("menuitem")).toHaveCount(4);
  await canvasMenu.getByRole("menuitem", { name: "Add Module Here...", exact: true }).click();
  const contextDialog = page.getByRole("dialog", { name: /Add Module/ });
  await contextDialog.getByLabel("Module title").fill("Review Point");
  await contextDialog.getByLabel("Module id").fill("review-point");
  await contextDialog.getByRole("button", { name: "Add Module", exact: true }).click();
  await waitForEditorIdle(page);

  await expect(flowNode(page, "system::review-point")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added Review Point at the requested canvas position in System Overview",
  );
  expect(await canvasViewportTransform(page)).toBe(viewportBeforeContextInsert);
  const contextDownload = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const contextSavedPath = await (await contextDownload).path();
  expect(contextSavedPath).not.toBeNull();
  const contextSaved = JSON.parse(await readFile(contextSavedPath!, "utf8"));
  const contextSystem = contextSaved.levels.find((level: { id: string }) => level.id === "system");
  expect(contextSystem.nodes.find((node: { id: string }) => node.id === "review-point").layout)
    .toEqual({ position: contextPoint.expectedOrigin, pinned: true });
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  expect(await exhaustiveRouteAudit(page)).toMatchObject({
    auditedRouteCount: 10,
    auditedPairCount: 45,
    expectedPairCount: 45,
    perRouteIssues: [],
    parallelConflicts: [],
    unbridgedCrossings: [],
    orphanJumps: [],
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::review-point")).toHaveCount(0);

  const [dragPoint] = await clearModuleInsertionPoints(page, 1);
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await toolbarButton(page, "Add Module...").dragTo(canvas, {
    targetPosition: {
      x: dragPoint.client.x - canvasBounds!.x,
      y: dragPoint.client.y - canvasBounds!.y,
    },
  });
  const dragDialog = page.getByRole("dialog", { name: /Add Module/ });
  await expect(dragDialog).toBeVisible();
  await dragDialog.getByLabel("Module title").fill("Dragged Review");
  await dragDialog.getByLabel("Module id").fill("dragged-review");
  await dragDialog.getByRole("button", { name: "Add Module", exact: true }).click();
  await waitForEditorIdle(page);

  await expect(flowNode(page, "system::dragged-review")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added Dragged Review at the requested canvas position in System Overview",
  );
  const dragDownload = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const dragSavedPath = await (await dragDownload).path();
  expect(dragSavedPath).not.toBeNull();
  const dragSaved = JSON.parse(await readFile(dragSavedPath!, "utf8"));
  const dragSystem = dragSaved.levels.find((level: { id: string }) => level.id === "system");
  expect(dragSystem.nodes.find((node: { id: string }) => node.id === "dragged-review").layout)
    .toEqual({ position: dragPoint.expectedOrigin, pinned: true });
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  if (process.env.CAPTURE_ADD_MODULE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/add-module-here.png");
  }

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::dragged-review")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
});

test("drops a module into an expanded empty child Level without a special-case target", async ({ page, browserName }) => {
  let document = createBlankDesign("empty-child-drop", "Empty Child Drop");
  document = applyDesignOperation(document, {
    type: "node/add",
    levelId: "system",
    node: createBlock({ id: "empty-boundary", title: "Empty Boundary" }),
  });
  document = applyDesignOperation(document, {
    type: "hierarchy/add",
    levelId: "system",
    nodeId: "empty-boundary",
    childLevel: createDesignLevel("empty-level", "Empty Level", "system"),
  });

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "empty-child-drop.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Empty Child Drop");
  await page.getByRole("region", { name: "Sources", exact: true })
    .getByRole("button", { name: "Expand Empty Boundary", exact: true }).click({ force: true });
  await expect(page.locator(".bd-level-chip")).toHaveText("1 expanded");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  const ownerBounds = await diagramNode(page, "system", "empty-boundary").boundingBox();
  expect(ownerBounds).not.toBeNull();
  await beginToolbarModuleDrag(page, {
    x: ownerBounds!.x + ownerBounds!.width / 2,
    y: ownerBounds!.y + 32 + (ownerBounds!.height - 32) / 2,
  });

  const dropTarget = page.locator(
    '[data-module-drop-target="true"][data-level-id="empty-level"]',
  );
  const preview = page.locator(
    '[data-module-drop-preview="true"][data-level-id="empty-level"]',
  );
  await expect(dropTarget).toBeVisible();
  await expect(dropTarget).toHaveAttribute("data-level-title", "Empty Level");
  await expect(preview).toBeVisible();
  const dropTargetBounds = await dropTarget.boundingBox();
  const previewBounds = await preview.boundingBox();
  expect(dropTargetBounds && previewBounds).not.toBeNull();
  expect(previewBounds!.x).toBeGreaterThan(dropTargetBounds!.x);
  expect(previewBounds!.y).toBeGreaterThan(dropTargetBounds!.y);
  expect(previewBounds!.x + previewBounds!.width).toBeLessThan(dropTargetBounds!.x + dropTargetBounds!.width);
  expect(previewBounds!.y + previewBounds!.height).toBeLessThan(dropTargetBounds!.y + dropTargetBounds!.height);
  if (process.env.CAPTURE_ADD_MODULE_HERE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/add-module-empty-level-drop-target.png");
  }

  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: /Add Module/ });
  await dialog.getByLabel("Module title").fill("First Internal");
  await dialog.getByLabel("Module id").fill("first-internal");
  await dialog.getByRole("button", { name: "Add Module", exact: true }).click();
  await waitForEditorIdle(page);
  await expect(diagramNode(page, "empty-level", "first-internal")).toHaveClass(/selected/);
  await expect(page.locator(".bd-command-notice")).toContainText(
    "Added First Internal at the requested canvas position in Empty Level",
  );

  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await download).path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const emptyLevel = saved.levels.find((level: { id: string }) => level.id === "empty-level");
  expect(emptyLevel.nodes).toHaveLength(1);
  expect(emptyLevel.nodes[0]).toMatchObject({
    id: "first-internal",
    layout: { position: { x: 0, y: 0 }, pinned: true },
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(diagramNode(page, "empty-level", "first-internal")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("keeps object context actions and right-button canvas pan mutually exclusive", async ({ page, browserName }) => {
  const canvas = page.locator(".bd-react-flow");
  const agent = flowNode(page, "system::agent-ui");
  const project = flowNode(page, "system::project");

  await rightClickLocator(page, agent);
  const moduleMenu = page.getByRole("menu", { name: "Module actions" });
  await expect(moduleMenu).toBeVisible();
  await expect(canvas).toHaveAttribute("data-context-gesture-outcome", "menu");
  await expect(agent).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Agent UI");
  await expect(moduleMenu.getByRole("menuitem")).toHaveCount(11);
  await expect(moduleMenu.getByRole("menuitem", { name: /Enter Module/ }))
    .toHaveAttribute("aria-disabled", "true");
  await expect(moduleMenu.getByRole("menuitem", { name: /^Create Child Design/ }))
    .not.toHaveAttribute("aria-disabled", "true");
  const menuBounds = await moduleMenu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(8);
  expect(menuBounds!.y).toBeGreaterThanOrEqual(8);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
  expect(await textContrastIssues(page, ".bd-context-menu")).toEqual([]);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  if (process.env.CAPTURE_CONTEXT_MENU === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/object-context-menu.png");
  }

  await moduleMenu.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(8);
  await expect(moduleMenu).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);

  await agent.focus();
  await page.keyboard.press("Shift+F10");
  await expect(moduleMenu).toBeVisible();
  await expect(moduleMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(moduleMenu.getByRole("menuitem").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(moduleMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(moduleMenu).toHaveCount(0);
  await expect(agent).toBeFocused();

  await project.click({ force: true, modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await rightClickLocator(page, agent);
  const selectionMenu = page.getByRole("menu", { name: "Selected diagram objects actions" });
  await expect(selectionMenu).toHaveAttribute("data-context-selection-count", "2");
  await expect(selectionMenu.getByRole("menuitem", { name: "Align Left", exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await page.keyboard.press("Escape");

  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  const edgePoint = await reachableEdgePoint(edge);
  await page.mouse.click(edgePoint.x, edgePoint.y, { button: "right" });
  const interfaceMenu = page.getByRole("menu", { name: "Interface actions" });
  await expect(interfaceMenu).toBeVisible();
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Session Command RPC");
  await expect(interfaceMenu.getByRole("menuitem")).toHaveCount(4);
  await page.keyboard.press("Escape");

  await agent.click({ force: true });
  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Title", { exact: true }).fill("Agent UI draft");
  const projectBounds = await project.boundingBox();
  expect(projectBounds).not.toBeNull();
  const rejectedContextPromise = page.waitForEvent("dialog");
  const rejectedContextClick = page.mouse.click(
    projectBounds!.x + projectBounds!.width - 12,
    projectBounds!.y + 36,
    { button: "right" },
  );
  const rejectedContextDialog = await rejectedContextPromise;
  expect(rejectedContextDialog.message()).toContain("Discard unapplied Inspector changes");
  await rejectedContextDialog.dismiss();
  await rejectedContextClick;
  await expect(page.locator(".bd-context-menu")).toHaveCount(0);
  await expect(agent).toHaveClass(/selected/);
  await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue("Agent UI draft");
  await inspector.getByLabel("Title", { exact: true }).fill("Agent UI");

  const agentBounds = await agent.boundingBox();
  expect(agentBounds).not.toBeNull();
  const beforeRightPan = await canvasTransform(page);
  const panStart = {
    x: agentBounds!.x + agentBounds!.width / 2,
    y: agentBounds!.y + Math.min(54, agentBounds!.height / 2),
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(panStart.x + 48, panStart.y + 32, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".bd-context-menu")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-context-gesture-outcome", "pan");
  const afterRightPan = await canvasTransform(page);
  expect(afterRightPan.x).toBeCloseTo(beforeRightPan.x + 48, 1);
  expect(afterRightPan.y).toBeCloseTo(beforeRightPan.y + 32, 1);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("keeps a dragged module under a stationary viewport-edge pointer", async ({ page }) => {
  const node = flowNode(page, "system::platform-provider");
  const before = await node.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(before && canvas).not.toBeNull();
  const start = {
    x: before!.x + Math.min(90, before!.width * 0.4),
    y: before!.y + 16,
  };
  const target = {
    x: canvas!.x + canvas!.width - 5,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };
  const pointerOffset = { x: start.x - before!.x, y: start.y - before!.y };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  const live = await node.boundingBox();
  expect(live).not.toBeNull();
  // One 12 px auto-pan frame plus the 16 px design grid is the maximum
  // visible anchor error before the next drag frame reconciles the node.
  expect(Math.abs(target.x - live!.x - pointerOffset.x)).toBeLessThan(32);
  expect(Math.abs(target.y - live!.y - pointerOffset.y)).toBeLessThan(32);
  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
});

test("keeps a selected module group together while edge auto-panning", async ({ page }) => {
  const project = flowNode(page, "system::project");
  const knowledge = flowNode(page, "system::knowledge");
  await project.click({ force: true });
  await knowledge.click({ force: true, modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const projectBefore = await project.boundingBox();
  const knowledgeBefore = await knowledge.boundingBox();
  const groupLocalPositions = () => page.locator(
    '.react-flow__node[data-id="system::project"], .react-flow__node[data-id="system::knowledge"]',
  ).evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform);
    if (!match) throw new Error(`Unexpected node transform ${transform}`);
    return [element.getAttribute("data-id"), { x: Number(match[1]), y: Number(match[2]) }];
  })) as Record<string, { x: number; y: number }>);
  const localBefore = await groupLocalPositions();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(projectBefore && knowledgeBefore && canvas).not.toBeNull();
  const start = {
    x: projectBefore!.x + Math.min(90, projectBefore!.width * 0.4),
    y: projectBefore!.y + 16,
  };
  const target = {
    x: canvas!.x + canvas!.width - 5,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  const localLive = await groupLocalPositions();
  expect(Math.abs(
    (localLive["system::project"].x - localBefore["system::project"].x) -
      (localLive["system::knowledge"].x - localBefore["system::knowledge"].x),
  )).toBeLessThan(0.01);
  expect(Math.abs(
    (localLive["system::project"].y - localBefore["system::project"].y) -
      (localLive["system::knowledge"].y - localBefore["system::knowledge"].y),
  )).toBeLessThan(0.01);
  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("clones a selected module group at a stationary viewport-edge pointer", async ({ page }) => {
  const agent = flowNode(page, "system::agent-ui");
  const core = flowNode(page, "system::rust-agent-core");
  await agent.click({ force: true });
  await core.click({ force: true, modifiers: ["Shift"] });
  const before = await agent.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(before && canvas).not.toBeNull();
  const start = {
    x: before!.x + Math.min(90, before!.width * 0.4),
    y: before!.y + 16,
  };
  const target = {
    x: canvas!.x + canvas!.width - 5,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };

  await page.keyboard.down("Control");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  await page.mouse.up();
  await page.keyboard.up("Control");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);
  await expect(page.locator(".bd-command-notice")).toContainText("Cloned 2 modules at the dragged position.");
  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("keeps a connection preview endpoint under a stationary viewport-edge pointer", async ({ page }) => {
  const source = flowNode(page, "system::agent-ui")
    .locator('.bd-port-handle-outer[data-handleid="session-command"]');
  const sourceBox = await source.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(sourceBox && canvas).not.toBeNull();
  const start = {
    x: sourceBox!.x + sourceBox!.width / 2,
    y: sourceBox!.y + sourceBox!.height / 2,
  };
  const target = {
    x: canvas!.x + canvas!.width - 4,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };
  const edgeCount = await page.locator(".react-flow__edge").count();

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.locator('.bd-connection-gesture-panel[data-connection-mode="create"]')).toBeVisible();
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  const pointerDistance = await page.locator(".bd-connection-preview-pointer").evaluate((circle, point) => {
    const marker = circle as SVGCircleElement;
    const matrix = marker.getScreenCTM();
    if (!matrix) return Number.POSITIVE_INFINITY;
    const screen = new DOMPoint(marker.cx.baseVal.value, marker.cy.baseVal.value).matrixTransform(matrix);
    return Math.hypot(screen.x - point.x, screen.y - point.y);
  }, target);
  expect(pointerDistance).toBeLessThan(12);
  await page.mouse.up();
  await expect(page.locator(".bd-connection-gesture-panel")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("keeps a reconnect preview attached while edge auto-panning at 100 percent", async ({ page }) => {
  await runMenuCommand(page, "View", /^Actual Size \(100%\)/);
  await expect.poll(() => canvasZoom(page)).toBeCloseTo(1, 3);
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await clickReachableEdgePoint(page, edge);
  const updater = edge.locator(".react-flow__edgeupdater-target");
  const updaterBox = await updater.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(updaterBox && canvas).not.toBeNull();
  const start = {
    x: updaterBox!.x + updaterBox!.width / 2,
    y: updaterBox!.y + updaterBox!.height / 2,
  };
  const target = {
    x: canvas!.x + canvas!.width - 4,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.locator('.bd-connection-gesture-panel[data-connection-mode="reconnect"]')).toBeVisible();
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  const pointerDistance = await page.locator(".bd-connection-preview-pointer").evaluate((circle, point) => {
    const marker = circle as SVGCircleElement;
    const matrix = marker.getScreenCTM();
    if (!matrix) return Number.POSITIVE_INFINITY;
    const screen = new DOMPoint(marker.cx.baseVal.value, marker.cy.baseVal.value).matrixTransform(matrix);
    return Math.hypot(screen.x - point.x, screen.y - point.y);
  }, target);
  expect(pointerDistance).toBeLessThan(12);

  await page.keyboard.press("Escape");
  await expect(page.locator(".bd-connection-gesture-panel")).toHaveCount(0);
  const atEscape = await canvasTransform(page);
  await page.waitForTimeout(120);
  const afterEscape = await canvasTransform(page);
  expect(afterEscape.x).toBeCloseTo(atEscape.x, 1);
  expect(afterEscape.y).toBeCloseTo(atEscape.y, 1);
  await page.mouse.up();
  await expect(page.locator(".bd-inspector-title code")).toContainText(
    "agent-ui.session-command → rust-agent-core.session-command",
  );
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");
});

test("continues box selection at all four viewport edges and stops on release", async ({ page }) => {
  const canvasLocator = page.locator(".bd-react-flow");
  await expect(canvasLocator).toHaveAttribute("data-auto-pan-edge-threshold", "40");
  await expect(canvasLocator).toHaveAttribute("data-auto-pan-maximum-frame-distance", "12");

  const directions = ["right", "left", "bottom", "top"] as const;
  for (const direction of directions) {
    await page.keyboard.press("ControlOrMeta+Shift+A");
    await page.keyboard.press("ControlOrMeta+Shift+H");
    await page.waitForTimeout(350);
    const canvas = await canvasLocator.boundingBox();
    expect(canvas).not.toBeNull();
    const start = {
      x: canvas!.x + canvas!.width * 0.5,
      y: canvas!.y + canvas!.height * 0.87,
    };
    const edge = direction === "right"
      ? { x: canvas!.x + canvas!.width - 3, y: start.y }
      : direction === "left"
        ? { x: canvas!.x + 3, y: start.y }
        : direction === "bottom"
          ? { x: start.x, y: canvas!.y + canvas!.height - 3 }
          : { x: start.x, y: canvas!.y + 3 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y, { steps: 8 });
    await expect(page.locator(".react-flow__selection")).toBeVisible();
    await page.waitForTimeout(40);
    const atArrival = await canvasTransform(page);
    const framesAtArrival = Number(await canvasLocator.getAttribute("data-auto-pan-frame-count"));
    await expect(canvasLocator).toHaveAttribute("data-auto-pan-active", "true");
    await expect(canvasLocator).toHaveAttribute("data-auto-pan-pressured", "true");
    await page.waitForTimeout(220);
    const afterHold = await canvasTransform(page);
    const framesAfterHold = Number(await canvasLocator.getAttribute("data-auto-pan-frame-count"));
    const movedFramesAfterHold = Number(await canvasLocator.getAttribute("data-auto-pan-moved-frame-count"));
    expect(framesAfterHold).toBeGreaterThan(framesAtArrival + 2);
    expect(movedFramesAfterHold).toBeGreaterThan(2);
    if (direction === "right") expect(afterHold.x).toBeLessThan(atArrival.x - 12);
    if (direction === "left") expect(afterHold.x).toBeGreaterThan(atArrival.x + 12);
    if (direction === "bottom") expect(afterHold.y).toBeLessThan(atArrival.y - 12);
    if (direction === "top") expect(afterHold.y).toBeGreaterThan(atArrival.y + 12);

    await page.mouse.up();
    const atRelease = await canvasTransform(page);
    await page.waitForTimeout(100);
    const afterRelease = await canvasTransform(page);
    expect(afterRelease.x).toBeCloseTo(atRelease.x, 1);
    expect(afterRelease.y).toBeCloseTo(atRelease.y, 1);
  }

  await page.keyboard.press("ControlOrMeta+Shift+A");
  await page.keyboard.press("ControlOrMeta+Shift+H");
  await page.waitForTimeout(350);
  const canvas = await canvasLocator.boundingBox();
  expect(canvas).not.toBeNull();
  const start = {
    x: canvas!.x + canvas!.width * 0.5,
    y: canvas!.y + canvas!.height * 0.87,
  };
  const edge = { x: canvas!.x + canvas!.width - 3, y: start.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y, { steps: 8 });
  await expect(canvasLocator).toHaveAttribute("data-auto-pan-active", "true");
  await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(canvasLocator).toHaveAttribute("data-auto-pan-active", "false");
  const atBlur = await canvasTransform(page);
  await page.waitForTimeout(120);
  const afterBlur = await canvasTransform(page);
  expect(afterBlur.x).toBeCloseTo(atBlur.x, 1);
  expect(afterBlur.y).toBeCloseTo(atBlur.y, 1);
  await page.mouse.up();
});

test("keeps a route segment under a stationary edge pointer while auto-panning", async ({ page, browserName }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "viewport-auto-pan-proof.block-design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(viewportAutoPanDesignDocument())),
  });
  await expect(page.locator(".bd-document-title span")).toHaveText("Viewport Edge Auto-Pan");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0);
  await page.waitForTimeout(350);

  const edge = page.locator('.react-flow__edge[data-id="system::review-flow"]');
  await clickReachableEdgePoint(page, edge);
  const segment = edge.locator('.bd-route-segment-handle[data-route-axis="v"]').first();
  const segmentBox = await segment.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(segmentBox && canvas).not.toBeNull();
  const pointerId = 87;
  const start = { x: segmentBox!.x + segmentBox!.width / 2, y: segmentBox!.y + segmentBox!.height / 2 };
  const target = {
    x: canvas!.x + canvas!.width - 16,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };
  await segment.dispatchEvent("pointerdown", {
    pointerId,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  await page.evaluate(({ pointerId: id, target: point }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: id,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }));
  }, { pointerId, target });
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);

  const pointerDistance = await edge.locator(".bd-route-preview").evaluate((path, point) => {
    const route = path as SVGPathElement;
    const matrix = route.getScreenCTM();
    if (!matrix) return Number.POSITIVE_INFINITY;
    const length = route.getTotalLength();
    let closest = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 120; index += 1) {
      const sample = route.getPointAtLength((length * index) / 120);
      const screen = new DOMPoint(sample.x, sample.y).matrixTransform(matrix);
      closest = Math.min(closest, Math.hypot(screen.x - point.x, screen.y - point.y));
    }
    return closest;
  }, target);
  expect(pointerDistance).toBeLessThan(16);
  const liveHandleDistance = await edge.locator(".bd-route-live-handle").evaluate((circle, point) => {
    const handle = circle as SVGCircleElement;
    const matrix = handle.getScreenCTM();
    if (!matrix) return Number.POSITIVE_INFINITY;
    const screen = new DOMPoint(handle.cx.baseVal.value, handle.cy.baseVal.value).matrixTransform(matrix);
    return Math.hypot(screen.x - point.x, screen.y - point.y);
  }, target);
  expect(liveHandleDistance).toBeLessThan(16);
  if (process.env.CAPTURE_VIEWPORT_AUTO_PAN === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/viewport-edge-auto-pan.png");
  }

  await page.evaluate(({ pointerId: id, target: point }) => {
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: id,
      button: 0,
      clientX: point.x,
      clientY: point.y,
    }));
  }, { pointerId, target });
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
});

test("keeps a resize corner under a stationary edge pointer while auto-panning", async ({ page }) => {
  const node = flowNode(page, "system::platform-provider");
  await node.click({ force: true });
  const handle = node.locator(".bd-node-resize-handle.bottom.right");
  const before = await node.boundingBox();
  const handleBox = await handle.boundingBox();
  const canvas = await page.locator(".bd-react-flow").boundingBox();
  expect(before && handleBox && canvas).not.toBeNull();
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  const target = {
    x: canvas!.x + canvas!.width - 4,
    y: Math.max(canvas!.y + 80, Math.min(canvas!.y + canvas!.height - 80, start.y)),
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.waitForTimeout(40);
  const atArrival = await canvasTransform(page);
  await page.waitForTimeout(220);
  const afterHold = await canvasTransform(page);
  expect(afterHold.x).toBeLessThan(atArrival.x - 12);
  const liveHandle = await handle.boundingBox();
  expect(liveHandle).not.toBeNull();
  expect(Math.abs(liveHandle!.x + liveHandle!.width / 2 - target.x)).toBeLessThan(18);
  await page.mouse.up();
  await waitForEditorIdle(page);

  const after = await node.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.width).toBeGreaterThan(before!.width + 80);
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
});

test("resizes a selected module from a corner and persists one atomic geometry change", async ({ page, browserName }) => {
  const node = flowNode(page, "system::platform-provider");
  const connectedEdge = page.locator('.react-flow__edge[data-id="system::platform-tool-registration"]');
  await node.click({ force: true });
  const viewportBeforeResize = await canvasViewportTransform(page);
  await expect(node.locator(".bd-node-resize-handle")).toHaveCount(4);
  await expect(node.locator(".bd-node-resize-line")).toHaveCount(4);
  const before = await node.boundingBox();
  const routeBefore = await connectedEdge.locator(".bd-interface-route").getAttribute("d");
  const handle = node.locator(".bd-node-resize-handle.bottom.right");
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 30,
    handleBox!.y + handleBox!.height / 2 + 40,
    { steps: 10 },
  );
  await page.mouse.up();
  await waitForEditorIdle(page);
  expect(await canvasViewportTransform(page)).toBe(viewportBeforeResize);

  const after = await node.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.width).toBeGreaterThan(before!.width + 20);
  expect(after!.height).toBeGreaterThan(before!.height + 30);
  await expect.poll(() => connectedEdge.locator(".bd-interface-route").getAttribute("d"))
    .not.toBe(routeBefore);
  const sizeText = await page.getByRole("region", { name: "Module geometry" }).locator("strong").innerText();
  const [width, height] = sizeText.split("×").map((value) => Number(value.trim()));
  expect(width).toBeGreaterThan(240);
  expect(height).toBeGreaterThan(145);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  if (process.env.CAPTURE_NODE_RESIZE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/node-resize.png");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "platform-provider",
  );
  expect(savedNode.layout).toMatchObject({
    pinned: true,
    position: { x: 1240, y: 650 },
    width,
    height,
  });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("240 × 145");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText(sizeText);
});

test("preserves a module's original proportions while Shift-resizing", async ({ page, browserName }) => {
  const node = flowNode(page, "system::platform-provider");
  const connectedEdge = page.locator('.react-flow__edge[data-id="system::platform-tool-registration"]');
  await node.click({ force: true });
  const before = await node.boundingBox();
  const routeBefore = await connectedEdge.locator(".bd-interface-route").getAttribute("d");
  expect(before).not.toBeNull();
  const originalRatio = before!.width / before!.height;
  const handle = node.locator(".bd-node-resize-handle.bottom.right");

  await page.keyboard.down("Shift");
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 56, start.y + 18, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await waitForEditorIdle(page);

  const after = await node.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.width).toBeGreaterThan(before!.width + 35);
  expect(after!.height).toBeGreaterThan(before!.height + 20);
  expect(after!.width / after!.height).toBeCloseTo(originalRatio, 2);
  await expect.poll(() => connectedEdge.locator(".bd-interface-route").getAttribute("d"))
    .not.toBe(routeBefore);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  if (process.env.CAPTURE_ASPECT_RESIZE === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/aspect-ratio-resize.png");
  }

  const sizeText = await page.getByRole("region", { name: "Module geometry" }).locator("strong").innerText();
  const [width, height] = sizeText.split("×").map((value) => Number(value.trim()));
  expect(width / height).toBeCloseTo(240 / 145, 2);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "platform-provider",
  );
  expect(savedNode.layout).toMatchObject({ width, height });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("240 × 145");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText(sizeText);
});

test("matches a sibling size while resizing and lets Alt bypass size snapping", async ({ page, browserName }) => {
  const node = flowNode(page, "system::platform-provider");
  await node.click({ force: true });

  const resizeWidthBy = async (deltaX: number, disableSnap = false) => {
    const handle = node.locator(".bd-node-resize-line.right");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (disableSnap) await page.keyboard.down("Alt");
    await page.mouse.move(start.x + deltaX, start.y, { steps: 8 });
    await page.waitForTimeout(120);
  };

  await resizeWidthBy(8);
  const sizeGuides = page.locator('.bd-size-guide-width[data-target-id="system::agent-ui"]');
  await expect(sizeGuides).toHaveCount(2);
  await expect(page.locator('.bd-size-guide-width[data-role="subject"]')).toBeVisible();
  await expect(page.locator('.bd-size-guide-width[data-role="target"]')).toBeVisible();
  const resizedPreview = await node.boundingBox();
  const matchingSibling = await flowNode(page, "system::agent-ui").boundingBox();
  expect(resizedPreview).not.toBeNull();
  expect(matchingSibling).not.toBeNull();
  expect(Math.abs(resizedPreview!.width - matchingSibling!.width)).toBeLessThan(1);
  if (process.env.CAPTURE_ALIGNMENT_GUIDES === "1" && browserName === "chromium") {
    await captureStudioScreenshot(page, "docs/screenshots/same-size-guides.png");
  }
  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("250 × 145");
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const savedPath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  const savedNode = saved.levels.find((level: { id: string }) => level.id === "system").nodes.find(
    (candidate: { id: string }) => candidate.id === "platform-provider",
  );
  expect(savedNode.layout).toMatchObject({ width: 250, height: 145 });

  await page.keyboard.press("ControlOrMeta+Z");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("240 × 145");
  await resizeWidthBy(8, true);
  await expect(page.locator(canvasGuideSelector)).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await waitForEditorIdle(page);
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("253 × 145");

  const precisionDownloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+S");
  const precisionSavedPath = await (await precisionDownloadPromise).path();
  const precisionSaved = JSON.parse(await readFile(precisionSavedPath!, "utf8"));
  const precisionSavedNode = precisionSaved.levels
    .find((level: { id: string }) => level.id === "system").nodes
    .find((candidate: { id: string }) => candidate.id === "platform-provider");
  expect(precisionSavedNode.layout).toMatchObject({ width: 253, height: 145 });
});

test("resizes a focused module only with the draw.io keyboard chord", async ({ page }) => {
  const node = flowNode(page, "system::agent-ui");
  await node.click({ force: true });
  await node.focus();
  await expect(node).toBeFocused();

  const initialBounds = await node.boundingBox();
  expect(initialBounds).not.toBeNull();
  await page.keyboard.press("Shift+ArrowRight");
  await waitForEditorIdle(page);
  await expect(node).toBeFocused();
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("250 × 175");
  const shiftOnlyBounds = await node.boundingBox();
  expect(shiftOnlyBounds).not.toBeNull();
  expect(shiftOnlyBounds!.x).toBeCloseTo(initialBounds!.x, 4);
  expect(shiftOnlyBounds!.y).toBeCloseTo(initialBounds!.y, 4);

  await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
  await waitForEditorIdle(page);
  await expect(node).toBeFocused();
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("266 × 175");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
  await waitForEditorIdle(page);
  await expect(node).toBeFocused();
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("266 × 191");
  await expect(page.locator(".bd-canvas-announcement")).toHaveText(
    "Resized Agent UI. Width 266, height 191.",
  );
});

test("rejects a resize while Inspector properties are unapplied and restores preview geometry", async ({ page }) => {
  const node = flowNode(page, "system::agent-ui");
  const inspector = page.getByRole("region", { name: "Properties" });
  await node.click({ force: true });
  await inspector.getByLabel("Title").fill("Agent UI draft");
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toBeVisible();
  const before = await node.boundingBox();
  const handle = node.locator(".bd-node-resize-handle.bottom.right");
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 36,
    handleBox!.y + handleBox!.height / 2 + 28,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.locator(".bd-command-error")).toContainText("before resizing a module");
  await expect.poll(async () => {
    const restored = await node.boundingBox();
    return restored ? { width: Math.round(restored.width), height: Math.round(restored.height) } : null;
  }).toEqual({ width: Math.round(before!.width), height: Math.round(before!.height) });
  await expect(inspector.getByLabel("Title")).toHaveValue("Agent UI draft");
  await expect(page.getByRole("region", { name: "Module geometry" }).locator("strong")).toHaveText("250 × 175");
});

test("keeps the installed design when a replacement is structurally invalid", async ({ page }) => {
  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(invalidPath);

  await expect(page.locator(".bd-load-error")).toContainText(
    "does not match BlockDesignDocument v2",
  );
  await expect(page.locator(".bd-document-title span")).toHaveText("AIO Agent Runtime");
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
});

test("authors, connects, nests, undoes, saves, and reloads a local module design", async ({ page }) => {
  test.setTimeout(process.env.CAPTURE_EDITOR_PROOF === "1" ? 360_000 : 180_000);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await toolbarButton(page, "New Design...").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Payments Architecture");
  await newDialog.getByLabel("Design id").fill("payments-architecture");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await expect(page.locator(".bd-document-title span")).toHaveText("Payments Architecture *");
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  await addModule(page, { title: "Public API", id: "api", owner: "API Team" });
  await expect(flowNode(page, "system::api")).toBeVisible();

  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Purpose").fill("Accept validated payment requests.");
  await inspector.getByLabel("Boundary").fill("Owns the external request boundary only.");
  await inspector.getByLabel("Failure behavior").fill("Rejects malformed requests without dispatching work.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await addPort(page, { label: "requests", id: "requests", direction: "input", side: "left", dataType: "PaymentRequest" });

  await addModule(page, { title: "Payment Worker", id: "worker", owner: "Payments Team" });
  await inspector.getByLabel("Purpose", { exact: true }).fill("Execute accepted payment work.");
  await inspector.getByLabel("Boundary", { exact: true }).fill("Owns payment execution, not request admission.");
  await inspector.getByLabel("Failure behavior", { exact: true }).fill("Returns a typed failure without mutating the API boundary.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await addPort(page, { label: "responses", id: "responses", direction: "output", side: "right", dataType: "PaymentResult" });

  const source = flowNode(page, "system::worker").locator('.bd-port-handle-outer[data-handleid="responses"]');
  const target = flowNode(page, "system::api").locator('.bd-port-handle-outer[data-handleid="requests"]');
  await dragConnection(page, source, target);
  const connectionDialog = page.getByRole("dialog", { name: "Create Typed Interface" });
  await expect(connectionDialog).toBeVisible();
  await connectionDialog.getByLabel("Interface title").fill("Payment Result Event");
  await connectionDialog.getByLabel("Connection id").fill("worker-to-api");
  await connectionDialog.getByLabel("Interface id").fill("payments.result");
  await connectionDialog.getByLabel("Interface type").selectOption("event");
  await connectionDialog.getByLabel("Owner").fill("Payments Team");
  await connectionDialog.getByRole("button", { name: "Create Connection", exact: true }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".bd-inspector-title h2")).toHaveText("Payment Result Event");
  await inspector.getByLabel("Purpose", { exact: true }).fill("Return the typed payment result to the API.");
  await inspector.getByLabel("Boundary", { exact: true }).fill("Carries result facts without owning payment state.");
  await inspector.getByLabel("Failure behavior", { exact: true }).fill("A missing consumer is reported as an interface delivery failure.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  const workerPosition = await flowNode(page, "system::worker").boundingBox();
  const apiPosition = await flowNode(page, "system::api").boundingBox();
  expect(workerPosition).not.toBeNull();
  expect(apiPosition).not.toBeNull();
  expect(workerPosition!.x).toBeLessThan(apiPosition!.x);
  if (process.env.CAPTURE_EDITOR_PROOF === "1") {
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/editor-polished-workbench.png");
  }

  await flowNode(page, "system::api").click({ force: true });
  await toolbarButton(page, "Create Child Design...").click({ force: true });
  const childDialog = page.getByRole("dialog", { name: /Create Child Design/ });
  await childDialog.getByLabel("Child design title").fill("API Internals");
  await childDialog.getByLabel("Child level id").fill("api-internals");
  await childDialog.getByRole("button", { name: "Create Child Design", exact: true }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-level-chip")).toHaveText("1 expanded");

  await addModule(page, { title: "Request Handler", id: "handler", owner: "API Team" });
  await inspector.getByLabel("Purpose", { exact: true }).fill("Adapt validated requests to internal work.");
  await inspector.getByLabel("Boundary", { exact: true }).fill("Owns request adaptation inside the API module.");
  await inspector.getByLabel("Failure behavior", { exact: true }).fill("Rejects unsupported requests before worker dispatch.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await addPort(page, { label: "requests", id: "requests", direction: "input", side: "left", dataType: "PaymentRequest" });
  await page.locator(".bd-tree-select").filter({ hasText: "Public API" }).click({ force: true });
  await inspector.locator(".bd-contract-fieldset").filter({ hasText: "Hierarchy port bindings" }).locator("select").selectOption("handler:requests");
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");

  await toolbarButton(page, "Undo").click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("1 errors");
  await toolbarButton(page, "Redo").click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await waitForEditorIdle(page);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    microSegments: [],
    sharedRoutes: [],
  });
  await expect(page.locator(".bd-interface-underlay")).toHaveCount(2);
  if (process.env.CAPTURE_EDITOR_PROOF === "1") {
    await runMenuCommand(page, "View", "Toggle Sources");
    await runMenuCommand(page, "View", "Toggle Properties");
    await page.waitForTimeout(400);
    await toolbarButton(page, "Fit Design").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/editor-routing-validation.png");
    await runMenuCommand(page, "View", "Toggle Sources");
    await runMenuCommand(page, "View", "Toggle Properties");
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: "File", exact: true }).click({ force: true });
  await page.getByRole("menuitem", { name: /^Save As\.\.\./ }).click({ force: true });
  const saveDialog = page.getByRole("dialog", { name: "Save Design As" });
  await saveDialog.getByLabel("File name").fill("payments.block-design.json");
  const downloadPromise = page.waitForEvent("download");
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click({ force: true });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("payments.block-design.json");
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const savedDocument = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(savedDocument.title).toBe("Payments Architecture");
  expect(savedDocument.levels).toHaveLength(2);
  expect(savedDocument.interfaceDefinitions["payments.result"].owner).toBe("Payments Team");
  expect(savedDocument.levels[0].nodes.find((node: { id: string }) => node.id === "api").hierarchy.portBindings).toEqual([
    { parentPortId: "requests", childEndpoint: { nodeId: "handler", portId: "requests" } },
  ]);
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  await openDesignDialog(page);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await waitForEditorIdle(page);
  await expect(page.locator(".bd-document-title span")).toHaveText("Payments Architecture");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await flowNode(page, "system::api").click({ force: true });

  await inspector.getByLabel("Title").fill("Public API v2");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::api").locator("h3")).toHaveText("Public API v2");
  page.once("dialog", async (dialog) => dialog.dismiss());
  await toolbarButton(page, "New Design...").click({ force: true });
  await expect(page.getByRole("dialog", { name: "New Design" })).toHaveCount(0);
  await expect(page.locator(".bd-document-title span")).toHaveText("Payments Architecture *");
  expect(browserErrors).toEqual([]);
});

test("moves, edits, deletes, restores, saves, and exports authored facts", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await toolbarButton(page, "New Design...").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Worker Design");
  await newDialog.getByLabel("Design id").fill("worker-design");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await addModule(page, { title: "Worker", id: "worker", owner: "Runtime Team" });
  const worker = flowNode(page, "system::worker");
  await toolbarButton(page, "Add Module...").click({ force: true });
  const duplicateDialog = page.getByRole("dialog", { name: /Add Module/ });
  await duplicateDialog.getByLabel("Module title").fill("Duplicate Worker");
  await duplicateDialog.getByLabel("Module id").fill("worker");
  await duplicateDialog.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await expect(duplicateDialog.getByRole("alert")).toContainText("already exists");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await duplicateDialog.getByRole("button", { name: "Cancel" }).click({ force: true });
  const beforeMove = await transformOf(worker);
  const workerBox = await worker.boundingBox();
  expect(workerBox).not.toBeNull();
  await page.mouse.move(workerBox!.x + 100, workerBox!.y + 15);
  await page.mouse.down();
  await page.mouse.move(workerBox!.x + 220, workerBox!.y + 95, { steps: 12 });
  await page.mouse.up();
  await waitForEditorIdle(page);
  await expect.poll(() => transformOf(worker)).not.toBe(beforeMove);
  await expect(worker.locator(".bd-pin-indicator")).toBeVisible();

  await worker.click({ force: true });
  await addPort(page, { label: "events", id: "events", direction: "input", side: "left", dataType: "Event" });
  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Label").fill("events-out");
  await inspector.getByLabel("Direction").selectOption("output");
  await inspector.getByRole("combobox", { name: "Side", exact: true }).selectOption("right");
  await inspector.getByLabel("Required connection").uncheck({ force: true });
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toContainText("events-out");

  const saveDownloadPromise = page.waitForEvent("download");
  await toolbarButton(page, "Save").click({ force: true });
  const saveDownload = await saveDownloadPromise;
  expect(saveDownload.suggestedFilename()).toBe("worker-design.block-design.json");
  await expect(page.locator(".bd-statusbar")).toContainText("Saved");

  await inspector.getByLabel("Data type").fill("DomainEvent");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");
  await page.getByRole("button", { name: "File", exact: true }).click({ force: true });
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export JSON", exact: true }).click({ force: true });
  const exportDownload = await exportPromise;
  expect(exportDownload.suggestedFilename()).toBe("worker-design.export.block-design.json");
  await expect(page.locator(".bd-statusbar")).toContainText("Unsaved changes");

  page.once("dialog", async (dialog) => dialog.accept());
  await toolbarButton(page, "Delete Selection").click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toHaveCount(0);
  await toolbarButton(page, "Undo").click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toContainText("events-out");

  await worker.click({ force: true });
  page.once("dialog", async (dialog) => dialog.accept());
  await toolbarButton(page, "Delete Selection").click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await toolbarButton(page, "Undo").click({ force: true });
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::worker")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
