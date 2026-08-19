import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Box, Braces, Cable, Check, Copy, Repeat2, SlidersHorizontal, Trash2 } from "lucide-react";
import type { DesignOperation } from "../editor";
import { listModuleInterfaces } from "../model";
import type {
  BlockDesignDocument,
  BlockNode,
  BlockPort,
  DesignLevel,
  InspectorDefinition,
  InterfaceDefinition,
  InterfaceKind,
  ModuleInterfaceDirection,
  PortDirection,
  PortSide,
} from "../model";
import { selectionKey, type SelectionRef } from "../studio/selection";

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
  if (selection.kind === "multiple") {
    return {
      kind: "MULTI",
      title: `${selection.items.length} objects selected`,
      raw: selection.items.map((item) => resolveInspection(document, item).raw),
    };
  }
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

function MultiSelectionSummary({ document, selection, onSelect }: {
  document: BlockDesignDocument;
  selection: Extract<SelectionRef, { kind: "multiple" }>;
  onSelect: (selection: SelectionRef) => void;
}) {
  const rows = selection.items.map((item) => ({ item, inspection: resolveInspection(document, item) }));
  const moduleCount = selection.items.filter((item) => item.kind === "node").length;
  const interfaceCount = selection.items.length - moduleCount;
  const levelCount = new Set(selection.items.map((item) => item.levelId)).size;
  const visibleRows = rows.slice(0, 60);
  return (
    <div className="bd-multi-inspection">
      <p className="bd-multi-lead">
        Move the selected modules together, or choose one object below to inspect and edit its contract.
      </p>
      <dl className="bd-multi-metrics" aria-label="Selection summary">
        <div><dt>Modules</dt><dd>{moduleCount}</dd></div>
        <div><dt>Interfaces</dt><dd>{interfaceCount}</dd></div>
        <div><dt>Levels</dt><dd>{levelCount}</dd></div>
      </dl>
      <div className="bd-multi-list" role="list" aria-label="Selected design objects">
        {visibleRows.map(({ item, inspection }) => (
          <button
            type="button"
            role="listitem"
            key={selectionKey(item)}
            onClick={() => onSelect(item)}
          >
            <span className="bd-multi-object-icon" aria-hidden="true">
              {item.kind === "node" ? <Box size={13} /> : <Cable size={13} />}
            </span>
            <span><strong>{inspection.title}</strong><small>{inspection.kind} · {item.levelId}</small></span>
          </button>
        ))}
      </div>
      {visibleRows.length < rows.length && (
        <p className="bd-multi-overflow">Showing 60 of {rows.length} selected objects.</p>
      )}
      <p className="bd-multi-help">Drag empty canvas to enclose · Alt-drag intersects, even over objects · Shift/Ctrl/⌘ toggles · Drag moves · Ctrl/⌘ drag clones · Arrange aligns · Ctrl/⌘ Shift+H fits · Esc clears.</p>
    </div>
  );
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

function useReportDraft(dirty: boolean, onDraftChange: (dirty: boolean) => void) {
  useLayoutEffect(() => onDraftChange(dirty), [dirty, onDraftChange]);
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

function DocumentEditor({ document, onOperation, onDraftChange }: { document: BlockDesignDocument; onOperation: (operation: DesignOperation) => void; onDraftChange: (dirty: boolean) => void }) {
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary);
  useReportDraft(title !== document.title || summary !== document.summary, onDraftChange);
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

function LevelEditor({ level, onOperation, onDraftChange }: { level: DesignLevel; onOperation: (operation: DesignOperation) => void; onDraftChange: (dirty: boolean) => void }) {
  const [title, setTitle] = useState(level.title);
  const [description, setDescription] = useState(level.description);
  const [direction, setDirection] = useState(level.layout.direction);
  const [spacing, setSpacing] = useState(String(level.layout.spacing));
  const [layerSpacing, setLayerSpacing] = useState(String(level.layout.layerSpacing));
  useReportDraft(
    title !== level.title ||
      description !== level.description ||
      direction !== level.layout.direction ||
      Number(spacing) !== level.layout.spacing ||
      Number(layerSpacing) !== level.layout.layerSpacing,
    onDraftChange,
  );
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

function HierarchyBindings({ document, level, node, onOperation, disabled }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  node: BlockNode;
  onOperation: (operation: DesignOperation) => void;
  disabled?: boolean;
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
            <select value={value} disabled={disabled} onChange={(event) => {
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
      {disabled && <p className="bd-form-help">Apply or discard the current module changes before editing hierarchy bindings.</p>}
      {endpoints.length === 0 && <p className="bd-form-help">Add ports to modules inside the child design before binding this module boundary.</p>}
    </fieldset>
  );
}

const interfaceDirectionMetadata: Record<ModuleInterfaceDirection, { label: string; icon: typeof ArrowDownLeft }> = {
  incoming: { label: "Incoming", icon: ArrowDownLeft },
  outgoing: { label: "Outgoing", icon: ArrowUpRight },
  loopback: { label: "Loopback", icon: Repeat2 },
};

function ConnectedInterfaces({ document, level, node, onSelect }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  node: BlockNode;
  onSelect: (selection: SelectionRef) => void;
}) {
  const summaries = listModuleInterfaces(document, level.id, node.id);
  return (
    <fieldset className="bd-related-interfaces">
      <legend>Connected interfaces <span>{summaries.length}</span></legend>
      {summaries.length === 0 ? (
        <p>No direct interfaces in this level.</p>
      ) : (["incoming", "outgoing", "loopback"] as const).map((direction) => {
        const group = summaries.filter((summary) => summary.direction === direction);
        if (group.length === 0) return null;
        const metadata = interfaceDirectionMetadata[direction];
        const Icon = metadata.icon;
        return (
          <section key={direction} aria-label={`${metadata.label} interfaces`}>
            <h3><Icon size={12} aria-hidden="true" /> {metadata.label} <span>{group.length}</span></h3>
            {group.map((summary) => (
              <button
                key={summary.connectionId}
                type="button"
                className="bd-related-interface-row"
                aria-label={`Open ${summary.title} interface`}
                onClick={() => onSelect({ kind: "connection", levelId: summary.levelId, connectionId: summary.connectionId })}
              >
                <span className={`bd-interface-kind bd-kind-${summary.kind ?? "connection"}`}>{summary.kind ?? "interface"}</span>
                <strong>{summary.title}</strong>
                <small>{direction === "incoming"
                  ? `${summary.peerNodeTitle}.${summary.peerPortLabel} → ${summary.localPortLabel}`
                  : direction === "outgoing"
                    ? `${summary.localPortLabel} → ${summary.peerNodeTitle}.${summary.peerPortLabel}`
                    : `${summary.localPortLabel} ↻ ${summary.peerPortLabel}`}</small>
              </button>
            ))}
          </section>
        );
      })}
    </fieldset>
  );
}

function NodeEditor({ document, level, node, onOperation, onDelete, onDraftChange, onSelect }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  node: BlockNode;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
  onDraftChange: (dirty: boolean) => void;
  onSelect: (selection: SelectionRef) => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [kind, setKind] = useState(node.kind);
  const [tone, setTone] = useState(node.tone);
  const [process, setProcess] = useState(node.process ?? "");
  const [summary, setSummary] = useState(node.summary ?? "");
  const [owner, setOwner] = useState(node.owner ?? "");
  const [inspector, setInspector] = useState(node.inspector);
  const dirty = title !== node.title ||
    kind !== node.kind ||
    tone !== node.tone ||
    (process.trim() || undefined) !== node.process ||
    (summary.trim() || undefined) !== node.summary ||
    (owner.trim() || undefined) !== node.owner ||
    JSON.stringify(inspector) !== JSON.stringify(node.inspector);
  useReportDraft(dirty, onDraftChange);
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
      <section className="bd-node-geometry" aria-label="Module geometry">
        <div>
          <span>Canvas size</span>
          <strong>{node.layout.width && node.layout.height
            ? `${node.layout.width} × ${node.layout.height}`
            : "Automatic"}</strong>
        </div>
        <p>Drag an edge or corner handle to resize; hold Shift to preserve the original proportions, taking priority over sibling-size snapping. Alignment and equal-size guides snap nearby geometry; start the direct gesture, then hold Alt to bypass them. Alt held before pointerdown forces a selection box instead. With the module focused, Ctrl/Cmd + Shift + Arrow changes width or height by 16 design pixels. Apply current property changes first.</p>
      </section>
      <ConnectedInterfaces document={document} level={level} node={node} onSelect={onSelect} />
      <ContractFields value={inspector} onChange={setInspector} />
      <HierarchyBindings document={document} level={level} node={node} onOperation={onOperation} disabled={dirty} />
    </EditorForm>
  );
}

function PortEditor({ level, node, port, onOperation, onDelete, onDraftChange }: {
  level: DesignLevel;
  node: BlockNode;
  port: BlockPort;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [label, setLabel] = useState(port.label);
  const [direction, setDirection] = useState<PortDirection>(port.direction);
  const [side, setSide] = useState<PortSide>(port.side);
  const [dataType, setDataType] = useState(port.dataType ?? "");
  const [required, setRequired] = useState(port.required);
  useReportDraft(
    label !== port.label ||
      direction !== port.direction ||
      side !== port.side ||
      (dataType.trim() || undefined) !== port.dataType ||
      required !== port.required,
    onDraftChange,
  );
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

function ConnectionEditor({ document, level, connectionId, onOperation, onDelete, onDraftChange }: {
  document: BlockDesignDocument;
  level: DesignLevel;
  connectionId: string;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const connection = level.connections.find((candidate) => candidate.id === connectionId)!;
  const [label, setLabel] = useState(connection.label ?? "");
  const [definition, setDefinition] = useState<InterfaceDefinition>(document.interfaceDefinitions[connection.interfaceId]);
  const update = (values: Partial<InterfaceDefinition>) => setDefinition((current) => ({ ...current, ...values }));
  const dirty =
    (label.trim() || undefined) !== connection.label ||
    JSON.stringify(definition) !== JSON.stringify(document.interfaceDefinitions[connection.interfaceId]);
  useReportDraft(dirty, onDraftChange);
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
      <section className="bd-route-editor" aria-label="Connection routing">
        <div><span>Routing</span><strong>{connection.routing ? "Manual" : "Automatic"}</strong></div>
        <p>Drag a diamond to move a segment. Manual routes also show solid bend points: drag or use Arrow keys to move; Delete or double click removes one. Drag either circular endpoint to reconnect. Confirmed geometry is saved in this JSON connection.</p>
        {connection.routing && (
          <button
            type="button"
            className="bd-inline-action"
            disabled={dirty}
            onClick={() => onOperation({
              type: "connection/route",
              levelId: level.id,
              connectionId: connection.id,
              routing: undefined,
            })}
          >
            Reset to automatic routing
          </button>
        )}
      </section>
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

function InspectionEditor({ document, selection, onOperation, onDelete, onDraftChange, onSelect }: {
  document: BlockDesignDocument;
  selection: SelectionRef;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
  onDraftChange: (dirty: boolean) => void;
  onSelect: (selection: SelectionRef) => void;
}) {
  if (selection.kind === "document") return <DocumentEditor document={document} onOperation={onOperation} onDraftChange={onDraftChange} />;
  if (selection.kind === "multiple") {
    return <MultiSelectionSummary document={document} selection={selection} onSelect={onSelect} />;
  }
  const level = findLevel(document, selection.levelId);
  if (!level) return <p className="bd-empty-state">The selected level no longer exists.</p>;
  if (selection.kind === "level") return <LevelEditor level={level} onOperation={onOperation} onDraftChange={onDraftChange} />;
  const node = selection.kind === "node" || selection.kind === "port" ? findNode(level, selection.nodeId) : undefined;
  if (selection.kind === "node" && node) return <NodeEditor document={document} level={level} node={node} onOperation={onOperation} onDelete={onDelete} onDraftChange={onDraftChange} onSelect={onSelect} />;
  if (selection.kind === "port" && node) {
    const port = findPort(node, selection.portId);
    if (port) return <PortEditor level={level} node={node} port={port} onOperation={onOperation} onDelete={onDelete} onDraftChange={onDraftChange} />;
  }
  if (selection.kind === "connection" && level.connections.some((connection) => connection.id === selection.connectionId)) {
    return <ConnectionEditor document={document} level={level} connectionId={selection.connectionId} onOperation={onOperation} onDelete={onDelete} onDraftChange={onDraftChange} />;
  }
  return <p className="bd-empty-state">The selected design object no longer exists.</p>;
}

export function Inspector({ document, selection, onOperation, onDelete, onDraftChange, onSelect }: {
  document: BlockDesignDocument;
  selection: SelectionRef;
  onOperation: (operation: DesignOperation) => void;
  onDelete: () => void;
  onDraftChange: (dirty: boolean) => void;
  onSelect: (selection: SelectionRef) => void;
}) {
  const inspectorRef = useRef<HTMLElement>(null);
  const restoreApplyFocus = useRef(false);
  const [tab, setTab] = useState<"properties" | "json">("properties");
  const [draftDirty, setDraftDirty] = useState(false);
  const inspected = useMemo(() => resolveInspection(document, selection), [document, selection]);
  const rawJson = useMemo(() => JSON.stringify(inspected.raw, null, 2), [inspected.raw]);
  const key = selectionKey(selection);
  const reportDraft = useCallback((dirty: boolean) => {
    setDraftDirty(dirty);
    onDraftChange(dirty);
  }, [onDraftChange]);
  useEffect(() => {
    setTab("properties");
    reportDraft(false);
  }, [key, reportDraft]);
  useLayoutEffect(() => {
    if (!restoreApplyFocus.current) return;
    const apply = inspectorRef.current?.querySelector<HTMLButtonElement>(".bd-inspector-actions .is-primary");
    if (!apply) return;
    restoreApplyFocus.current = false;
    apply.focus();
  }, [rawJson]);

  return (
    <section
      ref={inspectorRef}
      className="bd-pane bd-inspector-pane"
      onSubmitCapture={(event) => {
        if (!(event.target instanceof HTMLFormElement) || !event.target.classList.contains("bd-inspector-form")) return;
        restoreApplyFocus.current = true;
        window.requestAnimationFrame(() => {
          if (!restoreApplyFocus.current) return;
          if (window.document.activeElement?.isConnected && inspectorRef.current?.contains(window.document.activeElement)) {
            restoreApplyFocus.current = false;
          }
        });
      }}
    >
      <div className="bd-inspector-title">
        <span className={`bd-kind-badge bd-kind-${inspected.kind.toLowerCase()}`}>{inspected.kind}</span>
        {draftDirty && <span className="bd-inspector-draft-status" role="status">UNAPPLIED</span>}
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
      <div className="bd-inspector-scroll" hidden={tab !== "properties"}>
        <InspectionEditor key={`${key}:${rawJson}`} document={document} selection={selection} onOperation={onOperation} onDelete={onDelete} onDraftChange={reportDraft} onSelect={onSelect} />
      </div>
      <div className="bd-code-section bd-raw-json" hidden={tab !== "json"}>
          <header><h3>{selection.kind === "multiple" ? "Selected source objects" : "Selected source object"}</h3><CopyButton value={rawJson} /></header>
          <pre><code>{rawJson}</code></pre>
      </div>
    </section>
  );
}
