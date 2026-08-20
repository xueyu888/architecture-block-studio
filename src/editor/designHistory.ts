import { parseBlockDesignDocument, type BlockDesignDocument } from "../model";
import { serializeDesignSnapshot } from "../io/saveDesign";
import { applyDesignOperation, type DesignOperation } from "./designEditor";

export type DesignHistorySnapshot = Uint8Array;

export interface DesignHistoryState {
  document: BlockDesignDocument;
  /** Canonical serialized derivative of document; maintained atomically by this state machine. */
  currentSnapshot: string;
  past: DesignHistorySnapshot[];
  future: DesignHistorySnapshot[];
  savedSnapshot?: string;
}

const historyEncoder = new TextEncoder();
const historyDecoder = new TextDecoder();

function documentSnapshot(document: BlockDesignDocument): string {
  return serializeDesignSnapshot(document);
}

function historySnapshot(snapshot: string): DesignHistorySnapshot {
  return historyEncoder.encode(snapshot);
}

function restore(snapshotValue: DesignHistorySnapshot): {
  document: BlockDesignDocument;
  snapshot: string;
} {
  const snapshot = historyDecoder.decode(snapshotValue);
  return {
    document: parseBlockDesignDocument(JSON.parse(snapshot)),
    snapshot,
  };
}

export function createDesignHistory(
  document: BlockDesignDocument,
  saved: boolean,
): DesignHistoryState {
  const currentSnapshot = documentSnapshot(document);
  return {
    document,
    currentSnapshot,
    past: [],
    future: [],
    savedSnapshot: saved ? currentSnapshot : undefined,
  };
}

export function applyHistoryOperation(
  state: DesignHistoryState,
  operation: DesignOperation,
): DesignHistoryState {
  const document = applyDesignOperation(state.document, operation);
  const currentSnapshot = documentSnapshot(document);
  if (currentSnapshot === state.currentSnapshot) return state;
  return {
    ...state,
    document,
    currentSnapshot,
    past: [...state.past, historySnapshot(state.currentSnapshot)],
    future: [],
  };
}

export function replaceDesignHistory(
  document: BlockDesignDocument,
  saved: boolean,
): DesignHistoryState {
  return createDesignHistory(document, saved);
}

export function undoDesignHistory(state: DesignHistoryState): DesignHistoryState | undefined {
  const previous = state.past.at(-1);
  if (!previous) return undefined;
  const restored = restore(previous);
  return {
    ...state,
    document: restored.document,
    currentSnapshot: restored.snapshot,
    past: state.past.slice(0, -1),
    future: [historySnapshot(state.currentSnapshot), ...state.future],
  };
}

export function redoDesignHistory(state: DesignHistoryState): DesignHistoryState | undefined {
  const next = state.future[0];
  if (!next) return undefined;
  const restored = restore(next);
  return {
    ...state,
    document: restored.document,
    currentSnapshot: restored.snapshot,
    past: [...state.past, historySnapshot(state.currentSnapshot)],
    future: state.future.slice(1),
  };
}

export function markDesignHistorySaved(state: DesignHistoryState): DesignHistoryState {
  return { ...state, savedSnapshot: state.currentSnapshot };
}

export function isDesignHistoryDirty(state: DesignHistoryState): boolean {
  return state.savedSnapshot !== state.currentSnapshot;
}
