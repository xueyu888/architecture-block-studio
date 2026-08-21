import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Cable, ChevronRight, CircuitBoard, Layers3, Search } from "lucide-react";
import type { BlockDesignDocument } from "../model";
import { useStudioLocale } from "../i18n/StudioLocale";
import {
  selectionContains,
  toggleDiagramSelection,
  type DiagramSelectionRef,
  type SelectionRef,
} from "../studio/selection";
import { projectHierarchyRows } from "./hierarchyRows";

const RESULT_BATCH_SIZE = 40;

function ProgressiveResultList<T>({
  items,
  resetKey,
  className,
  ariaLabel,
  itemKey,
  renderItem,
  empty,
}: {
  items: readonly T[];
  resetKey: string;
  className: string;
  ariaLabel: string;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  empty: ReactNode;
}) {
  const { t } = useStudioLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ resetKey, limit: RESULT_BATCH_SIZE });
  const limit = window.resetKey === resetKey ? window.limit : RESULT_BATCH_SIZE;
  const renderedItems = items.slice(0, limit);

  useLayoutEffect(() => {
    setWindow({ resetKey, limit: RESULT_BATCH_SIZE });
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [resetKey]);

  return (
    <div
      ref={listRef}
      className={className}
      role="list"
      aria-label={ariaLabel}
      data-total-results={items.length}
      data-rendered-results={renderedItems.length}
      onScroll={(event) => {
        if (renderedItems.length >= items.length) return;
        const list = event.currentTarget;
        if (list.scrollHeight - list.scrollTop - list.clientHeight > 96) return;
        setWindow((current) => ({
          resetKey,
          limit: Math.min(
            items.length,
            (current.resetKey === resetKey ? current.limit : RESULT_BATCH_SIZE) + RESULT_BATCH_SIZE,
          ),
        }));
      }}
    >
      {renderedItems.map((item) => (
        <div role="listitem" key={itemKey(item)}>{renderItem(item)}</div>
      ))}
      {items.length === 0 && empty}
      {renderedItems.length < items.length && (
        <p className="bd-progressive-results" role="status">
          {t("sources.showing", { shown: renderedItems.length, total: items.length })}
        </p>
      )}
    </div>
  );
}

interface HierarchyNodeRowProps {
  levelId: string;
  nodeId: string;
  title: string;
  childLevelId?: string;
  expanded: boolean;
  selected: boolean;
  selection: SelectionRef;
  depth: number;
  onToggleLevel: (levelId: string) => void;
  onRevealLevel: (levelId: string) => void;
  onSelect: (selection: SelectionRef) => boolean;
}

const HierarchyNodeRow = memo(function HierarchyNodeRow({
  levelId,
  nodeId,
  title,
  childLevelId,
  expanded,
  selected,
  selection,
  depth,
  onToggleLevel,
  onRevealLevel,
  onSelect,
}: HierarchyNodeRowProps) {
  const { t } = useStudioLocale();
  return (
    <div>
      <div
        className={`bd-tree-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 22 + depth * 14 }}
      >
        <button
          type="button"
          className="bd-tree-select"
          data-level-id={levelId}
          data-node-id={nodeId}
          onClick={(event) => {
            const item: DiagramSelectionRef = { kind: "node", levelId, nodeId };
            const next = event.shiftKey || event.ctrlKey || event.metaKey
              ? toggleDiagramSelection(selection, [item], levelId)
              : item;
            if (onSelect(next)) onRevealLevel(levelId);
          }}
          onDoubleClick={() => childLevelId && onToggleLevel(childLevelId)}
        >
          {childLevelId ? <Layers3 size={13} aria-hidden="true" /> : <Box size={12} aria-hidden="true" />}
          <span>{title}</span>
        </button>
        {childLevelId && (
          <button
            type="button"
            className={`bd-tree-expander${expanded ? " is-expanded" : ""}`}
            aria-label={`${t(expanded ? "common.collapse" : "common.expand")} ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleLevel(childLevelId);
            }}
          >
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

export function HierarchyTree({
  document,
  expandedLevelIds,
  viewRootLevelId,
  selection,
  onToggleLevel,
  onEnterLevel,
  onRevealLevel,
  onSelect,
}: {
  document: BlockDesignDocument;
  expandedLevelIds: ReadonlySet<string>;
  viewRootLevelId: string;
  selection: SelectionRef;
  onToggleLevel: (levelId: string) => void;
  onEnterLevel: (levelId: string) => void;
  onRevealLevel: (levelId: string) => void;
  onSelect: (selection: SelectionRef) => boolean;
}) {
  const { t } = useStudioLocale();
  const [tab, setTab] = useState<"hierarchy" | "interfaces">("hierarchy");
  const [hierarchyQuery, setHierarchyQuery] = useState("");
  const [interfaceQuery, setInterfaceQuery] = useState("");
  const normalizedHierarchyQuery = hierarchyQuery.trim().toLocaleLowerCase();
  const normalizedInterfaceQuery = interfaceQuery.trim().toLocaleLowerCase();
  const totalNodeCount = useMemo(
    () => document.levels.reduce((total, level) => total + level.nodes.length, 0),
    [document],
  );
  const hierarchyRows = useMemo(
    () => projectHierarchyRows(document, expandedLevelIds),
    [document, expandedLevelIds],
  );
  const visibleNodes = useMemo(
    () => {
      if (!normalizedHierarchyQuery) return [];
      return document.levels.flatMap((level) => level.nodes.flatMap((node) => {
      const values = [node.title, node.id, node.owner, level.title, level.id];
      return values.some((value) => value?.toLocaleLowerCase().includes(normalizedHierarchyQuery))
        ? [{ level, node }]
        : [];
      }));
    },
    [document, normalizedHierarchyQuery],
  );
  const visibleConnections = useMemo(
    () => tab === "interfaces" ? document.levels.flatMap((level) =>
      level.connections.flatMap((connection) => {
        const definition = document.interfaceDefinitions[connection.interfaceId];
        const values = [
          level.title,
          connection.label,
          connection.id,
          connection.interfaceId,
          definition?.title,
          definition?.kind,
          connection.source.nodeId,
          connection.target.nodeId,
        ];
        return !normalizedInterfaceQuery || values.some((value) => value?.toLocaleLowerCase().includes(normalizedInterfaceQuery))
          ? [{ level, connection, definition }]
          : [];
      }),
    ) : [],
    [document, normalizedInterfaceQuery, tab],
  );

  return (
    <section className="bd-sources-pane">
      <div className="bd-dock-tabs" role="tablist" aria-label={t("sources.views")}>
        <button type="button" role="tab" aria-selected={tab === "hierarchy"} className={tab === "hierarchy" ? "is-active" : ""} onClick={() => setTab("hierarchy")}>
          <Layers3 size={12} aria-hidden="true" /> {t("sources.hierarchy")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "interfaces"} className={tab === "interfaces" ? "is-active" : ""} onClick={() => setTab("interfaces")}>
          <Cable size={12} aria-hidden="true" /> {t("sources.interfaces")}
        </button>
      </div>
      {tab === "hierarchy" ? (
        <div className="bd-hierarchy-browser">
          <label className="bd-filter-field">
            <Search size={13} aria-hidden="true" />
            <input
              value={hierarchyQuery}
              onChange={(event) => setHierarchyQuery(event.target.value)}
              placeholder={t("sources.filterModules")}
              aria-label={t("sources.filterModules")}
            />
            <output className="bd-filter-count" aria-live="polite">
              {normalizedHierarchyQuery ? visibleNodes.length : totalNodeCount}
            </output>
          </label>
          {normalizedHierarchyQuery ? (
            <ProgressiveResultList
              items={visibleNodes}
              resetKey={normalizedHierarchyQuery}
              className="bd-hierarchy-search-list"
              ariaLabel={t("sources.matchingModules")}
              itemKey={({ level, node }) => `${level.id}:${node.id}`}
              renderItem={({ level, node }) => {
                const item: DiagramSelectionRef = { kind: "node", levelId: level.id, nodeId: node.id };
                const selected = selectionContains(selection, item);
                return (
                  <button
                    type="button"
                    className={`bd-hierarchy-search-row${selected ? " is-selected" : ""}`}
                    onClick={(event) => {
                      const next = event.shiftKey || event.ctrlKey || event.metaKey
                        ? toggleDiagramSelection(selection, [item], level.id)
                        : item;
                      if (onSelect(next)) onRevealLevel(level.id);
                    }}
                  >
                    <Box size={12} aria-hidden="true" />
                    <strong>{node.title}</strong>
                    <small>{node.id} · {node.owner ?? t("sources.unassigned")} · {level.title}</small>
                  </button>
                );
              }}
              empty={<p className="bd-empty-state">{t("sources.noModules")}</p>}
            />
          ) : (
            <ProgressiveResultList
              items={hierarchyRows}
              resetKey={document.id}
              className="bd-source-scroll"
              ariaLabel={t("sources.designHierarchy")}
              itemKey={(row) => row.key}
              renderItem={(row) => {
                if (row.kind === "document") {
                  return (
                    <button
                      type="button"
                      className={`bd-tree-row bd-tree-document${selection.kind === "document" ? " is-selected" : ""}`}
                      onClick={() => onSelect({ kind: "document" })}
                    >
                      <Layers3 size={14} aria-hidden="true" />
                      <span>{document.title}</span>
                    </button>
                  );
                }
                if (row.kind === "level") {
                  const selected = selection.kind === "level" && selection.levelId === row.level.id;
                  return (
                    <button
                      type="button"
                      className={`bd-tree-row bd-tree-level-row${selected ? " is-selected" : ""}${row.level.id === viewRootLevelId ? " is-view-root" : ""}`}
                      style={{ paddingLeft: 8 + row.depth * 14 }}
                      aria-current={row.level.id === viewRootLevelId ? "page" : undefined}
                      onClick={() => {
                        if (onSelect({ kind: "level", levelId: row.level.id })) onRevealLevel(row.level.id);
                      }}
                      onDoubleClick={() => onEnterLevel(row.level.id)}
                    >
                      <CircuitBoard size={13} aria-hidden="true" />
                      <span>{row.level.title}</span>
                      <small>{row.level.nodes.length}</small>
                    </button>
                  );
                }
                const item: DiagramSelectionRef = { kind: "node", levelId: row.level.id, nodeId: row.node.id };
                const selected = selectionContains(selection, item);
                return (
                  <HierarchyNodeRow
                    levelId={row.level.id}
                    nodeId={row.node.id}
                    title={row.node.title}
                    childLevelId={row.childLevelId}
                    expanded={row.expanded}
                    selected={selected}
                    selection={selection}
                    depth={row.depth}
                    onToggleLevel={onToggleLevel}
                    onRevealLevel={onRevealLevel}
                    onSelect={onSelect}
                  />
                );
              }}
              empty={<p className="bd-empty-state">No hierarchy rows</p>}
            />
          )}
        </div>
      ) : (
        <div className="bd-interface-browser">
          <label className="bd-filter-field">
            <Search size={13} aria-hidden="true" />
            <input value={interfaceQuery} onChange={(event) => setInterfaceQuery(event.target.value)} placeholder={t("sources.filterInterfaces")} aria-label={t("sources.filterInterfaces")} />
            <output className="bd-filter-count" aria-live="polite">{visibleConnections.length}</output>
          </label>
          <ProgressiveResultList
            items={visibleConnections}
            resetKey={normalizedInterfaceQuery}
            className="bd-interface-browser-list"
            ariaLabel={t("sources.matchingInterfaces")}
            itemKey={({ level, connection }) => `${level.id}:${connection.id}`}
            renderItem={({ level, connection, definition }) => {
              const item: DiagramSelectionRef = {
                kind: "connection",
                levelId: level.id,
                connectionId: connection.id,
              };
              const selected = selectionContains(selection, item);
              return (
                <button
                  type="button"
                  className={`bd-interface-browser-row${selected ? " is-selected" : ""}`}
                  onClick={(event) => {
                    const next = event.shiftKey || event.ctrlKey || event.metaKey
                      ? toggleDiagramSelection(selection, [item], level.id)
                      : item;
                    if (onSelect(next)) onRevealLevel(level.id);
                  }}
                >
                  <span className={`bd-net-kind bd-net-kind-${definition?.kind ?? "internal"}`}>{definition?.kind ?? "internal"}</span>
                  <strong>{connection.label ?? definition?.title ?? connection.id}</strong>
                  <small>{level.title} · {connection.source.nodeId} → {connection.target.nodeId}</small>
                </button>
              );
            }}
            empty={<p className="bd-empty-state">{t("sources.noInterfaces")}</p>}
          />
        </div>
      )}
    </section>
  );
}
