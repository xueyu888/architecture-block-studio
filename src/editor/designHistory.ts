import { parseBlockDesignDocument, type BlockDesignDocument } from "../model";
import { serializeDesignSnapshot } from "../io/saveDesign";
import { applyDesignOperation, type DesignOperation } from "./designEditor";

export type DesignHistorySnapshot = Uint8Array;

export interface DesignHistoryState {
  document: BlockDesignDocument;
  past: DesignHistorySnapshot[];
  future: DesignHistorySnapshot[];
  savedSnapshot?: string;
}

const historyEncoder = new TextEncoder();
const historyDecoder = new TextDecoder();

function savedSnapshot(document: BlockDesignDocument): string {
  return serializeDesignSnapshot(document);
}

function historySnapshot(document: BlockDesignDocument): DesignHistorySnapshot {
  return historyEncoder.encode(serializeDesignSnapshot(document));
}

function restore(snapshotValue: DesignHistorySnapshot): BlockDesignDocument {
  return parseBlockDesignDocument(JSON.parse(historyDecoder.decode(snapshotValue)));
}

export function createDesignHistory(
  document: BlockDesignDocument,
  saved: boolean,
): DesignHistoryState {
  return {
    document,
    past: [],
    future: [],
    savedSnapshot: saved ? savedSnapshot(document) : undefined,
  };
}

export function applyHistoryOperation(
  state: DesignHistoryState,
  operation: DesignOperation,
): DesignHistoryState {
  const previousSnapshot = savedSnapshot(state.document);
  const document = applyDesignOperation(state.document, operation);
  if (savedSnapshot(document) === previousSnapshot) return state;
  return {
    ...state,
    document,
    past: [...state.past, historyEncoder.encode(previousSnapshot)],
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
  const document = restore(previous);
  return {
    ...state,
    document,
    past: state.past.slice(0, -1),
    future: [historySnapshot(state.document), ...state.future],
  };
}

export function redoDesignHistory(state: DesignHistoryState): DesignHistoryState | undefined {
  const next = state.future[0];
  if (!next) return undefined;
  const document = restore(next);
  return {
    ...state,
    document,
    past: [...state.past, historySnapshot(state.document)],
    future: state.future.slice(1),
  };
}

export function markDesignHistorySaved(state: DesignHistoryState): DesignHistoryState {
  return { ...state, savedSnapshot: savedSnapshot(state.document) };
}

export function isDesignHistoryDirty(state: DesignHistoryState): boolean {
  return state.savedSnapshot !== savedSnapshot(state.document);
}
