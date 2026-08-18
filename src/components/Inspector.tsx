import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Braces, Check, Copy, SlidersHorizontal, Trash2 } from "lucide-react";
import type { DesignOperation } from "../editor";
import type {
  BlockDesignDocument,
  BlockNode,
  BlockPort,
  DesignLevel,
  InspectorDefinition,
  InterfaceDefinition,
  InterfaceKind,
  PortDirection,
  PortSide,
} from "../model";
import type { SelectionRef } from "../studio/types";

interface ResolvedInspection {
  kind: string;
  title: string;
  route?: string;
  owner?: string;
  raw: unknown;
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
  if (selection.kind === "document") return { kind: "DESIGN", title: document.title, raw: document };
  const level = findLevel(document, selection.levelId);
  if (selection.kind === "level") return { kind: "LEVEL", title: level?.title ?? selection.levelId, raw: level ?? selection };
  if (selection.kind === "node") {
    const node = findNode(level, selection.nodeId);
    return { kind: "BLOCK", title: node?.title ?? selection.nodeId, owner: node?.owner, raw: node ?? selection };
  }
  if (selection.kind === "port") {
    const node = findNode(level, selection.nodeId);
    const port = findPort(node, selection.portId);
    return {
      kind: "PORT",
      title: port?.label ?? selection.portId,
      route: `${selection.nodeId}.${selection.portId}`,
      owner: node?.owner,
      raw: port ?? selection,
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
    raw: connection ? { connection, interface: definition } : selection,
  };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="bd-icon-button" title="Copy" aria-label="Copy" onClick={async () => {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  multilineRows = 2,
  required,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
  multilineRows?: number;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="bd-inspector-field">
      <span>{label}</span>
      {children ?? (multiline
        ? <textarea value={value} onChange={(event) => onChange?.(event.target.value)} rows={multilineRows} required={required} />
        : <input value={value} onChange={(event) => onChange?.(event.target.value)} required={required} />)}
    </label>
  );
}

function EditorForm({ children, onSubmit, onDelete }: { children: ReactNode; onSubmit: () => void; onDelete?: () => void }) {
  return (
    <form className="bd-inspector-form" onSubmit={(event: FormEvent) => {
      event.preventDefault();
      onSubmit();
    }}>
      <div className="bd-inspector-form-fields">{children}</div>
      <div className="bd-inspector-actions">
        {onDelete && <button type="button" className="is-danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>}
        <span />
        <button type="submit" className="is-primary">Apply Changes</button>
      </div>
    </form>
  );
}

function ContractFields({ value, onChange }: { value: InspectorDefinition; onChange: (value: InspectorDefinition) => void }) {
  const update = (values: Partial<InspectorDefinition>) => onChange({ ...value, ...values });
  return (
    <fieldset className="bd-contract-fieldset">
      <legend>Module contract</legend>
      <Field label="Principle" value={value.principle ?? ""} onChange={(principle) => update({ principle })} multiline />
      <Field label="Purpose" value={value.purpose} onChange={(purpose) => update({ purpose })} multiline />
      <Field label="Boundary" value={value.boundary} onChange={(boundary) => update({ boundary })} multiline />
      <Field label="Failure behavior" value={value.failure} onChange={(failure) => update({ failure })} multiline />
      <details className="bd-progressive-fields">
        <summary>Contract source</summary>
        <div>
          <Field label="Contract code" value={value.code ?? ""} onChange={(code) => update({ code })} multiline multilineRows={4} />
          <Field label="Code language" value={value.codeLanguage} onChange={(codeLanguage) => update({ codeLanguage })} />
        </div>
      </details>
    </fieldset>
  );
}

function DocumentEditor({ document, onOperation }: { document: BlockDesignDocument; onOperation: (operation: DesignOperation) => void }) {
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary);
  return (
    <EditorForm onSubmit={() => onOperation({ type: "document/update", values: { title, summary } })}>
      <Field label="Design id"><input value={document.id} disabled /></Field>
      <Field label="Title" value={title} onChange={setTitle} required />
      <Field label="Summary" value={summary} onChange={setSummary} multiline />
      <dl className="bd-property-grid">
        <div className="bd-property-row"><dt>Schema</dt><dd>{document.schemaVersion}</dd></div>
        <div className="bd-property-row"><dt>Entry level</dt><dd>{document.entryLevelId}</dd></div>
      </dl>
    </EditorForm>
  );
}

function LevelEditor({ level, onOperation }: { level: DesignLevel; onOperation: (operation: DesignOperation) => void }) {
  const [title, setTitle] = useState(level.title);
  const [description, setDescription] = useState(level.description);
  const [direction, setDirection] = useState(level.layout.direction);
  const [spacing, setSpacing] = useState(String(level.layout.spacing));
  const [layerSpacing, setLayerSpacing] = useState(String(level.layout.layerSpacing));
  return (
    <EditorForm onSubmit={() => onOperation({
      type: "level/update",
      levelId: level.id,
      values: {
        title,
        description,
        layout: { direction, spacing: Math.max(1, Number(spacing)), layerSpacing: Math.max(1, Number(layerSpacing)) },
      },
    })}>
      <Field label="Level id"><input value={level.id} disabled /></Field>
      <Field label="Title" value={title} onChange={setTitle} required />
      <Field label="Description" value={description} onChange={setDescription} multiline />
      <div className="bd-inspector-form-row">
        <Field label="Direction"><select value={direction} onChange={(event) => setDirection(event.target.value as DesignLevel["layout"]["direction"])}>
          <option value="RIGHT">Right</option><option value="DOWN">Down</option><option value="LEFT">Left</option><option value="UP">Up</option>
        </select></Field>
        <Field label="Spacing" value={spacing} onChange={setSpacing} />
        <Field label="Layer spacing" value={layerSpacing} onChange={setLayerSpacing} />
      </div>
    </EditorForm>
  );
}

function HierarchyBindings({ document, level, node, onOperation }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  node: BlockNode;
  onOperation: (operation: DesignOperation) => void;
}) {
  if (!node.hierarchy || node.ports.length === 0) return null;
  const childLevel = findLevel(document, node.hierarchy.childLevelId);
  const endpoints = childLevel?.nodes.flatMap((childNode) => childNode.ports.map((port) => ({
    value: `${childNode.id}:${port.id}`,
    label: `${childNode.title}.${port.label} (${port.direction})`,
    nodeId: childNode.id,
    portId: port.id,
  }))) ?? [];
  return (
    <fieldset className="bd-contract-fieldset">
      <legend>Hierarchy port bindings</legend>
      {node.ports.map((port) => {
        const binding = node.hierarchy?.portBindings.find((candidate) => candidate.parentPortId === port.id);
        const value = binding ? `${binding.childEndpoint.nodeId}:${binding.childEndpoint.portId}` : "";
        return (
          <Field key={port.id} label={port.label}>
            <select value={value} onChange={(event) => {
              if (!event.target.value) {
                onOperation({ type: "hierarchy/unbind", levelId: level.id, nodeId: node.id, parentPortId: port.id });
                return;
              }
              const endpoint = endpoints.find((candidate) => candidate.value === event.target.value);
              if (!endpoint) return;
              onOperation({
                type: "hierarchy/bind",
                levelId: level.id,
                nodeId: node.id,
                binding: { parentPortId: port.id, childEndpoint: { nodeId: endpoint.nodeId, portId: endpoint.portId } },
              });
            }}>
              <option value="">Unbound</option>
              {endpoints.map((endpoint) => <option key={endpoint.value} value={endpoint.value}>{endpoint.label}</option>)}
            </select>
          </Field>
        );
      })}
      {endpoints.length === 0 && <p className="bd-form-help">Add ports to modules inside the child design before binding this module boundary.</p>}
    </fieldset>
  );
}

function NodeEditor({ document, level, node, onOperation, onDelete }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  node: BlockNode;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [kind, setKind] = useState(node.kind);
  const [tone, setTone] = useState(node.tone);
  const [process, setProcess] = useState(node.process ?? "");
  const [summary, setSummary] = useState(node.summary ?? "");
  const [owner, setOwner] = useState(node.owner ?? "");
  const [inspector, setInspector] = useState(node.inspector);
  return (
    <EditorForm onDelete={onDelete} onSubmit={() => onOperation({
      type: "node/update",
      levelId: level.id,
      nodeId: node.id,
      values: {
        title,
        kind,
        tone,
        process: process.trim() || undefined,
        summary: summary.trim() || undefined,
        owner: owner.trim() || undefined,
        inspector,
      },
    })}>
      <Field label="Module id"><input value={node.id} disabled /></Field>
      <Field label="Title" value={title} onChange={setTitle} required />
      <div className="bd-inspector-form-row">
        <Field label="Owner" value={owner} onChange={setOwner} />
        <Field label="Kind" value={kind} onChange={setKind} />
      </div>
      <div className="bd-inspector-form-row">
        <Field label="Tone"><select value={tone} onChange={(event) => setTone(event.target.value)}>
          <option value="neutral">Neutral</option><option value="ui">UI</option><option value="core">Core</option><option value="tool">Tool</option><option value="platform">Platform</option><option value="plugin">Plugin</option>
        </select></Field>
        <Field label="Process" value={process} onChange={setProcess} />
      </div>
      <Field label="Summary" value={summary} onChange={setSummary} multiline />
      <ContractFields value={inspector} onChange={setInspector} />
      <HierarchyBindings document={document} level={level} node={node} onOperation={onOperation} />
    </EditorForm>
  );
}

function PortEditor({ level, node, port, onOperation, onDelete }: {
  level: DesignLevel;
  node: BlockNode;
  port: BlockPort;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(port.label);
  const [direction, setDirection] = useState<PortDirection>(port.direction);
  const [side, setSide] = useState<PortSide>(port.side);
  const [dataType, setDataType] = useState(port.dataType ?? "");
  const [required, setRequired] = useState(port.required);
  return (
    <EditorForm onDelete={onDelete} onSubmit={() => onOperation({
      type: "port/update",
      levelId: level.id,
      nodeId: node.id,
      portId: port.id,
      values: { label, direction, side, dataType: dataType.trim() || undefined, required, order: port.order },
    })}>
      <Field label="Port id"><input value={port.id} disabled /></Field>
      <Field label="Label" value={label} onChange={setLabel} required />
      <div className="bd-inspector-form-row">
        <Field label="Direction"><select value={direction} onChange={(event) => setDirection(event.target.value as PortDirection)}>
          <option value="input">Input</option><option value="output">Output</option><option value="bidirectional">Bidirectional</option>
        </select></Field>
        <Field label="Side"><select value={side} onChange={(event) => setSide(event.target.value as PortSide)}>
          <option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option>
        </select></Field>
      </div>
      <Field label="Data type" value={dataType} onChange={setDataType} />
      <label className="bd-check-field"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span>Required connection</span></label>
    </EditorForm>
  );
}

function ConnectionEditor({ document, level, connectionId, onOperation, onDelete }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  connectionId: string;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
}) {
  const connection = level.connections.find((candidate) => candidate.id === connectionId)!;
  const [label, setLabel] = useState(connection.label ?? "");
  const [definition, setDefinition] = useState<InterfaceDefinition>(document.interfaceDefinitions[connection.interfaceId]);
  const update = (values: Partial<InterfaceDefinition>) => setDefinition((current) => ({ ...current, ...values }));
  return (
    <EditorForm onDelete={onDelete} onSubmit={() => onOperation({
      type: "connection/update",
      levelId: level.id,
      connectionId: connection.id,
      values: { label: label.trim() || undefined },
      definition,
    })}>
      <Field label="Connection id"><input value={connection.id} disabled /></Field>
      <Field label="Interface id"><input value={connection.interfaceId} disabled /></Field>
      <Field label="Connection label" value={label} onChange={setLabel} />
      <Field label="Interface title" value={definition.title} onChange={(title) => update({ title })} required />
      <div className="bd-inspector-form-row">
        <Field label="Type"><select value={definition.kind} onChange={(event) => update({ kind: event.target.value as InterfaceKind })}>
          <option value="rpc">RPC</option><option value="dto">DTO</option><option value="port">Port</option><option value="integration">Integration</option><option value="internal">Internal</option><option value="event">Event</option><option value="stream">Stream</option>
        </select></Field>
        <Field label="Owner" value={definition.owner} onChange={(owner) => update({ owner })} required />
      </div>
      <Field label="Protocol" value={definition.protocol ?? ""} onChange={(protocol) => update({ protocol: protocol.trim() || undefined })} />
      <ContractFields value={definition} onChange={(value) => setDefinition({ ...definition, ...value })} />
    </EditorForm>
  );
}

function InspectionEditor({ document, selection, onOperation, onDelete }: {
  document: BlockDesignDocument;
  selection: SelectionRef;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
}) {
  if (selection.kind === "document") return <DocumentEditor document={document} onOperation={onOperation} />;
  const level = findLevel(document, selection.levelId);
  if (!level) return <p className="bd-empty-state">The selected level no longer exists.</p>;
  if (selection.kind === "level") return <LevelEditor level={level} onOperation={onOperation} />;
  const node = selection.kind === "node" || selection.kind === "port" ? findNode(level, selection.nodeId) : undefined;
  if (selection.kind === "node" && node) return <NodeEditor document={document} level={level} node={node} onOperation={onOperation} onDelete={onDelete} />;
  if (selection.kind === "port" && node) {
    const port = findPort(node, selection.portId);
    if (port) return <PortEditor level={level} node={node} port={port} onOperation={onOperation} onDelete={onDelete} />;
  }
  if (selection.kind === "connection" && level.connections.some((connection) => connection.id === selection.connectionId)) {
    return <ConnectionEditor document={document} level={level} connectionId={selection.connectionId} onOperation={onOperation} onDelete={onDelete} />;
  }
  return <p className="bd-empty-state">The selected design object no longer exists.</p>;
}

function selectionKey(selection: SelectionRef): string {
  if (selection.kind === "document") return "document";
  if (selection.kind === "level") return `level:${selection.levelId}`;
  if (selection.kind === "node") return `node:${selection.levelId}:${selection.nodeId}`;
  if (selection.kind === "port") return `port:${selection.levelId}:${selection.nodeId}:${selection.portId}`;
  return `connection:${selection.levelId}:${selection.connectionId}`;
}

export function Inspector({ document, selection, onOperation, onDelete }: {
  document: BlockDesignDocument;
  selection: SelectionRef;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<"properties" | "json">("properties");
  const inspected = useMemo(() => resolveInspection(document, selection), [document, selection]);
  const rawJson = useMemo(() => JSON.stringify(inspected.raw, null, 2), [inspected.raw]);
  const key = selectionKey(selection);
  useEffect(() => setTab("properties"), [key]);

  return (
    <section className="bd-pane bd-inspector-pane">
      <div className="bd-inspector-title">
        <span className={`bd-kind-badge bd-kind-${inspected.kind.toLowerCase()}`}>{inspected.kind}</span>
        <h2>{inspected.title}</h2>
        {inspected.route && <code>{inspected.route}</code>}
        {inspected.owner && <small>{inspected.owner}</small>}
      </div>
      <div className="bd-tabs" role="tablist" aria-label="Inspector views">
        <button type="button" role="tab" aria-selected={tab === "properties"} className={tab === "properties" ? "is-active" : ""} onClick={() => setTab("properties")}>
          <SlidersHorizontal size={13} aria-hidden="true" /> Properties
        </button>
        <button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "is-active" : ""} onClick={() => setTab("json")}>
          <Braces size={13} aria-hidden="true" /> JSON
        </button>
      </div>
      {tab === "properties" ? (
        <div className="bd-inspector-scroll">
          <InspectionEditor key={`${key}:${rawJson}`} document={document} selection={selection} onOperation={onOperation} onDelete={onDelete} />
        </div>
      ) : (
        <div className="bd-code-section bd-raw-json">
          <header><h3>Selected source object</h3><CopyButton value={rawJson} /></header>
          <pre><code>{rawJson}</code></pre>
        </div>
      )}
    </section>
  );
}
