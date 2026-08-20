import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const source = resolve("build/icon.svg");
const pngPath = resolve("build/icon.png");
const icoPath = resolve("build/icon.ico");
const svg = await readFile(source);
const png = await sharp(svg, { density: 384 })
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toBuffer();

await writeFile(pngPath, png);
await writeFile(icoPath, await pngToIco(pngPath));
