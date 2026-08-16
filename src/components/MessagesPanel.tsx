import { CircleCheck, CircleX, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import type { DesignIssue } from "../model";

function IssueIcon({ severity }: { severity: DesignIssue["severity"] }) {
  if (severity === "error") return <CircleX size={14} aria-hidden="true" />;
  if (severity === "warning") return <TriangleAlert size={14} aria-hidden="true" />;
  if (severity === "info") return <CircleCheck size={14} aria-hidden="true" />;
  return <Info size={14} aria-hidden="true" />;
}

export function MessagesPanel({
  issues,
  onSelect,
}: {
  issues: DesignIssue[];
  onSelect: (issue: DesignIssue) => void;
}) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return (
    <section className="bd-messages">
      <header className="bd-messages-header">
        <div className="bd-message-tab">
          <ShieldCheck size={13} aria-hidden="true" /> Design Rule Check
          <span className="bd-message-count bd-message-error">{errors}</span>
          <span className="bd-message-count bd-message-warning">{warnings}</span>
        </div>
      </header>
      <div className="bd-message-list">
        {issues.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`bd-message-row bd-message-${item.severity}`}
            onClick={() => onSelect(item)}
          >
            <IssueIcon severity={item.severity} />
            <code>{item.code}</code>
            <span>{item.message}</span>
            <small>{[item.levelId, item.nodeId, item.portId, item.connectionId].filter(Boolean).join(" / ")}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
