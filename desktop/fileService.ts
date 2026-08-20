import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export const MAX_DESIGN_FILE_BYTES = 32 * 1024 * 1024;

function assertJsonPath(filePath: string): void {
  if (extname(filePath).toLocaleLowerCase() !== ".json") {
    throw new Error("Architecture Block Studio can only open and save JSON design documents.");
  }
}

export async function readDesignFile(filePath: string): Promise<string> {
  assertJsonPath(filePath);
  const file = await open(filePath, "r");
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("The selected design is not a regular file.");
    if (stats.size > MAX_DESIGN_FILE_BYTES) {
      throw new Error("The selected design exceeds the 32 MiB desktop safety limit.");
    }
    return await file.readFile({ encoding: "utf8" });
  } finally {
    await file.close();
  }
}

export async function writeDesignFile(filePath: string, content: string): Promise<void> {
  assertJsonPath(filePath);
  if (Buffer.byteLength(content, "utf8") > MAX_DESIGN_FILE_BYTES) {
    throw new Error("The design exceeds the 32 MiB desktop safety limit.");
  }
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await open(temporaryPath, "wx").then(async (file) => {
      try {
        await file.writeFile(content, { encoding: "utf8" });
        await file.sync();
      } finally {
        await file.close();
      }
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
