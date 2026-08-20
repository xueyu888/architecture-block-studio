import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  MAX_DESIGN_FILE_BYTES,
  readDesignFile,
  writeDesignFile,
} from "../../desktop/fileService";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "architecture-block-studio-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("desktop file service", () => {
  test("reads and atomically replaces a JSON design without leaving temporary files", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "sample.block-design.json");
    await writeFile(filePath, "old\n", "utf8");

    await writeDesignFile(filePath, "new\n");

    expect(await readDesignFile(filePath)).toBe("new\n");
    expect(await readFile(filePath, "utf8")).toBe("new\n");
    expect(await readdir(directory)).toEqual(["sample.block-design.json"]);
  });

  test("rejects non-JSON paths and oversized designs before writing", async () => {
    const directory = await temporaryDirectory();
    await expect(writeDesignFile(join(directory, "sample.txt"), "{}\n")).rejects.toThrow(
      "only open and save JSON",
    );
    await expect(writeDesignFile(
      join(directory, "large.json"),
      "x".repeat(MAX_DESIGN_FILE_BYTES + 1),
    )).rejects.toThrow("32 MiB");
    expect(await readdir(directory)).toEqual([]);
  });
});
