import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ExternalLink,
  FolderOpen,
  LayoutDashboard,
  Maximize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Route,
  Scan,
  ShieldCheck,
} from "lucide-react";
import type { SourceRef } from "../model";

type MenuId = "file" | "design" | "view";

interface MenuCommand {
  label: string;
  icon: ReactNode;
  run: () => void;
}

function Menu({
  id,
  label,
  activeMenu,
  commands,
  onToggle,
  onClose,
}: {
  id: MenuId;
  label: string;
  activeMenu?: MenuId;
  commands: MenuCommand[];
  onToggle: (id: MenuId) => void;
  onClose: () => void;
}) {
  const open = activeMenu === id;
  return (
    <div className="bd-menu-root">
      <button
        type="button"
        className={`bd-menu-button${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        {label}
      </button>
      {open && (
        <div className="bd-menu-popover" role="menu">
          {commands.map((command) => (
            <button
              key={command.label}
              type="button"
              role="menuitem"
              onClick={() => {
                command.run();
                onClose();
              }}
            >
              {command.icon}
              <span>{command.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuBar({
  sourceRef,
  onOpen,
  onLayout,
  onOptimizeRouting,
  onFit,
  onValidate,
  onToggleSources,
  onToggleProperties,
  onToggleMessages,
  onMaximizeDiagram,
  onResetWorkspace,
}: {
  sourceRef?: SourceRef;
  onOpen: () => void;
  onLayout: () => void;
  onOptimizeRouting: () => void;
  onFit: () => void;
  onValidate: () => void;
  onToggleSources: () => void;
  onToggleProperties: () => void;
  onToggleMessages: () => void;
  onMaximizeDiagram: () => void;
  onResetWorkspace: () => void;
}) {
  const [activeMenu, setActiveMenu] = useState<MenuId>();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveMenu(undefined);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const menuProps = {
    activeMenu,
    onToggle: (id: MenuId) => setActiveMenu((current) => (current === id ? undefined : id)),
    onClose: () => setActiveMenu(undefined),
  };

  return (
    <div className="bd-menubar" ref={rootRef}>
      <Menu
        {...menuProps}
        id="file"
        label="File"
        commands={[{ label: "Open Design...", icon: <FolderOpen size={14} />, run: onOpen }]}
      />
      <Menu
        {...menuProps}
        id="design"
        label="Design"
        commands={[
          { label: "Regenerate Layout", icon: <LayoutDashboard size={14} />, run: onLayout },
          { label: "Optimize Routing", icon: <Route size={14} />, run: onOptimizeRouting },
          { label: "Validate Design", icon: <ShieldCheck size={14} />, run: onValidate },
        ]}
      />
      <Menu
        {...menuProps}
        id="view"
        label="View"
        commands={[
          { label: "Fit Design", icon: <Scan size={14} />, run: onFit },
          { label: "Toggle Sources", icon: <PanelLeft size={14} />, run: onToggleSources },
          { label: "Toggle Properties", icon: <PanelRight size={14} />, run: onToggleProperties },
          { label: "Toggle Messages", icon: <PanelBottom size={14} />, run: onToggleMessages },
          { label: "Maximize Diagram", icon: <Maximize2 size={14} />, run: onMaximizeDiagram },
          { label: "Reset Workspace", icon: <RotateCcw size={14} />, run: onResetWorkspace },
        ]}
      />
      <span />
      {sourceRef && (
        <a href={sourceRef.href} target="_blank" rel="noreferrer">
          {sourceRef.label}
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}
