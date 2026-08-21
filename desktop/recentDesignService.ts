import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export interface RecentDesignSummary {
  id: string;
  fileName: string;
  folderPath: string;
  openedAt: string;
}

interface StoredRecentDesign extends RecentDesignSummary {
  filePath: string;
}

interface RecentDesignDocument {
  version: 1;
  entries: StoredRecentDesign[];
}

const MAX_RECENT_DESIGNS = 10;

function canonicalFileKey(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function validStoredEntry(value: unknown): value is StoredRecentDesign {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["id", "fileName", "folderPath", "openedAt", "filePath"]
    .every((key) => typeof candidate[key] === "string" && candidate[key].length > 0);
}

function projectSummary(entry: StoredRecentDesign): RecentDesignSummary {
  return {
    id: entry.id,
    fileName: entry.fileName,
    folderPath: entry.folderPath,
    openedAt: entry.openedAt,
  };
}

export class RecentDesignService {
  private entries: StoredRecentDesign[] | undefined;
  private loadPromise: Promise<StoredRecentDesign[]> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storagePath: string) {}

  private async load(): Promise<StoredRecentDesign[]> {
    if (this.entries) return this.entries;
    this.loadPromise ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.storagePath, "utf8")) as Partial<RecentDesignDocument>;
        return parsed.version === 1 && Array.isArray(parsed.entries)
          ? parsed.entries.filter(validStoredEntry).slice(0, MAX_RECENT_DESIGNS)
          : [];
      } catch {
        return [];
      }
    })();
    this.entries = await this.loadPromise;
    return this.entries;
  }

  private async persist(entries: StoredRecentDesign[]): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.storagePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.catch(() => undefined).then(mutation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async list(): Promise<RecentDesignSummary[]> {
    await this.mutationQueue.catch(() => undefined);
    return (await this.load()).map(projectSummary);
  }

  record(filePath: string, openedAt = new Date()): Promise<RecentDesignSummary[]> {
    return this.enqueueMutation(async () => {
      const normalizedPath = resolve(filePath);
      const fileKey = canonicalFileKey(normalizedPath);
      const current = await this.load();
      const existing = current.find((entry) => canonicalFileKey(entry.filePath) === fileKey);
      const nextEntry: StoredRecentDesign = {
        id: existing?.id ?? randomUUID(),
        filePath: normalizedPath,
        fileName: basename(normalizedPath),
        folderPath: dirname(normalizedPath),
        openedAt: openedAt.toISOString(),
      };
      const next = [nextEntry, ...current.filter((entry) => canonicalFileKey(entry.filePath) !== fileKey)]
        .slice(0, MAX_RECENT_DESIGNS);
      await this.persist(next);
      this.entries = next;
      return next.map(projectSummary);
    });
  }

  async resolvePath(id: string): Promise<string | undefined> {
    await this.mutationQueue.catch(() => undefined);
    return (await this.load()).find((entry) => entry.id === id)?.filePath;
  }

  remove(id: string): Promise<RecentDesignSummary[]> {
    return this.enqueueMutation(async () => {
      const current = await this.load();
      const next = current.filter((entry) => entry.id !== id);
      if (next.length === current.length) return current.map(projectSummary);
      await this.persist(next);
      this.entries = next;
      return next.map(projectSummary);
    });
  }
}
