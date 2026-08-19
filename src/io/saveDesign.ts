import type { BlockDesignDocument } from "../model";

function compareRecordKeys([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(compareRecordKeys));
}

function canonicalSerializationDocument(document: BlockDesignDocument): BlockDesignDocument {
  return {
    ...document,
    interfaceDefinitions: Object.fromEntries(
      Object.entries(document.interfaceDefinitions)
        .sort(compareRecordKeys)
        .map(([interfaceId, definition]) => [
          interfaceId,
          { ...definition, attributes: sortRecord(definition.attributes) },
        ]),
    ),
    levels: document.levels.map((level) => ({
      ...level,
      nodes: level.nodes.map((node) => ({
        ...node,
        inspector: {
          ...node.inspector,
          attributes: sortRecord(node.inspector.attributes),
        },
      })),
    })),
  };
}

export function normalizeDesignFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\\/:*?"<>|]+/g, "-");
  if (!trimmed) throw new Error("File name cannot be empty.");
  return trimmed.endsWith(".block-design.json") || trimmed.endsWith(".json")
    ? trimmed
    : `${trimmed}.block-design.json`;
}

export function suggestedDesignFileName(document: BlockDesignDocument): string {
  return normalizeDesignFileName(document.id);
}

export function serializeDesign(document: BlockDesignDocument): string {
  return `${JSON.stringify(canonicalSerializationDocument(document), null, 2)}\n`;
}

export function serializeDesignSnapshot(document: BlockDesignDocument): string {
  return JSON.stringify(canonicalSerializationDocument(document));
}

export function downloadDesign(document: BlockDesignDocument, fileName: string): string {
  const normalizedFileName = normalizeDesignFileName(fileName);
  const url = URL.createObjectURL(new Blob([serializeDesign(document)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = normalizedFileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return normalizedFileName;
}
