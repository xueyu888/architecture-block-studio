import type { BlockDesignDocument, BlockNode, DesignLevel } from "../model";

export type HierarchyDisplayRow =
  | { kind: "document"; key: string; depth: 0 }
  | { kind: "level"; key: string; depth: number; level: DesignLevel }
  | {
      kind: "node";
      key: string;
      depth: number;
      level: DesignLevel;
      node: BlockNode;
      childLevelId?: string;
      expanded: boolean;
    };

export function projectHierarchyRows(
  document: BlockDesignDocument,
  expandedLevelIds: ReadonlySet<string>,
): HierarchyDisplayRow[] {
  const levelsById = new Map(document.levels.map((level) => [level.id, level] as const));
  const rows: HierarchyDisplayRow[] = [{ kind: "document", key: `document:${document.id}`, depth: 0 }];

  const appendLevel = (levelId: string, depth: number, ancestry: ReadonlySet<string>): void => {
    const level = levelsById.get(levelId);
    if (!level || ancestry.has(levelId)) return;
    rows.push({ kind: "level", key: `level:${level.id}`, depth, level });
    const nextAncestry = new Set(ancestry).add(levelId);
    level.nodes.forEach((node) => {
      const childLevelId = node.hierarchy?.childLevelId;
      const expanded = Boolean(childLevelId && expandedLevelIds.has(childLevelId));
      rows.push({
        kind: "node",
        key: `node:${level.id}:${node.id}`,
        depth,
        level,
        node,
        childLevelId,
        expanded,
      });
      if (childLevelId && expanded) appendLevel(childLevelId, depth + 1, nextAncestry);
    });
  };

  appendLevel(document.entryLevelId, 0, new Set());
  return rows;
}
