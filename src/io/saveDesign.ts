import type { BlockDesignDocument } from "../model";

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
  return `${JSON.stringify(document, null, 2)}\n`;
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
