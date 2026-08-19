import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Cable, ChevronRight, CircuitBoard, Layers3, Search } from "lucide-react";
import type { BlockDesignDocument } from "../model";
import type { SelectionRef } from "../studio/selection";
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
          Showing {renderedItems.length} of {items.length} · Scroll for more
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
  depth,
  onToggleLevel,
  onRevealLevel,
  onSelect,
}: HierarchyNodeRowProps) {
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
          onClick={() => {
            if (onSelect({ kind: "node", levelId, nodeId })) onRevealLevel(levelId);
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
            aria-label={`${expanded ? "折叠" : "展开"} ${title}`}
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
  selection,
  onToggleLevel,
  onRevealLevel,
  onSelect,
}: {
  document: BlockDesignDocument;
  expandedLevelIds: ReadonlySet<string>;
  selection: SelectionRef;
  onToggleLevel: (levelId: string) => void;
  onRevealLevel: (levelId: string) => void;
  onSelect: (selection: SelectionRef) => boolean;
}) {
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
      <div className="bd-dock-tabs" role="tablist" aria-label="Sources views">
        <button type="button" role="tab" aria-selected={tab === "hierarchy"} className={tab === "hierarchy" ? "is-active" : ""} onClick={() => setTab("hierarchy")}>
          <Layers3 size={12} aria-hidden="true" /> Hierarchy
        </button>
        <button type="button" role="tab" aria-selected={tab === "interfaces"} className={tab === "interfaces" ? "is-active" : ""} onClick={() => setTab("interfaces")}>
          <Cable size={12} aria-hidden="true" /> Interfaces
        </button>
      </div>
      {tab === "hierarchy" ? (
        <div className="bd-hierarchy-browser">
          <label className="bd-filter-field">
            <Search size={13} aria-hidden="true" />
            <input
              value={hierarchyQuery}
              onChange={(event) => setHierarchyQuery(event.target.value)}
              placeholder="Filter modules"
              aria-label="Filter modules"
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
              ariaLabel="Matching modules"
              itemKey={({ level, node }) => `${level.id}:${node.id}`}
              renderItem={({ level, node }) => {
                const selected = selection.kind === "node" && selection.levelId === level.id && selection.nodeId === node.id;
                return (
                  <button
                    type="button"
                    className={`bd-hierarchy-search-row${selected ? " is-selected" : ""}`}
                    onClick={() => {
                      if (onSelect({ kind: "node", levelId: level.id, nodeId: node.id })) onRevealLevel(level.id);
                    }}
                  >
                    <Box size={12} aria-hidden="true" />
                    <strong>{node.title}</strong>
                    <small>{node.id} · {node.owner ?? "Unassigned owner"} · {level.title}</small>
                  </button>
                );
              }}
              empty={<p className="bd-empty-state">No matching modules</p>}
            />
          ) : (
            <ProgressiveResultList
              items={hierarchyRows}
              resetKey={document.id}
              className="bd-source-scroll"
              ariaLabel="Design hierarchy"
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
                      className={`bd-tree-row bd-tree-level-row${selected ? " is-selected" : ""}`}
                      style={{ paddingLeft: 8 + row.depth * 14 }}
                      onClick={() => {
                        if (onSelect({ kind: "level", levelId: row.level.id })) onRevealLevel(row.level.id);
                      }}
                    >
                      <CircuitBoard size={13} aria-hidden="true" />
                      <span>{row.level.title}</span>
                      <small>{row.level.nodes.length}</small>
                    </button>
                  );
                }
                const selected = selection.kind === "node" && selection.levelId === row.level.id && selection.nodeId === row.node.id;
                return (
                  <HierarchyNodeRow
                    levelId={row.level.id}
                    nodeId={row.node.id}
                    title={row.node.title}
                    childLevelId={row.childLevelId}
                    expanded={row.expanded}
                    selected={selected}
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
            <input value={interfaceQuery} onChange={(event) => setInterfaceQuery(event.target.value)} placeholder="Filter interfaces" aria-label="Filter interfaces" />
            <output className="bd-filter-count" aria-live="polite">{visibleConnections.length}</output>
          </label>
          <ProgressiveResultList
            items={visibleConnections}
            resetKey={normalizedInterfaceQuery}
            className="bd-interface-browser-list"
            ariaLabel="Declared interfaces"
            itemKey={({ level, connection }) => `${level.id}:${connection.id}`}
            renderItem={({ level, connection, definition }) => {
              const selected = selection.kind === "connection" && selection.levelId === level.id && selection.connectionId === connection.id;
              return (
                <button
                  type="button"
                  className={`bd-interface-browser-row${selected ? " is-selected" : ""}`}
                  onClick={() => {
                    if (onSelect({ kind: "connection", levelId: level.id, connectionId: connection.id })) onRevealLevel(level.id);
                  }}
                >
                  <span className={`bd-net-kind bd-net-kind-${definition?.kind ?? "internal"}`}>{definition?.kind ?? "internal"}</span>
                  <strong>{connection.label ?? definition?.title ?? connection.id}</strong>
                  <small>{level.title} · {connection.source.nodeId} → {connection.target.nodeId}</small>
                </button>
              );
            }}
            empty={<p className="bd-empty-state">No matching interfaces</p>}
          />
        </div>
      )}
    </section>
  );
}
