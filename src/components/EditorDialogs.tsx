import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  connectionEndpointsEqual,
  firstConnectablePair,
  listConnectionSourceEndpoints,
  listConnectionTargetEndpoints,
  normalizeConnectionEndpoints,
} from "../model";
import type {
  ConnectablePortEndpoint,
  DesignLevel,
  InterfaceKind,
  NormalizedConnectionEndpoints,
  PortDirection,
  PortSide,
} from "../model";
import { useStudioLocale } from "../i18n/StudioLocale";
import { useDialogFocus } from "./useDialogFocus";

function DialogShell({
  open,
  title,
  children,
  submitLabel,
  submitDisabled = false,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useStudioLocale();
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus({ open, dialogRef, onClose });
  if (!open) return null;
  return (
    <div className="bd-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form ref={dialogRef} tabIndex={-1} className="bd-modal bd-editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit}>
        <header><h2>{title}</h2></header>
        <div className="bd-editor-dialog-fields">{children}</div>
        {error && <p className="bd-editor-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="is-primary" disabled={submitDisabled}>{submitLabel}</button>
        </footer>
      </form>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
  autoFocus,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="bd-form-field">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        data-autofocus={autoFocus || undefined}
        placeholder={placeholder}
      />
    </label>
  );
}

function useLinkedIdentifier({
  open,
  initialName,
  initialId,
  idFromName,
}: {
  open: boolean;
  initialName: string;
  initialId: string;
  idFromName: (name: string) => string;
}) {
  const [name, setName] = useState(initialName);
  const [id, setId] = useState(initialId);
  const [idCustomized, setIdCustomized] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    setName(initialName);
    setId(initialId);
    setIdCustomized(false);
  }, [initialId, initialName, open]);
  return {
    name,
    id,
    changeName: (nextName: string) => {
      setName(nextName);
      if (!idCustomized) setId(idFromName(nextName));
    },
    changeId: (nextId: string) => {
      setId(nextId);
      setIdCustomized(true);
    },
  };
}

export function NewDesignDialog({
  open,
  error,
  idFromTitle,
  onClose,
  onCreate,
}: {
  open: boolean;
  error?: string;
  idFromTitle: (title: string) => string;
  onClose: () => void;
  onCreate: (values: { id: string; title: string }) => void;
}) {
  const { t } = useStudioLocale();
  const draft = useLinkedIdentifier({
    open,
    initialName: "Untitled Architecture",
    initialId: "untitled-architecture",
    idFromName: idFromTitle,
  });
  return (
    <DialogShell open={open} title={t("dialog.newDesign")} submitLabel={t("dialog.create")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onCreate({ id: draft.id.trim(), title: draft.name.trim() });
    }}>
      <TextField label={t("dialog.designTitle")} value={draft.name} onChange={draft.changeName} required autoFocus />
      <TextField label={t("dialog.designId")} value={draft.id} onChange={draft.changeId} required />
    </DialogShell>
  );
}

export function AddBlockDialog({
  open,
  levelTitle,
  defaultId,
  error,
  idFromTitle,
  onClose,
  onCreate,
}: {
  open: boolean;
  levelTitle: string;
  defaultId: string;
  error?: string;
  idFromTitle: (title: string) => string;
  onClose: () => void;
  onCreate: (values: { id: string; title: string; owner: string }) => void;
}) {
  const { t } = useStudioLocale();
  const draft = useLinkedIdentifier({
    open,
    initialName: "New Module",
    initialId: defaultId,
    idFromName: idFromTitle,
  });
  const [owner, setOwner] = useState("");
  useLayoutEffect(() => {
    if (!open) return;
    setOwner("");
  }, [open]);
  return (
    <DialogShell open={open} title={t("dialog.addModuleTo", { title: levelTitle })} submitLabel={t("dialog.addModule")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onCreate({ id: draft.id.trim(), title: draft.name.trim(), owner: owner.trim() });
    }}>
      <TextField label={t("dialog.moduleTitle")} value={draft.name} onChange={draft.changeName} required autoFocus />
      <TextField label={t("dialog.moduleId")} value={draft.id} onChange={draft.changeId} required />
      <TextField label={t("dialog.owner")} value={owner} onChange={setOwner} placeholder={t("common.optional")} />
    </DialogShell>
  );
}

export function AddPortDialog({
  open,
  blockTitle,
  defaultId,
  error,
  idFromLabel,
  onClose,
  onCreate,
}: {
  open: boolean;
  blockTitle: string;
  defaultId: string;
  error?: string;
  idFromLabel: (label: string) => string;
  onClose: () => void;
  onCreate: (values: {
    id: string;
    label: string;
    direction: PortDirection;
    side: PortSide;
    dataType: string;
    required: boolean;
  }) => void;
}) {
  const { t } = useStudioLocale();
  const draft = useLinkedIdentifier({
    open,
    initialName: "port",
    initialId: defaultId,
    idFromName: idFromLabel,
  });
  const [direction, setDirection] = useState<PortDirection>("input");
  const [side, setSide] = useState<PortSide>("left");
  const [dataType, setDataType] = useState("");
  const [required, setRequired] = useState(true);
  useLayoutEffect(() => {
    if (!open) return;
    setDirection("input");
    setSide("left");
    setDataType("");
    setRequired(true);
  }, [open]);
  return (
    <DialogShell open={open} title={t("dialog.addPortTo", { title: blockTitle })} submitLabel={t("dialog.addPort")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onCreate({ id: draft.id.trim(), label: draft.name.trim(), direction, side, dataType: dataType.trim(), required });
    }}>
      <TextField label={t("dialog.portLabel")} value={draft.name} onChange={draft.changeName} required autoFocus />
      <TextField label={t("dialog.portId")} value={draft.id} onChange={draft.changeId} required />
      <div className="bd-form-row">
        <label className="bd-form-field"><span>{t("dialog.direction")}</span><select value={direction} onChange={(event) => setDirection(event.target.value as PortDirection)}>
          <option value="input">{t("dialog.input")}</option><option value="output">{t("dialog.output")}</option><option value="bidirectional">{t("dialog.bidirectional")}</option>
        </select></label>
        <label className="bd-form-field"><span>{t("dialog.side")}</span><select value={side} onChange={(event) => setSide(event.target.value as PortSide)}>
          <option value="left">{t("dialog.left")}</option><option value="right">{t("dialog.right")}</option><option value="top">{t("dialog.top")}</option><option value="bottom">{t("dialog.bottom")}</option>
        </select></label>
      </div>
      <TextField label={t("dialog.dataType")} value={dataType} onChange={setDataType} placeholder={t("common.optional")} />
      <label className="bd-check-field"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span>{t("dialog.required")}</span></label>
    </DialogShell>
  );
}

export function AddChildDesignDialog({
  open,
  blockTitle,
  defaultId,
  error,
  idFromTitle,
  onClose,
  onCreate,
}: {
  open: boolean;
  blockTitle: string;
  defaultId: string;
  error?: string;
  idFromTitle: (title: string) => string;
  onClose: () => void;
  onCreate: (values: { id: string; title: string }) => void;
}) {
  const { t } = useStudioLocale();
  const draft = useLinkedIdentifier({
    open,
    initialName: `${blockTitle} Internals`,
    initialId: defaultId,
    idFromName: idFromTitle,
  });
  return (
    <DialogShell open={open} title={t("dialog.createChildFor", { title: blockTitle })} submitLabel={t("dialog.createChild")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onCreate({ id: draft.id.trim(), title: draft.name.trim() });
    }}>
      <TextField label={t("dialog.childTitle")} value={draft.name} onChange={draft.changeName} required autoFocus />
      <TextField label={t("dialog.childId")} value={draft.id} onChange={draft.changeId} required />
    </DialogShell>
  );
}

export interface PendingConnection {
  levelId: string;
  source: { nodeId: string; portId: string; label: string };
  target: { nodeId: string; portId: string; label: string };
  defaultConnectionId: string;
  defaultInterfaceId: string;
}

export type ConnectionEndpointDialogMode =
  | { kind: "create" }
  | {
    kind: "reconnect";
    interfaceTitle: string;
    hasManualRouting: boolean;
    initial: NormalizedConnectionEndpoints;
  };

function endpointKey(endpoint: ConnectablePortEndpoint): string {
  return JSON.stringify([endpoint.nodeId, endpoint.portId]);
}

function endpointLabel(endpoint: ConnectablePortEndpoint): string {
  return `${endpoint.nodeTitle}.${endpoint.label} · ${endpoint.direction}`;
}

export function SelectConnectionEndpointsDialog({
  level,
  mode,
  error,
  onClose,
  onContinue,
}: {
  level?: DesignLevel;
  mode: ConnectionEndpointDialogMode;
  error?: string;
  onClose: () => void;
  onContinue: (connection: NormalizedConnectionEndpoints) => void;
}) {
  const { t } = useStudioLocale();
  const sourceOptions = useMemo(() => level ? listConnectionSourceEndpoints(level) : [], [level]);
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const initial = level
    ? mode.kind === "reconnect" ? mode.initial : firstConnectablePair(level)
    : undefined;
  const initialSourceKey = initial ? endpointKey(initial.source) : "";
  const initialTargetKey = initial ? endpointKey(initial.target) : "";

  useLayoutEffect(() => {
    if (!level) return;
    setSourceKey(initialSourceKey);
    setTargetKey(initialTargetKey);
  }, [initialSourceKey, initialTargetKey, level]);

  const source = sourceOptions.find((endpoint) => endpointKey(endpoint) === sourceKey);
  const availableTargets = useMemo(
    () => level ? listConnectionTargetEndpoints(level, source) : [],
    [level, source],
  );
  const target = availableTargets.find((endpoint) => endpointKey(endpoint) === targetKey);

  useLayoutEffect(() => {
    if (!level || !source || target || availableTargets.length === 0) return;
    const preferred = availableTargets.find((endpoint) => endpoint.nodeId !== source?.nodeId) ?? availableTargets[0];
    setTargetKey(endpointKey(preferred));
  }, [availableTargets, level, source, target]);

  const normalized = normalizeConnectionEndpoints(source, target);
  const endpointsChanged = mode.kind === "create" || Boolean(normalized && !connectionEndpointsEqual(
    mode.initial,
    normalized.source,
    normalized.target,
  ));
  const reconnectHint = mode.kind === "reconnect"
    ? `${mode.interfaceTitle} keeps its interface contract. ${
      mode.hasManualRouting
        ? "Changing either endpoint clears the old manual route and recalculates an automatic route."
        : "Changing either endpoint recalculates its automatic route."
    }`
    : undefined;

  return (
    <DialogShell
      open={Boolean(level)}
      title={t(mode.kind === "reconnect" ? "dialog.reconnect" : "dialog.connectPorts")}
      submitLabel={t(mode.kind === "reconnect" ? "dialog.reconnectAction" : "dialog.continue")}
      submitDisabled={!normalized || !endpointsChanged}
      error={error}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (normalized && endpointsChanged) onContinue(normalized);
      }}
    >
      <p className="bd-dialog-hint">
        {reconnectHint ?? `Choose two ports in ${level?.title}. The next step defines their shared interface contract.`}
      </p>
      <label className="bd-form-field">
        <span>{t("dialog.sourcePort")}</span>
        <select value={sourceKey} data-autofocus="true" onChange={(event) => setSourceKey(event.target.value)} required>
          {sourceOptions.map((endpoint) => <option key={endpointKey(endpoint)} value={endpointKey(endpoint)}>{endpointLabel(endpoint)}</option>)}
        </select>
      </label>
      <label className="bd-form-field">
        <span>{t("dialog.targetPort")}</span>
        <select value={target ? targetKey : ""} onChange={(event) => setTargetKey(event.target.value)} required>
          {availableTargets.map((endpoint) => <option key={endpointKey(endpoint)} value={endpointKey(endpoint)}>{endpointLabel(endpoint)}</option>)}
        </select>
      </label>
    </DialogShell>
  );
}

export function CreateConnectionDialog({
  pending,
  error,
  onClose,
  onCreate,
}: {
  pending?: PendingConnection;
  error?: string;
  onClose: () => void;
  onCreate: (values: { connectionId: string; interfaceId: string; title: string; kind: InterfaceKind; owner: string }) => void;
}) {
  const { t } = useStudioLocale();
  const [connectionId, setConnectionId] = useState("");
  const [interfaceId, setInterfaceId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<InterfaceKind>("port");
  const [owner, setOwner] = useState("");
  useLayoutEffect(() => {
    if (!pending) return;
    setConnectionId(pending.defaultConnectionId);
    setInterfaceId(pending.defaultInterfaceId);
    setTitle(`${pending.source.label} to ${pending.target.label}`);
    setKind("port");
    setOwner("");
  }, [pending]);
  return (
    <DialogShell open={Boolean(pending)} title={t("dialog.createTyped")} submitLabel={t("dialog.createConnection")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onCreate({ connectionId: connectionId.trim(), interfaceId: interfaceId.trim(), title: title.trim(), kind, owner: owner.trim() });
    }}>
      {pending && <p className="bd-dialog-route"><code>{pending.source.nodeId}.{pending.source.portId}</code><span>→</span><code>{pending.target.nodeId}.{pending.target.portId}</code></p>}
      <TextField label={t("dialog.interfaceTitle")} value={title} onChange={setTitle} required autoFocus />
      <div className="bd-form-row">
        <TextField label={t("dialog.connectionId")} value={connectionId} onChange={setConnectionId} required />
        <TextField label={t("dialog.interfaceId")} value={interfaceId} onChange={setInterfaceId} required />
      </div>
      <div className="bd-form-row">
        <label className="bd-form-field"><span>{t("dialog.interfaceType")}</span><select value={kind} onChange={(event) => setKind(event.target.value as InterfaceKind)}>
          <option value="rpc">RPC</option><option value="dto">DTO</option><option value="port">Port</option><option value="integration">Integration</option><option value="internal">Internal</option><option value="event">Event</option><option value="stream">Stream</option>
        </select></label>
        <TextField label={t("dialog.owner")} value={owner} onChange={setOwner} required />
      </div>
    </DialogShell>
  );
}

export function SaveDesignDialog({
  open,
  initialFileName,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  initialFileName: string;
  error?: string;
  onClose: () => void;
  onSave: (fileName: string) => void;
}) {
  const { t } = useStudioLocale();
  const [fileName, setFileName] = useState(initialFileName);
  useLayoutEffect(() => {
    if (open) setFileName(initialFileName);
  }, [initialFileName, open]);
  return (
    <DialogShell open={open} title={t("dialog.saveAs")} submitLabel={t("dialog.save")} error={error} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      onSave(fileName.trim());
    }}>
      <TextField label={t("dialog.fileName")} value={fileName} onChange={setFileName} required autoFocus />
      <p className="bd-dialog-hint">The browser saves a portable BlockDesignDocument JSON file.</p>
    </DialogShell>
  );
}
