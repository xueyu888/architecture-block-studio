import { z } from "zod";

export const portSideSchema = z.enum(["left", "right", "top", "bottom"]);
export const portDirectionSchema = z.enum(["input", "output", "bidirectional"]);
export const interfaceKindSchema = z.enum([
  "rpc",
  "dto",
  "port",
  "integration",
  "internal",
  "event",
  "stream",
]);

export const sourceRefSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

export const inspectorSchema = z.object({
  principle: z.string().default(""),
  purpose: z.string().default(""),
  boundary: z.string().default(""),
  failure: z.string().default(""),
  sourceRef: sourceRefSchema.optional(),
  code: z.string().optional(),
  codeLanguage: z.string().min(1).default("jsonc"),
  attributes: z.record(z.string()).default({}),
});

export const portSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  side: portSideSchema,
  direction: portDirectionSchema,
  dataType: z.string().min(1).optional(),
  required: z.boolean().default(true),
  order: z.number().int().nonnegative().optional(),
});

export const endpointSchema = z.object({
  nodeId: z.string().min(1),
  portId: z.string().min(1),
});

export const hierarchyPortBindingSchema = z.object({
  parentPortId: z.string().min(1),
  childEndpoint: endpointSchema,
});

export const hierarchySchema = z.object({
  childLevelId: z.string().min(1),
  portBindings: z.array(hierarchyPortBindingSchema).default([]),
});

export const nodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.string().min(1).default("module"),
  tone: z.string().min(1).default("neutral"),
  process: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  hierarchy: hierarchySchema.optional(),
  ports: z.array(portSchema).default([]),
  inspector: inspectorSchema,
  layout: z
    .object({
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      pinned: z.boolean().default(false),
    })
    .default({ pinned: false }),
});

export const connectionSchema = z.object({
  id: z.string().min(1),
  interfaceId: z.string().min(1),
  label: z.string().min(1).optional(),
  source: endpointSchema,
  target: endpointSchema,
});

export const levelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  parentLevelId: z.string().min(1).optional(),
  nodes: z.array(nodeSchema),
  connections: z.array(connectionSchema).default([]),
  layout: z
    .object({
      direction: z.enum(["RIGHT", "DOWN", "LEFT", "UP"]).default("RIGHT"),
      spacing: z.number().positive().default(64),
      layerSpacing: z.number().positive().default(110),
    })
    .default({ direction: "RIGHT", spacing: 64, layerSpacing: 110 }),
});

export const interfaceDefinitionSchema = z.object({
  kind: interfaceKindSchema,
  title: z.string().min(1),
  protocol: z.string().min(1).optional(),
  owner: z.string().min(1),
  principle: z.string().default(""),
  purpose: z.string().default(""),
  boundary: z.string().default(""),
  failure: z.string().default(""),
  sourceRef: sourceRefSchema.optional(),
  code: z.string().default(""),
  codeLanguage: z.string().min(1).default("jsonc"),
  attributes: z.record(z.string()).default({}),
});

export const blockDesignDocumentSchema = z.object({
  schemaVersion: z.literal("2.0"),
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  entryLevelId: z.string().min(1),
  sourceRef: sourceRefSchema.optional(),
  interfaceDefinitions: z.record(interfaceDefinitionSchema),
  levels: z.array(levelSchema).min(1),
});

export type PortSide = z.infer<typeof portSideSchema>;
export type PortDirection = z.infer<typeof portDirectionSchema>;
export type InterfaceKind = z.infer<typeof interfaceKindSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type InspectorDefinition = z.infer<typeof inspectorSchema>;
export type BlockPort = z.infer<typeof portSchema>;
export type HierarchyPortBinding = z.infer<typeof hierarchyPortBindingSchema>;
export type BlockHierarchy = z.infer<typeof hierarchySchema>;
export type BlockNode = z.infer<typeof nodeSchema>;
export type ConnectionEndpoint = z.infer<typeof endpointSchema>;
export type BlockConnection = z.infer<typeof connectionSchema>;
export type DesignLevel = z.infer<typeof levelSchema>;
export type InterfaceDefinition = z.infer<typeof interfaceDefinitionSchema>;
export type BlockDesignDocument = z.infer<typeof blockDesignDocumentSchema>;

export function parseBlockDesignDocument(input: unknown): BlockDesignDocument {
  return blockDesignDocumentSchema.parse(input);
}
