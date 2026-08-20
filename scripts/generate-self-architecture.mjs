import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourceRoot = join(repositoryRoot, "src");
const outputPath = join(
  repositoryRoot,
  "public/examples/architecture-block-studio.block-design.json",
);
const repositoryUrl = "https://github.com/xueyu888/architecture-block-studio";

const GROUPS = [
  { id: "core", title: "Design Core" },
  { id: "geometry", title: "Geometry Projection" },
  { id: "protocols", title: "Studio Protocols" },
  { id: "interaction", title: "Interaction Surface" },
  { id: "composition", title: "Studio Composition" },
  { id: "application", title: "Application Delivery" },
];

const MODULES = [
  {
    id: "model",
    groupId: "core",
    title: "Model Contract",
    shortTitle: "Model",
    kind: "domain",
    tone: "sand",
    owner: "src/model",
    sourcePaths: ["src/model/"],
    position: { x: 0, y: 360 },
    principle: "Own BlockDesignDocument, schema evolution, semantic validation, and stateless graph queries.",
    purpose: "Provide the unique design vocabulary consumed by every downstream capability.",
    boundary: "No React, workspace, history, layout, routing, or file-download ownership.",
    failure: "Reject invalid structure at a field path and return semantic issues without mutating input.",
  },
  {
    id: "io",
    groupId: "core",
    title: "Canonical File I/O",
    shortTitle: "I/O",
    kind: "adapter",
    tone: "blue",
    owner: "src/io",
    sourcePaths: ["src/io/"],
    position: { x: 340, y: 40 },
    principle: "Own conversion between external JSON and a validated canonical document.",
    purpose: "Load URL or local files and serialize stable save/download output.",
    boundary: "Does not interpret module business meaning or retain an installed document.",
    failure: "Return explicit load errors and preserve the previously installed design.",
  },
  {
    id: "editor",
    groupId: "core",
    title: "Atomic Editor",
    shortTitle: "Editor",
    kind: "service",
    tone: "red",
    owner: "src/editor",
    sourcePaths: ["src/editor/"],
    position: { x: 680, y: 70 },
    principle: "Own atomic DesignOperation transforms, history, dirty state, and portable fragments.",
    purpose: "Turn validated user intent into one complete document transition and one undo boundary.",
    boundary: "Does not render, route, choose workspace focus, or perform external file transport.",
    failure: "Any failed precondition leaves the original document and history unchanged.",
  },
  {
    id: "layout",
    groupId: "geometry",
    title: "Layout Projection",
    shortTitle: "Layout",
    kind: "projection",
    tone: "green",
    owner: "src/layout",
    sourcePaths: ["src/layout/"],
    position: { x: 340, y: 350 },
    principle: "Derive compound node geometry, placement signatures, guides, arrangement, and resize math.",
    purpose: "Provide deterministic design-coordinate geometry without storing UI gestures.",
    boundary: "Cannot mutate BlockDesignDocument or depend on Studio and React components.",
    failure: "Invalid geometry or placement failures surface to the Studio without fallback facts.",
  },
  {
    id: "routing",
    groupId: "geometry",
    title: "Routing Engine",
    shortTitle: "Routing",
    kind: "projection",
    tone: "green",
    owner: "src/routing",
    sourcePaths: ["src/routing/"],
    position: { x: 680, y: 380 },
    principle: "Own scene adaptation, deterministic orthogonal solving, route editing, and independent verification.",
    purpose: "Produce readable obstacle-aware routes and disposable connection previews.",
    boundary: "Does not move modules, own gestures, or write automatic routes into JSON.",
    failure: "Return an explicit unresolved result instead of using a second hidden router.",
  },
  {
    id: "protocols",
    groupId: "protocols",
    title: "Command & Selection",
    shortTitle: "Protocols",
    kind: "protocol",
    tone: "purple",
    owner: "src/studio/commands.ts · selection.ts",
    sourcePaths: ["src/studio/commands.ts", "src/studio/selection.ts"],
    position: { x: 340, y: 680 },
    principle: "Own the leaf contracts for command availability and canonical workspace selection.",
    purpose: "Let menus, keyboard, Canvas, Inspector, and Studio speak one interaction protocol.",
    boundary: "Does not render UI, execute editor mutations, or own viewport navigation.",
    failure: "Unavailable commands carry one visible reason; invalid selections resolve without hidden cursors.",
  },
  {
    id: "workbench",
    groupId: "interaction",
    title: "Workbench Components",
    shortTitle: "Workbench",
    kind: "view",
    tone: "blue",
    owner: "src/components · workbench surfaces",
    sourcePaths: [
      "src/components/CanvasContextMenu.tsx",
      "src/components/CommandPalette.tsx",
      "src/components/DockWorkspace.tsx",
      "src/components/EditorDialogs.tsx",
      "src/components/HierarchyTree.tsx",
      "src/components/Inspector.tsx",
      "src/components/LoadDesignDialog.tsx",
      "src/components/MenuBar.tsx",
      "src/components/MessagesPanel.tsx",
      "src/components/StudioToolbar.tsx",
      "src/components/Tooltip.tsx",
      "src/components/contextMenuModel.ts",
      "src/components/hierarchyRows.ts",
      "src/components/moduleCreationGesture.ts",
      "src/components/useDialogFocus.ts",
    ],
    position: { x: 680, y: 720 },
    principle: "Own accessible menus, dialogs, docks, navigation trees, Inspector, and review surfaces.",
    purpose: "Project current commands, selection, document, and issues into discoverable controls.",
    boundary: "Does not duplicate eligibility, selection, schema, editing, or route-solving rules.",
    failure: "Preserve focus and drafts, expose disabled reasons, and send rejected actions back visibly.",
  },
  {
    id: "canvas",
    groupId: "interaction",
    title: "Canvas Interaction",
    shortTitle: "Canvas",
    kind: "view",
    tone: "blue",
    owner: "src/components · canvas surface",
    sourcePaths: [
      "src/components/AlignmentGuideLayer.tsx",
      "src/components/BlockDesignCanvas.tsx",
      "src/components/BlockNode.tsx",
      "src/components/ConnectionGestureLayer.tsx",
      "src/components/InterfaceEdge.tsx",
      "src/components/ViewportAutoPanContext.tsx",
      "src/components/canvasDetail.ts",
      "src/components/canvasSelection.ts",
      "src/components/canvasTypes.ts",
      "src/components/moduleDropTarget.ts",
      "src/components/latestWorkerRequestQueue.ts",
      "src/components/routingFrameWorkerClient.ts",
      "src/components/useCommittedRoutingWorker.ts",
      "src/components/useLiveRoutingPreviewWorker.ts",
      "src/components/viewportAutoPan.ts",
    ],
    position: { x: 1030, y: 380 },
    principle: "Own React Flow projection, direct gestures, viewport transforms, and disposable previews.",
    purpose: "Make module and interface design directly operable while preserving canonical intent boundaries.",
    boundary: "Cannot become a document, command, routing, or Inspector draft fact source.",
    failure: "Cancel transient gestures cleanly and restore the last accepted document projection.",
  },
  {
    id: "studio",
    groupId: "composition",
    title: "Studio Orchestrator",
    shortTitle: "Studio",
    kind: "orchestrator",
    tone: "red",
    owner: "src/studio · composition",
    sourcePaths: [
      "src/studio/BlockDesignStudio.tsx",
      "src/studio/fragmentPlacement.ts",
      "src/studio/index.ts",
    ],
    position: { x: 1380, y: 380 },
    principle: "Compose public module contracts into the complete editing, review, and file workflow.",
    purpose: "Coordinate selection, draft protection, commands, layout, routing, dialogs, and feedback.",
    boundary: "Does not redefine any owned model, editor, file, geometry, protocol, or component rule.",
    failure: "Reject unsafe transitions visibly and keep document, history, selection, and focus recoverable.",
  },
  {
    id: "styles",
    groupId: "application",
    title: "Visual Tokens",
    shortTitle: "Tokens",
    kind: "style",
    tone: "neutral",
    owner: "src/styles.css",
    sourcePaths: ["src/styles.css"],
    position: { x: 1730, y: 740 },
    principle: "Own shared visual constants and semantic component presentation.",
    purpose: "Keep surfaces, typography, spacing, z-order, focus, and motion visually coherent.",
    boundary: "Contains no document, command, selection, layout, or routing semantics.",
    failure: "Unsupported states remain visible through semantic classes instead of hidden inline overrides.",
  },
  {
    id: "app",
    groupId: "application",
    title: "Application Assembly",
    shortTitle: "App",
    kind: "assembly",
    tone: "neutral",
    owner: "src/App.tsx",
    sourcePaths: ["src/App.tsx"],
    position: { x: 1730, y: 380 },
    principle: "Choose the initial design source and assemble the standalone Studio.",
    purpose: "Provide the browser application's minimal product entry contract.",
    boundary: "Does not own design content, commands, loading rules, or editor state.",
    failure: "Delegates load failures to the Studio while retaining the current installed document.",
  },
  {
    id: "bootstrap",
    groupId: "application",
    title: "Browser Bootstrap",
    shortTitle: "Bootstrap",
    kind: "entrypoint",
    tone: "neutral",
    owner: "src/main.tsx",
    sourcePaths: ["src/main.tsx"],
    position: { x: 2080, y: 380 },
    principle: "Mount one React root and install the application-wide visual stylesheet.",
    purpose: "Bridge the HTML host to the typed application assembly.",
    boundary: "Contains no product workflow, document, or geometry decisions.",
    failure: "A missing host root fails immediately instead of mounting a partial Studio.",
  },
];

const groupById = new Map(GROUPS.map((group) => [group.id, group]));
const moduleById = new Map(MODULES.map((module) => [module.id, module]));

function repositoryPath(absolutePath) {
  return relative(repositoryRoot, absolutePath).split("\\").join("/");
}

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(absolute);
    return [".ts", ".tsx", ".css"].includes(extname(entry.name))
      ? [repositoryPath(absolute)]
      : [];
  }).sort();
}

function sourcePathMatches(file, sourcePath) {
  return sourcePath.endsWith("/") ? file.startsWith(sourcePath) : file === sourcePath;
}

function sourceOwner(file) {
  const matches = MODULES.filter((module) =>
    module.sourcePaths.some((sourcePath) => sourcePathMatches(file, sourcePath))
  );
  if (matches.length !== 1) {
    throw new Error(
      `${file} must belong to exactly one architecture module; matched ${matches.map(({ id }) => id).join(", ") || "none"}.`,
    );
  }
  return matches[0];
}

function resolveRelativeSource(fromFile, specifier) {
  const sourcePath = specifier.replace(/[?#].*$/, "");
  const base = normalize(join(dirname(join(repositoryRoot, fromFile)), sourcePath));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.css`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!resolved || !resolved.startsWith(sourceRoot)) {
    throw new Error(`Cannot resolve managed relative import ${specifier} from ${fromFile}.`);
  }
  return repositoryPath(resolved);
}

function relativeModuleReferences(sourceFile) {
  if (![".ts", ".tsx"].includes(extname(sourceFile))) return [];
  const absolute = join(repositoryRoot, sourceFile);
  const source = ts.createSourceFile(
    sourceFile,
    readFileSync(absolute, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const references = [];
  const visit = (node) => {
    const moduleSpecifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text.startsWith(".")) {
      references.push(moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

function dependencyEdges() {
  const sourceFiles = listSourceFiles(sourceRoot);
  const ownerByFile = new Map(sourceFiles.map((file) => [file, sourceOwner(file)]));
  const edges = new Map();

  sourceFiles.forEach((sourceFile) => {
    const sourceModule = ownerByFile.get(sourceFile);
    relativeModuleReferences(sourceFile).forEach((specifier) => {
      const targetFile = resolveRelativeSource(sourceFile, specifier);
      const targetModule = ownerByFile.get(targetFile) ?? sourceOwner(targetFile);
      if (sourceModule.id === targetModule.id) return;
      const key = `${sourceModule.id}->${targetModule.id}`;
      const current = edges.get(key) ?? {
        sourceId: sourceModule.id,
        targetId: targetModule.id,
        declarations: [],
      };
      current.declarations.push(`${sourceFile} → ${targetFile}`);
      edges.set(key, current);
    });
  });

  const sorted = [...edges.values()]
    .map((edge) => ({ ...edge, declarations: edge.declarations.sort() }))
    .sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId) || left.targetId.localeCompare(right.targetId)
    );
  assertAcyclic(sorted);
  return { sourceFiles, edges: sorted };
}

function assertAcyclic(edges) {
  const outgoing = new Map(MODULES.map(({ id }) => [id, []]));
  edges.forEach((edge) => outgoing.get(edge.sourceId).push(edge.targetId));
  const visiting = new Set();
  const visited = new Set();
  const visit = (moduleId, path = []) => {
    if (visiting.has(moduleId)) {
      throw new Error(`Source module cycle detected: ${[...path, moduleId].join(" -> ")}.`);
    }
    if (visited.has(moduleId)) return;
    visiting.add(moduleId);
    outgoing.get(moduleId).forEach((targetId) => visit(targetId, [...path, moduleId]));
    visiting.delete(moduleId);
    visited.add(moduleId);
  };
  MODULES.forEach(({ id }) => visit(id));
}

function sourceRefFor(sourcePath, label = sourcePath) {
  const normalizedPath = sourcePath.endsWith("/") ? sourcePath.slice(0, -1) : sourcePath;
  const kind = sourcePath.endsWith("/") ? "tree" : "blob";
  return {
    label,
    href: `${repositoryUrl}/${kind}/main/${normalizedPath}`,
  };
}

function modulePortId(edge, endpoint) {
  return endpoint === "source"
    ? `depends-${edge.targetId}`
    : `used-by-${edge.sourceId}`;
}

function edgeLabel(edge) {
  const source = moduleById.get(edge.sourceId);
  const target = moduleById.get(edge.targetId);
  const count = edge.declarations.length;
  return `${source.title} → ${target.title} · ${count} import ${count === 1 ? "declaration" : "declarations"}`;
}

function moduleNode(module, edges) {
  const incoming = edges.filter((edge) => edge.targetId === module.id);
  const outgoing = edges.filter((edge) => edge.sourceId === module.id);
  const ports = [
    ...incoming.map((edge, index) => {
      const source = moduleById.get(edge.sourceId);
      return {
        id: modulePortId(edge, "target"),
        label: source.shortTitle,
        side: "right",
        direction: "input",
        dataType: `${edge.declarations.length} import declarations`,
        required: true,
        order: index,
      };
    }),
    ...outgoing.map((edge, index) => {
      const target = moduleById.get(edge.targetId);
      return {
        id: modulePortId(edge, "source"),
        label: target.shortTitle,
        side: "left",
        direction: "output",
        dataType: `${edge.declarations.length} import declarations`,
        required: true,
        order: index,
      };
    }),
  ];
  const sidePortCount = Math.max(
    ports.filter(({ side }) => side === "left").length,
    ports.filter(({ side }) => side === "right").length,
  );
  return {
    id: module.id,
    title: module.title,
    kind: module.kind,
    tone: module.tone,
    process: groupById.get(module.groupId).title.toLocaleUpperCase(),
    summary: module.purpose,
    owner: module.owner,
    ports,
    inspector: {
      principle: module.principle,
      purpose: module.purpose,
      boundary: module.boundary,
      failure: module.failure,
      sourceRef: sourceRefFor(module.sourcePaths[0], module.owner),
      code: module.sourcePaths.join("\n"),
      codeLanguage: "text",
      attributes: {
        architectureRole: "source-module",
        architectureModuleId: module.id,
        architectureGroupId: module.groupId,
        hierarchyDepth: "5",
        sourcePaths: module.sourcePaths.join("\n"),
        sourceFileCount: String(
          listSourceFiles(sourceRoot).filter((file) =>
            module.sourcePaths.some((sourcePath) => sourcePathMatches(file, sourcePath))
          ).length,
        ),
      },
    },
    layout: {
      position: module.position,
      width: 286,
      height: Math.max(184, 116 + sidePortCount * 27),
      pinned: true,
    },
  };
}

function interfaceDefinitions(edges) {
  return Object.fromEntries(
    [...new Set(edges.map(({ targetId }) => targetId))]
      .sort()
      .map((targetId) => {
        const target = moduleById.get(targetId);
        return [`source-import.${targetId}`, {
          kind: "internal",
          title: `${target.title} public import surface`,
          protocol: "ES module dependency",
          owner: target.owner,
          principle: `Consumers depend on the public exports owned by ${target.title}.`,
          purpose: `Make compile-time use of ${target.title} explicit and source-verifiable.`,
          boundary: "The edge proves a resolved relative source import, not runtime ownership or data mutation.",
          failure: "An unresolved, undeclared, fabricated, or cyclic module dependency fails the architecture gate.",
          sourceRef: sourceRefFor(target.sourcePaths[0], target.owner),
          code: target.sourcePaths.join("\n"),
          codeLanguage: "text",
          attributes: {
            architectureModuleId: target.id,
            evidence: "TypeScript/CSS resolved relative import",
          },
        }];
      }),
  );
}

function importConnection(edge, sourceNodeId, sourcePortId, targetNodeId, targetPortId) {
  return {
    id: `import-${edge.sourceId}-to-${edge.targetId}`,
    interfaceId: `source-import.${edge.targetId}`,
    label: edgeLabel(edge),
    source: { nodeId: sourceNodeId, portId: sourcePortId },
    target: { nodeId: targetNodeId, portId: targetPortId },
  };
}

function scopeInspector(principle, purpose, boundary, failure, sourcePath, attributes = {}) {
  return {
    principle,
    purpose,
    boundary,
    failure,
    sourceRef: sourceRefFor(sourcePath),
    code: sourcePath,
    codeLanguage: "text",
    attributes: { architectureRole: "scope", ...attributes },
  };
}

function scopeNode({ id, title, childLevelId, summary, principle, boundary, sourcePath, position, depth }) {
  return {
    id,
    title,
    kind: "boundary",
    tone: "neutral",
    process: "ARCHITECTURE SCOPE",
    summary,
    owner: "Architecture Block Studio",
    hierarchy: { childLevelId, portBindings: [] },
    ports: [],
    inspector: scopeInspector(
      principle,
      summary,
      boundary,
      "Invalid child references or source drift fail validation without inventing a fallback scope.",
      sourcePath,
      { hierarchyDepth: String(depth) },
    ),
    layout: { position, width: 320, height: 190, pinned: true },
  };
}

function createDocument() {
  const { sourceFiles, edges } = dependencyEdges();
  return {
    schemaVersion: "2.1",
    id: "architecture-block-studio.source-architecture.v1",
    title: "Architecture Block Studio — Source Architecture",
    summary: `Generated from ${sourceFiles.length} managed source files and ${edges.length} verified cross-module dependencies; five hierarchy depths preserve product, runtime, composition, architecture, and module context.`,
    entryLevelId: "product-boundary",
    sourceRef: { label: "architecture-block-studio", href: repositoryUrl },
    interfaceDefinitions: interfaceDefinitions(edges),
    levels: [
      {
        id: "product-boundary",
        title: "Product Boundary",
        description: "Depth 1: the version-controlled architecture design product.",
        nodes: [scopeNode({
          id: "architecture-block-studio",
          title: "Architecture Block Studio",
          childLevelId: "browser-runtime",
          summary: "Design, visualize, and human-review code module and interface architecture as canonical JSON.",
          principle: "Keep architecture intent explicit, inspectable, editable, and version controlled.",
          boundary: "This product does not infer arbitrary business architecture inside its editing runtime.",
          sourcePath: "README.md",
          position: { x: 40, y: 40 },
          depth: 1,
        })],
        connections: [],
        layout: { direction: "LEFT", spacing: 80, layerSpacing: 140 },
      },
      {
        id: "browser-runtime",
        title: "Browser Runtime",
        description: "Depth 2: standalone React application installation.",
        parentLevelId: "product-boundary",
        nodes: [scopeNode({
          id: "react-application",
          title: "React Browser Application",
          childLevelId: "workbench-composition",
          summary: "Mount one desktop workbench and load a replaceable BlockDesignDocument source.",
          principle: "Install the editor without moving design facts into the host shell.",
          boundary: "The browser host does not own document semantics, layout, routing, or history.",
          sourcePath: "src/main.tsx",
          position: { x: 40, y: 40 },
          depth: 2,
        })],
        connections: [],
        layout: { direction: "LEFT", spacing: 80, layerSpacing: 140 },
      },
      {
        id: "workbench-composition",
        title: "Workbench Composition",
        description: "Depth 3: application composition before source boundaries are expanded.",
        parentLevelId: "browser-runtime",
        nodes: [scopeNode({
          id: "module-architecture",
          title: "Module Architecture",
          childLevelId: "source-architecture",
          summary: "Compose stable module owners through explicit one-way source dependencies.",
          principle: "Module internals own facts and behavior; the Studio owns only composition.",
          boundary: "A grouping is not allowed to hide cycles, unmapped files, or fabricated dependencies.",
          sourcePath: "docs/ARCHITECTURE.md",
          position: { x: 40, y: 40 },
          depth: 3,
        })],
        connections: [],
        layout: { direction: "LEFT", spacing: 80, layerSpacing: 140 },
      },
      {
        id: "source-architecture",
        title: "Verified Source Architecture",
        description: "Depth 4: a single source-verification boundary before concrete modules are projected.",
        parentLevelId: "workbench-composition",
        nodes: [scopeNode({
          id: "verified-source-graph",
          title: "Verified Source Graph",
          childLevelId: "runtime-modules",
          summary: "Every managed source file has one module owner and every cross-module edge resolves to a repository import.",
          principle: "Keep source ownership and dependency direction executable instead of maintaining a decorative diagram.",
          boundary: "Semantic groups enrich module meaning but cannot hide files, fabricate edges, or permit cycles.",
          sourcePath: "scripts/generate-self-architecture.mjs",
          position: { x: 40, y: 40 },
          depth: 4,
        })],
        connections: [],
        layout: { direction: "LEFT", spacing: 80, layerSpacing: 140 },
      },
      {
        id: "runtime-modules",
        title: "Runtime Source Modules",
        description: "Depth 5: twelve responsibility-owned source modules and every resolved cross-module dependency.",
        parentLevelId: "source-architecture",
        nodes: MODULES.map((module) => moduleNode(module, edges)),
        connections: edges.map((edge) => importConnection(
          edge,
          edge.sourceId,
          modulePortId(edge, "source"),
          edge.targetId,
          modulePortId(edge, "target"),
        )),
        layout: { direction: "LEFT", spacing: 84, layerSpacing: 144 },
      },
    ],
  };
}

function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

const generated = canonicalJson(createDocument());
const checkOnly = process.argv.includes("--check");
if (checkOnly) {
  if (!existsSync(outputPath)) {
    throw new Error(`Missing generated architecture example ${repositoryPath(outputPath)}.`);
  }
  const installed = readFileSync(outputPath, "utf8");
  if (installed !== generated) {
    throw new Error(
      `${repositoryPath(outputPath)} is stale. Run pnpm generate:self-architecture and commit the result.`,
    );
  }
  const { sourceFiles, edges } = dependencyEdges();
  process.stdout.write(
    `Verified self architecture: ${MODULES.length} modules, ${sourceFiles.length} source files, ${edges.length} cross-module dependencies, 5 hierarchy depths.\n`,
  );
} else {
  writeFileSync(outputPath, generated);
  process.stdout.write(`Generated ${repositoryPath(outputPath)}.\n`);
}
