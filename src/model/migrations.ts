import { z, ZodError } from "zod";
import {
  BLOCK_DESIGN_SCHEMA_VERSION,
  blockDesignDocumentSchema,
  connectionSchema,
  levelSchema,
  nodeSchema,
  portSchema,
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

const portV21Schema = portSchema.omit({ offset: true }).extend({
  order: z.number().int().nonnegative().optional(),
});
const nodeV21Schema = nodeSchema.extend({
  ports: z.array(portV21Schema).default([]),
});
const levelV21Schema = levelSchema.extend({
  nodes: z.array(nodeV21Schema),
});
const blockDesignDocumentV21Schema = blockDesignDocumentSchema.extend({
  schemaVersion: z.literal("2.1"),
  levels: z.array(levelV21Schema).min(1),
});
const connectionV20Schema = connectionSchema.omit({ routing: true }).strict();
const levelV20Schema = levelV21Schema.extend({
  connections: z.array(connectionV20Schema).default([]),
});
const blockDesignDocumentV20Schema = blockDesignDocumentSchema.extend({
  schemaVersion: z.literal("2.0"),
  levels: z.array(levelV20Schema).min(1),
});

function migrateV20ToV21(input: unknown): unknown {
  const legacy = blockDesignDocumentV20Schema.parse(input);
  return { ...legacy, schemaVersion: "2.1" };
}

function migrateV21ToV22(input: unknown): unknown {
  const legacy = blockDesignDocumentV21Schema.parse(input);
  return {
    ...legacy,
    schemaVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    levels: legacy.levels.map((level) => ({
      ...level,
      nodes: level.nodes.map((node) => {
        const offsets = new Map<string, number>();
        (["left", "right", "top", "bottom"] as const).forEach((side) => {
          const sidePorts = node.ports
            .filter((port) => port.side === side)
            .sort((left, right) =>
              (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
              left.label.localeCompare(right.label) ||
              left.id.localeCompare(right.id)
            );
          sidePorts.forEach((port, index) => offsets.set(port.id, (index + 1) / (sidePorts.length + 1)));
        });
        return {
          ...node,
          ports: node.ports.map(({ order: _order, ...port }) => ({
            ...port,
            offset: offsets.get(port.id) ?? 0.5,
          })),
        };
      }),
    })),
  };
}

const blockDesignSchemaMigrations: readonly BlockDesignSchemaMigration[] = [
  {
    fromVersion: "2.0",
    toVersion: "2.1",
    migrate: migrateV20ToV21,
  },
  {
    fromVersion: "2.1",
    toVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    migrate: migrateV21ToV22,
  },
];

export const blockDesignSchemaCompatibility: readonly BlockDesignSchemaCompatibility[] = Object.freeze([
  ...[...new Set(blockDesignSchemaMigrations.map((migration) => migration.fromVersion))].map((inputVersion) => Object.freeze({
    inputVersion,
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
