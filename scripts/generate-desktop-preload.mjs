import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const channelsPath = resolve("desktop/ipcChannels.json");
const templatePath = resolve("desktop/preload.template.cjs");
const outputPath = resolve("dist-desktop/desktop/preload.cjs");
const channels = JSON.parse(await readFile(channelsPath, "utf8"));
const template = await readFile(templatePath, "utf8");

if (!template.includes("__CHANNELS__")) {
  throw new Error("Desktop preload template is missing the channel placeholder.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, template.replace("__CHANNELS__", JSON.stringify(channels)), "utf8");
