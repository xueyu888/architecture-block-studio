import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const examplePath = fileURLToPath(
  new URL("../public/examples/aio-agent-runtime.block-design.json", import.meta.url),
);
const invalidPath = fileURLToPath(new URL("./fixtures/invalid.block-design.json", import.meta.url));

function flowNode(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

async function waitForLayout(page: Page): Promise<void> {
  await expect(page.locator(".bd-document-title span")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".react-flow__edge")).not.toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(350);
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
    const nodeRects = [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .filter((element) => element.querySelector(".bd-block")?.getAttribute("data-expanded") !== "true")
      .map((element) => ({
        id: element.dataset.id ?? "unknown",
        rect: element.getBoundingClientRect(),
      }));
    const collisions: string[] = [];

    document.querySelectorAll<SVGPathElement>(".react-flow__edge-path").forEach((path) => {
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

    return { collisions, labelOverlaps, siblingOverlaps };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForLayout(page);
});

test("loads the bundled v2 design without DRC or viewport failures", async ({ page }) => {
  await expect(page.locator(".bd-document-title span")).toHaveText("AIO Agent Runtime");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);
  await expect(page.locator(".bd-statusbar")).toContainText("BlockDesignDocument 2.0");

  const overflow = await page.evaluate(() => [
    document.body.scrollWidth - window.innerWidth,
    document.body.scrollHeight - window.innerHeight,
  ]);
  expect(overflow).toEqual([0, 0]);
});

test("expands Core inline and preserves the parent context and boundary continuity", async ({ page }) => {
  await expandHierarchy(page, "Rust Agent Core");

  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await expect(page.locator(".react-flow__edge")).toHaveCount(34);
  await expect(page.locator(".bd-statusbar")).toContainText("26 visible interfaces");
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

test("keeps routes outside blocks with both hierarchy containers expanded", async ({ page }) => {
  const browserWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      browserWarnings.push(message.text());
    }
  });

  await expandHierarchy(page, "Rust Agent Core");
  await expandHierarchy(page, "Tool System");
  await expect(page.locator(".react-flow__node")).toHaveCount(32);
  await expect(page.locator(".react-flow__edge")).toHaveCount(54);
  await expect(page.locator(".bd-statusbar")).toContainText("40 visible interfaces");
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);

  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
  });
  expect(browserWarnings).toEqual([]);
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

  await page.locator('.bd-toolbar button[title="Sources"]').click({ force: true });
  expect((await sources.boundingBox())!.width).toBeLessThan(60);
  await page.locator('.bd-toolbar button[title="Sources"]').click({ force: true });
  expect((await sources.boundingBox())!.width).toBeGreaterThan(250);

  const diagramBefore = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  await page.locator('.bd-toolbar button[title="最大化或还原画布"]').click({ force: true });
  const diagramMaximized = await page.getByRole("region", { name: "Diagram" }).boundingBox();
  expect(diagramMaximized!.width).toBeGreaterThan(diagramBefore!.width + 300);
  await page.locator('.bd-toolbar button[title="最大化或还原画布"]').click({ force: true });

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

  await page.locator('.bd-toolbar button[title="仅优化布线"]').evaluate((button: HTMLButtonElement) => button.click());
  expect(await transformOf(project)).toBe(before);

  await page.locator('.bd-toolbar button[title="重新生成布局"]').evaluate((button: HTMLButtonElement) => button.click());
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
