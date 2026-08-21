import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ArchitectureBlockStudioDesktopBridge,
  DesktopUpdateState,
} from "../io/desktopBridge";

function updateLabel(state: DesktopUpdateState): string {
  switch (state.status) {
    case "idle": return `检查更新 · v${state.currentVersion}`;
    case "checking": return "正在检查更新…";
    case "up-to-date": return `已是最新版 · v${state.currentVersion}`;
    case "available": return `下载 v${state.availableVersion}`;
    case "downloading": return `正在下载 ${Math.round(state.progressPercent ?? 0)}%`;
    case "downloaded": return `重启并安装 v${state.availableVersion}`;
    case "installing": return "正在启动安装…";
    case "error": return state.availableVersion ? "重试下载" : "重试检查";
    case "unsupported": return "";
  }
}

export function DesktopUpdateControl({ bridge }: {
  bridge?: ArchitectureBlockStudioDesktopBridge;
}) {
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
            ? "请先保存设计并应用 Inspector 修改，再重启安装。"
            : "更新尚未下载完成。");
        }
        return;
      }
      setState(await bridge.checkForUpdates());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新操作失败。");
    }
  };

  return (
    <div className={`bd-desktop-update is-${state.status}`} title={detail}>
      <button type="button" disabled={disabled} onClick={() => void runAction()}>
        {icon}
        <span>{updateLabel(state)}</span>
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
