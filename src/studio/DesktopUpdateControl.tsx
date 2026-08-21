import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ArchitectureBlockStudioDesktopBridge,
  DesktopUpdateState,
} from "../io/desktopBridge";
import { useStudioLocale } from "../i18n/StudioLocale";
import type { StudioMessageKey } from "../i18n/catalog";

type Translate = (key: StudioMessageKey, values?: Readonly<Record<string, string | number>>) => string;

function updateLabel(state: DesktopUpdateState, t: Translate): string {
  switch (state.status) {
    case "idle": return t("update.idle", { version: state.currentVersion });
    case "checking": return t("update.checking");
    case "up-to-date": return t("update.current", { version: state.currentVersion });
    case "available": return t("update.available", { version: state.availableVersion ?? "" });
    case "downloading": return t("update.downloading", { progress: Math.round(state.progressPercent ?? 0) });
    case "downloaded": return t("update.downloaded", { version: state.availableVersion ?? "" });
    case "installing": return t("update.installing");
    case "error": return t(state.availableVersion ? "update.retryDownload" : "update.retryCheck");
    case "unsupported": return "";
  }
}

export function DesktopUpdateControl({ bridge }: {
  bridge?: ArchitectureBlockStudioDesktopBridge;
}) {
  const { t } = useStudioLocale();
  const [state, setState] = useState<DesktopUpdateState>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onUpdateState((next) => {
      if (active) setState(next);
    });
    void bridge.getUpdateState().then((next) => { if (active) setState(next); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge || !state || state.status === "unsupported") return null;
  const disabled = state.status === "checking" || state.status === "downloading" || state.status === "installing";
  const icon = state.status === "available" || state.status === "downloading"
    ? <Download size={13} aria-hidden="true" />
    : state.status === "downloaded" || state.status === "installing"
      ? <RotateCw size={13} aria-hidden="true" />
      : <RefreshCw size={13} aria-hidden="true" />;
  const detail = notice ?? state.errorMessage;

  const runAction = async () => {
    setNotice(undefined);
    try {
      if (state.status === "available" || (state.status === "error" && state.availableVersion)) {
        setState(await bridge.downloadUpdate());
        return;
      }
      if (state.status === "downloaded") {
        const result = await bridge.installUpdate();
        if (result.status === "blocked") {
          setNotice(result.reason === "unsaved-changes"
            ? t("update.saveFirst")
            : t("update.notDownloaded"));
        }
        return;
      }
      setState(await bridge.checkForUpdates());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("update.failed"));
    }
  };

  return (
    <div className={`bd-desktop-update is-${state.status}`} title={detail}>
      <button type="button" disabled={disabled} onClick={() => void runAction()}>
        {icon}
        <span>{updateLabel(state, t)}</span>
      </button>
      {state.status === "downloading" && (
        <span className="bd-desktop-update-progress" aria-hidden="true">
          <i style={{ width: `${state.progressPercent ?? 0}%` }} />
        </span>
      )}
      {detail && <span className="bd-desktop-update-detail" role="status">{detail}</span>}
    </div>
  );
}
