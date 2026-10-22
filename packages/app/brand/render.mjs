// Renders the logo SVGs to the PNG icons used by the web app, the website and the desktop build.
// Usage: node render.mjs <logo.svg> <out.png@size> [...]   (needs @napi-rs/canvas, e.g. via NODE_PATH)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const [, , src, ...targets] = process.argv;
const svg = readFileSync(src, "utf8");
for (const t of targets) {
  const [file, size] = t.split("@");
  const s = Number(size);
  // render at the target size instead of scaling a 64 px bitmap
  const img = await loadImage(Buffer.from(svg.replace(/width="64" height="64"/, `width="${s}" height="${s}"`)));
  const c = createCanvas(s, s);
  c.getContext("2d").drawImage(img, 0, 0, s, s);
  writeFileSync(file, c.toBuffer("image/png"));
  console.log("wrote", file, s);
}
