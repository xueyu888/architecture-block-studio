import { useMemo, useState, type ReactNode } from "react";
import { Box, Cable, ChevronRight, CircuitBoard, Layers3, Search } from "lucide-react";
import type { BlockDesignDocument, DesignLevel } from "../model";
import type { SelectionRef } from "../studio/types";

function levelById(document: BlockDesignDocument, id: string): DesignLevel | undefined {
  return document.levels.find((level) => level.id === id);
}

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
  onSelect: (selection: SelectionRef) => void;
}) {
  const [tab, setTab] = useState<"hierarchy" | "interfaces">("hierarchy");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleConnections = useMemo(
    () => document.levels.flatMap((level) =>
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
        return !normalizedQuery || values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
          ? [{ level, connection, definition }]
          : [];
      }),
    ),
    [document, normalizedQuery],
  );

  const renderLevel = (levelId: string, depth: number, ancestry: Set<string>): ReactNode => {
    const level = levelById(document, levelId);
    if (!level || ancestry.has(levelId)) return null;
    const nextAncestry = new Set(ancestry).add(levelId);
    const levelSelected = selection.kind === "level" && selection.levelId === level.id;
    return (
      <div key={level.id} className="bd-tree-level">
        <button
          type="button"
          className={`bd-tree-row bd-tree-level-row${levelSelected ? " is-selected" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            onRevealLevel(level.id);
            onSelect({ kind: "level", levelId: level.id });
          }}
        >
          <CircuitBoard size={13} aria-hidden="true" />
          <span>{level.title}</span>
          <small>{level.nodes.length}</small>
        </button>
        {level.nodes.map((node) => {
          const childLevelId = node.hierarchy?.childLevelId;
          const expanded = childLevelId ? expandedLevelIds.has(childLevelId) : false;
          const selected = selection.kind === "node" && selection.levelId === level.id && selection.nodeId === node.id;
          return (
            <div key={node.id}>
              <div
                className={`bd-tree-row${selected ? " is-selected" : ""}`}
                style={{ paddingLeft: 22 + depth * 14 }}
              >
                <button
                  type="button"
                  className="bd-tree-select"
                  onClick={() => {
                    onRevealLevel(level.id);
                    onSelect({ kind: "node", levelId: level.id, nodeId: node.id });
                  }}
                  onDoubleClick={() => childLevelId && onToggleLevel(childLevelId)}
                >
                  {childLevelId ? <Layers3 size={13} aria-hidden="true" /> : <Box size={12} aria-hidden="true" />}
                  <span>{node.title}</span>
                </button>
                {childLevelId && (
                  <button
                    type="button"
                    className={`bd-tree-expander${expanded ? " is-expanded" : ""}`}
                    aria-label={`${expanded ? "折叠" : "展开"} ${node.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLevel(childLevelId);
                    }}
                  >
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
              {childLevelId && expanded && renderLevel(childLevelId, depth + 1, nextAncestry)}
            </div>
          );
        })}
      </div>
    );
  };

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
        <div className="bd-source-scroll">
          <button
            type="button"
            className={`bd-tree-row bd-tree-document${selection.kind === "document" ? " is-selected" : ""}`}
            onClick={() => onSelect({ kind: "document" })}
          >
            <Layers3 size={14} aria-hidden="true" />
            <span>{document.title}</span>
          </button>
          {renderLevel(document.entryLevelId, 0, new Set())}
        </div>
      ) : (
        <div className="bd-interface-browser">
          <label className="bd-filter-field">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter interfaces" aria-label="Filter interfaces" />
          </label>
          <div className="bd-interface-browser-list">
            {visibleConnections.map(({ level, connection, definition }) => {
              const selected = selection.kind === "connection" && selection.levelId === level.id && selection.connectionId === connection.id;
              return (
                <button
                  type="button"
                  key={`${level.id}:${connection.id}`}
                  className={`bd-interface-browser-row${selected ? " is-selected" : ""}`}
                  onClick={() => {
                    onRevealLevel(level.id);
                    onSelect({ kind: "connection", levelId: level.id, connectionId: connection.id });
                  }}
                >
                  <span className={`bd-net-kind bd-net-kind-${definition?.kind ?? "internal"}`}>{definition?.kind ?? "internal"}</span>
                  <strong>{connection.label ?? definition?.title ?? connection.id}</strong>
                  <small>{level.title} · {connection.source.nodeId} → {connection.target.nodeId}</small>
                </button>
              );
            })}
            {visibleConnections.length === 0 && <p className="bd-empty-state">No matching interfaces</p>}
          </div>
        </div>
      )}
    </section>
  );
}
