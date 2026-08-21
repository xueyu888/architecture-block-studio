import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecentDesignService } from "../../desktop/recentDesignService";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createService() {
  const directory = await mkdtemp(join(tmpdir(), "architecture-block-studio-recent-"));
  temporaryDirectories.push(directory);
  const storagePath = join(directory, "state", "recent-designs.json");
  return { service: new RecentDesignService(storagePath), storagePath, directory };
}

describe("RecentDesignService", () => {
  it("stores references only, deduplicates by canonical path, and keeps newest first", async () => {
    const { service, storagePath, directory } = await createService();
    const firstPath = join(directory, "first.block-design.json");
    const secondPath = join(directory, "second.block-design.json");

    await service.record(firstPath, new Date("2026-08-20T10:00:00.000Z"));
    await service.record(secondPath, new Date("2026-08-20T11:00:00.000Z"));
    const entries = await service.record(firstPath, new Date("2026-08-20T12:00:00.000Z"));

    expect(entries.map((entry) => entry.fileName)).toEqual([
      "first.block-design.json",
      "second.block-design.json",
    ]);
    expect(entries[0].openedAt).toBe("2026-08-20T12:00:00.000Z");
    expect(await service.resolvePath(entries[0].id)).toBe(firstPath);
    const stored = await readFile(storagePath, "utf8");
    expect(stored).toContain(firstPath);
    expect(stored).not.toContain("schemaVersion");
  });

  it("limits history to ten entries and removes unavailable references by opaque id", async () => {
    const { service, directory } = await createService();
    for (let index = 0; index < 12; index += 1) {
      await service.record(join(directory, `${index}.json`), new Date(2026, 7, 20, 10, index));
    }
    const entries = await service.list();
    expect(entries).toHaveLength(10);
    expect(entries[0].fileName).toBe("11.json");
    expect(entries.at(-1)?.fileName).toBe("2.json");
    await service.remove(entries[4].id);
    expect(await service.list()).toHaveLength(9);
    expect(await service.resolvePath(entries[4].id)).toBeUndefined();
  });

  it("keeps concurrent first records in one ordered reference list", async () => {
    const { service, directory } = await createService();
    await Promise.all([
      service.record(join(directory, "first.json"), new Date("2026-08-20T10:00:00.000Z")),
      service.record(join(directory, "second.json"), new Date("2026-08-20T11:00:00.000Z")),
    ]);
    expect((await service.list()).map((entry) => entry.fileName)).toEqual(["second.json", "first.json"]);
  });

  it("recovers from an unreadable or invalid state file", async () => {
    const { service, storagePath, directory } = await createService();
    await service.record(join(directory, "valid.json"));
    const reloaded = new RecentDesignService(storagePath);
    expect(await reloaded.list()).toHaveLength(1);
    await rm(storagePath);
    expect(await new RecentDesignService(storagePath).list()).toEqual([]);
  });
});
