import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
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

async function waitForEditorIdle(page: Page): Promise<void> {
  await expect(page.locator(".bd-canvas-busy")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(250);
}

async function addModule(page: Page, values: { title: string; id: string; owner?: string }): Promise<void> {
  await page.locator('.bd-toolbar button[title="添加模块"]').click({ force: true });
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
  await page.locator('.bd-toolbar button[title="添加端口"]').click({ force: true });
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
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 14 });
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

    const routeSamples = paths.map((path) => {
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      const samples: Array<{ x: number; y: number; axis: "h" | "v" }> = [];
      if (matrix && length > 12) {
        for (let distance = 6; distance < length - 6; distance += 4) {
          const before = path.getPointAtLength(Math.max(0, distance - 1));
          const point = path.getPointAtLength(distance);
          const after = path.getPointAtLength(Math.min(length, distance + 1));
          const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          samples.push({
            x: screenPoint.x,
            y: screenPoint.y,
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

    return { collisions, labelOverlaps, siblingOverlaps, boundaryEscapes, sharedRoutes };
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

test("keeps the authoring chrome stable and handles direct commands", async ({ page }) => {
  const positions = await page.locator('.bd-toolbar button[title="新建设计"]').evaluate(async (button) => {
    const samples: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      const rect = button.getBoundingClientRect();
      samples.push(`${rect.x}:${rect.y}:${rect.width}:${rect.height}`);
    }
    return samples;
  });
  expect(new Set(positions).size).toBe(1);
  await page.locator('.bd-toolbar button[title="新建设计"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("dialog", { name: "New Design" })).toBeVisible();
  await page.getByRole("dialog", { name: "New Design" }).getByRole("button", { name: "Cancel" }).evaluate((button: HTMLButtonElement) => button.click());
});

test("keeps the viewport and canvas mounted while applying property edits", async ({ page }) => {
  await flowNode(page, "system::agent-ui").click({ force: true });
  const canvas = page.locator(".bd-react-flow");
  await canvas.evaluate((element) => { element.setAttribute("data-mount-proof", "preserved"); });
  const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("transform");
  const inspector = page.getByRole("region", { name: "Properties" });
  await inspector.getByLabel("Summary").fill("User-facing agent workbench.");
  await inspector.getByRole("button", { name: "Apply Changes" }).click({ force: true });
  await waitForEditorIdle(page);

  await expect(canvas).toHaveAttribute("data-mount-proof", "preserved");
  expect(await page.locator(".react-flow__viewport").getAttribute("transform")).toBe(viewportBefore);
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
    boundaryEscapes: [],
    sharedRoutes: [],
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

test("authors, connects, nests, undoes, saves, and reloads a local module design", async ({ page }) => {
  test.setTimeout(process.env.CAPTURE_EDITOR_PROOF === "1" ? 360_000 : 180_000);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.locator('.bd-toolbar button[title="新建设计"]').click({ force: true });
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
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await page.locator('.bd-toolbar button[title="适应窗口"]').click({ force: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "docs/screenshots/editor-polished-workbench.png" });
  }

  await flowNode(page, "system::api").click({ force: true });
  await page.locator('.bd-toolbar button[title="创建子设计"]').click({ force: true });
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

  await page.locator('.bd-toolbar button[title="撤销"]').click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("1 errors");
  await page.locator('.bd-toolbar button[title="重做"]').click({ force: true });
  await expect(page.locator(".bd-validation-summary")).toContainText("0 errors");
  await expect(page.locator(".bd-validation-summary")).toContainText("0 warnings");
  await waitForEditorIdle(page);
  expect(await geometryIssues(page)).toEqual({
    collisions: [],
    labelOverlaps: [],
    siblingOverlaps: [],
    boundaryEscapes: [],
    sharedRoutes: [],
  });
  await expect(page.locator(".bd-interface-underlay")).toHaveCount(2);
  if (process.env.CAPTURE_EDITOR_PROOF === "1") {
    await page.locator('.bd-toolbar button[title="Sources"]').click({ force: true });
    await page.locator('.bd-toolbar button[title="Properties"]').click({ force: true });
    await page.waitForTimeout(400);
    await page.locator('.bd-toolbar button[title="适应窗口"]').click({ force: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "docs/screenshots/editor-routing-validation.png" });
    await page.locator('.bd-toolbar button[title="Sources"]').click({ force: true });
    await page.locator('.bd-toolbar button[title="Properties"]').click({ force: true });
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: "File", exact: true }).click({ force: true });
  await page.getByRole("menuitem", { name: "Save As...", exact: true }).click({ force: true });
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
  await page.locator('.bd-toolbar button[title="新建设计"]').click({ force: true });
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
  await page.locator('.bd-toolbar button[title="新建设计"]').click({ force: true });
  const newDialog = page.getByRole("dialog", { name: "New Design" });
  await newDialog.getByLabel("Design title").fill("Worker Design");
  await newDialog.getByLabel("Design id").fill("worker-design");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click({ force: true });
  await waitForEditorIdle(page);

  await addModule(page, { title: "Worker", id: "worker", owner: "Runtime Team" });
  const worker = flowNode(page, "system::worker");
  await page.locator('.bd-toolbar button[title="添加模块"]').click({ force: true });
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
  await page.locator('.bd-toolbar button[title="保存设计"]').click({ force: true });
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
  await page.locator('.bd-toolbar button[title="删除所选内容"]').click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toHaveCount(0);
  await page.locator('.bd-toolbar button[title="撤销"]').click({ force: true });
  await waitForEditorIdle(page);
  await expect(worker.locator(".bd-port-label")).toContainText("events-out");

  await worker.click({ force: true });
  page.once("dialog", async (dialog) => dialog.accept());
  await page.locator('.bd-toolbar button[title="删除所选内容"]').click({ force: true });
  await waitForEditorIdle(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await page.locator('.bd-toolbar button[title="撤销"]').click({ force: true });
  await waitForEditorIdle(page);
  await expect(flowNode(page, "system::worker")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
