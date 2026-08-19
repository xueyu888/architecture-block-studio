import { blockDesignDocumentSchema, type BlockDesignDocument } from "./design";
import { migrateBlockDesignDocument } from "./migrations";

export function parseBlockDesignDocument(input: unknown): BlockDesignDocument {
  return blockDesignDocumentSchema.parse(migrateBlockDesignDocument(input));
}
