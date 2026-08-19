import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import axe, { type AxeResults } from "axe-core";
import { performanceDesignDocument } from "./fixtures/performanceDesign";
import { createPerformanceSample, emitPerformanceSample } from "./performance/performanceSample";

const examplePath = fileURLToPath(
  new URL("../public/examples/aio-agent-runtime.block-design.json", import.meta.url),
);
const invalidPath = fileURLToPath(new URL("./fixtures/invalid.block-design.json", import.meta.url));
const legacyPath = fileURLToPath(new URL("./fixtures/legacy-v2.0.block-design.json", import.meta.url));
const browserProblems = new WeakMap<Page, string[]>();
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

function toolbarButton(page: Page, name: string): Locator {
  return page
    .getByRole("toolbar", { name: "Architecture design tools" })
    .getByRole("button", { name, exact: true });
}

async function clickWithPointer(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function canvasViewportTransform(page: Page): Promise<string> {
  return page.locator(".react-flow__viewport").evaluate(
    (element: HTMLElement) => element.style.transform,
  );
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
      const points = [...path.getAttribute("d")!.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),?\s*(-?\d+(?:\.\d+)?)/g)]
        .map((match) => new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix));
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
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(250);
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
  await toolbarButton(page, "添加模块").click({ force: true });
  const dialog = page.getByRole("dialog", { name: /Add Module/ });
  await dialog.getByLabel("Module title").fill(values.title);
  await dialog.getByLabel("Module id").fill(values.id);
  if (values.owner) await dialog.getByLabel("Owner").fill(values.owner);
  await dialog.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);
}

async function addPort(page: Page, values: {
  label: string;
  id: string;
  direction: "input" | "output" | "bidirectional";
  side: "left" | "right" | "top" | "bottom";
  dataType?: string;
}): Promise<void> {
  await toolbarButton(page, "添加端口").click({ force: true });
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

async function expandHierarchy(page: Page, title: string): Promise<void> {
  const expandedBefore = Number.parseInt(await page.locator(".bd-level-chip").innerText(), 10);
  await page.getByRole("button", { name: `展开 ${title}`, exact: true }).click({ force: true });
  await expect(page.locator(".bd-level-chip")).toHaveText(`${expandedBefore + 1} expanded`);
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: `折叠 ${title}`, exact: true })).toBeVisible();
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

async function clickReachableEdgePoint(page: Page, edge: Locator): Promise<void> {
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

    return { collisions, labelOverlaps, siblingOverlaps, boundaryEscapes, endpointIntrusions, sharedRoutes };
  });
}

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
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
  await expect(page.locator(".bd-statusbar")).toContainText("BlockDesignDocument 2.1");
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
  await expect(agentUi.locator(".bd-port-label small").first()).toBeVisible();
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    sharedRoutes: [],
  });

  const overflow = await page.evaluate(() => [
    document.body.scrollWidth - window.innerWidth,
    document.body.scrollHeight - window.innerHeight,
  ]);
  expect(overflow).toEqual([0, 0]);
});

test("keeps the compact desktop workbench operable without panel or route obstruction", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await toolbarButton(page, "适应窗口").click({ force: true });

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

  await toolbarButton(page, "Messages").click({ force: true });
  await expect(page.locator(".bd-messages")).toBeVisible();
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

  if (process.env.CAPTURE_COMPACT_WORKBENCH === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/compact-workbench.png");
  }
});

test("reveals one unobtrusive tooltip path for toolbar and canvas controls", async ({ page }) => {
  const tooltip = page.getByRole("tooltip");
  const save = toolbarButton(page, "保存设计");

  await expect(page.locator(".bd-toolbar button[title], .bd-canvas-controls button[title]")).toHaveCount(0);
  await save.hover();
  await expect(tooltip).toHaveCount(0);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("保存设计");
  await expect(tooltip).toContainText("Ctrl/⌘ S");

  const toolbarGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.bd-toolbar button[aria-label="保存设计"]');
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
    .getByRole("button", { name: /^添加端口 — Select a module first\.$/ });
  await unavailablePort.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("添加端口");
  await expect(tooltip).toContainText("Select a module first.");
  expect((await accessibilityResults(page, '[role="tooltip"]')).violations).toEqual([]);
  expect(await textContrastIssues(page, '[role="tooltip"]')).toEqual([]);
  if (process.env.CAPTURE_TOOLTIP_PROOF === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/command-tooltip.png");
  }

  await page.mouse.move(700, 420);
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
  await toolbarButton(page, "适应窗口").click({ force: true });
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
  await toolbarButton(page, "Messages").click({ force: true });
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
  await page.getByRole("button", { name: "新建设计", exact: true }).click();
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

  const addPortTool = page.getByRole("button", { name: /^添加端口/ });
  const addInterfaceTool = page.getByRole("button", { name: /^添加接口/ });
  const addChildTool = page.getByRole("button", { name: /^创建子设计/ });
  await expect(addPortTool).toHaveAttribute("aria-label", "添加端口 — Select a module first.");
  await expect(addInterfaceTool).toHaveAttribute("aria-label", "添加接口 — Add compatible output/input ports to this level first.");

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
    "创建子设计 — Use this module's hierarchy control to open its child design.",
  );
});

test("guides a new user from an empty design to the first module", async ({ page }) => {
  await toolbarButton(page, "新建设计").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Review Workbench");
  await newDialog.getByLabel("Design id").fill("review-workbench");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });

  const emptyState = page.getByRole("region", { name: "Start with a module" });
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("Module");
  await expect(emptyState).toContainText("Port");
  await expect(emptyState).toContainText("Interface");
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
  await toolbarButton(page, "新建设计").click({ force: true });
  const newDesign = page.getByRole("dialog", { name: "New Design" });
  await newDesign.getByLabel("Design title").fill("Checkout Platform");
  await expect(newDesign.getByLabel("Design id")).toHaveValue("checkout-platform");
  await newDesign.getByLabel("Design id").fill("checkout-system");
  await newDesign.getByLabel("Design title").fill("Checkout Platform v2");
  await expect(newDesign.getByLabel("Design id")).toHaveValue("checkout-system");
  await newDesign.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "添加模块").click({ force: true });
  const firstModule = page.getByRole("dialog", { name: /Add Module/ });
  await firstModule.getByLabel("Module title").fill("Payment Worker");
  await expect(firstModule.getByLabel("Module id")).toHaveValue("payment-worker");
  await firstModule.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "添加模块").click({ force: true });
  const secondModule = page.getByRole("dialog", { name: /Add Module/ });
  await secondModule.getByLabel("Module title").fill("Payment Worker");
  await expect(secondModule.getByLabel("Module id")).toHaveValue("payment-worker-2");
  if (process.env.CAPTURE_LINKED_IDS === "1") {
    await captureStudioScreenshot(page, "docs/screenshots/linked-id-suggestion.png");
  }
  await secondModule.getByRole("button", { name: "Add Module", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "添加端口").click({ force: true });
  const firstPort = page.getByRole("dialog", { name: /Add Port/ });
  await firstPort.getByLabel("Port label").fill("Session Events");
  await expect(firstPort.getByLabel("Port id")).toHaveValue("session-events");
  await firstPort.getByLabel("Required connection").uncheck({ force: true });
  await firstPort.getByRole("button", { name: "Add Port", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await toolbarButton(page, "添加端口").click({ force: true });
  const secondPort = page.getByRole("dialog", { name: /Add Port/ });
  await secondPort.getByLabel("Port label").fill("Session Events");
  await expect(secondPort.getByLabel("Port id")).toHaveValue("session-events-2");
  await secondPort.getByLabel("Required connection").uncheck({ force: true });
  await secondPort.getByRole("button", { name: "Add Port", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await flowNode(page, "system::payment-worker").click({ force: true });
  await toolbarButton(page, "创建子设计").click({ force: true });
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
  await agentUi.click({ force: true });
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

  const acceptDialogPromise = page.waitForEvent("dialog");
  const acceptedNavigation = project.click({ force: true });
  const acceptDialog = await acceptDialogPromise;
  await acceptDialog.accept();
  await acceptedNavigation;
  await expect(inspector.getByLabel("Title")).toHaveValue("Project");

  await inspector.getByLabel("Title").fill("Project draft");
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toBeVisible();
  await toolbarButton(page, "保存设计").click({ force: true });
  await expect(page.locator(".bd-command-error")).toContainText("before saving");
  await expect(inspector.getByLabel("Title")).toHaveValue("Project draft");

  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(inspector.getByText("UNAPPLIED", { exact: true })).toHaveCount(0);
  await expect(inspector.getByLabel("Title")).toHaveValue("Project draft");
});

test("keeps keyboard focus inside dialogs and restores the invoking command", async ({ page }) => {
  const newButton = toolbarButton(page, "新建设计");
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

  const openButton = toolbarButton(page, "打开设计");
  await openButton.focus();
  await openButton.click({ force: true });
  const openDialog = page.getByRole("dialog", { name: "Open Design" });
  await expect(openDialog.getByRole("button", { name: "Choose JSON file" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openDialog).toHaveCount(0);
  await expect(openButton).toBeFocused();
});

test("filters design issues and cross-probes the reviewed module", async ({ page }) => {
  await toolbarButton(page, "新建设计").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Review Workbench");
  await newDialog.getByLabel("Design id").fill("review-workbench");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await addModule(page, { title: "Public API", id: "api" });

  const viewTrigger = page.getByRole("button", { name: "View", exact: true });
  await viewTrigger.focus();
  await page.keyboard.press("Enter");
  const viewMenu = page.getByRole("menu", { name: "View" });
  await expect(viewMenu.getByRole("menuitem", { name: /^Fit Design/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
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
  const positions = await toolbarButton(page, "新建设计").evaluate(async (button) => {
    const samples: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      const rect = button.getBoundingClientRect();
      samples.push(`${rect.x}:${rect.y}:${rect.width}:${rect.height}`);
    }
    return samples;
  });
  expect(new Set(positions).size).toBe(1);
  await toolbarButton(page, "新建设计").evaluate((button: HTMLButtonElement) => button.click());
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
  const addInterface = toolbarButton(page, "添加接口");
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
  test.setTimeout(120_000);
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

  await tabTo(page, toolbarButton(page, "验证设计"), 160, "backward");
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
    await toolbarButton(page, "适应窗口").click({ force: true });
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
    sharedRoutes: [],
  });
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

  await toolbarButton(page, "Sources").click({ force: true });
  expect((await sources.boundingBox())!.width).toBeLessThan(60);
  await toolbarButton(page, "Sources").click({ force: true });
  expect((await sources.boundingBox())!.width).toBeGreaterThan(250);

  const diagramBefore = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  await toolbarButton(page, "最大化或还原画布").click({ force: true });
  const diagramMaximized = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  expect(diagramMaximized!.width).toBeGreaterThan(diagramBefore!.width + 300);
  await toolbarButton(page, "最大化或还原画布").click({ force: true });

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

test("optimizes routes without moving blocks and regenerates placement separately", async ({ page }) => {
  const project = flowNode(page, "system::project");
  const before = await transformOf(project);

  await toolbarButton(page, "仅优化布线").evaluate((button: HTMLButtonElement) => button.click());
  expect(await transformOf(project)).toBe(before);

  await toolbarButton(page, "重新生成布局").evaluate((button: HTMLButtonElement) => button.click());
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
  await expect(page.locator(".bd-statusbar")).toContainText("BlockDesignDocument 2.1");
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
    await toolbarButton(page, "撤销").click({ force: true });
    await expect(page.locator(".bd-inspector-title h2")).toContainText("Revision 9");
    metrics.historyUndoMs = Math.round(performance.now() - undoStarted);
    const redoStarted = performance.now();
    await toolbarButton(page, "重做").click({ force: true });
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
  if (stress) {
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
    const points = [...(path.getAttribute("d") ?? "").matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),?\s*(-?\d+(?:\.\d+)?)/g)];
    if (!matrix || !canvas || points.length < 2) return false;
    return points.every((match) => {
      const point = new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix);
      return point.x >= canvas.left && point.x <= canvas.right && point.y >= canvas.top && point.y <= canvas.bottom;
    });
  })).toBe(true);
  metrics.revealInterfaceMs = Math.round(performance.now() - revealInterfaceStarted);

  const saveStarted = performance.now();
  const downloadPromise = page.waitForEvent("download");
  await clickWithPointer(page, toolbarButton(page, "保存设计"));
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
  await toolbarButton(page, "保存设计").click({ force: true });
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.schemaVersion).toBe("2.1");
  expect(saved.levels[0].connections.find((connection: { id: string }) => connection.id === "ui-session-command").routing.waypoints.length).toBeGreaterThanOrEqual(2);

  await inspector.getByRole("button", { name: "Reset to automatic routing" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="automatic"]')).toBeVisible();
  await toolbarButton(page, "撤销").click({ force: true });
  await waitForEditorIdle(page);
  await expect(edge.locator('[data-routing-mode="manual"]')).toBeVisible();
});

test("selects and edits an orthogonal route entirely from the keyboard", async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="system::ui-session-command"]');
  await tabTo(page, edge);
  await expect(edge).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(edge).toHaveClass(/selected/);
  await expect(page.locator(".bd-inspector-title h2")).toContainText("Session Command");

  const handle = edge.locator(".bd-route-handle").first();
  await expect(handle).toBeVisible();
  expect((await accessibilityResults(page, ".bd-route-handle-object")).violations).toEqual([]);
  await page.keyboard.press("Tab");
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

test("moves a selected module through the document with the keyboard", async ({ page }) => {
  const node = flowNode(page, "system::agent-ui");
  await tabTo(page, node);
  await expect(node).toBeFocused();
  await page.keyboard.press("Enter");
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
  await toolbarButton(page, "新建设计").click({ force: true });
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
    await toolbarButton(page, "适应窗口").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/editor-polished-workbench.png");
  }

  await flowNode(page, "system::api").click({ force: true });
  await toolbarButton(page, "创建子设计").click({ force: true });
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

  await toolbarButton(page, "撤销").click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("1 errors");
  await toolbarButton(page, "重做").click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await waitForEditorIdle(page);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    endpointIntrusions: [],
    sharedRoutes: [],
  });
  await expect(page.locator(".bd-interface-underlay")).toHaveCount(2);
  if (process.env.CAPTURE_EDITOR_PROOF === "1") {
    await toolbarButton(page, "Sources").click({ force: true });
    await toolbarButton(page, "Properties").click({ force: true });
    await page.waitForTimeout(400);
    await toolbarButton(page, "适应窗口").click({ force: true });
    await page.waitForTimeout(400);
    await captureStudioScreenshot(page, "docs/screenshots/editor-routing-validation.png");
    await toolbarButton(page, "Sources").click({ force: true });
    await toolbarButton(page, "Properties").click({ force: true });
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
  await toolbarButton(page, "新建设计").click({ force: true });
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
  await toolbarButton(page, "新建设计").click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Worker Design");
  await newDialog.getByLabel("Design id").fill("worker-design");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await addModule(page, { title: "Worker", id: "worker", owner: "Runtime Team" });
  const worker = flowNode(page, "system::worker");
  await toolbarButton(page, "添加模块").click({ force: true });
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
  await inspector.getByLabel("Side").selectOption("right");
  await inspector.getByLabel("Required connection").uncheck({ force: true });
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toContainText("events-out");

  const saveDownloadPromise = page.waitForEvent("download");
  await toolbarButton(page, "保存设计").click({ force: true });
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
  await toolbarButton(page, "删除所选内容").click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toHaveCount(0);
  await toolbarButton(page, "撤销").click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toContainText("events-out");

  await worker.click({ force: true });
  page.once("dialog", async (dialog) => dialog.accept());
  await toolbarButton(page, "删除所选内容").click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await toolbarButton(page, "撤销").click({ force: true });
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::worker")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
