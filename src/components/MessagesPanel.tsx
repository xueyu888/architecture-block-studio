import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleX, Info, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import type { DesignIssue } from "../model";

type SeverityFilter = "all" | DesignIssue["severity"];

function IssueIcon({ severity }: { severity: DesignIssue["severity"] }) {
  if (severity === "error") return <CircleX size={14} aria-hidden="true" />;
  if (severity === "warning") return <TriangleAlert size={14} aria-hidden="true" />;
  if (severity === "info") return <CircleCheck size={14} aria-hidden="true" />;
  return <Info size={14} aria-hidden="true" />;
}

export function MessagesPanel({
  issues,
  focusRequest,
  onSelect,
}: {
  issues: DesignIssue[];
  focusRequest: number;
  onSelect: (issue: DesignIssue) => void;
}) {
  const filterRef = useRef<HTMLInputElement>(null);
  const handledFocusRequest = useRef(0);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const infos = issues.filter((issue) => issue.severity === "info").length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleIssues = useMemo(() => issues.filter((issue) => {
    if (severity !== "all" && issue.severity !== severity) return false;
    if (!normalizedQuery) return true;
    return [issue.code, issue.message, issue.remediation, issue.levelId, issue.nodeId, issue.portId, issue.connectionId]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  }), [issues, normalizedQuery, severity]);
  const filters: Array<{ id: SeverityFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: issues.length },
    { id: "error", label: "Errors", count: errors },
    { id: "warning", label: "Warnings", count: warnings },
    { id: "info", label: "Info", count: infos },
  ];
  useEffect(() => {
    if (focusRequest <= handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequest;
    const frame = window.requestAnimationFrame(() => filterRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);
  return (
    <section className="bd-messages">
      <header className="bd-messages-header">
        <div className="bd-message-tab">
          <ShieldCheck size={13} aria-hidden="true" /> Design Rule Check
          <span className="bd-message-count bd-message-error">{errors}</span>
          <span className="bd-message-count bd-message-warning">{warnings}</span>
        </div>
      </header>
      <div className="bd-message-filters" role="toolbar" aria-label="Design issue filters">
        <label>
          <Search size={12} aria-hidden="true" />
          <input
            ref={filterRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter design issues"
            placeholder="Filter code, message, or target"
          />
        </label>
        <div className="bd-message-severity">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={severity === filter.id}
              className={severity === filter.id ? "is-active" : ""}
              onClick={() => setSeverity(filter.id)}
            >
              {filter.label} <span>{filter.count}</span>
            </button>
          ))}
        </div>
        <small>{visibleIssues.length} shown</small>
      </div>
      <div className="bd-message-list">
        {visibleIssues.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`bd-message-row bd-message-${item.severity}`}
            onClick={() => onSelect(item)}
          >
            <IssueIcon severity={item.severity} />
            <code>{item.code}</code>
            <span className="bd-message-description">
              <span>{item.message}</span>
              <small className="bd-message-remediation">Next: {item.remediation}</small>
            </span>
            <small className="bd-message-target">{[item.levelId, item.nodeId, item.portId, item.connectionId].filter(Boolean).join(" / ")}</small>
          </button>
        ))}
        {visibleIssues.length === 0 && <p className="bd-message-empty">No matching design issues</p>}
      </div>
    </section>
  );
}
