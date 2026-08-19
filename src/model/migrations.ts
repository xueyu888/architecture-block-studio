import { z, ZodError } from "zod";
import {
  BLOCK_DESIGN_SCHEMA_VERSION,
  blockDesignDocumentSchema,
  connectionSchema,
  levelSchema,
} from "./design";

interface BlockDesignSchemaMigration {
  fromVersion: string;
  toVersion: string;
  migrate: (input: unknown) => unknown;
}

export interface BlockDesignSchemaCompatibility {
  inputVersion: string;
  outputVersion: typeof BLOCK_DESIGN_SCHEMA_VERSION;
  mode: "current" | "migrate";
}

const versionEnvelopeSchema = z.object({
  schemaVersion: z.string().min(1),
});

const legacyConnectionSchema = connectionSchema.omit({ routing: true }).strict();
const legacyLevelSchema = levelSchema.extend({
  connections: z.array(legacyConnectionSchema).default([]),
});
const blockDesignDocumentV20Schema = blockDesignDocumentSchema.extend({
  schemaVersion: z.literal("2.0"),
  levels: z.array(legacyLevelSchema).min(1),
});

function migrateV20ToV21(input: unknown): unknown {
  const legacy = blockDesignDocumentV20Schema.parse(input);
  return { ...legacy, schemaVersion: BLOCK_DESIGN_SCHEMA_VERSION };
}

const blockDesignSchemaMigrations: readonly BlockDesignSchemaMigration[] = [
  {
    fromVersion: "2.0",
    toVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    migrate: migrateV20ToV21,
  },
];

export const blockDesignSchemaCompatibility: readonly BlockDesignSchemaCompatibility[] = Object.freeze([
  ...blockDesignSchemaMigrations.map((migration) => Object.freeze({
    inputVersion: migration.fromVersion,
    outputVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    mode: "migrate" as const,
  })),
  Object.freeze({
    inputVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    outputVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    mode: "current" as const,
  }),
]);

function readSchemaVersion(input: unknown): string {
  return versionEnvelopeSchema.parse(input).schemaVersion;
}

function unsupportedVersion(version: string): ZodError {
  const supported = blockDesignSchemaCompatibility
    .map((entry) => entry.inputVersion)
    .join(", ");
  return new ZodError([{
    code: z.ZodIssueCode.custom,
    path: ["schemaVersion"],
    message: `Unsupported BlockDesignDocument schemaVersion "${version}". Supported versions: ${supported}.`,
  }]);
}

export function migrateBlockDesignDocument(input: unknown): unknown {
  let candidate = input;
  let version = readSchemaVersion(candidate);
  const visited = new Set<string>();

  while (version !== BLOCK_DESIGN_SCHEMA_VERSION) {
    if (visited.has(version)) {
      throw new Error(`BlockDesignDocument migration cycle detected at schemaVersion "${version}".`);
    }
    visited.add(version);

    const migration = blockDesignSchemaMigrations.find((step) => step.fromVersion === version);
    if (!migration) throw unsupportedVersion(version);

    candidate = migration.migrate(candidate);
    const migratedVersion = readSchemaVersion(candidate);
    if (migratedVersion !== migration.toVersion) {
      throw new Error(
        `BlockDesignDocument migration ${migration.fromVersion} -> ${migration.toVersion} produced schemaVersion "${migratedVersion}".`,
      );
    }
    version = migratedVersion;
  }

  return candidate;
}
