import { useCallback, useMemo, useRef, useState } from "react";
import type { BlockDesignDocument } from "../model";
import type { DesignOperation } from "./designEditor";
import {
  applyHistoryOperation,
  createDesignHistory,
  isDesignHistoryDirty,
  markDesignHistorySaved,
  redoDesignHistory,
  replaceDesignHistory,
  undoDesignHistory,
  type DesignHistoryState,
} from "./designHistory";

export interface DesignEditor {
  document: BlockDesignDocument;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  apply: (operation: DesignOperation) => BlockDesignDocument;
  replace: (document: BlockDesignDocument, saved: boolean) => void;
  undo: () => BlockDesignDocument | undefined;
  redo: () => BlockDesignDocument | undefined;
  markSaved: () => void;
}

export function useDesignEditor(initialDocument: BlockDesignDocument): DesignEditor {
  const [state, setState] = useState(() => createDesignHistory(initialDocument, true));
  const stateRef = useRef(state);

  const commit = useCallback((next: DesignHistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback((operation: DesignOperation) => {
    const current = stateRef.current;
    const next = applyHistoryOperation(current, operation);
    commit(next);
    return next.document;
  }, [commit]);

  const replace = useCallback((document: BlockDesignDocument, saved: boolean) => {
    commit(replaceDesignHistory(document, saved));
  }, [commit]);

  const undo = useCallback(() => {
    const next = undoDesignHistory(stateRef.current);
    if (!next) return undefined;
    commit(next);
    return next.document;
  }, [commit]);

  const redo = useCallback(() => {
    const next = redoDesignHistory(stateRef.current);
    if (!next) return undefined;
    commit(next);
    return next.document;
  }, [commit]);

  const markSaved = useCallback(() => {
    commit(markDesignHistorySaved(stateRef.current));
  }, [commit]);

  const dirty = useMemo(
    () => isDesignHistoryDirty(state),
    [state.document, state.savedSnapshot],
  );

  return {
    document: state.document,
    dirty,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    replace,
    undo,
    redo,
    markSaved,
  };
}
