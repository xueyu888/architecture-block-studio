import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

interface TooltipTriggerProps {
  "aria-describedby"?: string;
}

export interface TooltipProps {
  label: string;
  detail?: string;
  shortcut?: string;
  side?: TooltipSide;
  align?: TooltipAlign;
  children: ReactElement<TooltipTriggerProps>;
}

const POINTER_OPEN_DELAY_MS = 360;

export function Tooltip({
  label,
  detail,
  shortcut,
  side = "bottom",
  align = "center",
  children,
}: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const pointerInside = useRef(false);
  const dismissed = useRef(false);

  const clearOpenTimer = () => {
    if (openTimer.current === undefined) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  };

  const close = () => {
    clearOpenTimer();
    setOpen(false);
  };

  useEffect(() => clearOpenTimer, []);

  const showFromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    pointerInside.current = true;
    if (event.pointerType === "touch" || dismissed.current || open) return;
    clearOpenTimer();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      if (!dismissed.current && pointerInside.current) setOpen(true);
    }, POINTER_OPEN_DELAY_MS);
  };

  const hideFromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    pointerInside.current = false;
    dismissed.current = false;
    if (event.currentTarget.contains(document.activeElement)) {
      clearOpenTimer();
      return;
    }
    close();
  };

  const showFromFocus = () => {
    if (dismissed.current) return;
    clearOpenTimer();
    setOpen(true);
  };

  const hideFromFocus = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    dismissed.current = false;
    if (!pointerInside.current) close();
  };

  const dismiss = () => {
    dismissed.current = true;
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Escape") dismiss();
  };

  const supplementaryDescription = Boolean(detail || shortcut);
  const describedBy = supplementaryDescription && open
    ? [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ")
    : children.props["aria-describedby"];
  const trigger = cloneElement(children, { "aria-describedby": describedBy || undefined });

  return (
    <span
      className="bd-tooltip-trigger"
      data-tooltip-side={side}
      data-tooltip-align={align}
      onPointerEnter={showFromPointer}
      onPointerLeave={hideFromPointer}
      onPointerDownCapture={dismiss}
      onFocusCapture={showFromFocus}
      onBlurCapture={hideFromFocus}
      onKeyDownCapture={onKeyDown}
    >
      {trigger}
      {open && (
        <span id={tooltipId} className="bd-tooltip" role="tooltip">
          <strong aria-hidden={supplementaryDescription ? "true" : undefined}>{label}</strong>
          {shortcut && <kbd aria-label={`Shortcut ${shortcut}`}>{shortcut}</kbd>}
          {detail && <span className="bd-tooltip-detail">{detail}</span>}
        </span>
      )}
    </span>
  );
}
