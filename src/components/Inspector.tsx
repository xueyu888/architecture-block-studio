import { useEffect, useMemo, useState } from "react";
import { Braces, Check, Copy, ExternalLink, SlidersHorizontal } from "lucide-react";
import type {
  BlockDesignDocument,
  BlockNode,
  BlockPort,
  DesignLevel,
  InspectorDefinition,
  InterfaceDefinition,
} from "../model";
import type { SelectionRef } from "../studio/types";

interface ResolvedInspection {
  kind: string;
  title: string;
  route?: string;
  owner?: string;
  inspector?: InspectorDefinition | InterfaceDefinition;
  raw: unknown;
  attributes: Record<string, string>;
}

function findLevel(document: BlockDesignDocument, levelId: string): DesignLevel | undefined {
  return document.levels.find((level) => level.id === levelId);
}

function findNode(level: DesignLevel | undefined, nodeId: string): BlockNode | undefined {
  return level?.nodes.find((node) => node.id === nodeId);
}

function findPort(node: BlockNode | undefined, portId: string): BlockPort | undefined {
  return node?.ports.find((port) => port.id === portId);
}

function resolveInspection(document: BlockDesignDocument, selection: SelectionRef): ResolvedInspection {
  if (selection.kind === "document") {
    return {
      kind: "DESIGN",
      title: document.title,
      inspector: {
        purpose: document.summary || "Hierarchical block design document.",
        boundary: "The document supplies design content; the studio owns only visualization state.",
        failure: "A structurally invalid document is not installed.",
        principle: "Single design-content source",
        sourceRef: document.sourceRef,
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
      raw: document,
      attributes: {
        "Schema version": document.schemaVersion,
        "Entry level": document.entryLevelId,
        Levels: String(document.levels.length),
        Interfaces: String(Object.keys(document.interfaceDefinitions).length),
      },
    };
  }

  const level = findLevel(document, selection.levelId);
  if (selection.kind === "level") {
    return {
      kind: "LEVEL",
      title: level?.title ?? selection.levelId,
      inspector: {
        purpose: level?.description || "Block design hierarchy level.",
        boundary: "Contains only the blocks and connections defined for this hierarchy boundary.",
        failure: "Missing blocks, ports or interfaces are reported by design validation.",
        principle: "One visible hierarchy boundary",
        code: "",
        codeLanguage: "jsonc",
        attributes: {},
      },
      raw: level ?? selection,
      attributes: {
        Blocks: String(level?.nodes.length ?? 0),
        Connections: String(level?.connections.length ?? 0),
        Direction: level?.layout.direction ?? "unknown",
      },
    };
  }

  if (selection.kind === "node") {
    const node = findNode(level, selection.nodeId);
    return {
      kind: "BLOCK",
      title: node?.title ?? selection.nodeId,
      owner: node?.owner,
      inspector: node?.inspector,
      raw: node ?? selection,
      attributes: {
        Kind: node?.kind ?? "unknown",
        Process: node?.process ?? "not specified",
        Ports: String(node?.ports.length ?? 0),
        Hierarchy: node?.hierarchy?.childLevelId ?? "leaf block",
      },
    };
  }

  if (selection.kind === "port") {
    const node = findNode(level, selection.nodeId);
    const port = findPort(node, selection.portId);
    return {
      kind: "PORT",
      title: port?.label ?? selection.portId,
      route: `${selection.nodeId}.${selection.portId}`,
      owner: node?.owner,
      inspector: {
        purpose: `Expose ${port?.dataType ?? "a typed value"} at the ${node?.title ?? selection.nodeId} boundary.`,
        boundary: "Connections may attach only through this named boundary port.",
        failure: "Direction and required-connection violations are reported by design validation.",
        principle: "Explicit module boundary",
        code: port?.dataType ?? "",
        codeLanguage: "text",
        attributes: {},
      },
      raw: port ?? selection,
      attributes: {
        Direction: port?.direction ?? "unknown",
        Side: port?.side ?? "unknown",
        Required: String(port?.required ?? false),
        "Data type": port?.dataType ?? "not specified",
      },
    };
  }

  const connection = level?.connections.find((candidate) => candidate.id === selection.connectionId);
  const definition = connection ? document.interfaceDefinitions[connection.interfaceId] : undefined;
  return {
    kind: definition?.kind.toUpperCase() ?? "CONNECTION",
    title: connection?.label ?? definition?.title ?? selection.connectionId,
    route: connection
      ? `${connection.source.nodeId}.${connection.source.portId} → ${connection.target.nodeId}.${connection.target.portId}`
      : undefined,
    owner: definition?.owner,
    inspector: definition,
    raw: connection ? { connection, interface: definition } : selection,
    attributes: {
      Protocol: definition?.protocol ?? "not specified",
      "Interface id": connection?.interfaceId ?? "missing",
      "Source block": connection?.source.nodeId ?? "missing",
      "Target block": connection?.target.nodeId ?? "missing",
    },
  };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="bd-icon-button"
      title="Copy"
      aria-label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export function Inspector({ document, selection }: { document: BlockDesignDocument; selection: SelectionRef }) {
  const [tab, setTab] = useState<"properties" | "json">("properties");
  const inspected = useMemo(() => resolveInspection(document, selection), [document, selection]);
  const rawJson = useMemo(() => JSON.stringify(inspected.raw, null, 2), [inspected.raw]);

  useEffect(() => setTab("properties"), [selection]);

  return (
    <section className="bd-pane bd-inspector-pane">
      <div className="bd-inspector-title">
        <span className={`bd-kind-badge bd-kind-${inspected.kind.toLowerCase()}`}>{inspected.kind}</span>
        <h2>{inspected.title}</h2>
        {inspected.route && <code>{inspected.route}</code>}
      </div>
      <div className="bd-tabs" role="tablist" aria-label="Inspector views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "properties"}
          className={tab === "properties" ? "is-active" : ""}
          onClick={() => setTab("properties")}
        >
          <SlidersHorizontal size={13} aria-hidden="true" /> Properties
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "json"}
          className={tab === "json" ? "is-active" : ""}
          onClick={() => setTab("json")}
        >
          <Braces size={13} aria-hidden="true" /> JSON
        </button>
      </div>

      {tab === "properties" ? (
        <div className="bd-inspector-scroll">
          <dl className="bd-property-grid">
            {inspected.owner && (
              <div className="bd-property-row">
                <dt>Owner</dt>
                <dd>{inspected.owner}</dd>
              </div>
            )}
            {Object.entries(inspected.attributes).map(([key, value]) => (
              <div className="bd-property-row" key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {inspected.inspector && (
            <div className="bd-contract-sections">
              {inspected.inspector.principle && (
                <section>
                  <h3>Principle</h3>
                  <p>{inspected.inspector.principle}</p>
                </section>
              )}
              <section>
                <h3>Purpose</h3>
                <p>{inspected.inspector.purpose}</p>
              </section>
              <section>
                <h3>Boundary</h3>
                <p>{inspected.inspector.boundary}</p>
              </section>
              <section>
                <h3>Failure</h3>
                <p>{inspected.inspector.failure}</p>
              </section>
              {inspected.inspector.sourceRef && (
                <a className="bd-source-link" href={inspected.inspector.sourceRef.href} target="_blank" rel="noreferrer">
                  {inspected.inspector.sourceRef.label}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
              {inspected.inspector.code && (
                <section className="bd-code-section">
                  <header>
                    <h3>{inspected.inspector.codeLanguage}</h3>
                    <CopyButton value={inspected.inspector.code} />
                  </header>
                  <pre><code>{inspected.inspector.code}</code></pre>
                </section>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bd-code-section bd-raw-json">
          <header>
            <h3>Selected source object</h3>
            <CopyButton value={rawJson} />
          </header>
          <pre><code>{rawJson}</code></pre>
        </div>
      )}
    </section>
  );
}
