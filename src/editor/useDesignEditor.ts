import { useCallback, useRef, useState } from "react";
import type { BlockDesignDocument } from "../model";
import { applyDesignOperation, type DesignOperation } from "./designEditor";

interface DesignHistoryState {
  document: BlockDesignDocument;
  past: BlockDesignDocument[];
  future: BlockDesignDocument[];
  savedSnapshot?: string;
}

function snapshot(document: BlockDesignDocument): string {
  return JSON.stringify(document);
}

function createState(document: BlockDesignDocument, saved: boolean): DesignHistoryState {
  return {
    document,
    past: [],
    future: [],
    savedSnapshot: saved ? snapshot(document) : undefined,
  };
}

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
  const [state, setState] = useState(() => createState(initialDocument, true));
  const stateRef = useRef(state);

  const commit = useCallback((next: DesignHistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback((operation: DesignOperation) => {
    const current = stateRef.current;
    const document = applyDesignOperation(current.document, operation);
    commit({
      ...current,
      document,
      past: [...current.past, current.document],
      future: [],
    });
    return document;
  }, [commit]);

  const replace = useCallback((document: BlockDesignDocument, saved: boolean) => {
    commit(createState(document, saved));
  }, [commit]);

  const undo = useCallback(() => {
    const current = stateRef.current;
    const document = current.past.at(-1);
    if (!document) return undefined;
    commit({
      ...current,
      document,
      past: current.past.slice(0, -1),
      future: [current.document, ...current.future],
    });
    return document;
  }, [commit]);

  const redo = useCallback(() => {
    const current = stateRef.current;
    const document = current.future[0];
    if (!document) return undefined;
    commit({
      ...current,
      document,
      past: [...current.past, current.document],
      future: current.future.slice(1),
    });
    return document;
  }, [commit]);

  const markSaved = useCallback(() => {
    const current = stateRef.current;
    commit({ ...current, savedSnapshot: snapshot(current.document) });
  }, [commit]);

  return {
    document: state.document,
    dirty: state.savedSnapshot !== snapshot(state.document),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    replace,
    undo,
    redo,
    markSaved,
  };
}
