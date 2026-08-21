import { useRef, useState } from "react";
import { FileJson, Link, X } from "lucide-react";
import { useStudioLocale } from "../i18n/StudioLocale";
import { useDialogFocus } from "./useDialogFocus";

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
  const { t } = useStudioLocale();
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus({ open, dialogRef, onClose });
  if (!open) return null;

  return (
    <div className="bd-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="bd-dialog" role="dialog" aria-modal="true" aria-labelledby="load-design-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{t("open.eyebrow")}</span>
            <h2 id="load-design-title">{t("open.title")}</h2>
          </div>
          <button type="button" className="bd-icon-button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="bd-dialog-section">
          <h3><FileJson size={15} /> {t("open.local")}</h3>
          <p>{t("open.localHint")}</p>
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
          <button type="button" className="bd-command-button" data-autofocus="true" disabled={busy} onClick={() => inputRef.current?.click()}>
            <FileJson size={15} /> {t("open.choose")}
          </button>
        </div>
        <div className="bd-dialog-section">
          <h3><Link size={15} /> URL</h3>
          <p>{t("open.urlHint")}</p>
          <div className="bd-url-row">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/design.json" />
            <button type="button" className="bd-command-button" disabled={busy || !url.trim()} onClick={() => onLoadUrl(url.trim())}>
              {t("open.action")}
            </button>
          </div>
        </div>
        {error && <pre className="bd-load-error">{error}</pre>}
      </section>
    </div>
  );
}
