import { z, ZodError } from "zod";
import {
  BLOCK_DESIGN_SCHEMA_VERSION,
  blockDesignDocumentSchema,
  connectionSchema,
  levelSchema,
  nodeSchema,
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

const legacyPortV22Schema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  side: z.enum(["left", "right", "top", "bottom"]),
  direction: z.enum(["input", "output", "bidirectional"]),
  dataType: z.string().min(1).optional(),
  required: z.boolean().default(true),
  offset: z.number().finite().gt(0).lt(1),
});
const portV21Schema = legacyPortV22Schema.omit({ offset: true }).extend({
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
const nodeV22Schema = nodeSchema.extend({
  ports: z.array(legacyPortV22Schema).default([]),
});
const levelV22Schema = levelSchema.extend({
  nodes: z.array(nodeV22Schema),
});
const blockDesignDocumentV22Schema = blockDesignDocumentSchema.extend({
  schemaVersion: z.literal("2.2"),
  levels: z.array(levelV22Schema).min(1),
});

function migrateV20ToV21(input: unknown): unknown {
  const legacy = blockDesignDocumentV20Schema.parse(input);
  return { ...legacy, schemaVersion: "2.1" };
}

function migrateV21ToV22(input: unknown): unknown {
  const legacy = blockDesignDocumentV21Schema.parse(input);
  return {
    ...legacy,
    schemaVersion: "2.2",
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

function migrateV22ToV23(input: unknown): unknown {
  const legacy = blockDesignDocumentV22Schema.parse(input);
  type MigratedDirection = "input" | "output";
  const portKey = (levelId: string, nodeId: string, portId: string) =>
    JSON.stringify([levelId, nodeId, portId]);
  const directions = new Map<string, Set<MigratedDirection>>();
  const bindings: Array<readonly [string, string]> = [];
  const addDirection = (key: string, direction: MigratedDirection) => {
    const values = directions.get(key) ?? new Set<MigratedDirection>();
    values.add(direction);
    directions.set(key, values);
  };

  legacy.levels.forEach((level) => {
    level.nodes.forEach((node) => {
      node.ports.forEach((port) => {
        if (port.direction !== "bidirectional") {
          addDirection(portKey(level.id, node.id, port.id), port.direction);
        }
      });
      node.hierarchy?.portBindings.forEach((binding) => {
        bindings.push([
          portKey(level.id, node.id, binding.parentPortId),
          portKey(node.hierarchy!.childLevelId, binding.childEndpoint.nodeId, binding.childEndpoint.portId),
        ]);
      });
    });
    level.connections.forEach((connection) => {
      addDirection(portKey(level.id, connection.source.nodeId, connection.source.portId), "output");
      addDirection(portKey(level.id, connection.target.nodeId, connection.target.portId), "input");
    });
  });

  let propagated = true;
  while (propagated) {
    propagated = false;
    bindings.forEach(([left, right]) => {
      const merged = new Set([...(directions.get(left) ?? []), ...(directions.get(right) ?? [])]);
      [left, right].forEach((key) => {
        const current = directions.get(key) ?? new Set<MigratedDirection>();
        if (current.size === merged.size) return;
        directions.set(key, new Set(merged));
        propagated = true;
      });
    });
  }

  const issues: z.ZodIssue[] = [];
  const levels = legacy.levels.map((level, levelIndex) => ({
    ...level,
    nodes: level.nodes.map((node, nodeIndex) => {
      const ports = node.ports.map((port, portIndex) => {
        const inferredDirections = directions.get(portKey(level.id, node.id, port.id)) ?? new Set<MigratedDirection>();
        if (port.direction === "bidirectional" && inferredDirections.size !== 1) {
          issues.push({
            code: z.ZodIssueCode.custom,
            path: ["levels", levelIndex, "nodes", nodeIndex, "ports", portIndex, "direction"],
            message: `Port ${node.id}.${port.id} is bidirectional and has ${inferredDirections.size === 0 ? "no call direction" : "conflicting call directions"}; split it into one input port and one output port before migrating to 2.3.`,
          });
          return port;
        }
        const direction = port.direction === "bidirectional"
          ? [...inferredDirections][0]
          : port.direction;
        return {
          ...port,
          direction,
          side: direction === "input" ? "left" as const : "right" as const,
        };
      });
      const sidesToReflow = new Set(
        ports.flatMap((port, portIndex) => {
          if (port.direction === "bidirectional") return [];
          const legacyPort = node.ports[portIndex];
          return legacyPort.direction === "bidirectional" || legacyPort.side !== port.side
            ? [port.side]
            : [];
        }),
      );
      sidesToReflow.forEach((side) => {
        const sidePorts = ports
          .filter((port) => port.direction !== "bidirectional" && port.side === side)
          .sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id));
        sidePorts.forEach((port, index) => {
          port.offset = (index + 1) / (sidePorts.length + 1);
        });
      });
      return { ...node, ports };
    }),
  }));
  if (issues.length > 0) throw new ZodError(issues);
  return { ...legacy, schemaVersion: BLOCK_DESIGN_SCHEMA_VERSION, levels };
}

const blockDesignSchemaMigrations: readonly BlockDesignSchemaMigration[] = [
  {
    fromVersion: "2.0",
    toVersion: "2.1",
    migrate: migrateV20ToV21,
  },
  {
    fromVersion: "2.1",
    toVersion: "2.2",
    migrate: migrateV21ToV22,
  },
  {
    fromVersion: "2.2",
    toVersion: BLOCK_DESIGN_SCHEMA_VERSION,
    migrate: migrateV22ToV23,
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
