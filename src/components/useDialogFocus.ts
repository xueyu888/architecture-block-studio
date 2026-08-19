import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

export function useDialogFocus({
  open,
  dialogRef,
  onClose,
}: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<HTMLElement | undefined>(undefined);
  const restoreFocusOnCleanupRef = useRef(true);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const prepareFocusHandoff = useCallback(() => {
    restoreFocusOnCleanupRef.current = false;
    if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    previouslyFocusedRef.current = previouslyFocused;
    restoreFocusOnCleanupRef.current = true;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = focusableElements(dialog);
    const initial = dialog.querySelector<HTMLElement>("[data-autofocus='true']") ?? focusable[0] ?? dialog;
    initial.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const currentFocusable = focusableElements(dialog);
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (restoreFocusOnCleanupRef.current && previouslyFocused?.isConnected) previouslyFocused.focus();
      previouslyFocusedRef.current = undefined;
    };
  }, [dialogRef, open]);

  return { prepareFocusHandoff };
}
