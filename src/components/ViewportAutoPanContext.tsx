import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ViewportAutoPanController } from "./viewportAutoPan";

const ViewportAutoPanContext = createContext<ViewportAutoPanController | undefined>(undefined);

export function ViewportAutoPanProvider({
  controller,
  children,
}: {
  controller: ViewportAutoPanController;
  children: ReactNode;
}) {
  const lifecycleGeneration = useRef(0);
  const currentController = useRef(controller);
  currentController.current = controller;
  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      const cleanupGeneration = lifecycleGeneration.current;
      // Strict Mode immediately re-runs the same effect after its development
      // cleanup probe. A microtask distinguishes that probe from a real
      // unmount without leaving an obsolete controller alive after replacement.
      queueMicrotask(() => {
        if (
          lifecycleGeneration.current === cleanupGeneration ||
          currentController.current !== controller
        ) {
          controller.dispose();
        }
      });
    };
  }, [controller]);
  return (
    <ViewportAutoPanContext.Provider value={controller}>
      {children}
    </ViewportAutoPanContext.Provider>
  );
}

export function useViewportAutoPan(): ViewportAutoPanController {
  const controller = useContext(ViewportAutoPanContext);
  if (!controller) throw new Error("Canvas gestures require ViewportAutoPanProvider.");
  return controller;
}
