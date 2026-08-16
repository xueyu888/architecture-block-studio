import { useRef, useState } from "react";
import { FileJson, Link, X } from "lucide-react";

export function LoadDesignDialog({
  open,
  busy,
  error,
  onClose,
  onLoadFile,
  onLoadUrl,
}: {
  open: boolean;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onLoadFile: (file: File) => void;
  onLoadUrl: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  return (
    <div className="bd-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="bd-dialog" role="dialog" aria-modal="true" aria-labelledby="load-design-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>BLOCK DESIGN SOURCE</span>
            <h2 id="load-design-title">Open Design</h2>
          </div>
          <button type="button" className="bd-icon-button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="bd-dialog-section">
          <h3><FileJson size={15} /> Local document</h3>
          <p>Open a BlockDesignDocument v2 JSON file. The current design stays active until parsing succeeds.</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onLoadFile(file);
            }}
          />
          <button type="button" className="bd-command-button" disabled={busy} onClick={() => inputRef.current?.click()}>
            <FileJson size={15} /> Choose JSON file
          </button>
        </div>
        <div className="bd-dialog-section">
          <h3><Link size={15} /> URL</h3>
          <p>Load a same-origin or CORS-enabled HTTP(S) JSON document.</p>
          <div className="bd-url-row">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/design.json" />
            <button type="button" className="bd-command-button" disabled={busy || !url.trim()} onClick={() => onLoadUrl(url.trim())}>
              Open
            </button>
          </div>
        </div>
        {error && <pre className="bd-load-error">{error}</pre>}
      </section>
    </div>
  );
}
